import { Cookie, HoppRESTRequest } from "@hoppscotch/data"
import {
  CageModuleCtx,
  defineCageModule,
  defineSandboxFn,
  defineSandboxFunctionRaw,
  defineSandboxObject,
} from "faraday-cage/modules"

import { getStatusReason } from "~/constants/http-status-codes"
import { TestDescriptor, TestResponse, TestResult } from "~/types"
import postRequestBootstrapCode from "../bootstrap-code/post-request?raw"
import preRequestBootstrapCode from "../bootstrap-code/pre-request?raw"
import { createBaseInputs } from "./utils/base-inputs"
import { createChaiMethods } from "./utils/chai-helpers"
import { createExpectationMethods } from "./utils/expectation-helpers"
import { createRequestSetterMethods } from "./utils/request-setters"

type PostRequestModuleConfig = {
  envs: TestResult["envs"]
  testRunStack: TestDescriptor[]
  request: HoppRESTRequest
  response: TestResponse
  cookies: Cookie[] | null
  handleSandboxResults: ({
    envs,
    testRunStack,
    cookies,
  }: {
    envs: TestResult["envs"]
    testRunStack: TestDescriptor[]
    cookies: Cookie[] | null
  }) => void
  onTestPromise?: (promise: Promise<void>) => void
}

type PreRequestModuleConfig = {
  envs: TestResult["envs"]
  request: HoppRESTRequest
  cookies: Cookie[] | null
  handleSandboxResults: ({
    envs,
    request,
    cookies,
  }: {
    envs: TestResult["envs"]
    request: HoppRESTRequest
    cookies: Cookie[] | null
  }) => void
}

type ModuleType = "pre" | "post"
type ModuleConfig = PreRequestModuleConfig | PostRequestModuleConfig

/**
 * Additional results that may be required for hook registration
 */
type HookRegistrationAdditionalResults = {
  getUpdatedRequest: () => HoppRESTRequest
}

/**
 * Helper function to register after-script execution hooks with proper typing
 * Overload for pre-request hooks (requires additionalResults)
 */
function registerAfterScriptExecutionHook(
  ctx: CageModuleCtx,
  type: "pre",
  config: PreRequestModuleConfig,
  baseInputs: ReturnType<typeof createBaseInputs>,
  additionalResults: HookRegistrationAdditionalResults
): void

/**
 * Overload for post-request hooks (no additionalResults needed)
 */
function registerAfterScriptExecutionHook(
  ctx: CageModuleCtx,
  type: "post",
  config: PostRequestModuleConfig,
  baseInputs: ReturnType<typeof createBaseInputs>
): void

/**
 * Implementation of the hook registration function
 */
function registerAfterScriptExecutionHook(
  ctx: CageModuleCtx,
  type: ModuleType,
  config: ModuleConfig,
  baseInputs: ReturnType<typeof createBaseInputs>,
  additionalResults?: HookRegistrationAdditionalResults
) {
  if (type === "pre") {
    const preConfig = config as PreRequestModuleConfig
    const getUpdatedRequest = additionalResults?.getUpdatedRequest

    if (!getUpdatedRequest) {
      throw new Error(
        "getUpdatedRequest is required for pre-request hook registration"
      )
    }

    ctx.afterScriptExecutionHooks.push(() => {
      preConfig.handleSandboxResults({
        envs: baseInputs.getUpdatedEnvs(),
        request: getUpdatedRequest(),
        cookies: baseInputs.getUpdatedCookies(),
      })
    })
  } else if (type === "post") {
    const postConfig = config as PostRequestModuleConfig

    ctx.afterScriptExecutionHooks.push(() => {
      postConfig.handleSandboxResults({
        envs: baseInputs.getUpdatedEnvs(),
        testRunStack: postConfig.testRunStack,
        cookies: baseInputs.getUpdatedCookies(),
      })
    })
  }
}

/**
 * Creates input object for scripting modules with appropriate methods based on type
 */
const createScriptingInputsObj = (
  ctx: CageModuleCtx,
  type: ModuleType,
  config: ModuleConfig
) => {
  if (type === "pre") {
    const preConfig = config as PreRequestModuleConfig

    // Create request setter methods FIRST for pre-request scripts
    const { methods: requestSetterMethods, getUpdatedRequest } =
      createRequestSetterMethods(ctx, preConfig.request)

    // Create base inputs with access to updated request
    const baseInputs = createBaseInputs(ctx, {
      envs: config.envs,
      request: config.request,
      cookies: config.cookies,
      getUpdatedRequest, // Pass the updater function for pre-request
    })

    // Register hook with helper function
    registerAfterScriptExecutionHook(ctx, "pre", preConfig, baseInputs, {
      getUpdatedRequest,
    })

    return {
      ...baseInputs,
      ...requestSetterMethods,
    }
  }

  // Create base inputs shared across all namespaces (post-request path)
  const baseInputs = createBaseInputs(ctx, {
    envs: config.envs,
    request: config.request,
    cookies: config.cookies,
  })

  if (type === "post") {
    const postConfig = config as PostRequestModuleConfig

    // Create expectation methods for post-request scripts
    const expectationMethods = createExpectationMethods(
      ctx,
      postConfig.testRunStack
    )

    // Create Chai methods
    const chaiMethods = createChaiMethods(ctx, postConfig.testRunStack)

    // Register hook with helper function
    registerAfterScriptExecutionHook(ctx, "post", postConfig, baseInputs)

    return {
      ...baseInputs,
      ...expectationMethods,
      ...chaiMethods,

      // Test management methods
      preTest: defineSandboxFn(
        ctx,
        "preTest",
        function preTest(descriptor: unknown) {
          postConfig.testRunStack.push({
            descriptor: descriptor as string,
            expectResults: [],
            children: [],
          })
        }
      ),
      postTest: defineSandboxFn(ctx, "postTest", function postTest() {
        const child = postConfig.testRunStack.pop() as TestDescriptor
        postConfig.testRunStack[
          postConfig.testRunStack.length - 1
        ].children.push(child)
      }),
      registerTestPromise: defineSandboxFunctionRaw(
        ctx,
        "registerTestPromise",
        (...args: any[]) => {
          const promiseHandle = args[0]
          console.log('[scripting-module] registerTestPromise called with handle, type:', ctx.vm.typeof(promiseHandle))

          if (postConfig.onTestPromise) {
            // Convert QuickJS promise handle to host promise
            try {
              const hostPromise = ctx.vm.resolvePromise(promiseHandle).then(
                (result) => {
                  console.log('[scripting-module] Test promise RESOLVED in VM')
                  // Unwrap the result and dispose of the handle
                  result.dispose()
                  return Promise.resolve()
                },
                (error) => {
                  console.log('[scripting-module] Test promise REJECTED in VM')
                  // Dispose of error handle if present
                  if (error && typeof error.dispose === 'function') {
                    error.dispose()
                  }
                  return Promise.reject(error)
                }
              )
              console.log('[scripting-module] Converted to host promise successfully')
              postConfig.onTestPromise(hostPromise)
            } catch (error) {
              console.error('[scripting-module] Failed to convert promise:', error)
            }
          }

          return ctx.vm.undefined
        }
      ),
      getResponse: defineSandboxFn(ctx, "getResponse", function getResponse() {
        return postConfig.response
      }),
      // Response utility methods as cage functions
      responseReason: defineSandboxFn(
        ctx,
        "responseReason",
        function responseReason() {
          return getStatusReason(postConfig.response.status)
        }
      ),
      responseDataURI: defineSandboxFn(
        ctx,
        "responseDataURI",
        function responseDataURI() {
          try {
            const body = postConfig.response.body
            const contentType =
              postConfig.response.headers.find(
                (h) => h.key.toLowerCase() === "content-type"
              )?.value || "application/octet-stream"

            // Convert body to base64 (browser and Node.js compatible)
            let base64Body: string
            const bodyString = typeof body === "string" ? body : String(body)

            // Check if we're in a browser environment (btoa available)
            if (typeof btoa !== "undefined") {
              // Browser environment: use btoa
              // btoa requires binary string, so we need to handle UTF-8 properly
              const utf8Bytes = new TextEncoder().encode(bodyString)
              const binaryString = Array.from(utf8Bytes, (byte) =>
                String.fromCharCode(byte)
              ).join("")
              base64Body = btoa(binaryString)
            } else if (typeof Buffer !== "undefined") {
              // Node.js environment: use Buffer
              base64Body = Buffer.from(bodyString).toString("base64")
            } else {
              throw new Error("No base64 encoding method available")
            }

            return `data:${contentType};base64,${base64Body}`
          } catch (error) {
            throw new Error(`Failed to convert response to data URI: ${error}`)
          }
        }
      ),
      responseJsonp: defineSandboxFn(
        ctx,
        "responseJsonp",
        function responseJsonp(...args: unknown[]) {
          const callbackName = args[0]
          const body = postConfig.response.body
          const text = typeof body === "string" ? body : String(body)

          if (callbackName && typeof callbackName === "string") {
            // Escape special regex characters in callback name
            const escapedName = callbackName.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&"
            )
            const regex = new RegExp(
              `^\\s*${escapedName}\\s*\\(([\\s\\S]*)\\)\\s*;?\\s*$`
            )
            const match = text.match(regex)
            if (match && match[1]) {
              return JSON.parse(match[1])
            }
          }

          // Auto-detect callback wrapper
          const autoDetect = text.match(
            /^\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(([\s\S]*)\)\s*;?\s*$/
          )
          if (autoDetect && autoDetect[2]) {
            try {
              return JSON.parse(autoDetect[2])
            } catch {
              // If parsing fails, fall through to plain JSON
            }
          }

          // No JSONP wrapper found, parse as plain JSON
          return JSON.parse(text)
        }
      ),
    }
  }

  return baseInputs
}

/**
 * Creates a scripting module for pre or post request execution
 */
const createScriptingModule = (
  type: ModuleType,
  bootstrapCode: string,
  config: ModuleConfig
) => {
  return defineCageModule((ctx) => {
    // Track test promises for keepAlive
    const testPromises: Promise<unknown>[] = []
    let resolveKeepAlive: (() => void) | null = null

    // Create keepAlive promise that waits for all test promises
    // This promise is created BEFORE the script runs, but only resolves after tests complete
    const testPromiseKeepAlive = new Promise<void>((resolve) => {
      resolveKeepAlive = resolve
    })

    ctx.keepAlivePromises.push(testPromiseKeepAlive)

    // Wrap onTestPromise to track in testPromises array
    const originalOnTestPromise = (config as PostRequestModuleConfig).onTestPromise
    if (originalOnTestPromise) {
      ;(config as PostRequestModuleConfig).onTestPromise = (promise) => {
        console.log('[scripting-module] Registering test promise')
        testPromises.push(promise)
        originalOnTestPromise(promise)
      }
    }

    const funcHandle = ctx.scope.manage(ctx.vm.evalCode(bootstrapCode)).unwrap()

    const inputsObj = defineSandboxObject(
      ctx,
      createScriptingInputsObj(ctx, type, config)
    )

    ctx.vm.callFunction(funcHandle, ctx.vm.undefined, inputsObj)

    // IMPORTANT: Schedule the test promise resolution check after script execution
    // Use afterScriptExecutionHooks to wait for test promises AFTER main script completes
    ctx.afterScriptExecutionHooks.push(() => {
      // Schedule async work without blocking the hook
      setTimeout(async () => {
        console.log('[scripting-module] Waiting for', testPromises.length, 'test promises')
        if (testPromises.length > 0) {
          await Promise.allSettled(testPromises)
        }
        console.log('[scripting-module] All test promises completed')
        resolveKeepAlive?.()
      }, 0)
    })
  })
}

export const preRequestModule = (config: PreRequestModuleConfig) =>
  createScriptingModule("pre", preRequestBootstrapCode, config)

export const postRequestModule = (config: PostRequestModuleConfig) =>
  createScriptingModule("post", postRequestBootstrapCode, config)
