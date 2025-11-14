import { Cookie, HoppRESTRequest } from "@hoppscotch/data"
import {
  CageModuleCtx,
  defineCageModule,
  defineSandboxFn,
  defineSandboxObject,
} from "faraday-cage/modules"
import { cloneDeep } from "lodash-es"

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
 *
 * CRITICAL FIX: Environment variable mutations from async callbacks
 * ===============================================================
 * Problem: Environment variables set inside async callbacks (like hopp.fetch().then())
 * were being lost because handleSandboxResults was called BEFORE async operations completed.
 *
 * Solution: We snapshot existing keepAlivePromises and wait for them to resolve BEFORE
 * capturing results. This ensures all async env mutations are captured.
 *
 * Execution flow:
 * 1. Script runs (sync part)
 * 2. afterScriptExecutionHooks called → starts waiting for existingPromises
 * 3. FaradayCage waits for ALL keepAlivePromises (including our capturePromise)
 * 4. Async callbacks execute (hopp.fetch .then(), etc.) → mutate envs
 * 5. existingPromises resolve
 * 6. Our Promise.all() resolves → captures results with all mutations
 * 7. Our capturePromise resolves
 * 8. FaradayCage completes
 */
function registerAfterScriptExecutionHook(
  _ctx: CageModuleCtx,
  _type: ModuleType,
  _config: ModuleConfig,
  _baseInputs: ReturnType<typeof createBaseInputs>,
  _additionalResults?: HookRegistrationAdditionalResults
) {
  // NOTE: This function is now a no-op. We've moved result capture to happen
  // AFTER cage.runCode() completes instead of inside hooks/promises.
  // This ensures we capture results after the script fully executes with all awaits.
}

/**
 * Creates input object for scripting modules with appropriate methods based on type
 */
const createScriptingInputsObj = (
  ctx: CageModuleCtx,
  type: ModuleType,
  config: ModuleConfig,
  captureGetUpdatedRequest?: (fn: () => HoppRESTRequest) => void
) => {
  if (type === "pre") {
    const preConfig = config as PreRequestModuleConfig

    // Create request setter methods FIRST for pre-request scripts
    const { methods: requestSetterMethods, getUpdatedRequest } =
      createRequestSetterMethods(ctx, preConfig.request)

    // Capture the getUpdatedRequest function so the caller can use it
    if (captureGetUpdatedRequest) {
      captureGetUpdatedRequest(getUpdatedRequest)
    }

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

    // Track current executing test
    let currentExecutingTest: TestDescriptor | null = null

    const getCurrentTestContext = (): TestDescriptor | null => {
      return currentExecutingTest
    }

    // Create expectation methods for post-request scripts
    const expectationMethods = createExpectationMethods(
      ctx,
      postConfig.testRunStack,
      getCurrentTestContext // Pass getter for current test context
    )

    // Create Chai methods
    const chaiMethods = createChaiMethods(
      ctx,
      postConfig.testRunStack,
      getCurrentTestContext // Pass getter for current test context
    )

    return {
      ...baseInputs,
      ...expectationMethods,
      ...chaiMethods,

      // Test management methods
      preTest: defineSandboxFn(
        ctx,
        "preTest",
        function preTest(descriptor: unknown) {
          const testDescriptor: TestDescriptor = {
            descriptor: descriptor as string,
            expectResults: [],
            children: [],
          }

          // CRITICAL FIX: Add to root.children immediately to preserve registration order
          // This ensures tests appear in the order they're defined, not completion order
          postConfig.testRunStack[0].children.push(testDescriptor)

          // NOTE: We no longer push onto stack here because all tests would be pushed
          // synchronously during registration, making stack-based tracking unreliable.
          // Instead, we use setCurrentTest() in the bootstrap code.

          // Return the test descriptor so it can be set as context
          return testDescriptor
        }
      ),
      postTest: defineSandboxFn(ctx, "postTest", function postTest() {
        // NOTE: No longer pops from stack since we don't push in preTest
        // Test cleanup is handled by clearCurrentTest() in bootstrap
      }),
      setCurrentTest: defineSandboxFn(
        ctx,
        "setCurrentTest",
        function setCurrentTest(descriptorName: unknown) {
          // Find the test descriptor in the testRunStack by descriptor name
          // This ensures we use the ACTUAL object, not a serialized copy
          const found = postConfig.testRunStack[0].children.find(
            (test) => test.descriptor === descriptorName
          )
          currentExecutingTest = found || null
        }
      ),
      clearCurrentTest: defineSandboxFn(
        ctx,
        "clearCurrentTest",
        function clearCurrentTest() {
          currentExecutingTest = null
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
  config: ModuleConfig,
  captureHook?: { capture?: () => void }
) => {
  return defineCageModule((ctx) => {
    // Track test promises for keepAlive
    const testPromises: Promise<unknown>[] = []
    let resolveKeepAlive: (() => void) | null = null
    let rejectKeepAlive: ((error: Error) => void) | null = null

    // Create keepAlive promise that waits for all test promises
    // This promise is created BEFORE the script runs, but only resolves after tests complete
    const testPromiseKeepAlive = new Promise<void>((resolve, reject) => {
      resolveKeepAlive = resolve
      rejectKeepAlive = reject
    })

    ctx.keepAlivePromises.push(testPromiseKeepAlive)

    // Wrap onTestPromise to track in testPromises array
    const originalOnTestPromise = (config as PostRequestModuleConfig)
      .onTestPromise
    if (originalOnTestPromise) {
      ;(config as PostRequestModuleConfig).onTestPromise = (promise) => {
        testPromises.push(promise)
        originalOnTestPromise(promise)
      }
    }

    const funcHandle = ctx.scope.manage(ctx.vm.evalCode(bootstrapCode)).unwrap()

    // Capture getUpdatedRequest via callback for pre-request scripts
    let getUpdatedRequest: (() => HoppRESTRequest) | undefined = undefined
    const inputsObj = createScriptingInputsObj(ctx, type, config, (fn) => {
      getUpdatedRequest = fn
    })

    // CRITICAL FIX: Set up the capture function before script runs
    // This allows the caller to capture results AFTER runCode() completes
    if (captureHook && type === "pre") {
      const preConfig = config as PreRequestModuleConfig

      captureHook.capture = () => {
        const capturedEnvs = (inputsObj as any).getUpdatedEnvs?.() || {
          global: [],
          selected: [],
        }
        // Use the getUpdatedRequest from request setters (via createRequestSetterMethods)
        // This returns the mutated request, not the original
        const finalRequest = getUpdatedRequest
          ? getUpdatedRequest()
          : config.request

        preConfig.handleSandboxResults({
          envs: capturedEnvs,
          request: finalRequest,
          cookies: (inputsObj as any).getUpdatedCookies?.() || null,
        })
      }
    } else if (captureHook && type === "post") {
      const postConfig = config as PostRequestModuleConfig
      captureHook.capture = () => {
        // Deep clone testRunStack to prevent UI reactivity to async mutations
        // Without this, async test callbacks that complete after capture will mutate
        // the same object being displayed in the UI, causing flickering test results

        postConfig.handleSandboxResults({
          envs: (inputsObj as any).getUpdatedEnvs?.() || {
            global: [],
            selected: [],
          },
          testRunStack: cloneDeep(postConfig.testRunStack),
          cookies: (inputsObj as any).getUpdatedCookies?.() || null,
        })
      }
    }

    const sandboxInputsObj = defineSandboxObject(ctx, inputsObj)

    const bootstrapResult = ctx.vm.callFunction(
      funcHandle,
      ctx.vm.undefined,
      sandboxInputsObj
    )

    // Extract the test execution chain promise from the bootstrap function's return value
    let testExecutionChainPromise: any = null
    if (bootstrapResult.error) {
      console.error(
        "[SCRIPTING] Bootstrap function error:",
        ctx.vm.dump(bootstrapResult.error)
      )
      bootstrapResult.error.dispose()
    } else if (bootstrapResult.value) {
      testExecutionChainPromise = bootstrapResult.value
      // Don't dispose the value yet - we need to await it
    }

    // IMPORTANT: Wait for test execution chain BEFORE resolving keepAlive
    // This ensures all tests complete before results are captured
    ctx.afterScriptExecutionHooks.push(() => {
      setTimeout(async () => {
        try {
          // If we have a test execution chain, await it
          if (testExecutionChainPromise) {
            const resolvedPromise = ctx.vm.resolvePromise(
              testExecutionChainPromise
            )
            testExecutionChainPromise.dispose()

            const awaitResult = await resolvedPromise
            if (awaitResult.error) {
              const errorDump = ctx.vm.dump(awaitResult.error)
              awaitResult.error.dispose()
              // CRITICAL FIX: Propagate test execution errors
              // These errors represent actual failures in test scripts (e.g., syntax errors,
              // undefined variable access) and must cause the entire script to fail
              const error = new Error(
                typeof errorDump === "string"
                  ? errorDump
                  : JSON.stringify(errorDump)
              )
              rejectKeepAlive?.(error)
              return
            } else {
              awaitResult.value?.dispose()
            }
          }

          // Also wait for any old-style test promises (for backwards compatibility)
          if (testPromises.length > 0) {
            await Promise.allSettled(testPromises)
          }

          resolveKeepAlive?.()
        } catch (error) {
          rejectKeepAlive?.(
            error instanceof Error ? error : new Error(String(error))
          )
        }
      }, 0)
    })
  })
}

export const preRequestModule = (
  config: PreRequestModuleConfig,
  captureHook?: { capture?: () => void }
) => createScriptingModule("pre", preRequestBootstrapCode, config, captureHook)

export const postRequestModule = (
  config: PostRequestModuleConfig,
  captureHook?: { capture?: () => void }
) =>
  createScriptingModule("post", postRequestBootstrapCode, config, captureHook)
