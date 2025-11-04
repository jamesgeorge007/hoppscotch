# RFC #5221 Critical Blockers - hopp.fetch() & pm.sendRequest()

**Date**: 2025-11-05
**Status**: 🔴 **BLOCKED** - Fundamental QuickJS async limitations prevent RFC implementation
**Priority**: P0 - Blocks entire RFC

---

## Executive Summary

After comprehensive investigation, **hopp.fetch() and pm.sendRequest() cannot be implemented as specified in RFC #5221 using the current QuickJS-based sandbox architecture**.

### What Works vs. What Doesn't

| Scenario | CLI ✅ | Web App ❌ | Root Cause |
|----------|--------|-----------|------------|
| Plain Promises | ✅ | ✅ | QuickJS handles native Promises |
| `await hopp.fetch()` top-level | ✅ | ❌ | QuickJS can't serialize host async functions |
| `hopp.fetch()` in callbacks | ✅ | ❌ | Same - callback runs after cage disposal |
| `pm.sendRequest()` callback style | ✅ | ❌ | Callback never executes in QuickJS |

---

## Root Cause: QuickJS Async Serialization

### The Problem

When `hopp.fetch()` is called from QuickJS:

```
User Script (QuickJS)
    ↓
hopp.fetch('url')  ← Calls host function
    ↓
HoppFetchHook (Node/Browser) ← Returns Promise
    ↓
❌ QuickJS CANNOT serialize Promise from host function
    ↓
await never resolves
```

### Why Plain Promises Work

```typescript
// ✅ THIS WORKS
const func = new Promise((res) => {
  return setTimeout(res(1000), 1000)
})
console.error(await func)  // Logs: 1000
```

**Why**: Promise is created **inside QuickJS**, so QuickJS can track and await it.

### Why hopp.fetch() Doesn't Work

```typescript
// ❌ THIS DOESN'T WORK
const val = await hopp.fetch("https://echo.hoppscotch.io")
console.error('api complete', val)  // Never executes
```

**Why**: Promise is created by **host function** (outside QuickJS), so QuickJS cannot properly serialize/await it.

---

## RFC #5221 Requirements vs. Reality

### RFC Requirement 1: hopp.fetch() with await

**RFC Example**:
```typescript
hopp.onResponse(async () => {
  const response = await hopp.fetch('https://api.example.com/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'value' })
  });

  const data = await response.json();
  console.log('External API response:', data);
});
```

**Status**: ❌ **BLOCKED**
- `await hopp.fetch()` never resolves in QuickJS
- Callback style doesn't help - still async host function

### RFC Requirement 2: pm.sendRequest() callback style

**RFC Example**:
```typescript
pm.sendRequest('https://api.example.com/data', (error, response) => {
  if (error) {
    console.error('Request failed:', error);
    return;
  }
  console.log('Status:', response.code);
  console.log('Body:', response.json());
});
```

**Status**: ❌ **BLOCKED**
- Callback never executes because QuickJS script completes before async operation
- Same issue as await - QuickJS can't wait for host async operations

---

## What We Fixed (But Doesn't Solve Core Problem)

### Fix 1: Response Serialization ✅
- **File**: [hopp-fetch.ts](packages/hoppscotch-common/src/helpers/fetch/hopp-fetch.ts)
- **What**: Convert native Response to serializable object
- **Impact**: Prevents lifetime errors IF async worked
- **Result**: Necessary but not sufficient

### Fix 2: Try/Finally Blocks ✅
- **Files**: [web/test-runner/index.ts](packages/hoppscotch-js-sandbox/src/web/test-runner/index.ts), [web/pre-request/index.ts](packages/hoppscotch-js-sandbox/src/web/pre-request/index.ts)
- **What**: Proper cage lifetime management
- **Impact**: Prevents premature disposal
- **Result**: Good practice but doesn't solve async issue

---

## Why CLI Works

The CLI works because it uses **synchronous-looking execution**:

```typescript
// CLI implementation (Node.js)
const hoppFetchHook: HoppFetchHook = async (input, init) => {
  const axiosResponse = await axios(config)
  return createResponseObject(axiosResponse)  // Plain object
}
```

When the cage runs the script, **Node.js awaits the entire cage.runCode() call**:

```typescript
// Node.js test runner
const result = await cage.runCode(testScript, [
  ...defaultModules({ hoppFetchHook }),
  // ...
])
```

So from Node's perspective, everything completes before returning.

### Why Web Doesn't Work

The web app has the **exact same architecture**, but the browser environment handles async differently, and QuickJS in the browser cannot properly await host functions.

---

## Technical Deep Dive: QuickJS Async Limitations

### How QuickJS Handles Async

QuickJS supports async/await **only for Promises created within the QuickJS context**:

```javascript
// ✅ QuickJS can handle this
async function test() {
  return new Promise((resolve) => {
    setTimeout(() => resolve(42), 1000)
  })
}
await test()  // Works!
```

### What QuickJS Cannot Handle

```javascript
// ❌ QuickJS CANNOT handle this
// If myHostFunction is provided by host (Node/Browser)
const result = await myHostFunction()  // Never resolves
```

**Why**: QuickJS needs to serialize Promises to track them. Promises from host functions are opaque objects that QuickJS cannot introspect or serialize.

### Faraday Cage fetch Module

The `faraday-cage/modules/fetch` module tries to wrap host fetch:

```javascript
// Simplified conceptual code
export const fetch = (config) => ({
  name: 'fetch',
  setup: (ctx) => {
    ctx.global.set('fetch', async (url, options) => {
      // This calls host's fetch implementation
      const response = await config.fetchImpl(url, options)

      // ❌ But QuickJS can't await this properly!
      return response
    })
  }
})
```

---

## Attempted Workarounds (All Failed)

### Attempt 1: Top-Level Await
**Tried**: `const response = await hopp.fetch('...')`
**Result**: ❌ Never completes

### Attempt 2: .then() Chains
**Tried**:
```typescript
hopp.fetch('...').then(response => {
  hopp.expect(response.status).toBe(200)
})
```
**Result**: ❌ `.then()` never executes

### Attempt 3: Callback Style (pm.sendRequest)
**Tried**:
```typescript
pm.sendRequest('...', (error, response) => {
  // ...
})
```
**Result**: ❌ Callback never executes

### Attempt 4: Async Test Functions
**Tried**:
```typescript
hopp.test('test', async () => {
  const response = await hopp.fetch('...')
  hopp.expect(response.status).toBe(200)
})
```
**Result**: ❌ Test function never completes, assertions not captured

---

## Solutions & Alternatives

### Solution 1: Switch to Web Workers (No QuickJS) ⭐ RECOMMENDED

**Approach**: Use Web Workers without QuickJS for async operations

**Pros**:
- ✅ Full async/await support
- ✅ Can await host functions properly
- ✅ No serialization issues
- ✅ Standard JavaScript environment

**Cons**:
- ⚠️ Less sandboxed (more security considerations)
- ⚠️ Different architecture for Node vs. Browser

**Implementation**:
- For `hopp.fetch()` / `pm.sendRequest()`: Execute in Web Worker
- For other operations: Keep QuickJS sandbox

### Solution 2: Synchronous API (Breaks RFC) ❌

**Approach**: Make `hopp.fetch()` return synchronously

```typescript
// Would require blocking until fetch completes
const response = hopp.fetch('...')  // No await
hopp.expect(response.status).toBe(200)
```

**Pros**:
- ✅ Would work in QuickJS

**Cons**:
- ❌ Violates RFC spec
- ❌ Breaks Fetch API compatibility
- ❌ Terrible UX (blocks UI)

### Solution 3: Hybrid Sandbox ⭐ VIABLE

**Approach**: Use QuickJS for sync operations, Web Worker for async

**Architecture**:
```
Test Script
    ├─ Sync operations → QuickJS sandbox
    └─ hopp.fetch/pm.sendRequest → Web Worker
```

**Pros**:
- ✅ Keeps security sandbox for most code
- ✅ Allows async operations to work
- ✅ RFC compliant

**Cons**:
- ⚠️ Complex implementation
- ⚠️ Need to detect which operations are async

### Solution 4: Ditch QuickJS Entirely

**Approach**: Use only Web Workers for all script execution

**Pros**:
- ✅ Full JavaScript support
- ✅ All async works

**Cons**:
- ❌ Security implications
- ❌ Major architectural change
- ❌ Requires complete rewrite

---

## Recommended Path Forward

### Phase 1: Validate Issue (CURRENT)
- ✅ Document QuickJS limitations
- ✅ Confirm async doesn't work
- ✅ Get stakeholder alignment

### Phase 2: Prototype Hybrid Approach
1. Keep QuickJS for test framework (`hopp.test`, `hopp.expect`)
2. Execute `hopp.fetch` and `pm.sendRequest` in Web Worker
3. Communicate results back to QuickJS

**Estimated Effort**: 1-2 weeks

### Phase 3: Full Implementation
1. Implement hybrid sandbox
2. Update all async operations
3. Comprehensive testing

**Estimated Effort**: 3-4 weeks

---

## Impact Assessment

### If Not Fixed

- ❌ RFC #5221 cannot be implemented
- ❌ No `hopp.fetch()` support
- ❌ No `pm.sendRequest()` support
- ❌ Major feature gap vs. Postman
- ❌ User expectations not met

### If Fixed with Hybrid Approach

- ✅ Full RFC #5221 compliance
- ✅ Maintains security sandbox
- ✅ Competitive with Postman
- ⚠️ Some architectural complexity

### If Fixed by Ditching QuickJS

- ✅ Full async support
- ✅ Simpler architecture
- ❌ Security implications
- ❌ Large rewrite effort

---

## Stakeholder Decision Required

**Question**: How should we proceed?

**Options**:
1. **Hybrid Sandbox** (Recommended) - QuickJS + Web Workers
2. **Web Workers Only** - Ditch QuickJS entirely
3. **Defer RFC** - Wait for better sandboxing solution
4. **Alternative Spec** - Modify RFC to work within QuickJS constraints

**Timeline Impact**:
- Option 1: +2-3 weeks
- Option 2: +4-6 weeks (major rewrite)
- Option 3: Indefinite
- Option 4: Requires RFC revision and stakeholder buy-in

---

## Conclusion

The current QuickJS-based sandbox **cannot support async host functions** as required by RFC #5221. We must either:

1. Implement a hybrid sandbox approach (QuickJS + Web Workers)
2. Move entirely away from QuickJS
3. Revise the RFC to work within QuickJS limitations

**Recommendation**: Proceed with **Hybrid Sandbox** approach (Option 1) as it provides the best balance of security, functionality, and implementation effort.

---

**Next Steps**:
1. Get stakeholder decision on approach
2. If hybrid approved: Begin prototype
3. Update RFC with any technical constraints
4. Plan implementation timeline

**Documents**:
- [QUICKJS_LIFETIME_ROOT_CAUSE_ANALYSIS.md](QUICKJS_LIFETIME_ROOT_CAUSE_ANALYSIS.md) - Detailed technical analysis
- [FETCH_TEST_VALIDATION_RESULTS.md](FETCH_TEST_VALIDATION_RESULTS.md) - CLI test results (showing it works there)

**Status**: ⏸️ **AWAITING DECISION**
