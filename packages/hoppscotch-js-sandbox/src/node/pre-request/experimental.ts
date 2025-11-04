import { Cookie, HoppRESTRequest } from "@hoppscotch/data"
import { FaradayCage } from "faraday-cage"
import { pipe } from "fp-ts/function"
import * as TE from "fp-ts/lib/TaskEither"
import { cloneDeep } from "lodash"

import { defaultModules, preRequestModule } from "~/cage-modules"
import { HoppFetchHook, SandboxPreRequestResult, TestResult } from "~/types"

export const runPreRequestScriptWithFaradayCage = (
  preRequestScript: string,
  envs: TestResult["envs"],
  request: HoppRESTRequest,
  cookies: Cookie[] | null,
  hoppFetchHook?: HoppFetchHook
): TE.TaskEither<string, SandboxPreRequestResult> => {
  return pipe(
    TE.tryCatch(
      async (): Promise<SandboxPreRequestResult> => {
        let finalEnvs = envs
        let finalRequest = request
        let finalCookies = cookies

        const cage = await FaradayCage.create()

        try {
          const result = await cage.runCode(preRequestScript, [
            ...defaultModules({
              hoppFetchHook,
            }),

            preRequestModule({
              envs: cloneDeep(envs),
              request: cloneDeep(request),
              cookies: cookies ? cloneDeep(cookies) : null,
              handleSandboxResults: ({ envs, request, cookies }) => {
                finalEnvs = envs
                finalRequest = request
                finalCookies = cookies
              },
            }),
          ])

          if (result.type === "error") {
            throw result.err
          }

          return {
            updatedEnvs: finalEnvs,
            updatedRequest: finalRequest,
            updatedCookies: finalCookies,
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
