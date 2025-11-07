import { FaradayCage } from "faraday-cage"
import { ConsoleEntry } from "faraday-cage/modules"
import * as E from "fp-ts/Either"
import { cloneDeep } from "lodash-es"

import { defaultModules, postRequestModule } from "~/cage-modules"
import {
  HoppFetchHook,
  RunPostRequestScriptOptions,
  SandboxTestResult,
  TestDescriptor,
  TestResponse,
  TestResult,
} from "~/types"
import { preventCyclicObjects } from "~/utils/shared"

import { Cookie, HoppRESTRequest } from "@hoppscotch/data"
import Worker from "./worker?worker&inline"

const runPostRequestScriptWithWebWorker = (
  testScript: string,
  envs: TestResult["envs"],
  response: TestResponse
): Promise<E.Either<string, SandboxTestResult>> => {
  return new Promise((resolve) => {
    const worker = new Worker()

    // Listen for the results from the web worker
    worker.addEventListener("message", (event: MessageEvent) =>
      resolve(event.data.results)
    )

    // Send the script to the web worker
    worker.postMessage({
      testScript,
      envs,
      response,
    })
  })
}

const runPostRequestScriptWithFaradayCage = async (
  testScript: string,
  envs: TestResult["envs"],
  request: HoppRESTRequest,
  response: TestResponse,
  cookies: Cookie[] | null,
  hoppFetchHook?: HoppFetchHook
): Promise<E.Either<string, SandboxTestResult>> => {
  const testRunStack: TestDescriptor[] = [
    { descriptor: "root", expectResults: [], children: [] },
  ]

  let finalEnvs = envs
  let finalTestResults = testRunStack
  const consoleEntries: ConsoleEntry[] = []
  let finalCookies = cookies
  const testPromises: Promise<void>[] = []

  const cage = await FaradayCage.create()

  try {
    // Create a hook object to receive the capture function from the module
    const captureHook: { capture?: () => void } = {}

    const result = await cage.runCode(testScript, [
      ...defaultModules({
        handleConsoleEntry: (consoleEntry) => consoleEntries.push(consoleEntry),
        hoppFetchHook,
      }),

      postRequestModule(
        {
          envs: cloneDeep(envs),
          testRunStack: cloneDeep(testRunStack),
          request: cloneDeep(request),
          response: cloneDeep(response),
          cookies: cookies ? cloneDeep(cookies) : null,
          handleSandboxResults: ({ envs, testRunStack, cookies }) => {
            finalEnvs = envs
            finalTestResults = testRunStack
            finalCookies = cookies
          },
          onTestPromise: (promise) => {
            testPromises.push(promise)
          },
        },
        captureHook
      ),
    ])

    // CRITICAL: Capture results AFTER runCode() completes
    if (captureHook.capture) {
      captureHook.capture()
    }

    if (result.type === "error") {
      if (
        result.err !== null &&
        typeof result.err === "object" &&
        "message" in result.err
      ) {
        return E.left(`Script execution failed: ${result.err.message}`)
      }

      return E.left(`Script execution failed: ${String(result.err)}`)
    }

    // Wait for any async test functions to complete
    if (testPromises.length > 0) {
      await Promise.all(testPromises)
    }

    return E.right(<SandboxTestResult>{
      tests: finalTestResults[0],
      envs: finalEnvs,
      consoleEntries,
      updatedCookies: finalCookies,
    })
  } finally{
    // NOTE: Do NOT dispose the cage here - it causes QuickJS lifetime errors
    // because returned objects (like Response from hopp.fetch()) may still be
    // accessed after script execution completes.
    // Rely on garbage collection to clean up the cage when no longer referenced.
    // TODO: Investigate proper disposal timing or cage pooling/reuse strategy
  }
}

export const runTestScript = async (
  testScript: string,
  options: RunPostRequestScriptOptions
): Promise<E.Either<string, SandboxTestResult>> => {
  const responseObjHandle = preventCyclicObjects<TestResponse>(options.response)

  if (E.isLeft(responseObjHandle)) {
    return E.left(`Response marshalling failed: ${responseObjHandle.left}`)
  }

  const resolvedResponse = responseObjHandle.right

  const { envs, experimentalScriptingSandbox = true } = options

  if (experimentalScriptingSandbox) {
    const { request, cookies, hoppFetchHook } = options as Extract<
      RunPostRequestScriptOptions,
      { experimentalScriptingSandbox: true }
    >

    return runPostRequestScriptWithFaradayCage(
      testScript,
      envs,
      request,
      resolvedResponse,
      cookies,
      hoppFetchHook
    )
  }

  return runPostRequestScriptWithWebWorker(testScript, envs, resolvedResponse)
}
