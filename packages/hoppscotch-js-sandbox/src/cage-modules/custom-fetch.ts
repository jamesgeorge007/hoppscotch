import { defineCageModule, defineSandboxFunctionRaw } from "faraday-cage/modules"
import type { HoppFetchHook } from "~/types"

/**
 * Extended Response type with _bodyBytes property
 */
type SerializableResponse = Response & {
  _bodyBytes: number[]
}

/**
 * Interface for configuring the custom fetch module
 */
export type CustomFetchModuleConfig = {
  /**
   * Custom fetch implementation to use (HoppFetchHook)
   */
  fetchImpl?: HoppFetchHook
}

/**
 * Creates a custom fetch module that uses HoppFetchHook
 * This module wraps the HoppFetchHook and provides proper async handling
 */
export const customFetchModule = (config: CustomFetchModuleConfig = {}) =>
  defineCageModule((ctx) => {
    const fetchImpl = config.fetchImpl || globalThis.fetch

    // Track pending async operations
    const pendingOperations: Promise<unknown>[] = []
    let resolveKeepAlive: (() => void) | null = null

    // Create keepAlive promise BEFORE registering hook
    const keepAlivePromise = new Promise<void>((resolve) => {
      resolveKeepAlive = resolve
    })

    ctx.keepAlivePromises.push(keepAlivePromise)

    // Register async hook to wait for all fetch operations
    // NOTE: Type says (() => void) but faraday-cage's own fetch module uses async functions
    ctx.afterScriptExecutionHooks.push((async () => {
      // Poll until all operations are complete with grace period
      let emptyRounds = 0
      const maxEmptyRounds = 5

      while (emptyRounds < maxEmptyRounds) {
        if (pendingOperations.length > 0) {
          emptyRounds = 0
          await Promise.allSettled(pendingOperations)
          await new Promise((r) => setTimeout(r, 10))
        } else {
          emptyRounds++
          // Grace period: wait for VM to process jobs
          await new Promise((r) => setTimeout(r, 10))
        }
      }
      resolveKeepAlive?.()
    }) as any) // Cast needed because types say (() => void) but runtime supports async

    // Track async operations
    const trackAsyncOperation = <T>(promise: Promise<T>): Promise<T> => {
      pendingOperations.push(promise)
      return promise.finally(() => {
        const index = pendingOperations.indexOf(promise)
        if (index > -1) {
          pendingOperations.splice(index, 1)
        }
      })
    }

    // Helper to marshal values to VM
    const marshalValue = (value: any): any => {
      if (value === null) return ctx.vm.null
      if (value === undefined) return ctx.vm.undefined
      if (value === true) return ctx.vm.true
      if (value === false) return ctx.vm.false
      if (typeof value === "string") return ctx.scope.manage(ctx.vm.newString(value))
      if (typeof value === "number") return ctx.scope.manage(ctx.vm.newNumber(value))
      if (typeof value === "object") {
        if (Array.isArray(value)) {
          const arr = ctx.scope.manage(ctx.vm.newArray())
          value.forEach((item, i) => {
            ctx.vm.setProp(arr, i, marshalValue(item))
          })
          return arr
        } else {
          const obj = ctx.scope.manage(ctx.vm.newObject())
          for (const [k, v] of Object.entries(value)) {
            ctx.vm.setProp(obj, k, marshalValue(v))
          }
          return obj
        }
      }
      return ctx.vm.undefined
    }

    // Define fetch function in the sandbox
    const fetchFn = defineSandboxFunctionRaw(ctx, "fetch", (...args) => {
      const [input, init] = args.map((arg) => ctx.vm.dump(arg))

      const promiseHandle = ctx.scope.manage(
        ctx.vm.newPromise((resolve, reject) => {
          const fetchPromise = trackAsyncOperation(fetchImpl(input, init))

          fetchPromise
            .then((response) => {
              // Cast to SerializableResponse to access _bodyBytes
              const serializableResponse = response as SerializableResponse

              // Create a serializable response object
              const responseObj = ctx.scope.manage(ctx.vm.newObject())

              // Set basic properties
              ctx.vm.setProp(
                responseObj,
                "status",
                ctx.scope.manage(ctx.vm.newNumber(serializableResponse.status))
              )
              ctx.vm.setProp(
                responseObj,
                "statusText",
                ctx.scope.manage(ctx.vm.newString(serializableResponse.statusText))
              )
              ctx.vm.setProp(
                responseObj,
                "ok",
                serializableResponse.ok ? ctx.vm.true : ctx.vm.false
              )

              // Create headers object with Headers-like interface
              const headersObj = ctx.scope.manage(ctx.vm.newObject())
              // Use _headersData which contains only header key-value pairs (no methods)
              const headersMap = ((serializableResponse as any)._headersData as Record<string, string>) || {}

              // Set individual header properties
              for (const [key, value] of Object.entries(headersMap)) {
                ctx.vm.setProp(
                  headersObj,
                  key,
                  ctx.scope.manage(ctx.vm.newString(String(value)))
                )
              }

              // Add entries() method for Headers compatibility
              // Returns an array of [key, value] pairs
              // QuickJS arrays are iterable by default, so for...of will work
              const entriesFn = defineSandboxFunctionRaw(ctx, "entries", () => {
                const entriesArray = ctx.scope.manage(ctx.vm.newArray())
                let index = 0
                for (const [key, value] of Object.entries(headersMap)) {
                  const entry = ctx.scope.manage(ctx.vm.newArray())
                  ctx.vm.setProp(
                    entry,
                    0,
                    ctx.scope.manage(ctx.vm.newString(key))
                  )
                  ctx.vm.setProp(
                    entry,
                    1,
                    ctx.scope.manage(ctx.vm.newString(String(value)))
                  )
                  ctx.vm.setProp(entriesArray, index++, entry)
                }
                return entriesArray
              })
              ctx.vm.setProp(headersObj, "entries", entriesFn)

              // Add get() method for Headers compatibility
              const getFn = defineSandboxFunctionRaw(ctx, "get", (...args) => {
                const key = String(ctx.vm.dump(args[0]))
                const value = headersMap[key] || headersMap[key.toLowerCase()]
                return value ? ctx.scope.manage(ctx.vm.newString(value)) : ctx.vm.null
              })
              ctx.vm.setProp(headersObj, "get", getFn)

              ctx.vm.setProp(responseObj, "headers", headersObj)

              // Store the body bytes internally
              const bodyBytes = serializableResponse._bodyBytes || []

              // Store body bytes for sync access
              const bodyBytesArray = ctx.scope.manage(ctx.vm.newArray())
              for (let i = 0; i < bodyBytes.length; i++) {
                ctx.vm.setProp(bodyBytesArray, i, ctx.scope.manage(ctx.vm.newNumber(bodyBytes[i])))
              }
              ctx.vm.setProp(responseObj, "_bodyBytes", bodyBytesArray)

              // Add json() method - returns promise
              const jsonFn = defineSandboxFunctionRaw(ctx, "json", () => {
                // Parse synchronously and create a VM promise that resolves immediately
                const vmPromise = ctx.vm.newPromise((resolve, reject) => {
                  try {
                    // Filter out null bytes (some interceptors add trailing null bytes)
                    // Find the first null byte and truncate there, or use all bytes if no null
                    const nullByteIndex = bodyBytes.indexOf(0)
                    const cleanBytes = nullByteIndex >= 0 ? bodyBytes.slice(0, nullByteIndex) : bodyBytes

                    const text = new TextDecoder().decode(new Uint8Array(cleanBytes))
                    const parsed = JSON.parse(text)
                    const marshalledResult = marshalValue(parsed)
                    resolve(marshalledResult)
                  } catch (error) {
                    reject(
                      ctx.scope.manage(
                        ctx.vm.newError({
                          name: "JSONError",
                          message: error instanceof Error ? error.message : "JSON parse failed",
                        })
                      )
                    )
                  }
                })

                return ctx.scope.manage(vmPromise).handle
              })

              ctx.vm.setProp(responseObj, "json", jsonFn)

              // Add text() method - returns promise
              const textFn = defineSandboxFunctionRaw(ctx, "text", () => {
                // Parse synchronously and create a VM promise that resolves immediately
                const vmPromise = ctx.vm.newPromise((resolve, reject) => {
                  try {
                    // Filter out null bytes (some interceptors add trailing null bytes)
                    const nullByteIndex = bodyBytes.indexOf(0)
                    const cleanBytes = nullByteIndex >= 0 ? bodyBytes.slice(0, nullByteIndex) : bodyBytes

                    const text = new TextDecoder().decode(new Uint8Array(cleanBytes))
                    const textHandle = ctx.scope.manage(ctx.vm.newString(String(text)))
                    resolve(textHandle)
                  } catch (error) {
                    reject(
                      ctx.scope.manage(
                        ctx.vm.newError({
                          name: "TextError",
                          message: error instanceof Error ? error.message : "Text decode failed",
                        })
                      )
                    )
                  }
                })

                return ctx.scope.manage(vmPromise).handle
              })

              ctx.vm.setProp(responseObj, "text", textFn)

              resolve(responseObj)
            })
            .catch((error) => {
              reject(
                ctx.scope.manage(
                  ctx.vm.newError({
                    name: "FetchError",
                    message: error instanceof Error ? error.message : "Fetch failed",
                  })
                )
              )
            })
        })
      )

      return promiseHandle.handle
    })

    // Add fetch to global scope
    ctx.vm.setProp(ctx.vm.global, "fetch", fetchFn)
  })
