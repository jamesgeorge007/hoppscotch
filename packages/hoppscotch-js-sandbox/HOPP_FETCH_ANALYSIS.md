# Comprehensive Analysis: `hopp.fetch()` and Async Handling in Hoppscotch

## Executive Summary

After comprehensive analysis and testing, the current implementation has **fundamental architectural issues** that require a strategic fix. The custom fetch module approach is a stepping stone, but the real solution lies in using the **updated faraday-cage library** with proper async handling.

---

## Current State Analysis

### 1. **Architecture Overview**

```
┌─────────────────────────────────────────────────────────────┐
│ User Script (QuickJS Sandbox)                               │
│                                                              │
│  await hopp.fetch("url") ──┐                                │
│                            │                                 │
│  await response.json() ────┼───▶ [Async Operations]         │
│                            │                                 │
└────────────────────────────┼─────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ Custom Fetch Module (custom-fetch.ts)                       │
│                                                              │
│  • trackAsyncOperation()    ← Tracks fetch() call           │
│  • keepAlivePromises        ← Waits for completion          │
│  • createResponseObject()   ← Creates Response proxy        │
│                                                              │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ HoppFetchHook (hopp-fetch.ts)                               │
│                                                              │
│  • KernelInterceptorService ← Respects interceptor          │
│  • RelayRequest conversion                                  │
│  • Serializable Response    ← Plain object, not native      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2. **The Core Problem**

From your testing:
```javascript
// ✅ WORKS: Plain promises tracked correctly
const func = new Promise(res => setTimeout(res('Test'), 1000))
await func  // Completes successfully

// ❌ FAILS: response.json() not tracked
const response = await hopp.fetch("url")  // Works
await response.json()  // Returns pending, never completes
```

**Root Cause**: `response.json()` creates a **new VM promise** that is NOT being tracked by the keep-alive mechanism.

---

## Why Custom Fetch Module Fails

### Problem in `custom-fetch.ts:98-124`

```typescript
ctx.vm.setProp(obj, "json", defineSandboxFunctionRaw(ctx, "json", () => {
  // ✅ This promise IS tracked
  const jsonPromise = trackAsyncOperation(
    response.json().then((data) => {
      console.error("[DEBUG] json() resolved")
      return data
    })
  )

  // ❌ This VM promise is NOT tracked
  return ctx.scope.manage(
    ctx.vm.newPromise((resolve) => {
      jsonPromise.then((data) => {
        // Marshal and resolve...
      })
    })
  ).handle
})
```

**The Issue**:
1. `trackAsyncOperation()` tracks the **host-land promise**
2. `ctx.vm.newPromise()` creates a **separate VM promise**
3. Keep-alive waits for host-land promises only
4. VM promise resolves **after** keep-alive already finished
5. Script terminates before VM promise completes

---

## Analysis of HoppFetchHook Design

### Current Implementation (hopp-fetch.ts)

**Strengths** ✅:
1. **Respects interceptor preference**: Routes through `KernelInterceptorService`
2. **Serializable Response**: Returns plain object, not native Response
3. **Comprehensive conversion**: Handles all body types (text, JSON, FormData, Blob, ArrayBuffer)
4. **Proper type safety**: Implements full Response interface

**Critical Design Decision** 🎯:

```typescript
// Lines 156-159
function convertRelayResponseToSerializableResponse(
  relayResponse: any
): Response {
  // CRITICAL: We cannot return a native Response object because:
  // 1. Native Response has internal C++ state that cannot be cloned
  // 2. When passed to QuickJS, it becomes a proxy that dies when cage ends
  // 3. User scripts access Response after async operations complete
```

This is **exactly correct** and aligns with the fundamental limitation of QuickJS.

### The Response Object Structure

```typescript
const serializableResponse = {
  status: 200,
  statusText: "OK",
  ok: true,
  headers: { get, has, entries, keys, values, forEach },
  _bodyBytes: [/* array of bytes */],

  // ❌ PROBLEM: These are async methods
  async arrayBuffer(): Promise<ArrayBuffer> { ... },
  async text(): Promise<string> { ... },
  async json(): Promise<any> { ... },
  async blob(): Promise<Blob> { ... }
}
```

**The Issue**: These async methods on the Response object are **not being tracked** by faraday-cage's keep-alive mechanism.

---

## The Solution: Use Updated Faraday-Cage

Based on your PRs to faraday-cage-fork:
- https://github.com/jamesgeorge007/faraday-cage-fork/pull/1
- https://github.com/jamesgeorge007/faraday-cage-fork/pull/2

You've **already solved this problem** in the underlying library! The updated faraday-cage properly handles:
1. ✅ Async promises at all levels
2. ✅ Nested promise tracking
3. ✅ Response method promises (text(), json(), etc.)

### Why This is the Right Approach

1. **Library-Level Solution**: Fixes the root cause, not symptoms
2. **Reusable**: Benefits all cage modules, not just fetch
3. **Maintainable**: Changes stay in one place (faraday-cage)
4. **Tested**: Your playground validates it works

---

## Recommendation: Strategic Fix

### Immediate Action Items

1. **Update Package Dependency**
   ```json
   // packages/hoppscotch-js-sandbox/package.json
   {
     "dependencies": {
       "faraday-cage": "file:../../faraday-cage"  // ← Already pointing to your fork
     }
   }
   ```

2. **Remove Custom Fetch Module**
   - Delete `src/cage-modules/custom-fetch.ts`
   - Revert to using faraday-cage's built-in fetch module

3. **Use Standard Fetch Module**
   ```typescript
   // src/cage-modules/default.ts
   import { fetch } from "faraday-cage/modules"

   export const defaultModules = (config?: DefaultModulesConfig) => {
     return [
       // ... other modules
       fetch({
         fetchImpl: config?.hoppFetchHook,  // ← Routes through interceptor
       }),
     ]
   }
   ```

### Why This Works

Your faraday-cage updates solve the **fundamental problem**:
- ✅ All async operations tracked (fetch, response.json(), response.text(), etc.)
- ✅ Keep-alive waits for nested promises
- ✅ VM promises properly synchronized with host promises
- ✅ Script execution doesn't terminate early

---

## HoppFetchHook Integration Analysis

### Is `response.json()` needed for `hopp.fetch()`?

**Answer: YES, it's required** ✅

#### Reasoning:

1. **Standard Fetch API Contract**
   ```typescript
   export type HoppFetchHook = (
     input: RequestInfo | URL,
     init?: RequestInit
   ) => Promise<Response>
   ```
   - Must return a `Response` object
   - `Response` must have `.json()`, `.text()`, etc.

2. **Interceptor System Returns Serializable Response**
   ```typescript
   // From hopp-fetch.ts:161-249
   function convertRelayResponseToSerializableResponse(
     relayResponse: any
   ): Response {
     // Returns plain object with async methods
     async json(): Promise<any> {
       const text = await this.text()
       return JSON.parse(text)
     }
   }
   ```

3. **User Scripts Expect Standard API**
   ```javascript
   // Users write standard fetch code:
   const response = await hopp.fetch("url")
   const data = await response.json()  // ← Must work
   ```

### Why Global `fetch()` Should Be Different

**Global `fetch()` should NOT exist** or should throw an error:

```typescript
// In bootstrap code or cage module:
globalThis.fetch = () => {
  throw new Error(
    "Use hopp.fetch() instead of fetch() in Hoppscotch scripts. " +
    "hopp.fetch() respects your interceptor settings (browser/proxy/extension)."
  )
}
```

**Rationale**:
- Native `fetch()` bypasses interceptor system
- Causes CORS issues in browser
- Confuses users (why have two?)
- `hopp.fetch()` is the Hoppscotch way

---

## Interceptor Preference Integration

### How It Currently Works ✅

```typescript
// In web app (RequestRunner.ts or similar):
const kernelInterceptor = inject(KernelInterceptorService)

const hoppFetchHook = createHoppFetchHook(
  kernelInterceptor,  // ← Automatically uses user's preference
  onFetchCall
)

// Run script with hook
runPreRequestScript({
  script: preRequestScript,
  envs,
  request,
  hoppFetchHook  // ← Passed to cage modules
})
```

### Flow Diagram

```
User Script
   │
   │ await hopp.fetch("https://api.example.com")
   │
   ▼
Faraday-Cage Fetch Module
   │
   │ Calls: hoppFetchHook(url, init)
   │
   ▼
createHoppFetchHook (hopp-fetch.ts)
   │
   │ Converts to RelayRequest
   │
   ▼
KernelInterceptorService
   │
   │ User's Setting: "proxy" / "browser" / "extension" / "agent"
   │
   ├─▶ ProxyInterceptor     (if user selected proxy)
   ├─▶ BrowserInterceptor   (if user selected browser)
   ├─▶ ExtensionInterceptor (if user selected extension)
   └─▶ AgentInterceptor     (if user selected agent)
       │
       ▼
    Network Request
       │
       ▼
    RelayResponse
       │
       ▼
    Serializable Response Object
       │
       ▼
    Back to User Script
```

**This design is perfect** ✅ - `hopp.fetch()` automatically respects the user's interceptor preference without any script-level configuration.

---

## Implementation Gaps

### Current Issues

1. **Custom Fetch Module Doesn't Track Response Methods**
   - `response.json()` creates untracked VM promise
   - Keep-alive doesn't wait for it
   - Script terminates early

2. **Faraday-Cage Local Version Not Updated**
   - Still using old version with async tracking issues
   - Need to rebuild/reinstall from your fork

3. **No Global fetch() Protection**
   - Users can accidentally use `fetch()` instead of `hopp.fetch()`
   - Causes confusion and CORS errors

### Fixes Required

1. **Use Updated Faraday-Cage**
   ```bash
   cd /Users/jamesgeorge/CodeSpaces/faraday-cage
   # Pull your PR changes
   pnpm run build

   cd /Users/jamesgeorge/CodeSpaces/hoppscotch/packages/hoppscotch-js-sandbox
   pnpm install --force
   pnpm run build
   ```

2. **Remove Custom Fetch Module**
   ```bash
   rm src/cage-modules/custom-fetch.ts
   ```

3. **Revert to Standard Fetch Module**
   ```typescript
   // src/cage-modules/default.ts
   import { fetch } from "faraday-cage/modules"

   return [
     // ... other modules
     fetch({ fetchImpl: config?.hoppFetchHook }),
   ]
   ```

4. **Add Global fetch() Warning**
   ```typescript
   // In bootstrap-code/pre-request.js (around line 160)
   // Remove or wrap the global fetch alias
   globalThis.fetch = () => {
     throw new Error(
       "Use hopp.fetch() instead of fetch(). " +
       "hopp.fetch() respects your interceptor settings."
     )
   }

   globalThis.hopp = {
     // ... existing hopp namespace
     fetch: actualFetchFunction,  // ← Only way to fetch
   }
   ```

---

## Testing Strategy

### Test Cases

1. **Basic Fetch**
   ```javascript
   const response = await hopp.fetch("https://echo.hoppscotch.io")
   console.log("Status:", response.status)  // Should work
   ```

2. **Response.json()**
   ```javascript
   const response = await hopp.fetch("https://echo.hoppscotch.io")
   const data = await response.json()  // Should work with updated faraday-cage
   console.log("Data:", data)
   ```

3. **Response.text()**
   ```javascript
   const response = await hopp.fetch("https://echo.hoppscotch.io")
   const text = await response.text()  // Should work
   console.log("Length:", text.length)
   ```

4. **POST with Body**
   ```javascript
   const response = await hopp.fetch("https://echo.hoppscotch.io", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ test: "data" })
   })
   const result = await response.json()
   ```

5. **Error Handling**
   ```javascript
   try {
     await hopp.fetch("https://invalid-url-that-does-not-exist.com")
   } catch (error) {
     console.log("Caught error:", error.message)
   }
   ```

### Expected Results

With updated faraday-cage:
- ✅ All 5 tests should pass
- ✅ All console.log statements should execute
- ✅ No "pending" promises
- ✅ No early script termination

---

## Conclusion

### Summary

| Component | Status | Action Required |
|-----------|--------|-----------------|
| **HoppFetchHook Design** | ✅ Perfect | None - works as intended |
| **Interceptor Integration** | ✅ Perfect | None - automatically respects user preference |
| **Serializable Response** | ✅ Correct | None - proper design for QuickJS |
| **Faraday-Cage Version** | ❌ Outdated | Update to your fork with async fixes |
| **Custom Fetch Module** | ❌ Incomplete | Remove - use standard fetch module instead |
| **Global fetch()** | ⚠️ Warning needed | Add error message directing to hopp.fetch() |

### The Path Forward

1. **Short Term** (Current Session):
   - Update faraday-cage from your fork
   - Remove custom-fetch.ts
   - Revert to standard fetch module
   - Test all 5 scenarios

2. **Long Term** (After Testing):
   - Publish your faraday-cage fork as package
   - Update Hoppscotch to use published version
   - Add comprehensive fetch() tests to CI
   - Document hopp.fetch() vs fetch() in user docs

### Key Takeaway

**Don't reinvent the wheel** - you've already solved this in faraday-cage. Use that solution, and `hopp.fetch()` will work perfectly with the interceptor system. The architecture is sound; we just need to use the updated library version.
