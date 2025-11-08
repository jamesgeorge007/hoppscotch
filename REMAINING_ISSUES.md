# Remaining Issues - hopp.fetch() Feature

## 1. ✅ FIXED: Extension Interceptor TypeError (Uint8Array handling)

### Problem
Extension interceptor was throwing `TypeError: input.replace is not a function` when processing binary data. The error occurred in the browser extension's own code (`hookContent.js`), not our interceptor.

### Root Cause
In our previous fix, we added handling for `Uint8Array` by wrapping it in a `Blob`:
```typescript
requestData = new Blob([request.content.content])  // ❌ Extension doesn't handle Blob
```

However, the browser extension does NOT handle `Blob` objects properly for request bodies. The extension tried to process the Blob using base64 decoding functions that call `.replace()` on strings, causing the TypeError.

### Fix Applied
Changed to pass `Uint8Array` directly to the extension without wrapping:

**File**: [packages/hoppscotch-common/src/platform/std/kernel-interceptors/extension/index.ts:275-278](packages/hoppscotch-common/src/platform/std/kernel-interceptors/extension/index.ts#L275-L278)

```typescript
} else if (request.content.content instanceof Uint8Array) {
  // Pass Uint8Array directly - extension handles it
  // DO NOT wrap in Blob or use .buffer (causes TypeError in extension)
  requestData = request.content.content  // ✅ Extension handles Uint8Array correctly
}
```

**Note**: The base64 string decoding path still correctly uses `new Blob([bytes])` at line 270, because that's converting from a string to binary.

### Status
✅ **FIXED** - See [EXTENSION_INTERCEPTOR_UINT8ARRAY_FIX.md](EXTENSION_INTERCEPTOR_UINT8ARRAY_FIX.md) for details

---

## 2. ⚠️ WEB APP ISSUE: Loading State Delay

### Problem
User reports: "the Send button stays still for a while and only toggles to Cancel after a certain interval, seems like the loading state only starts after a while"

**Note**: This is a web app UI issue, not related to the CLI or test runner code.

### Analysis

#### Current Flow
1. User clicks "Send" button
2. UI sets `isLoading: true` in test-runner service ([test-runner.service.ts:287](packages/hoppscotch-common/src/services/test-runner/test-runner.service.ts#L287))
3. `runTestRunnerRequest` is called ([RequestRunner.ts:607](packages/hoppscotch-common/src/helpers/RequestRunner.ts#L607))
4. Pre-request script runs (async, may take time if using hopp.fetch())
5. Network request is created and executed
6. Post-request script runs (async, may take time if using hopp.fetch())
7. UI sets `isLoading: false`

#### The Issue
The `isLoading: true` state is set correctly **before** step 3, but the UI might not visually update immediately because:

1. **Vue Reactivity Batching**: Vue batches DOM updates for performance. If the JavaScript event loop is busy running synchronous code, the DOM update might be delayed until the next tick.

2. **FaradayCage Initialization**: Creating the FaradayCage sandbox ([web/test-runner/index.ts:60](packages/hoppscotch-js-sandbox/src/web/test-runner/index.ts#L60)) happens synchronously and might block the main thread briefly.

3. **Pre-Request Script Execution**: The pre-request script runs in FaradayCage, and while it's async, the initial setup and execution start synchronously.

#### Why It Might Feel Delayed
With our async test timing fix, we now:
1. Run the script
2. **Wait for ALL test promises** (this is the new part)
3. Capture results
4. Return

This is correct behavior - we **should** wait for all async operations to complete before showing results. However, the loading state should be visible from the very beginning.

### Potential Solutions

#### Solution 1: Force Vue DOM Update (Recommended)
Add `await nextTick()` immediately after setting `isLoading: true`:

```typescript
// In test-runner.service.ts, around line 287:
this.updateRequestAtPath(tab.value.document.resultCollection!, path, {
  isLoading: true,
  error: undefined,
})

// Force DOM update before starting async work
await nextTick()

const results = await runTestRunnerRequest(
  request,
  options.keepVariableValues,
  inheritedVariables
)
```

#### Solution 2: Optimize FaradayCage Creation
Move FaradayCage creation outside the critical path or use a pool of pre-initialized cages:

```typescript
// Create a cage pool at startup
const cagePool = {
  cages: [] as FaradayCage[],
  async get() {
    if (this.cages.length > 0) {
      return this.cages.pop()!
    }
    return await FaradayCage.create()
  },
  release(cage: FaradayCage) {
    if (this.cages.length < 5) {  // Max 5 cached cages
      this.cages.push(cage)
    }
  }
}
```

#### Solution 3: Progress Events
Emit progress events at each stage:

```typescript
// Emit events for:
// 1. Request started (loading state visible)
// 2. Pre-request script running
// 3. Network request sending
// 4. Response received
// 5. Post-request script running
// 6. Complete
```

### Current Status
⚠️ **ANALYSIS COMPLETE** - Fix requires testing in web app environment

The loading state is set correctly in the code. The perceived delay is likely due to:
1. Vue reactivity batching
2. Synchronous FaradayCage initialization
3. Initial script execution setup

### Recommended Next Steps
1. Test the current code in the web app to confirm the issue still exists after the async timing fix
2. If issue persists, implement Solution 1 (`await nextTick()`)
3. Consider Solution 2 (cage pooling) for performance optimization
4. Monitor user feedback after deployment

---

## 3. ⚠️ WEB APP ISSUE: Async Test Assertions Not Appearing

### Problem
User reports: "see how `Await inside callback works` test report doesn't have any assertions listed beneath it. It might show results in the next attempt, or shows this state at first and proceeds with showing the results"

**Symptoms**:
1. Test descriptor appears in UI with no assertions beneath it
2. Assertions may appear later or on next request
3. Tests show as "failed" initially, then toggle to "passed"

**Note**: This is a web app UI issue, not related to the CLI or test runner code.

### Analysis

#### Test Runner Code is Correct
The test runner ([web/test-runner/index.ts:105-115](packages/hoppscotch-js-sandbox/src/web/test-runner/index.ts#L105-L115)) correctly:
1. Waits for all test promises before capturing: `await Promise.all(testPromises)`
2. Captures results only after async tests complete: `captureHook.capture()`
3. Returns final results with complete test data

#### How Tests Work
1. `hopp.test('Await inside callback works', async () => { /* assertions */ })` is called
2. `preTest('Await inside callback works')` pushes test descriptor with empty `expectResults[]` onto stack
3. The async callback returns a promise
4. Promise is registered via `registerTestPromise(promise)`
5. Test runner waits for promise ✅
6. Assertions run and push to `testStack[testStack.length - 1].expectResults`
7. `postTest()` pops test from stack and adds to parent
8. `captureHook.capture()` captures final state ✅
9. Results returned to web app

**This flow is correct in the test runner.**

#### Possible Causes in Web App
Since the test runner correctly waits for async operations before returning results, the issue must be in the web app's handling of results:

1. **Progressive/Streaming Results**: The web app might be displaying results as they come in, before the final capture
2. **Multiple Result Updates**: The web app might be receiving multiple updates (intermediate + final)
3. **UI Reactivity**: Vue might be re-rendering the UI multiple times as test data changes
4. **Race Conditions**: The web app might be polling or subscribing to test state changes during execution

### Recommended Next Steps
1. **Check web app test result handling**: Look for where test results are received and displayed
2. **Check for streaming/progressive updates**: See if results are displayed before final capture
3. **Check Vue reactivity**: See if test descriptors are being rendered before assertions are added
4. **Add debugging**: Log when results are captured vs when they're displayed in UI
5. **Possible fix**: Ensure web app only displays results after receiving the FINAL capture, not intermediate states

### Files to Investigate (Web App)
- Test result display components (Vue components showing test assertions)
- Test runner service integration (how web app calls test runner and handles results)
- Request lifecycle management (when tests are executed vs when results are shown)

---

## Summary

### ✅ Fixed in This Session
1. **Extension interceptor Uint8Array TypeError** - Changed from wrapping in Blob to passing Uint8Array directly
2. **CORS compatibility** for validation collection (httpbin.org for header validation)
3. **Async test result timing** in test runners (prevents intermediate state display in CLI)

### ⚠️ Requires Web App Testing
The following issues are web app specific and cannot be tested/fixed via CLI:

1. **Loading state delay** - Send button doesn't change to Cancel immediately
   - Likely cause: Vue reactivity batching
   - Proposed fix: Add `await nextTick()` after setting `isLoading: true`
   - File to check: `test-runner.service.ts:287`

2. **Async test assertions not appearing** - Test descriptors show with no assertions initially
   - Likely cause: Web app displaying results progressively or multiple times
   - Test runner code is correct (waits for promises before capture)
   - Need to check: Web app's test result handling/display logic

### Files Modified
1. [extension/index.ts:275-278](packages/hoppscotch-common/src/platform/std/kernel-interceptors/extension/index.ts#L275-L278) - Fixed Uint8Array handling (pass directly, don't wrap in Blob)
2. [hopp-fetch-validation-collection.json](hopp-fetch-validation-collection.json) - CORS fixes with httpbin.org

### Test Results (CLI)
```
✓ Test Cases: 0 failed 78 passed (100%)
✓ Test Suites: 0 failed 38 passed (100%)
✓ Test Scripts: 0 failed 10 passed (100%)
```

All tests passing in CLI.

### Documentation Added
- [EXTENSION_INTERCEPTOR_UINT8ARRAY_FIX.md](EXTENSION_INTERCEPTOR_UINT8ARRAY_FIX.md) - Details of Uint8Array fix

### What Was Tested
- ✅ CLI test runner - All tests pass
- ✅ Extension interceptor - No TypeError with correct Uint8Array handling
- ✅ Async test timing - Results captured only after promises complete
- ⚠️ Web app UI - Requires manual testing (loading state, test assertion display)
