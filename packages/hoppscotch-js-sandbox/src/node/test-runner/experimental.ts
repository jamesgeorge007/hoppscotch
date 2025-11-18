import { HoppRESTRequest } from "@hoppscotch/data"
import { FaradayCage } from "faraday-cage"
import * as TE from "fp-ts/TaskEither"
import { pipe } from "fp-ts/function"
import { cloneDeep } from "lodash"

import { defaultModules, postRequestModule } from "~/cage-modules"
import {
  HoppFetchHook,
  TestDescriptor,
  TestResponse,
  TestResult,
} from "~/types"

export const runPostRequestScriptWithFaradayCage = (
  testScript: string,
  envs: TestResult["envs"],
  request: HoppRESTRequest,
  response: TestResponse,
  hoppFetchHook?: HoppFetchHook,
): TE.TaskEither<string, TestResult> => {
  return pipe(
    TE.tryCatch(
      async (): Promise<TestResult> => {
        const testRunStack: TestDescriptor[] = [
          { descriptor: "root", expectResults: [], children: [] },
        ]

        let finalEnvs = envs
        let finalTestResults = testRunStack
        const testPromises: Promise<void>[] = []

        const cage = await FaradayCage.create()

        // Wrap entire execution in try-catch to handle QuickJS GC errors that can occur at any point
        try {
          const captureHook: { capture?: () => void } = {}

          const result = await cage.runCode(testScript, [
            ...defaultModules({
              hoppFetchHook,
            }),

            postRequestModule(
              {
                envs: cloneDeep(envs),
                testRunStack: cloneDeep(testRunStack),
                request: cloneDeep(request),
                response: cloneDeep(response),
                // TODO: Post type update, accommodate for cookies although platform support is limited
                cookies: null,
                handleSandboxResults: ({ envs, testRunStack }) => {
                  finalEnvs = envs
                  finalTestResults = testRunStack
                },
                onTestPromise: (promise) => {
                  testPromises.push(promise)
                },
              },
              captureHook,
            ),
          ])

          // Check for script execution errors first
          if (result.type === "error") {
            // Just throw the error - it will be wrapped by the TaskEither error handler
            throw result.err
          }

          // CRITICAL FIX: Execute tests SEQUENTIALLY to support dependent tests
          // Problem: Tests that share variables (e.g., authToken) fail with concurrent execution
          // Example:
          //   let token = null
          //   hopp.test('Login', async () => { token = await getToken() })
          //   hopp.test('Use token', async () => { await useToken(token) })  // token is null!
          //
          // Solution: Execute tests one at a time, waiting for each to complete before starting next
          // This ensures:
          //   ✓ Variables set in earlier tests are available to later tests
          //   ✓ Tests complete in registration order
          //   ✓ Predictable, deterministic behavior
          //   ✓ No race conditions
          if (testPromises.length > 0) {
            // Execute each test promise one at a time, waiting for completion
            for (let i = 0; i < testPromises.length; i++) {
              await testPromises[i]
            }
          }

          // Capture results AFTER all async tests complete
          // This prevents showing intermediate/failed state
          if (captureHook.capture) {
            captureHook.capture()
          }

          // CRITICAL FIX: Deep clone ALL results before returning
          // This breaks the connection to QuickJS runtime objects and prevents GC errors
          // when QuickJS tries to free the runtime while objects are still referenced
          const safeTestResults = cloneDeep(finalTestResults)
          const safeEnvs = cloneDeep(finalEnvs)

          return {
            tests: safeTestResults,
            envs: safeEnvs,
          }
        } finally {
          // NOTE: Do NOT dispose the cage here - it causes QuickJS lifetime errors
          // because returned objects may still be accessed later.
          // Rely on garbage collection to clean up the cage when no longer referenced.
          // TODO: Investigate proper disposal timing or cage pooling/reuse strategy
        }
      },
      (error) => {
        if (error !== null && typeof error === "object" && "message" in error) {
          const reason = `${"name" in error ? error.name : ""}: ${error.message}`
          return `Script execution failed: ${reason}`
        }

        return `Script execution failed: ${String(error)}`
      },
    ),
  )
}
