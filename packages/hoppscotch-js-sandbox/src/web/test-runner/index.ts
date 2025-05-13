import * as E from "fp-ts/Either"

import {
  ExpectResult,
  GlobalEnvItem,
  SandboxTestResult,
  SelectedEnvItem,
  TestDescriptor,
  TestResponse,
  TestResult,
} from "~/types"

import Worker from "./worker?worker&inline"

import { FaradayCage } from "faraday-cage"
import {
  blobPolyfill,
  console as ConsoleModule,
  defineCageModule,
  defineSandboxFn,
  defineSandboxFunctionRaw,
  esmModuleLoader,
} from "faraday-cage/modules"

import { parseTemplateStringE } from "@hoppscotch/data"
import { pipe } from "fp-ts/lib/function"
import * as O from "fp-ts/Option"
import * as TE from "fp-ts/TaskEither"
import { cloneDeep } from "lodash-es"

export const getEnv = (envName: string, envs: TestResult["envs"]) => {
  return O.fromNullable(
    envs.selected.find((x) => x.key === envName) ??
      envs.global.find((x) => x.key === envName),
  )
}

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

export const runTestScript = async (
  testScript: string,
  envs: TestResult["envs"],
  response: TestResponse,
): Promise<E.Either<string, SandboxTestResult>> => {
  const {
    module: pwModule,
    getUpdatedEnvs,
    getTestRunStack,
  } = createPwModule({ selected: [], global: [] })

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

  const code = `
  console.log('Hello from the sandbox!');
    const result = 40 + 2;
    console.log('Result:', result);

    pw.env.set("FOO", "bar")

  // Results in a runtime error
  pw.expect(pw.env.get("FOO")).toBe("bar")
  
  pw.expect(2 + 2).toBe(4)

  pw.expect("hello").not.toBe("Hello");
  pw.expect(5).not.toBe("5");
  // Import the pw module
    // These tests will pass
  pw.expect(204).toBeLevel2xx();
  pw.expect(308).toBeLevel3xx();
  pw.expect(308).not.toBeLevel4xx();
  pw.expect(404).toBeLevel4xx();
  pw.expect(503).toBeLevel5xx();
  pw.expect(513).not.toBeLevel2xx();

    // These tests will fail
  pw.expect(204).toBeLevel3xx();
  pw.expect(308).toBeLevel4xx();

  // These tests will pass
  pw.expect(5).toBeType("number");
  pw.expect(15).not.toBeType("string");
  pw.expect("Hello, world!").toBeType("string");

    // These tests will fail
  pw.expect(5).toBeType("string");
  pw.expect("Hello, world!").toBeType("number");

  pw.expect("hoppscotch").toInclude("hop");
  pw.expect([1, 2]).not.toInclude(3);

  // These expectations will pass
  pw.expect("hoppscotch").toHaveLength(10);
  pw.expect("hoppscotch").not.toHaveLength(9);

    pw.expect(["apple", "banana", "coconut"]).toHaveLength(3);
  pw.expect(["apple", "banana", "coconut"]).not.toHaveLength(4);
  
  pw.test("Test block", () => {
    pw.expect(2 + 2).toBe(4)
    pw.expect(pw.env.get("FOO")).toBe("bar")
  })`

  await cage.runCode(code, modules)

  console.log("Updated Envs:", getUpdatedEnvs())
  console.log("Test Results:", getTestRunStack())

  return TE.right(<SandboxTestResult>{
    tests: getTestRunStack()[0],
    envs: getUpdatedEnvs(),
  })()

  return new Promise((resolve) => {
    const worker = new Worker()

    // Listen for the results from the web worker
    worker.addEventListener("message", (event: MessageEvent) =>
      resolve(event.data.results),
    )

    // Send the script to the web worker
    worker.postMessage({
      testScript,
      envs,
      response,
    })
  })
}
