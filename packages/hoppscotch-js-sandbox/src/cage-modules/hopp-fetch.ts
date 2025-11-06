import {
  defineCageModule,
  defineSandboxFn,
  defineSandboxFunctionRaw,
  defineSandboxObject,
  type CageModuleCtx,
} from "faraday-cage/modules"
import type { HoppFetchHook } from "~/types"

// Simple marshalToVM implementation
function marshalToVM(vm: any, scope: any, value: unknown): any {
  if (value === null) return vm.null
  if (value === undefined) return vm.undefined
  if (value === true) return vm.true
  if (value === false) return vm.false
  if (typeof value === "number") return vm.newNumber(value)
  if (typeof value === "string") return vm.newString(value)

  if (Array.isArray(value)) {
    const arrayHandle = scope.manage(vm.newArray())
    value.forEach((val, index) => {
      const itemHandle = marshalToVM(vm, scope, val)
      vm.setProp(arrayHandle, index, itemHandle)
      itemHandle.dispose()
    })
    return arrayHandle
  }

  if (typeof value === "object") {
    const objHandle = scope.manage(vm.newObject())
    Object.entries(value as Record<string, unknown>).forEach(([key, val]) => {
      const valHandle = marshalToVM(vm, scope, val)
      vm.setProp(objHandle, key, valHandle)
      valHandle.dispose()
    })
    return objHandle
  }

  return vm.undefined
}

/**
 * Interface for configuring the fetch module
 */
export type FetchModuleConfig = {
  /**
   * Custom fetch implementation (hoppFetchHook)
   */
  fetchImpl?: HoppFetchHook
}

/**
 * EXACT copy from faraday-cage fix/fetch-top-level-await-support branch
 * This is the working implementation from the PR
 */
export const hoppFetchModule = (config: FetchModuleConfig = {}) =>
  defineCageModule((ctx) => {
  // Use provided fetch implementation or fallback to global fetch
  const fetchImpl = config.fetchImpl || fetch;

  // Keep-alive promise management for pending fetches
  const pendingOperations: Promise<unknown>[] = [];

  // Store native Response/Request objects to keep them accessible
  // We use a Map with unique IDs because WeakMap doesn't work across VM marshalling
  let instanceIdCounter = 0;
  const nativeInstances = new Map<number, Response | Request>();

  // Create a keep-alive promise that continuously waits for pending operations
  const keepAlivePromise = new Promise<void>((resolve) => {
    ctx.afterScriptExecutionHooks.push(async () => {
      // Poll until all operations are complete
      // We need multiple rounds of waiting even after pendingOperations becomes empty
      // because the VM needs time to process promise resolutions and resume the script
      let emptyRounds = 0;
      const maxEmptyRounds = 5; // Wait up to 5 rounds after becoming empty

      while (emptyRounds < maxEmptyRounds) {
        if (pendingOperations.length > 0) {
          emptyRounds = 0; // Reset counter when we have operations
          await Promise.allSettled(pendingOperations);
          // Wait a bit to allow any new operations to be registered
          await new Promise(r => setTimeout(r, 10));
        } else {
          emptyRounds++;
          // Give VM time to process jobs and register new operations
          await new Promise(r => setTimeout(r, 10));
        }
      }
      resolve();
    });
  });

  // Track an async operation and add it to pending list
  const trackAsyncOperation = <T>(promise: Promise<T>): Promise<T> => {
    pendingOperations.push(promise);
    return promise.finally(() => {
      const index = pendingOperations.indexOf(promise);
      if (index > -1) {
        pendingOperations.splice(index, 1);
      }
    });
  };

  ctx.keepAlivePromises.push(keepAlivePromise);

  // Type for 'this' in methods
  type HeadersThis = { __internal_headers: Headers };

  // Implement Headers class
  const headersPrototype = defineSandboxObject(ctx, {
    append: defineSandboxFn(ctx, "append", function(this: HeadersThis, ...args: unknown[]) {
      const name = String(args[0]);
      const value = String(args[1]);
      this.__internal_headers.append(name, value);
      return undefined;
    }),

    delete: defineSandboxFn(ctx, "delete", function(this: HeadersThis, ...args: unknown[]) {
      const name = String(args[0]);
      this.__internal_headers.delete(name);
      return undefined;
    }),

    get: defineSandboxFn(ctx, "get", function(this: HeadersThis, ...args: unknown[]) {
      const name = String(args[0]);
      return this.__internal_headers.get(name);
    }),

    has: defineSandboxFn(ctx, "has", function(this: HeadersThis, ...args: unknown[]) {
      const name = String(args[0]);
      return this.__internal_headers.has(name);
    }),

    set: defineSandboxFn(ctx, "set", function(this: HeadersThis, ...args: unknown[]) {
      const name = String(args[0]);
      const value = String(args[1]);
      this.__internal_headers.set(name, value);
      return undefined;
    }),

    forEach: defineSandboxFn(ctx, "forEach", function(this: HeadersThis, ...args: unknown[]) {
      const callbackfn = args[0] as (value: string, key: string, parent: any) => void;
      this.__internal_headers.forEach((value: string, key: string) => {
        callbackfn(value, key, this);
      });
      return undefined;
    }),

    entries: defineSandboxFn(ctx, "entries", function(this: HeadersThis) {
      // Polyfill for headers.entries() if not available
      const entries: [string, string][] = [];
      this.__internal_headers.forEach((value, key) => {
        entries.push([key, value]);
      });
      return entries;
    }),

    keys: defineSandboxFn(ctx, "keys", function(this: HeadersThis) {
      // Polyfill for headers.keys() if not available
      const keys: string[] = [];
      this.__internal_headers.forEach((_, key) => {
        keys.push(key);
      });
      return keys;
    }),

    values: defineSandboxFn(ctx, "values", function(this: HeadersThis) {
      // Polyfill for headers.values() if not available
      const values: string[] = [];
      this.__internal_headers.forEach((value) => {
        values.push(value);
      });
      return values;
    })
  });

  const HeadersConstructor = defineSandboxFunctionRaw(ctx, "Headers", (headersInit) => {
    const obj = ctx.scope.manage(ctx.vm.newObject());
    
    // Create actual Headers instance
    const headersInstance = new Headers(
      headersInit ? (ctx.vm.dump(headersInit) as HeadersInit) : undefined
    );
    
    // Store internal headers instance
    ctx.vm.setProp(obj, "__internal_headers", marshalToVM(ctx.vm, ctx.scope, headersInstance));
    
    // Set prototype
    ctx.vm.defineProp(obj, "__proto__", { configurable: false, enumerable: false, value: headersPrototype });
    
    return obj;
  });

  // Types for 'this' in methods
  type SignalThis = { __internal_signal: AbortSignal };
  type ControllerThis = { __internal_controller: AbortController };

  // Implement AbortController and AbortSignal
  const abortSignalPrototype = defineSandboxObject(ctx, {
    addEventListener: defineSandboxFn(ctx, "addEventListener", function(this: SignalThis, ...args: unknown[]) {
      const type = String(args[0]);
      const listener = args[1] as () => void;
      this.__internal_signal.addEventListener(type, listener);
      return undefined;
    }),

    removeEventListener: defineSandboxFn(ctx, "removeEventListener", function(this: SignalThis, ...args: unknown[]) {
      const type = String(args[0]);
      const listener = args[1] as () => void;
      this.__internal_signal.removeEventListener(type, listener);
      return undefined;
    }),

    // aborted property will be defined on instances
  });

  const abortControllerPrototype = defineSandboxObject(ctx, {
    abort: defineSandboxFn(ctx, "abort", function(this: ControllerThis, ...args: unknown[]) {
      const reason = args[0];
      this.__internal_controller.abort(reason);
      return undefined;
    }),

    // signal property will be defined on instances
  });

  const AbortControllerConstructor = defineSandboxFunctionRaw(ctx, "AbortController", () => {
    const obj = ctx.scope.manage(ctx.vm.newObject());
    
    // Create actual AbortController instance
    const controller = new AbortController();
    
    // Store internal controller instance
    ctx.vm.setProp(obj, "__internal_controller", marshalToVM(ctx.vm, ctx.scope, controller));
    
    // Create signal object
    const signalObj = ctx.scope.manage(ctx.vm.newObject());
    ctx.vm.setProp(signalObj, "__internal_signal", marshalToVM(ctx.vm, ctx.scope, controller.signal));
    ctx.vm.defineProp(signalObj, "__proto__", { configurable: false, enumerable: false, value: abortSignalPrototype });
    
    // Define aborted property on the signal object
    const getAbortedFn = defineSandboxFn(ctx, "get_aborted", function(this: SignalThis) {
      return this.__internal_signal.aborted;
    });

    ctx.vm.defineProp(signalObj, "aborted", {
      configurable: false,
      enumerable: true,
      get: getAbortedFn as any
    });
    
    // Attach signal to controller
    ctx.vm.setProp(obj, "signal", signalObj);
    
    // Set prototype
    ctx.vm.defineProp(obj, "__proto__", { configurable: false, enumerable: false, value: abortControllerPrototype });
    
    return obj;
  });

  // Common body methods for both Request and Response
  // Sets methods directly on an object instance
  const setBodyMethodsOnObject = (obj: any, instanceId: number) => {
    ctx.vm.setProp(obj, "arrayBuffer", defineSandboxFunctionRaw(ctx, "arrayBuffer", () => {
      const instance = nativeInstances.get(instanceId) as Response | Request;
      const resultPromise = trackAsyncOperation(
        instance.arrayBuffer().then((result) => marshalToVM(ctx.vm, ctx.scope, result))
      );

      return ctx.scope.manage(
        ctx.vm.newPromise((resolve, reject) => {
          resultPromise
            .then((marshalledHandle) => resolve(marshalledHandle))
            .catch((error) => {
              try {
                reject(marshalToVM(ctx.vm, ctx.scope, error));
              } catch {
                // Scope might be disposed if error occurs after keep-alive resolves
              }
            });
        })
      ).handle;
    }));

    ctx.vm.setProp(obj, "blob", defineSandboxFunctionRaw(ctx, "blob", () => {
      const instance = nativeInstances.get(instanceId) as Response | Request;
      const resultPromise = trackAsyncOperation(
        instance.blob().then((result) => marshalToVM(ctx.vm, ctx.scope, result))
      );

      return ctx.scope.manage(
        ctx.vm.newPromise((resolve, reject) => {
          resultPromise
            .then((marshalledHandle) => resolve(marshalledHandle))
            .catch((error) => {
              try {
                reject(marshalToVM(ctx.vm, ctx.scope, error));
              } catch {
                // Scope might be disposed if error occurs after keep-alive resolves
              }
            });
        })
      ).handle;
    }));

    ctx.vm.setProp(obj, "formData", defineSandboxFunctionRaw(ctx, "formData", () => {
      const instance = nativeInstances.get(instanceId) as Response | Request;
      const resultPromise = trackAsyncOperation(
        instance.formData().then((result) => marshalToVM(ctx.vm, ctx.scope, result))
      );

      return ctx.scope.manage(
        ctx.vm.newPromise((resolve, reject) => {
          resultPromise
            .then((marshalledHandle) => resolve(marshalledHandle))
            .catch((error) => {
              try {
                reject(marshalToVM(ctx.vm, ctx.scope, error));
              } catch {
                // Scope might be disposed if error occurs after keep-alive resolves
              }
            });
        })
      ).handle;
    }));

    ctx.vm.setProp(obj, "json", defineSandboxFunctionRaw(ctx, "json", () => {
      const instance = nativeInstances.get(instanceId) as Response | Request;
      const resultPromise = trackAsyncOperation(
        instance.json().then((result) => marshalToVM(ctx.vm, ctx.scope, result))
      );

      return ctx.scope.manage(
        ctx.vm.newPromise((resolve, reject) => {
          resultPromise
            .then((marshalledHandle) => resolve(marshalledHandle))
            .catch((error) => {
              try {
                reject(marshalToVM(ctx.vm, ctx.scope, error));
              } catch {
                // Scope might be disposed if error occurs after keep-alive resolves
              }
            });
        })
      ).handle;
    }));

    ctx.vm.setProp(obj, "text", defineSandboxFunctionRaw(ctx, "text", () => {
      const instance = nativeInstances.get(instanceId) as Response | Request;

      // Await the promise and marshal the result in host-land,
      // then create a VM promise with the marshalled result
      const resultPromise = trackAsyncOperation(
        instance.text().then((result) => marshalToVM(ctx.vm, ctx.scope, result))
      );

      // Return a VM promise that will be resolved with the already-marshalled handle
      return ctx.scope.manage(
        ctx.vm.newPromise((resolve, reject) => {
          resultPromise
            .then((marshalledHandle) => resolve(marshalledHandle))
            .catch((error) => {
              try {
                reject(marshalToVM(ctx.vm, ctx.scope, error));
              } catch {
                // Scope might be disposed if error occurs after keep-alive resolves
                // In this case, just ignore since the sandbox has finished
              }
            });
        })
      ).handle;
    }));
  };

  // Legacy method for test mocks that use __internal_instance
  const createBodyMethods = (prototype: any) => {
    ctx.vm.setProp(prototype, "arrayBuffer", defineSandboxFn(ctx, "arrayBuffer", function(this: any) {
      const method = this.__internal_instance?.arrayBuffer;
      if (typeof method === 'function') {
        return trackAsyncOperation(method.call(this.__internal_instance));
      }
      return method;
    }));

    ctx.vm.setProp(prototype, "blob", defineSandboxFn(ctx, "blob", function(this: any) {
      const method = this.__internal_instance?.blob;
      if (typeof method === 'function') {
        return trackAsyncOperation(method.call(this.__internal_instance));
      }
      return method;
    }));

    ctx.vm.setProp(prototype, "formData", defineSandboxFn(ctx, "formData", function(this: any) {
      const method = this.__internal_instance?.formData;
      if (typeof method === 'function') {
        return trackAsyncOperation(method.call(this.__internal_instance));
      }
      return method;
    }));

    ctx.vm.setProp(prototype, "json", defineSandboxFn(ctx, "json", function(this: any) {
      const method = this.__internal_instance?.json;
      if (typeof method === 'function') {
        return trackAsyncOperation(method.call(this.__internal_instance));
      }
      return method;
    }));

    ctx.vm.setProp(prototype, "text", defineSandboxFn(ctx, "text", function(this: any) {
      const method = this.__internal_instance?.text;
      if (typeof method === 'function') {
        return trackAsyncOperation(method.call(this.__internal_instance));
      }
      return method;
    }));
  };

  // Implement Response class
  const responsePrototype = defineSandboxObject(ctx, {
    clone: defineSandboxFn(ctx, "clone", function(this: any) {
      if (this.__internal_instance_id !== undefined) {
        const instance = nativeInstances.get(this.__internal_instance_id) as Response;
        const cloned = instance.clone();
        return createResponseObject(ctx, cloned);
      }
      // For test mocks
      const cloned = this.__internal_instance.clone();
      return createResponseObject(ctx, cloned);
    })
  });

  // Add body methods to Response prototype
  createBodyMethods(responsePrototype);

  const ResponseConstructor = defineSandboxFunctionRaw(ctx, "Response", (body, init) => {
    // Create a new Response instance
    const bodyValue = body ? ctx.vm.dump(body) : undefined;
    const initValue = init ? ctx.vm.dump(init) as ResponseInit : undefined;

    const response = new Response(bodyValue, initValue);

    // Create Response object
    return createResponseObject(ctx, response);
  });

  // Implement Request class
  const requestPrototype = defineSandboxObject(ctx, {
    clone: defineSandboxFn(ctx, "clone", function(this: any) {
      if (this.__internal_instance_id !== undefined) {
        const instance = nativeInstances.get(this.__internal_instance_id) as Request;
        const cloned = instance.clone();
        return createRequestObject(ctx, cloned);
      }
      // For test mocks
      const cloned = this.__internal_instance.clone();
      return createRequestObject(ctx, cloned);
    })
  });

  // Add body methods to Request prototype
  createBodyMethods(requestPrototype);

  const RequestConstructor = defineSandboxFunctionRaw(ctx, "Request", (input, init) => {
    // Convert input Request object or string URL
    let inputValue: string | Request;
    
    if (ctx.vm.typeof(input) === "object") {
      const obj = ctx.vm.dump(input);
      if (obj && typeof obj === "object" && "__internal_instance" in obj) {
        inputValue = obj.__internal_instance;
      } else {
        inputValue = String(obj);
      }
    } else {
      inputValue = String(ctx.vm.dump(input));
    }
    
    const initValue = init ? ctx.vm.dump(init) as RequestInit : undefined;
    
    // Create an actual Request instance
    const request = new Request(inputValue, initValue);
    
    // Create Request object
    return createRequestObject(ctx, request);
  });

  // Helper function to create a Response object with properties
  function createResponseObject(ctx: CageModuleCtx, response: Response) {
    const obj = ctx.scope.manage(ctx.vm.newObject());

    // Store the native Response instance in our Map and store its ID
    const instanceId = instanceIdCounter++;
    nativeInstances.set(instanceId, response);

    ctx.vm.setProp(obj, "__internal_instance_id", marshalToVM(ctx.vm, ctx.scope, instanceId));

    // Add standard properties
    const properties = [
      { name: "ok", value: response.ok },
      { name: "redirected", value: response.redirected },
      { name: "status", value: response.status },
      { name: "statusText", value: response.statusText },
      { name: "type", value: response.type },
      { name: "url", value: response.url },
      { name: "bodyUsed", value: response.bodyUsed }
    ];

    for (const prop of properties) {
      ctx.vm.setProp(obj, prop.name, marshalToVM(ctx.vm, ctx.scope, prop.value));
    }

    // Add headers
    const headersObj = ctx.scope.manage(ctx.vm.newObject());
    const headersInstance = response.headers;
    ctx.vm.setProp(headersObj, "__internal_headers", marshalToVM(ctx.vm, ctx.scope, headersInstance));
    ctx.vm.defineProp(headersObj, "__proto__", { configurable: false, enumerable: false, value: headersPrototype });
    ctx.vm.setProp(obj, "headers", headersObj);

    // Add body methods directly to this instance
    setBodyMethodsOnObject(obj, instanceId);

    // Add clone method
    ctx.vm.setProp(obj, "clone", defineSandboxFn(ctx, "clone", function() {
      const instance = nativeInstances.get(instanceId) as Response;
      const cloned = instance.clone();
      return createResponseObject(ctx, cloned);
    }));

    return obj;
  }

  // Helper function to create a Request object with properties
  function createRequestObject(ctx: CageModuleCtx, request: Request) {
    const obj = ctx.scope.manage(ctx.vm.newObject());

    // Store the native Request instance in our Map and store its ID
    const instanceId = instanceIdCounter++;
    nativeInstances.set(instanceId, request);

    ctx.vm.setProp(obj, "__internal_instance_id", marshalToVM(ctx.vm, ctx.scope, instanceId));

    // Add standard properties
    const properties = [
      { name: "cache", value: request.cache },
      { name: "credentials", value: request.credentials },
      { name: "destination", value: request.destination },
      { name: "integrity", value: request.integrity },
      { name: "method", value: request.method },
      { name: "mode", value: request.mode },
      { name: "redirect", value: request.redirect },
      { name: "referrer", value: request.referrer },
      { name: "referrerPolicy", value: request.referrerPolicy },
      { name: "url", value: request.url },
      { name: "bodyUsed", value: request.bodyUsed }
    ];

    for (const prop of properties) {
      ctx.vm.setProp(obj, prop.name, marshalToVM(ctx.vm, ctx.scope, prop.value));
    }

    // Add headers
    const headersObj = ctx.scope.manage(ctx.vm.newObject());
    const headersInstance = request.headers;
    ctx.vm.setProp(headersObj, "__internal_headers", marshalToVM(ctx.vm, ctx.scope, headersInstance));
    ctx.vm.defineProp(headersObj, "__proto__", { configurable: false, enumerable: false, value: headersPrototype });
    ctx.vm.setProp(obj, "headers", headersObj);

    // Add body methods directly to this instance
    setBodyMethodsOnObject(obj, instanceId);

    // Add clone method
    ctx.vm.setProp(obj, "clone", defineSandboxFn(ctx, "clone", function() {
      const instance = nativeInstances.get(instanceId) as Request;
      const cloned = instance.clone();
      return createRequestObject(ctx, cloned);
    }));

    return obj;
  }

  // Implement main fetch function
  const fetchFunction = defineSandboxFunctionRaw(ctx, "fetch", (input, init) => {
    // Convert input Request object or string URL
    let inputValue: string | Request;

    if (ctx.vm.typeof(input) === "object") {
      const obj = ctx.vm.dump(input);
      if (obj && typeof obj === "object" && "__internal_instance" in obj) {
        inputValue = obj.__internal_instance;
      } else {
        inputValue = String(obj);
      }
    } else {
      inputValue = String(ctx.vm.dump(input));
    }

    const initValue = init ? ctx.vm.dump(init) as RequestInit : undefined;

    // Create the fetch promise and track it
    const fetchPromise = trackAsyncOperation(
      fetchImpl(inputValue, initValue)
    );

    // Create promise that will resolve with the Response
    return ctx.scope.manage(
      ctx.vm.newPromise((resolve, reject) => {
        fetchPromise
          .then((response) => {
            // Convert the response to a sandbox Response object
            const responseObj = createResponseObject(ctx, response);
            resolve(responseObj);
          })
          .catch((error) => {
            reject(marshalToVM(ctx.vm, ctx.scope, error));
          });
      })
    ).handle;
  });

  // Register the fetch API on the global object
  ctx.vm.setProp(ctx.vm.global, "fetch", fetchFunction)
  ctx.vm.setProp(ctx.vm.global, "Headers", HeadersConstructor)
  ctx.vm.setProp(ctx.vm.global, "Request", RequestConstructor)
  ctx.vm.setProp(ctx.vm.global, "Response", ResponseConstructor)
  ctx.vm.setProp(ctx.vm.global, "AbortController", AbortControllerConstructor)
})
