import { HoppRESTRequest } from "@hoppscotch/data"
import { FaradayCage } from "faraday-cage"
import * as TE from "fp-ts/TaskEither"
import { pipe } from "fp-ts/function"
import { cloneDeep } from "lodash"

import { defaultModules, postRequestModule } from "~/cage-modules"
import { HoppFetchHook, TestDescriptor, TestResponse, TestResult } from "~/types"

export const runPostRequestScriptWithFaradayCage = (
  testScript: string,
  envs: TestResult["envs"],
  request: HoppRESTRequest,
  response: TestResponse,
  hoppFetchHook?: HoppFetchHook
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
              captureHook
            ),
          ])

          if (result.type === "error") {
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
            console.log(`[EXPERIMENTAL] Executing ${testPromises.length} tests sequentially...`)

            // Execute each test promise one at a time, waiting for completion
            for (let i = 0; i < testPromises.length; i++) {
              console.log(`[EXPERIMENTAL] Executing test ${i + 1}/${testPromises.length}...`)
              await testPromises[i]
              console.log(`[EXPERIMENTAL] Test ${i + 1} completed`)
            }

            console.log('[EXPERIMENTAL] All tests completed sequentially')
          }

          // Capture results AFTER all async tests complete
          // This prevents showing intermediate/failed state
          if (captureHook.capture) {
            captureHook.capture()
          }

          return {
            tests: finalTestResults,
            envs: finalEnvs,
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
      }
    )
  )
}
