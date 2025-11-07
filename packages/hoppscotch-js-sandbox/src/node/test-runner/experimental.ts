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

          if (captureHook.capture) {
            captureHook.capture()
          }

          if (result.type === "error") {
            throw result.err
          }

          // Wait for any async test functions to complete
          if (testPromises.length > 0) {
            await Promise.all(testPromises)
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
