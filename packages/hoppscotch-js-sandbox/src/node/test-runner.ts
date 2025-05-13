import * as E from "fp-ts/Either"
import * as TE from "fp-ts/TaskEither"
import { pipe } from "fp-ts/function"
import { createRequire } from "module"

import type ivmT from "isolated-vm"

import { parseTemplateStringE } from "@hoppscotch/data"
import {
  blobPolyfill,
  defineCageModule,
  defineSandboxFn,
  defineSandboxFunctionRaw,
  esmModuleLoader,
  console as ConsoleModule,
} from "faraday-cage/modules"
import * as O from "fp-ts/Option"
import { cloneDeep } from "lodash"
import {
  getTestRunnerScriptMethods,
  preventCyclicObjects,
} from "~/shared-utils"
import {
  ExpectResult,
  GlobalEnvItem,
  SandboxTestResult,
  SelectedEnvItem,
  TestDescriptor,
  TestResponse,
  TestResult,
} from "~/types"
import { getEnv } from "~/web/test-runner"
import { getSerializedAPIMethods } from "./utils"
import { FaradayCage } from "faraday-cage"

const nodeRequire = createRequire(import.meta.url)
const ivm = nodeRequire("isolated-vm")

const findEnvIndex = (
  envName: string,
  envList: SelectedEnvItem[] | GlobalEnvItem[],
) => {
  return envList.findIndex((envItem) => envItem.key === envName)
}

export const setEnv = (
  envName: string,
  envValue: string,
  envs: TestResult["envs"],
) => {
  const { global, selected } = envs

  const indexInSelected = findEnvIndex(envName, selected)
  const indexInGlobal = findEnvIndex(envName, global)

  if (indexInSelected >= 0) {
    const selectedEnv = selected[indexInSelected]
    if ("value" in selectedEnv) {
      selectedEnv.value = envValue
    }
  } else if (indexInGlobal >= 0) {
    if ("value" in global[indexInGlobal]) global[indexInGlobal].value = envValue
  } else {
    selected.push({
      key: envName,
      value: envValue,
      secret: false,
    })
  }

  return {
    global,
    selected,
  }
}

export const unsetEnv = (envName: string, envs: TestResult["envs"]) => {
  const { global, selected } = envs

  const indexInSelected = findEnvIndex(envName, selected)
  const indexInGlobal = findEnvIndex(envName, global)

  if (indexInSelected >= 0) {
    selected.splice(indexInSelected, 1)
  } else if (indexInGlobal >= 0) {
    global.splice(indexInGlobal, 1)
  }

  return {
    global,
    selected,
  }
}

const getSharedMethods = (envs: TestResult["envs"]) => {
  let updatedEnvs = envs

  const envGetFn = (key: unknown) => {
    if (typeof key !== "string") throw new Error("Expected key to be a string")

    return pipe(
      getEnv(key, updatedEnvs),
      O.fold(
        () => undefined,
        (env) => String(env.value),
      ),
    )
  }

  const envGetResolveFn = (key: unknown) => {
    if (typeof key !== "string") throw new Error("Expected key to be a string")

    return pipe(
      getEnv(key, updatedEnvs),
      E.fromOption(() => "INVALID_KEY"),
      E.map((e) =>
        pipe(
          parseTemplateStringE(e.value, [
            ...updatedEnvs.selected,
            ...updatedEnvs.global,
          ]),
          E.getOrElse(() => e.value),
        ),
      ),
      E.map((x) => String(x)),
      E.getOrElseW(() => undefined),
    )
  }

  const envSetFn = (key: unknown, value: unknown) => {
    if (typeof key !== "string") throw new Error("Expected key to be a string")
    if (typeof value !== "string")
      throw new Error("Expected value to be a string")

    updatedEnvs = setEnv(key, value, updatedEnvs)
    return undefined
  }

  const envUnsetFn = (key: unknown) => {
    if (typeof key !== "string") throw new Error("Expected key to be a string")

    updatedEnvs = unsetEnv(key, updatedEnvs)
    return undefined
  }

  const envResolveFn = (value: unknown) => {
    if (typeof value !== "string")
      throw new Error("Expected value to be a string")

    return String(
      pipe(
        parseTemplateStringE(value, [
          ...updatedEnvs.selected,
          ...updatedEnvs.global,
        ]),
        E.getOrElse(() => value),
      ),
    )
  }

  return {
    methods: {
      env: {
        get: envGetFn,
        getResolve: envGetResolveFn,
        set: envSetFn,
        unset: envUnsetFn,
        resolve: envResolveFn,
      },
    },
    updatedEnvs,
  }
}

const createPwModule = (initialEnvs: TestResult["envs"]) => {
  const updatedEnvs = cloneDeep(initialEnvs)

  const testRunStack: TestDescriptor[] = [
    { descriptor: "root", expectResults: [], children: [] },
  ]

  const { methods } = getSharedMethods(updatedEnvs)

  return {
    module: defineCageModule((ctx) => {
      const vm = ctx.vm
      const global = vm.global

      const pwObj = ctx.scope.manage(vm.newObject())
      vm.setProp(global, "pw", pwObj)

      const envObj = ctx.scope.manage(vm.newObject())
      vm.setProp(pwObj, "env", envObj)

      for (const [key, fn] of Object.entries(methods.env)) {
        const wrapped = defineSandboxFn(ctx, `pw.env.${key}`, fn)
        vm.setProp(envObj, key, wrapped)
      }

      // --- Attach test/expect methods ---
      const testFn = defineSandboxFunctionRaw(
        ctx,
        "pw.test",
        (desc: any, func: any) => {
          testRunStack.push({
            descriptor: desc,
            expectResults: [],
            children: [],
          })

          const result = ctx.vm.callFunction(func, ctx.vm.undefined)
          ctx.scope.manage(result) // cleanup if needed

          const child = testRunStack.pop()
          testRunStack[testRunStack.length - 1].children.push(child!)

          return result.unwrap()
        },
      )

      const expectFn = ctx.vm.newFunction("expect", (actualHandle) => {
        const resolvedExpectVal = ctx.vm.dump(actualHandle)
        const matcherObj = ctx.scope.manage(ctx.vm.newObject())

        const pushResult = (
          status: ExpectResult["status"],
          message: string,
        ) => {
          testRunStack[testRunStack.length - 1].expectResults.push({
            status,
            message,
          })
        }

        const defineMatcher = (
          name: string,
          matcher: (...args: unknown[]) => void,
        ) => {
          const matcherFn = ctx.vm.newFunction(name, (...argHandles) => {
            const args = argHandles.map((h) => ctx.vm.dump(h))
            matcher(...args)
            return ctx.vm.undefined
          })
          ctx.scope.manage(matcherFn)
          ctx.vm.setProp(matcherObj, name, matcherFn)
        }

        const notMatcherObj = ctx.scope.manage(ctx.vm.newObject())

        const defineNotMatcher = (
          name: string,
          matcher: (...args: unknown[]) => void,
        ) => {
          const notMatcherFn = ctx.vm.newFunction(name, (...argHandles) => {
            const args = argHandles.map((h) => ctx.vm.dump(h))
            matcher(...args)
            return ctx.vm.undefined
          })
          ctx.scope.manage(notMatcherFn)
          ctx.vm.setProp(notMatcherObj, name, notMatcherFn)
        }

        defineMatcher("toBe", (expectedVal: unknown) => {
          const assertion = resolvedExpectVal === expectedVal
          const status = assertion ? "pass" : "fail"
          const message = `Expected '${resolvedExpectVal}' to be '${expectedVal}'`
          pushResult(status, message)
        })

        defineNotMatcher("toBe", (expectedVal) => {
          const assertion = resolvedExpectVal !== expectedVal
          const status = assertion ? "pass" : "fail"
          const message = `Expected '${resolvedExpectVal}' not to be '${expectedVal}'`
          pushResult(status, message)
        })

        const toBeLevelXxx = (
          label: string,
          min: number,
          max: number,
          negate = false,
        ) => {
          const parsedVal = parseInt(resolvedExpectVal)
          if (!Number.isNaN(parsedVal)) {
            const assertion = parsedVal >= min && parsedVal <= max
            const finalAssertion = negate ? !assertion : assertion
            const status = finalAssertion ? "pass" : "fail"
            const prefix = negate ? "not " : ""
            const message = `Expected '${parsedVal}' ${prefix}to be ${label}-level status`
            pushResult(status, message)
          } else {
            const prefix = negate ? "not " : ""
            pushResult(
              "error",
              `Expected ${prefix}${label}-level status but could not parse value '${resolvedExpectVal}'`,
            )
          }
        }

        defineMatcher("toBeLevel2xx", () => toBeLevelXxx("200", 200, 299))
        defineNotMatcher("toBeLevel2xx", () =>
          toBeLevelXxx("200", 200, 299, true),
        )

        defineMatcher("toBeLevel3xx", () => toBeLevelXxx("300", 300, 399))
        defineNotMatcher("toBeLevel3xx", () =>
          toBeLevelXxx("300", 300, 399, true),
        )

        defineMatcher("toBeLevel4xx", () => toBeLevelXxx("400", 400, 499))
        defineNotMatcher("toBeLevel4xx", () =>
          toBeLevelXxx("400", 400, 499, true),
        )

        defineMatcher("toBeLevel5xx", () => toBeLevelXxx("500", 500, 599))
        defineNotMatcher("toBeLevel5xx", () =>
          toBeLevelXxx("500", 500, 599, true),
        )

        defineMatcher("toBeType", (expectedType: any) => {
          const validTypes = [
            "string",
            "boolean",
            "number",
            "object",
            "undefined",
            "bigint",
            "symbol",
            "function",
          ]
          if (!validTypes.includes(expectedType)) {
            pushResult(
              "error",
              "Argument for toBeType should be one of: " +
                validTypes.join(", "),
            )
            return
          }
          const assertion = typeof resolvedExpectVal === expectedType
          const status = assertion ? "pass" : "fail"
          const message = `Expected '${resolvedExpectVal}' to be type '${expectedType}'`
          pushResult(status, message)
        })

        defineNotMatcher("toBeType", (expectedType: any) => {
          const validTypes = [
            "string",
            "boolean",
            "number",
            "object",
            "undefined",
            "bigint",
            "symbol",
            "function",
          ]
          if (!validTypes.includes(expectedType)) {
            pushResult(
              "error",
              "Argument for toBeType should be one of: " +
                validTypes.join(", "),
            )
            return
          }
          const assertion = typeof resolvedExpectVal !== expectedType
          const status = assertion ? "pass" : "fail"
          const message = `Expected '${resolvedExpectVal}' not to be type '${expectedType}'`
          pushResult(status, message)
        })

        defineMatcher("toHaveLength", (expectedLength) => {
          if (
            !Array.isArray(resolvedExpectVal) &&
            typeof resolvedExpectVal !== "string"
          ) {
            pushResult(
              "error",
              "Expected toHaveLength to be called for an array or string",
            )
            return
          }
          if (
            typeof expectedLength !== "number" ||
            Number.isNaN(expectedLength)
          ) {
            pushResult("error", "Argument for toHaveLength should be a number")
            return
          }
          const assertion = resolvedExpectVal.length === expectedLength
          const status = assertion ? "pass" : "fail"
          const message = `Expected the array to be of length '${expectedLength}'`
          pushResult(status, message)
        })

        defineNotMatcher("toHaveLength", (expectedLength) => {
          if (
            !Array.isArray(resolvedExpectVal) &&
            typeof resolvedExpectVal !== "string"
          ) {
            pushResult(
              "error",
              "Expected toHaveLength to be called for an array or string",
            )
            return
          }
          if (
            typeof expectedLength !== "number" ||
            Number.isNaN(expectedLength)
          ) {
            pushResult("error", "Argument for toHaveLength should be a number")
            return
          }
          const assertion = resolvedExpectVal.length !== expectedLength
          const status = assertion ? "pass" : "fail"
          const message = `Expected the array not to be of length '${expectedLength}'`
          pushResult(status, message)
        })

        defineMatcher("toInclude", (needle: any) => {
          if (
            !Array.isArray(resolvedExpectVal) &&
            typeof resolvedExpectVal !== "string"
          ) {
            pushResult(
              "error",
              "Expected toInclude to be called for an array or string",
            )
            return
          }
          if (needle == null) {
            pushResult(
              "error",
              `Argument for toInclude should not be ${needle}`,
            )
            return
          }
          const assertion = resolvedExpectVal.includes(needle)
          const status = assertion ? "pass" : "fail"
          const message = `Expected ${JSON.stringify(
            resolvedExpectVal,
          )} to include ${JSON.stringify(needle)}`
          pushResult(status, message)
        })

        defineNotMatcher("toInclude", (needle: any) => {
          if (
            !Array.isArray(resolvedExpectVal) &&
            typeof resolvedExpectVal !== "string"
          ) {
            pushResult(
              "error",
              "Expected toInclude to be called for an array or string",
            )
            return
          }
          if (needle == null) {
            pushResult(
              "error",
              `Argument for toInclude should not be ${needle}`,
            )
            return
          }
          const assertion = !resolvedExpectVal.includes(needle)
          const status = assertion ? "pass" : "fail"
          const message = `Expected ${JSON.stringify(
            resolvedExpectVal,
          )} not to include ${JSON.stringify(needle)}`
          pushResult(status, message)
        })

        ctx.vm.setProp(matcherObj, "not", notMatcherObj)

        return matcherObj
      })

      ctx.scope.manage(expectFn)

      vm.setProp(pwObj, "test", testFn)
      vm.setProp(pwObj, "expect", expectFn)
    }),

    getUpdatedEnvs: () => updatedEnvs,
    getTestRunStack: () => testRunStack,
  }
}

// Function implementation
export const runTestScript = (
  testScript: string,
  envs: TestResult["envs"],
  response: TestResponse,
): TE.TaskEither<string, TestResult> => {
  return pipe(
    TE.tryCatch(
      async () => {
        const {
          module: pwModule,
          getUpdatedEnvs,
          getTestRunStack,
        } = createPwModule(envs)

        const modules = [
          pwModule,
          blobPolyfill,
          esmModuleLoader,
          ConsoleModule({
            onLog(...args) {
              console.log(...args)
            },
          }),
        ]

        const cage = await FaradayCage.create()

        await cage.runCode(testScript, modules)

        const testResults = getTestRunStack()
        const updatedEnvs = getUpdatedEnvs()

        return <TestResult>{
          tests: testResults,
          envs: updatedEnvs,
        }
      },
      (reason) => `Context initialization failed: ${String(reason)}`,
    ),
  )
}

const executeScriptInContext = (
  testScript: string,
  envs: TestResult["envs"],
  response: TestResponse,
  isolate: ivmT.Isolate,
  context: ivmT.Context,
): Promise<TestResult> => {
  return new Promise((resolve, reject) => {
    // Parse response object
    const responseObjHandle = preventCyclicObjects(response)
    if (E.isLeft(responseObjHandle)) {
      return reject(`Response parsing failed: ${responseObjHandle.left}`)
    }

    const jail = context.global

    const { pw, testRunStack, updatedEnvs } = getTestRunnerScriptMethods(envs)

    const serializedAPIMethods = getSerializedAPIMethods({
      ...pw,
      response: responseObjHandle.right,
    })
    jail.setSync("serializedAPIMethods", serializedAPIMethods, { copy: true })

    jail.setSync("atob", atob)
    jail.setSync("btoa", btoa)

    jail.setSync("ivm", ivm)

    // Methods in the isolate context can't be invoked straightaway
    const finalScript = `
    const pw = new Proxy(serializedAPIMethods, {
      get: (pwObj, pwObjProp) => {
        // pw.expect(), pw.env, etc.
        const topLevelEntry = pwObj[pwObjProp]

        // If the entry exists and is a function
        // pw.expect(), pw.test(), etc.
        if (topLevelEntry && topLevelEntry.typeof === "function") {
          // pw.test() just involves invoking the function via "applySync()"
          if (pwObjProp === "test") {
            return (...args) => topLevelEntry.applySync(null, args)
          }

          // pw.expect() returns an object with matcher methods
          return (...args) => {
            // Invoke "pw.expect()" and get access to the object with matcher methods
            const expectFnResult = topLevelEntry.applySync(
              null,
              args.map((expectVal) => {
                if (typeof expectVal === "object") {
                  if (expectVal === null) {
                    return null
                  }

                  // Only arrays and objects stringified here should be parsed from the "pw.expect()" method definition
                  // The usecase is that any JSON string supplied should be preserved
                  // An extra "isStringifiedWithinIsolate" prop is added to indicate it has to be parsed

                  if (Array.isArray(expectVal)) {
                    return JSON.stringify({
                      arr: expectVal,
                      isStringifiedWithinIsolate: true,
                    })
                  }

                  return JSON.stringify({
                    ...expectVal,
                    isStringifiedWithinIsolate: true,
                  })
                }

                return expectVal
              })
            )

            // Matcher methods that can be chained with "pw.expect()"
            // pw.expect().toBe(), etc
            if (expectFnResult.typeof === "object") {
              // Access the getter that points to the negated matcher methods via "{ accessors: true }"
              const matcherMethods = {
                not: expectFnResult.getSync("not", { accessors: true }),
              }

              // Serialize matcher methods for use in the isolate context
              const matcherMethodNames = [
                "toBe",
                "toBeLevel2xx",
                "toBeLevel3xx",
                "toBeLevel4xx",
                "toBeLevel5xx",
                "toBeType",
                "toHaveLength",
                "toInclude",
              ]
              matcherMethodNames.forEach((methodName) => {
                matcherMethods[methodName] = expectFnResult.getSync(methodName)
              })

              return new Proxy(matcherMethods, {
                get: (matcherMethodTarget, matcherMethodProp) => {
                  // pw.expect().not.toBe(), etc
                  const matcherMethodEntry = matcherMethodTarget[matcherMethodProp]

                  if (matcherMethodProp === "not") {
                    return new Proxy(matcherMethodEntry, {
                      get: (negatedObjTarget, negatedObjprop) => {
                        // Return the negated matcher method defn that is invoked from the test script
                        const negatedMatcherMethodDefn = negatedObjTarget.getSync(negatedObjprop)
                        return negatedMatcherMethodDefn
                      },
                    })
                  }

                  // Return the matcher method defn that is invoked from the test script
                  return matcherMethodEntry
                },
              })
            }
          }
        }

        // "pw.env" set of API methods
        if (typeof topLevelEntry === "object" && pwObjProp !== "response") {
          return new Proxy(topLevelEntry, {
            get: (subTarget, subProp) => {
              const subLevelProperty = subTarget[subProp]
              if (
                subLevelProperty &&
                subLevelProperty.typeof === "function"
              ) {
                return (...args) => subLevelProperty.applySync(null, args)
              }
            },
          })
        }

        return topLevelEntry
      },
    })

      ${testScript}
    `

    // Create a script and compile it
    const script = isolate.compileScript(finalScript)

    // Run the test script in the provided context
    script
      .then((script) => script.run(context))
      .then(() => {
        resolve({
          tests: testRunStack,
          envs: updatedEnvs,
        })
      })
      .catch((error: Error) => {
        reject(error)
      })
  })
}
