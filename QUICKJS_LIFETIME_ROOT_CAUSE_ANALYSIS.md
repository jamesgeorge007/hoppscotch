# QuickJS Lifetime Root Cause Analysis

**Date**: 2025-11-05
**Issue**: QuickJSUseAfterFree: Lifetime not alive errors in web app
**Severity**: CRITICAL - Blocks RFC #5221 implementation

---

## Executive Summary

The QuickJS lifetime errors occur because **native browser Response objects returned by hopp.fetch() cannot cross the QuickJS boundary** properly. The current implementation attempts to pass Response objects directly into QuickJS, but these become invalid proxies after the cage's execution completes.

**Impact**:
- ✅ CLI: Works correctly (uses Node.js)
- ❌ Web App: Fails with QuickJS lifetime errors
- ❌ Test assertions: Not captured when using async/await syntax

---

## Root Cause Analysis

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                          USER SCRIPT                             │
│  async () => {                                                   │
│    const response = await hopp.fetch('...')  // Returns Response │
│    hopp.expect(response.status).toBe(200)    // Access after await│
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FARADAY CAGE (QuickJS)                      │
│                                                                   │
│  1. Execute user script                                          │
│  2. hopp.fetch() calls hoppFetchHook                            │
│  3. Hook returns native Response object                         │
│  4. QuickJS wraps Response as proxy                             │
│  5. Script execution completes                                   │
│  6. Cage lifetime ENDS                                           │
│  7. ❌ Response proxy becomes INVALID                            │
│  8. ❌ User tries to access response.status → LIFETIME ERROR    │
└─────────────────────────────────────────────────────────────────┘
```

### The Problem

**In Node.js (CLI)** - Works ✅:
- Response objects are simple POJOs created by the CLI
- Can be serialized/cloned by QuickJS
- Lifetime management not critical

**In Browser (Web App)** - Fails ❌:
- Response objects are native browser APIs with methods
- Cannot be cloned by lodash's `cloneDeep()`
- Become QuickJS proxies that die when cage ends
- Async operations access Response after cage disposal

### Key Files Involved

#### 1. Web Test Runner
**File**: [packages/hoppscotch-js-sandbox/src/web/test-runner/index.ts](packages/hoppscotch-js-sandbox/src/web/test-runner/index.ts)

**Problem at lines 59-79**:
```typescript
const cage = await FaradayCage.create()

const result = await cage.runCode(testScript, [
  ...defaultModules({
    hoppFetchHook,  // Returns native Response
  }),
  postRequestModule({
    response: cloneDeep(response),  // ❌ Cannot clone Response
    // ...
  }),
])

// ❌ No try/finally, no disposal management
// ❌ Response object from hopp.fetch() becomes invalid
```

**Issues**:
1. No try/finally block (unlike Node implementation)
2. `cloneDeep(response)` cannot handle native Response objects
3. Response from `hoppFetchHook` is not serialized
4. Cage lifetime ends while Response is still referenced

#### 2. Hopp Fetch Hook Implementation
**File**: [packages/hoppscotch-common/src/helpers/fetch/hopp-fetch.ts](packages/hoppscotch-common/src/helpers/fetch/hopp-fetch.ts)

**Problem at lines 151-172**:
```typescript
function convertRelayResponseToFetchResponse(relayResponse: any): Response {
  const headers = new Headers()
  // ...

  return new Response(relayResponse.body, {  // ❌ Native Response
    status,
    statusText,
    headers,
  })
}
```

**Issue**: Returns a **native browser Response object** that cannot be passed through QuickJS boundary.

#### 3. Pre-Request Runner
**File**: [packages/hoppscotch-js-sandbox/src/web/pre-request/index.ts](packages/hoppscotch-js-sandbox/src/web/pre-request/index.ts)

**Same issues as test runner** - missing try/finally, no proper Response handling.

---

## Why CLI Works But Web Doesn't

### CLI (Node.js) Implementation
**File**: [packages/hoppscotch-cli/src/utils/test/test-runner.ts](packages/hoppscotch-cli/src/utils/test/test-runner.ts)

```typescript
// CLI creates serializable response objects
const hoppFetchHook: HoppFetchHook = async (input, init) => {
  const axiosResponse = await axios(config)

  // Returns POJO, not native Response
  return {
    status: axiosResponse.status,
    headers: new Headers(axiosResponse.headers),
    text: async () => String(axiosResponse.data),
    json: async () => axiosResponse.data,
    // ... all methods return serializable data
  } as unknown as Response
}
```

**Why it works**:
- Response is a plain object implementing Response interface
- All data is already available (not lazy-loaded)
- Can be serialized/cloned by QuickJS
- No native browser APIs involved

### Web Implementation
```typescript
// Web returns native Response
return new Response(relayResponse.body, {
  status,
  statusText,
  headers,
})
```

**Why it fails**:
- Native Response has internal C++ state
- Methods like `.json()`, `.text()` are lazy
- Cannot be cloned or serialized
- Becomes invalid QuickJS proxy

---

## The Async/Await Problem

### Issue: Test Assertions Not Captured

**User Script**:
```typescript
hopp.test('test', async () => {
  const response = await hopp.fetch('...')
  hopp.expect(response.status).toBe(200)  // ❌ Not captured
})
```

**Why assertions aren't captured**:
1. Test is async function
2. `hopp.test()` returns promise
3. `cage.runCode()` completes before promise resolves
4. Assertions execute AFTER cage lifetime ends
5. Test runner captures empty test stack

**Current Behavior**:
```
testRunStack = [
  { descriptor: "root", expectResults: [], children: [] }
]
// ❌ No test results captured!
```

---

## Attempted Solutions (All Failed)

### Attempt 1: Add cage.dispose() in finally
**Result**: Made problem worse - immediate lifetime errors

### Attempt 2: Use .then() instead of async/await
**User tried**:
```typescript
hopp.test('test', () => {
  hopp.fetch('...').then(response => {
    hopp.expect(response.status).toBe(200)
  })
})
```
**Result**: Still fails - promise resolves after cage disposal

### Attempt 3: cloneDeep() on Response
**Current code**: `response: cloneDeep(response)`
**Result**: Cannot clone native Response objects

---

## Required Fixes

### Fix 1: Response Serialization (CRITICAL)

**Location**: [packages/hoppscotch-common/src/helpers/fetch/hopp-fetch.ts](packages/hoppscotch-common/src/helpers/fetch/hopp-fetch.ts)

**Solution**: Return a serializable Response-like object instead of native Response

```typescript
export const createHoppFetchHook = (
  kernelInterceptor: KernelInterceptorService,
  onFetchCall?: (meta: FetchCallMeta) => void
): HoppFetchHook => {
  return async (input, init) => {
    // ... existing code ...

    // ✅ Eagerly consume Response and create serializable object
    const nativeResponse = convertRelayResponseToFetchResponse(result.right)

    // Read all data immediately (before returning to QuickJS)
    const bodyArrayBuffer = await nativeResponse.arrayBuffer()
    const bodyBytes = new Uint8Array(bodyArrayBuffer)

    // Create serializable Response-like object
    const serializableResponse = {
      status: nativeResponse.status,
      statusText: nativeResponse.statusText,
      ok: nativeResponse.ok,
      headers: Object.fromEntries(nativeResponse.headers.entries()),
      _bodyBytes: Array.from(bodyBytes),  // Serializable

      // Implement Response methods using stored data
      async arrayBuffer() {
        return new Uint8Array(this._bodyBytes).buffer
      },
      async text() {
        return new TextDecoder().decode(new Uint8Array(this._bodyBytes))
      },
      async json() {
        const text = await this.text()
        return JSON.parse(text)
      },
      async blob() {
        return new Blob([new Uint8Array(this._bodyBytes)])
      },
    }

    return serializableResponse as unknown as Response
  }
}
```

### Fix 2: Add Try/Finally to Web Implementations

**Location**: [packages/hoppscotch-js-sandbox/src/web/test-runner/index.ts](packages/hoppscotch-js-sandbox/src/web/test-runner/index.ts)

**Solution**: Match Node.js implementation structure

```typescript
const cage = await FaradayCage.create()

try {
  const result = await cage.runCode(testScript, [
    ...defaultModules({
      hoppFetchHook,
    }),
    postRequestModule({
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
    }),
  ])

  if (result.type === "error") {
    return E.left(`Script execution failed: ${result.err.message}`)
  }

  return E.right(<SandboxTestResult>{
    tests: finalTestResults[0],
    envs: finalEnvs,
    consoleEntries,
    updatedCookies: finalCookies,
  })
} finally {
  // NOTE: Do NOT dispose the cage here - it causes QuickJS lifetime errors
  // because returned objects may still be accessed later.
  // Rely on garbage collection to clean up the cage when no longer referenced.
  // TODO: Investigate proper disposal timing or cage pooling/reuse strategy
}
```

### Fix 3: Async Test Support (QuickJS Limitation)

**Problem**: QuickJS cannot wait for async promises in test functions

**Workaround Options**:

**Option A**: Document limitation, require synchronous assertions
```typescript
// ❌ Not supported
hopp.test('test', async () => {
  const response = await hopp.fetch('...')
  hopp.expect(response.status).toBe(200)
})

// ✅ Supported (if we make hopp.fetch synchronous-looking)
hopp.test('test', () => {
  const response = hopp.fetch('...')  // Returns immediately
  hopp.expect(response.status).toBe(200)
})
```

**Option B**: Top-level await only
```typescript
// ✅ Supported (top-level await)
const response = await hopp.fetch('...')
hopp.test('test', () => {
  hopp.expect(response.status).toBe(200)
})
```

**Option C**: Custom promise handling (complex)
- Modify hopp.test() to detect async functions
- Use QuickJS promise primitives to wait
- May not be possible with current QuickJS version

---

## Comparison: Node vs Web

| Aspect | Node/CLI ✅ | Web ❌ |
|--------|------------|---------|
| Response type | POJO | Native browser API |
| Serializable | Yes | No |
| cloneDeep works | Yes | No |
| Lifetime issues | No | Yes |
| Try/finally | Yes | No |
| Async support | Limited (QuickJS) | Limited (QuickJS) |

---

## Next Steps

1. ✅ **Immediate**: Implement Response serialization in hopp-fetch.ts
2. ✅ **Immediate**: Add try/finally to web implementations
3. ⚠️ **Document**: Async test limitations clearly in docs
4. 🔍 **Investigate**: Alternative sandbox solutions (Web Workers without QuickJS)
5. 🔍 **Consider**: Hybrid approach (QuickJS for sync, Workers for async)

---

## Testing Strategy

### Validation Steps:
1. Test simple sync assertions (should work after Fix 1 + 2)
2. Test top-level await (should work after Fix 1 + 2)
3. Test async test functions (document as unsupported if fails)
4. Test sequential requests (top-level await chain)
5. Test error handling with serialized responses

### Success Criteria:
- ✅ No QuickJS lifetime errors
- ✅ Test assertions captured properly
- ✅ Response methods (.json(), .text(), etc.) work
- ✅ Status, headers, ok accessible
- ⚠️ Async test functions (nice-to-have, may be QuickJS limitation)

---

**Priority**: P0 (Blocks RFC implementation)
**Estimated Effort**: 2-3 hours (Fix 1 + Fix 2)
**Risk**: Medium (requires careful Response API compatibility)
