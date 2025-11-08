# Async Test Result Timing Fix

## Problem
When running tests with async operations (top-level await, .then() chains, async callbacks in hopp.test()), the UI showed intermediate or failed test states before async operations completed:

1. **Premature Results**: Test results appeared before async operations finished
2. **Flickering UI**: Tests showed as "failed" initially, then toggled to "passed" after async completion
3. **Missing Data**: Environment variables set in async callbacks weren't captured
4. **Loading State**: Send button changed to Cancel and back before results were ready

Example problematic flow:
```javascript
hopp.test('Async test', async () => {
  const response = await hopp.fetch('https://echo.hoppscotch.io')
  hopp.env.active.set('result', 'success')  // Not captured if results grabbed too early
  hopp.expect(response.status).toBe(200)     // Shows failed initially
})
```

## Root Cause

Both web and node test runners had the same execution order issue:

```typescript
// WRONG ORDER (old code):
const result = await cage.runCode(testScript, modules)

// 1. Capture results immediately after script execution
if (captureHook.capture) {
  captureHook.capture()  // ❌ TOO EARLY - async operations still running!
}

// 2. Check for errors
if (result.type === "error") {
  throw result.err
}

// 3. Wait for async operations (too late!)
if (testPromises.length > 0) {
  await Promise.all(testPromises)  // Results already captured above!
}

return { tests: finalTestResults, envs: finalEnvs }
```

**The Issue**:
- `cage.runCode()` returns as soon as the script's synchronous portion completes
- Any async operations (await, .then(), async test callbacks) are still running
- `captureHook.capture()` was called immediately, capturing **intermediate state**
- `testPromises` were awaited **after** capture, so their results weren't included
- UI received incomplete/failed results, then got updated when async operations finished

## The Fix

Reordered execution in both test runners to ensure results are only captured **after** all async operations complete:

```typescript
// CORRECT ORDER (new code):
const result = await cage.runCode(testScript, modules)

// 1. Check for script execution errors first
if (result.type === "error") {
  return E.left(`Script execution failed: ${result.err.message}`)
}

// 2. CRITICAL: Wait for ALL async test functions to complete
// This ensures test assertions in async callbacks finish before we capture results
if (testPromises.length > 0) {
  await Promise.all(testPromises)  // ✅ Wait for async operations
}

// 3. Capture results AFTER all async tests complete
// This prevents showing intermediate/failed state in UI
if (captureHook.capture) {
  captureHook.capture()  // ✅ Capture final state only
}

// 4. Return final results
return E.right({
  tests: finalTestResults,
  envs: finalEnvs,
  consoleEntries,
  updatedCookies: finalCookies
})
```

## How It Works

### Test Promise Tracking
The `postRequestModule` provides a `registerTestPromise()` function that tracks async operations:

```javascript
// In user's test script:
hopp.test('Async test', async () => {
  const response = await hopp.fetch('...')  // Async operation
  hopp.expect(response.status).toBe(200)
})

// Behind the scenes:
// - hopp.test() detects async callback (returns Promise)
// - Calls registerTestPromise(promise)
// - Promise added to testPromises array
// - Test runner waits for all testPromises before capturing results
```

### Execution Flow

**Old Flow (Broken)**:
```
1. Run script → async operations start
2. captureHook.capture() → captures intermediate state ❌
3. Return results → UI shows failed tests
4. await testPromises → async operations complete
5. (Results already sent, UI updates separately - causes flicker)
```

**New Flow (Fixed)**:
```
1. Run script → async operations start
2. Check for errors
3. await testPromises → wait for ALL async operations to complete ✅
4. captureHook.capture() → captures final state ✅
5. Return results → UI shows correct final state
```

## Files Changed

### 1. Web Test Runner
**File**: [packages/hoppscotch-js-sandbox/src/web/test-runner/index.ts](packages/hoppscotch-js-sandbox/src/web/test-runner/index.ts#L92-L122)

**Changes** (lines 92-122):
```typescript
// Check for script execution errors first
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

// CRITICAL: Wait for async test functions BEFORE capturing results
// This ensures test assertions in async callbacks complete before we return results
if (testPromises.length > 0) {
  await Promise.all(testPromises)
}

// Capture results AFTER all async tests complete
// This prevents showing intermediate/failed state in UI
if (captureHook.capture) {
  captureHook.capture()
}

return E.right(<SandboxTestResult>{
  tests: finalTestResults[0],
  envs: finalEnvs,
  consoleEntries,
  updatedCookies: finalCookies,
})
```

### 2. Node Test Runner (CLI)
**File**: [packages/hoppscotch-js-sandbox/src/node/test-runner/experimental.ts](packages/hoppscotch-js-sandbox/src/node/test-runner/experimental.ts#L58-L77)

**Changes** (lines 58-77):
```typescript
if (result.type === "error") {
  throw result.err
}

// CRITICAL: Wait for async test functions BEFORE capturing results
// This ensures test assertions in async callbacks complete before we return results
if (testPromises.length > 0) {
  await Promise.all(testPromises)
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
```

## Test Coverage

The fix was validated against the comprehensive async validation collection:

### Async Patterns Tested
1. **Top-level await**
   ```javascript
   const response = await hopp.fetch('...')
   ```

2. **.then() chaining**
   ```javascript
   hopp.fetch('...').then(r => r.json()).then(data => {
     hopp.env.active.set('result', data.value)
   })
   ```

3. **Await inside hopp.test()**
   ```javascript
   hopp.test('Test', async () => {
     const response = await hopp.fetch('...')
     hopp.expect(response.status).toBe(200)
   })
   ```

4. **.then() inside hopp.test()**
   ```javascript
   hopp.test('Test', () => {
     return hopp.fetch('...')
       .then(r => r.json())
       .then(data => hopp.expect(data).toBeDefined())
   })
   ```

5. **Promise.all with multiple fetches**
   ```javascript
   const [r1, r2] = await Promise.all([
     hopp.fetch('...'),
     hopp.fetch('...')
   ])
   ```

6. **Mixed patterns**
   ```javascript
   const r1 = await hopp.fetch('...')
   hopp.fetch('...').then(r2 => {
     hopp.test('Combined', async () => {
       const r3 = await hopp.fetch('...')
       hopp.expect(r3.status).toBe(200)
     })
   })
   ```

### Test Results
All 77 test cases passing:
```
✓ Test Cases: 0 failed 77 passed
✓ Test Suites: 0 failed 38 passed
✓ Test Scripts: 0 failed 10 passed
```

## Impact

### Before Fix
- ❌ UI showed failed tests that later became passing
- ❌ Environment variables from async callbacks not captured
- ❌ Test assertions in async callbacks showed wrong results initially
- ❌ Loading state ended before async operations completed
- ❌ Confusing user experience with flickering test results

### After Fix
- ✅ UI shows only final test results after all async operations complete
- ✅ All environment variables properly captured
- ✅ Test assertions execute fully before results displayed
- ✅ Loading state persists until all async operations finish
- ✅ Clean, consistent user experience

## Technical Details

### Why testPromises Tracking Works

The `registerTestPromise()` function is provided by `postRequestModule`:

```typescript
postRequestModule({
  // ... other config
  onTestPromise: (promise) => {
    testPromises.push(promise)  // Track async test
  }
})
```

When user calls `hopp.test()` with an async callback:

```typescript
// In cage-modules/post-request.ts
function test(descriptor: string, callback: () => void | Promise<void>) {
  const result = callback()

  if (result && typeof result.then === 'function') {
    // Async test detected - track it!
    onTestPromise(result)
  }
}
```

This ensures the test runner knows about ALL async operations and can wait for them.

### FaradayCage Lifecycle

```typescript
const cage = await FaradayCage.create()

try {
  const result = await cage.runCode(testScript, modules)
  // ... wait for testPromises
  // ... capture results
  return finalResults
} finally {
  // NOTE: Do NOT dispose the cage here - it causes QuickJS lifetime errors
  // because returned objects (like Response from hopp.fetch()) may still be
  // accessed after script execution completes.
  // Rely on garbage collection to clean up the cage when no longer referenced.
  // TODO: Investigate proper disposal timing or cage pooling/reuse strategy
}
```

## Related Fixes

This fix complements two earlier fixes in the same feature branch:

1. **[ContentType Structure Fix](BROWSER_INTERCEPTOR_FIX_SUMMARY.md)**: Changed from `{body, contentType}` to `{kind, content, mediaType}`

2. **[Extension Interceptor Fix](EXTENSION_INTERCEPTOR_FIX_SUMMARY.md)**: Fixed Uint8Array→Blob conversion and added proper ContentType kind handling

Together, these three fixes ensure hopp.fetch() works correctly with:
- All content types (text, json, binary, form, etc.)
- All interceptors (browser, extension, proxy, native, agent)
- All async patterns (await, .then(), async callbacks, Promise.all)
- Proper UI state management (no intermediate/failed states)

## Summary

The async test timing fix ensures that test results are only captured and displayed **after** all async operations complete, preventing confusing intermediate states in the UI. This was achieved by reordering the execution flow to:

1. Check for script errors
2. **Wait for all test promises** (`await Promise.all(testPromises)`)
3. **Then capture results** (`captureHook.capture()`)
4. Return final results

Applied consistently to both web and node test runners, this fix provides a clean user experience where test results are accurate and stable from the moment they appear.
