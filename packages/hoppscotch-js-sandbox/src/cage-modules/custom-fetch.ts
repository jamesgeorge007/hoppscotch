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

    // ========================================================================
    // Headers Class Implementation
    // ========================================================================
    const HeadersClass = defineSandboxFunctionRaw(ctx, "Headers", (...args) => {
      // Create internal headers storage
      const headersData: Record<string, string> = {}

      // Initialize from argument if provided
      if (args.length > 0) {
        const init = ctx.vm.dump(args[0])
        if (init && typeof init === "object") {
          if (Array.isArray(init)) {
            // Array of [key, value] pairs
            for (const [key, value] of init) {
              headersData[String(key).toLowerCase()] = String(value)
            }
          } else {
            // Object with key-value pairs
            for (const [key, value] of Object.entries(init)) {
              headersData[key.toLowerCase()] = String(value)
            }
          }
        }
      }

      const headersInstance = ctx.scope.manage(ctx.vm.newObject())

      // append(name, value) - adds value to header
      const appendFn = defineSandboxFunctionRaw(ctx, "append", (...appendArgs) => {
        const name = String(ctx.vm.dump(appendArgs[0])).toLowerCase()
        const value = String(ctx.vm.dump(appendArgs[1]))

        if (headersData[name]) {
          headersData[name] = `${headersData[name]}, ${value}`
        } else {
          headersData[name] = value
        }

        return ctx.vm.undefined
      })
      ctx.vm.setProp(headersInstance, "append", appendFn)

      // delete(name) - removes header
      const deleteFn = defineSandboxFunctionRaw(ctx, "delete", (...deleteArgs) => {
        const name = String(ctx.vm.dump(deleteArgs[0])).toLowerCase()
        delete headersData[name]
        return ctx.vm.undefined
      })
      ctx.vm.setProp(headersInstance, "delete", deleteFn)

      // get(name) - retrieves header value
      const getFn = defineSandboxFunctionRaw(ctx, "get", (...getArgs) => {
        const name = String(ctx.vm.dump(getArgs[0])).toLowerCase()
        const value = headersData[name]
        return value !== undefined ? ctx.scope.manage(ctx.vm.newString(value)) : ctx.vm.null
      })
      ctx.vm.setProp(headersInstance, "get", getFn)

      // has(name) - checks if header exists
      const hasFn = defineSandboxFunctionRaw(ctx, "has", (...hasArgs) => {
        const name = String(ctx.vm.dump(hasArgs[0])).toLowerCase()
        return headersData[name] !== undefined ? ctx.vm.true : ctx.vm.false
      })
      ctx.vm.setProp(headersInstance, "has", hasFn)

      // set(name, value) - sets or overwrites header
      const setFn = defineSandboxFunctionRaw(ctx, "set", (...setArgs) => {
        const name = String(ctx.vm.dump(setArgs[0])).toLowerCase()
        const value = String(ctx.vm.dump(setArgs[1]))
        headersData[name] = value
        return ctx.vm.undefined
      })
      ctx.vm.setProp(headersInstance, "set", setFn)

      // forEach(callbackfn) - iterates with callback
      const forEachFn = defineSandboxFunctionRaw(ctx, "forEach", (...forEachArgs) => {
        const callback = forEachArgs[0]

        for (const [key, value] of Object.entries(headersData)) {
          ctx.vm.callFunction(
            callback,
            ctx.vm.undefined,
            ctx.scope.manage(ctx.vm.newString(value)),
            ctx.scope.manage(ctx.vm.newString(key)),
            headersInstance
          )
        }

        return ctx.vm.undefined
      })
      ctx.vm.setProp(headersInstance, "forEach", forEachFn)

      // entries() - returns [key, value] iterator
      const entriesFn = defineSandboxFunctionRaw(ctx, "entries", () => {
        const entriesArray = ctx.scope.manage(ctx.vm.newArray())
        let index = 0

        for (const [key, value] of Object.entries(headersData)) {
          const entry = ctx.scope.manage(ctx.vm.newArray())
          ctx.vm.setProp(entry, 0, ctx.scope.manage(ctx.vm.newString(key)))
          ctx.vm.setProp(entry, 1, ctx.scope.manage(ctx.vm.newString(value)))
          ctx.vm.setProp(entriesArray, index++, entry)
        }

        return entriesArray
      })
      ctx.vm.setProp(headersInstance, "entries", entriesFn)

      // keys() - returns header names iterator
      const keysFn = defineSandboxFunctionRaw(ctx, "keys", () => {
        const keysArray = ctx.scope.manage(ctx.vm.newArray())
        let index = 0

        for (const key of Object.keys(headersData)) {
          ctx.vm.setProp(keysArray, index++, ctx.scope.manage(ctx.vm.newString(key)))
        }

        return keysArray
      })
      ctx.vm.setProp(headersInstance, "keys", keysFn)

      // values() - returns header values iterator
      const valuesFn = defineSandboxFunctionRaw(ctx, "values", () => {
        const valuesArray = ctx.scope.manage(ctx.vm.newArray())
        let index = 0

        for (const value of Object.values(headersData)) {
          ctx.vm.setProp(valuesArray, index++, ctx.scope.manage(ctx.vm.newString(value)))
        }

        return valuesArray
      })
      ctx.vm.setProp(headersInstance, "values", valuesFn)

      // Store internal headers data for access by other classes
      ctx.vm.setProp(
        headersInstance,
        "__internal_headers",
        marshalValue(headersData)
      )

      return headersInstance
    })

    ctx.vm.setProp(ctx.vm.global, "Headers", HeadersClass)

    // ========================================================================
    // Request Class Implementation
    // ========================================================================
    const RequestClass = defineSandboxFunctionRaw(ctx, "Request", (...args) => {
      const input = ctx.vm.dump(args[0])
      const init = args.length > 1 ? ctx.vm.dump(args[1]) : {}

      const requestInstance = ctx.scope.manage(ctx.vm.newObject())

      // Determine URL
      let url: string
      if (typeof input === "string") {
        url = input
      } else if (input && typeof input === "object" && "url" in input) {
        url = String(input.url)
      } else {
        url = ""
      }

      // Set URL property
      ctx.vm.setProp(requestInstance, "url", ctx.scope.manage(ctx.vm.newString(url)))

      // Set method property
      const method = (init.method || "GET").toUpperCase()
      ctx.vm.setProp(requestInstance, "method", ctx.scope.manage(ctx.vm.newString(method)))

      // Set headers property - call Headers constructor directly
      // We can't use callFunction with scope.manage, so we create headers inline
      const headersData = init.headers || {}
      const headersObj = ctx.scope.manage(ctx.vm.newObject())

      // Populate headers from init
      if (headersData && typeof headersData === "object") {
        for (const [key, value] of Object.entries(headersData)) {
          ctx.vm.setProp(
            headersObj,
            key.toLowerCase(),
            ctx.scope.manage(ctx.vm.newString(String(value)))
          )
        }
      }

      ctx.vm.setProp(requestInstance, "headers", headersObj)

      // Set body property (can be string, ArrayBuffer, or null)
      if (init.body !== undefined && init.body !== null) {
        ctx.vm.setProp(requestInstance, "body", marshalValue(init.body))
      } else {
        ctx.vm.setProp(requestInstance, "body", ctx.vm.null)
      }

      // Set mode property
      ctx.vm.setProp(
        requestInstance,
        "mode",
        ctx.scope.manage(ctx.vm.newString(init.mode || "cors"))
      )

      // Set credentials property
      ctx.vm.setProp(
        requestInstance,
        "credentials",
        ctx.scope.manage(ctx.vm.newString(init.credentials || "same-origin"))
      )

      // Set cache property
      ctx.vm.setProp(
        requestInstance,
        "cache",
        ctx.scope.manage(ctx.vm.newString(init.cache || "default"))
      )

      // Set redirect property
      ctx.vm.setProp(
        requestInstance,
        "redirect",
        ctx.scope.manage(ctx.vm.newString(init.redirect || "follow"))
      )

      // Set referrer property
      ctx.vm.setProp(
        requestInstance,
        "referrer",
        ctx.scope.manage(ctx.vm.newString(init.referrer || "about:client"))
      )

      // Set integrity property
      ctx.vm.setProp(
        requestInstance,
        "integrity",
        ctx.scope.manage(ctx.vm.newString(init.integrity || ""))
      )

      // clone() method - creates a copy of the request
      const cloneFn = defineSandboxFunctionRaw(ctx, "clone", () => {
        // Create a new request instance manually to avoid callFunction type issues
        const clonedRequest = ctx.scope.manage(ctx.vm.newObject())

        // Copy all properties
        ctx.vm.setProp(clonedRequest, "url", ctx.scope.manage(ctx.vm.newString(url)))
        ctx.vm.setProp(clonedRequest, "method", ctx.scope.manage(ctx.vm.newString(method)))

        // Clone headers
        const clonedHeadersObj = ctx.scope.manage(ctx.vm.newObject())
        if (headersData && typeof headersData === "object") {
          for (const [key, value] of Object.entries(headersData)) {
            ctx.vm.setProp(
              clonedHeadersObj,
              key.toLowerCase(),
              ctx.scope.manage(ctx.vm.newString(String(value)))
            )
          }
        }
        ctx.vm.setProp(clonedRequest, "headers", clonedHeadersObj)

        // Copy other properties
        if (init.body !== undefined && init.body !== null) {
          ctx.vm.setProp(clonedRequest, "body", marshalValue(init.body))
        } else {
          ctx.vm.setProp(clonedRequest, "body", ctx.vm.null)
        }
        ctx.vm.setProp(clonedRequest, "mode", ctx.scope.manage(ctx.vm.newString(init.mode || "cors")))
        ctx.vm.setProp(clonedRequest, "credentials", ctx.scope.manage(ctx.vm.newString(init.credentials || "same-origin")))
        ctx.vm.setProp(clonedRequest, "cache", ctx.scope.manage(ctx.vm.newString(init.cache || "default")))
        ctx.vm.setProp(clonedRequest, "redirect", ctx.scope.manage(ctx.vm.newString(init.redirect || "follow")))
        ctx.vm.setProp(clonedRequest, "referrer", ctx.scope.manage(ctx.vm.newString(init.referrer || "about:client")))
        ctx.vm.setProp(clonedRequest, "integrity", ctx.scope.manage(ctx.vm.newString(init.integrity || "")))

        return clonedRequest
      })
      ctx.vm.setProp(requestInstance, "clone", cloneFn)

      return requestInstance
    })

    ctx.vm.setProp(ctx.vm.global, "Request", RequestClass)

    // ========================================================================
    // Response Class Implementation
    // ========================================================================
    const ResponseClass = defineSandboxFunctionRaw(ctx, "Response", (...args) => {
      const body = args.length > 0 ? ctx.vm.dump(args[0]) : null
      const init = args.length > 1 ? ctx.vm.dump(args[1]) : {}

      const responseInstance = ctx.scope.manage(ctx.vm.newObject())

      // Set status property
      const status = init.status || 200
      ctx.vm.setProp(responseInstance, "status", ctx.scope.manage(ctx.vm.newNumber(status)))

      // Set statusText property
      ctx.vm.setProp(
        responseInstance,
        "statusText",
        ctx.scope.manage(ctx.vm.newString(init.statusText || ""))
      )

      // Set ok property (true for 200-299 status codes)
      const ok = status >= 200 && status < 300
      ctx.vm.setProp(responseInstance, "ok", ok ? ctx.vm.true : ctx.vm.false)

      // Set headers property - create headers inline
      const responseHeadersData = init.headers || {}
      const responseHeadersObj = ctx.scope.manage(ctx.vm.newObject())

      // Populate headers from init
      if (responseHeadersData && typeof responseHeadersData === "object") {
        for (const [key, value] of Object.entries(responseHeadersData)) {
          ctx.vm.setProp(
            responseHeadersObj,
            key.toLowerCase(),
            ctx.scope.manage(ctx.vm.newString(String(value)))
          )
        }
      }

      ctx.vm.setProp(responseInstance, "headers", responseHeadersObj)

      // Set type property
      ctx.vm.setProp(
        responseInstance,
        "type",
        ctx.scope.manage(ctx.vm.newString(init.type || "default"))
      )

      // Set url property
      ctx.vm.setProp(
        responseInstance,
        "url",
        ctx.scope.manage(ctx.vm.newString(init.url || ""))
      )

      // Set redirected property
      ctx.vm.setProp(
        responseInstance,
        "redirected",
        init.redirected ? ctx.vm.true : ctx.vm.false
      )

      // Store body internally
      let bodyBytes: number[] = []
      if (body !== null && body !== undefined) {
        if (typeof body === "string") {
          bodyBytes = Array.from(new TextEncoder().encode(body))
        } else if (typeof body === "object" && body !== null) {
          // Assume it's JSON-serializable
          const jsonString = JSON.stringify(body)
          bodyBytes = Array.from(new TextEncoder().encode(jsonString))
        }
      }

      // json() method
      const jsonFn = defineSandboxFunctionRaw(ctx, "json", () => {
        const vmPromise = ctx.vm.newPromise((resolve, reject) => {
          try {
            const text = new TextDecoder().decode(new Uint8Array(bodyBytes))
            const parsed = JSON.parse(text)
            resolve(marshalValue(parsed))
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
      ctx.vm.setProp(responseInstance, "json", jsonFn)

      // text() method
      const textFn = defineSandboxFunctionRaw(ctx, "text", () => {
        const vmPromise = ctx.vm.newPromise((resolve, reject) => {
          try {
            const text = new TextDecoder().decode(new Uint8Array(bodyBytes))
            resolve(ctx.scope.manage(ctx.vm.newString(text)))
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
      ctx.vm.setProp(responseInstance, "text", textFn)

      // clone() method
      const cloneFn = defineSandboxFunctionRaw(ctx, "clone", () => {
        // Create a new response instance manually to avoid callFunction type issues
        const clonedResponse = ctx.scope.manage(ctx.vm.newObject())

        // Copy all properties
        ctx.vm.setProp(clonedResponse, "status", ctx.scope.manage(ctx.vm.newNumber(status)))
        ctx.vm.setProp(clonedResponse, "statusText", ctx.scope.manage(ctx.vm.newString(init.statusText || "")))
        ctx.vm.setProp(clonedResponse, "ok", ok ? ctx.vm.true : ctx.vm.false)

        // Clone headers
        const clonedResponseHeadersObj = ctx.scope.manage(ctx.vm.newObject())
        if (responseHeadersData && typeof responseHeadersData === "object") {
          for (const [key, value] of Object.entries(responseHeadersData)) {
            ctx.vm.setProp(
              clonedResponseHeadersObj,
              key.toLowerCase(),
              ctx.scope.manage(ctx.vm.newString(String(value)))
            )
          }
        }
        ctx.vm.setProp(clonedResponse, "headers", clonedResponseHeadersObj)

        // Copy other properties
        ctx.vm.setProp(clonedResponse, "type", ctx.scope.manage(ctx.vm.newString(init.type || "default")))
        ctx.vm.setProp(clonedResponse, "url", ctx.scope.manage(ctx.vm.newString(init.url || "")))
        ctx.vm.setProp(clonedResponse, "redirected", init.redirected ? ctx.vm.true : ctx.vm.false)

        // Note: We don't copy body methods as they would share the same bodyBytes reference
        // In a real implementation, you'd need to clone the body stream

        return clonedResponse
      })
      ctx.vm.setProp(responseInstance, "clone", cloneFn)

      return responseInstance
    })

    ctx.vm.setProp(ctx.vm.global, "Response", ResponseClass)

    // ========================================================================
    // AbortController Class Implementation
    // ========================================================================
    const AbortControllerClass = defineSandboxFunctionRaw(ctx, "AbortController", () => {
      const controllerInstance = ctx.scope.manage(ctx.vm.newObject())

      // Create AbortSignal
      const signalInstance = ctx.scope.manage(ctx.vm.newObject())
      ctx.vm.setProp(signalInstance, "aborted", ctx.vm.false)

      // Store abort listeners
      const abortListeners: any[] = []

      // addEventListener method for signal
      const addEventListenerFn = defineSandboxFunctionRaw(
        ctx,
        "addEventListener",
        (...listenerArgs) => {
          const eventType = ctx.vm.dump(listenerArgs[0])
          if (eventType === "abort") {
            abortListeners.push(listenerArgs[1])
          }
          return ctx.vm.undefined
        }
      )
      ctx.vm.setProp(signalInstance, "addEventListener", addEventListenerFn)

      // Set signal property on controller
      ctx.vm.setProp(controllerInstance, "signal", signalInstance)

      // abort() method
      const abortFn = defineSandboxFunctionRaw(ctx, "abort", () => {
        // Mark signal as aborted
        ctx.vm.setProp(signalInstance, "aborted", ctx.vm.true)

        // Call all abort listeners
        for (const listener of abortListeners) {
          ctx.vm.callFunction(listener, ctx.vm.undefined)
        }

        return ctx.vm.undefined
      })
      ctx.vm.setProp(controllerInstance, "abort", abortFn)

      return controllerInstance
    })

    ctx.vm.setProp(ctx.vm.global, "AbortController", AbortControllerClass)
  })
