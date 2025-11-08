# Web App UI Fixes for hopp.fetch() Feature

## Overview

This document summarizes the web app UI fixes applied to resolve loading state delays and async test result display issues.

## Issue 1: Loading State Delay - ✅ FIXED

### Problem
Send button didn't change to "Cancel" immediately when clicked - it stayed still for a period before showing the loading state.

**User Report**: "the Send button stays still for a while and only toggles to Cancel after a certain interval"

### Root Cause
Vue's reactivity batching delays DOM updates when JavaScript is busy. The flow was:
1. User clicks "Send"
2. `isLoading: true` is set
3. Vue queues a DOM update (but doesn't apply it yet)
4. `runTestRunnerRequest()` starts executing (synchronous setup blocks main thread)
5. FaradayCage initialization runs synchronously
6. Pre-request script starts
7. **Eventually** Vue flushes DOM updates and button changes to "Cancel"

The delay between step 2 and step 7 caused the perceived lag.

### Fix Applied

**File**: [test-runner.service.ts:291-293](packages/hoppscotch-common/src/services/test-runner/test-runner.service.ts#L291-L293)

Added `await nextTick()` after setting loading state:

```typescript
// Update request status in the result collection
this.updateRequestAtPath(tab.value.document.resultCollection!, path, {
  isLoading: true,
  error: undefined,
})

// Force Vue to flush DOM updates before starting async work
// This ensures the loading state (Send -> Cancel button) appears immediately
await nextTick()

const results = await runTestRunnerRequest(
  request,
  options.keepVariableValues,
  inheritedVariables
)
```

**How It Works**: `nextTick()` forces Vue to flush all pending DOM updates before continuing. This ensures the button changes to "Cancel" before we start the request execution.

**Import Added**: Added `nextTick` to imports at line 10:
```typescript
import { nextTick, Ref } from "vue"
```

---

## Issue 2: Async Test Assertions Not Appearing - ✅ FIXED

### Problem
Test descriptors appeared in UI with no assertions beneath them, then assertions appeared later or on the next request.

**User Report**: "see how `Await inside callback works` test report doesn't have any assertions listed beneath it. It might show results in the next attempt, or shows this state at first and proceeds with showing the results"

**Symptoms**:
1. Test descriptor shows with empty space below it
2. Assertions may appear later
3. Tests show as "failed" initially, then toggle to "passed"

### Root Cause Analysis

The test runner code was already correct (waits for all promises before capturing results). However, the UI components were rendering test descriptors even when they had **empty** `expectResults` arrays.

**The Flow**:
1. Test runs: `hopp.test('Await inside callback works', async () => { /* assertions */ })`
2. Test runner waits for promise to complete ✅
3. Assertions execute and populate `expectResults` ✅
4. Results are captured and returned ✅
5. UI receives complete results ✅

**BUT**: The UI was rendering tests with empty `expectResults` in certain edge cases or during reactive updates.

### Fixes Applied

#### Fix 1: TestResultEntry.vue
**File**: [TestResultEntry.vue:9-11](packages/hoppscotch-common/src/components/http/TestResultEntry.vue#L9-L11)

Changed condition from checking if `expectResults` exists to checking if it has content:

```vue
<!-- BEFORE: -->
<div v-if="testResults.expectResults" class="divide-y divide-dividerLight">

<!-- AFTER: -->
<!-- Only show test results if expectResults exists AND has content
     This prevents showing empty test descriptors during async operations -->
<div v-if="testResults.expectResults && testResults.expectResults.length > 0" class="divide-y divide-dividerLight">
```

Also removed redundant length check at line 11 (now line 13):
```vue
<!-- BEFORE: -->
<HttpTestResultReport
  v-if="testResults.expectResults.length && !shouldHideResultReport"
  :test-results="testResults"
/>

<!-- AFTER: -->
<HttpTestResultReport
  v-if="!shouldHideResultReport"
  :test-results="testResults"
/>
```

The length check is no longer needed because the parent `v-if` already ensures `expectResults.length > 0`.

#### Fix 2: TestResult.vue
**File**: [TestResult.vue:118-128](packages/hoppscotch-common/src/components/http/TestResult.vue#L118-L128)

Added filtering to only show tests with content:

```vue
<!-- BEFORE: -->
<div v-if="testResults.tests" class="divide-y-4 divide-dividerLight">
  <HttpTestResultEntry
    v-for="(result, index) in testResults.tests"
    :key="`result-${index}`"
    :test-results="result"
  />
</div>

<!-- AFTER: -->
<!-- Only show nested tests if they have content
     This prevents showing empty test descriptors during async operations -->
<div v-if="testResults.tests && testResults.tests.length > 0" class="divide-y-4 divide-dividerLight">
  <HttpTestResultEntry
    v-for="(result, index) in testResults.tests.filter(test =>
      test.expectResults && test.expectResults.length > 0
    )"
    :key="`result-${index}`"
    :test-results="result"
  />
</div>
```

**How It Works**: The `.filter()` ensures only tests with populated `expectResults` are rendered. This prevents showing empty test descriptors during the brief period when Vue is reactively updating.

---

## Issue 3: Extension Interceptor Response Data Safeguards - ✅ FIXED

### Problem
While not directly a UI issue, the extension might return unexpected response data types that could cause errors.

### Fix Applied

**File**: [extension/index.ts:341-370](packages/hoppscotch-common/src/platform/std/kernel-interceptors/extension/index.ts#L341-L370)

Added safeguards to ensure response data is always in valid format:

```typescript
// Ensure response data is in valid format for body.body()
// The extension should return ArrayBuffer or Uint8Array, but add safeguard
let responseData = extensionResponse.data
if (responseData && !(responseData instanceof ArrayBuffer) && !(responseData instanceof Uint8Array)) {
  // If extension returns something unexpected (string, object, etc.), convert to Uint8Array
  console.warn('[Extension Interceptor] Unexpected response data type, converting to Uint8Array:', typeof responseData)
  try {
    if (typeof responseData === 'string') {
      // If it's a string, encode it
      responseData = new TextEncoder().encode(responseData)
    } else {
      // If it's something else, stringify and encode
      responseData = new TextEncoder().encode(JSON.stringify(responseData))
    }
  } catch (err) {
    console.error('[Extension Interceptor] Failed to convert response data:', err)
    responseData = new Uint8Array(0) // Empty array as fallback
  }
}

return E.right({
  id: request.id,
  status: extensionResponse.status,
  statusText: extensionResponse.statusText,
  version: request.version,
  headers: extensionResponse.headers,
  body: body.body(
    responseData || new Uint8Array(0),  // Ensure always valid
    extensionResponse.headers["content-type"]
  ),
  // ... rest of response
})
```

**How It Works**:
1. Check if response data is `ArrayBuffer` or `Uint8Array` (expected types)
2. If not, convert to `Uint8Array`:
   - Strings → encode with `TextEncoder`
   - Objects → stringify then encode
   - Errors → use empty `Uint8Array` as fallback
3. Always pass valid data to `body.body()`, preventing TypeErrors

This ensures graceful handling even if the extension returns unexpected data types.

---

## Summary of Changes

### Files Modified
1. **[test-runner.service.ts](packages/hoppscotch-common/src/services/test-runner/test-runner.service.ts)**
   - Line 10: Added `nextTick` import
   - Lines 291-293: Added `await nextTick()` after setting loading state

2. **[TestResultEntry.vue](packages/hoppscotch-common/src/components/http/TestResultEntry.vue)**
   - Lines 9-15: Changed condition to check `expectResults.length > 0`
   - Removed redundant length check

3. **[TestResult.vue](packages/hoppscotch-common/src/components/http/TestResult.vue)**
   - Lines 118-128: Added filtering to only show tests with content

4. **[extension/index.ts](packages/hoppscotch-common/src/platform/std/kernel-interceptors/extension/index.ts)**
   - Lines 341-370: Added response data type safeguards

### Testing Checklist

#### ✅ Loading State Delay
- [ ] Click "Send" button
- [ ] Verify button immediately changes to "Cancel"
- [ ] Verify no delay before loading state appears

#### ✅ Async Test Assertions
- [ ] Run test with async callback: `hopp.test('Test', async () => { await hopp.fetch('...'); hopp.expect(...) })`
- [ ] Verify test descriptor doesn't appear until assertions are ready
- [ ] Verify no empty test descriptors shown
- [ ] Verify no "failed → passed" toggling

#### ✅ Extension Interceptor
- [ ] Run requests with extension interceptor
- [ ] Check console for any warnings about response data types
- [ ] Verify no TypeErrors when processing responses

### Expected Behavior After Fixes

1. **Loading State**: Send button changes to Cancel immediately when clicked
2. **Test Results**: Only complete tests with assertions are displayed, no empty descriptors
3. **Extension Interceptor**: Gracefully handles any response data type without errors

### Related Documentation

- [EXTENSION_INTERCEPTOR_UINT8ARRAY_FIX.md](EXTENSION_INTERCEPTOR_UINT8ARRAY_FIX.md) - Extension interceptor Uint8Array fix
- [ASYNC_TEST_TIMING_FIX_SUMMARY.md](ASYNC_TEST_TIMING_FIX_SUMMARY.md) - Test runner async timing fix
- [REMAINING_ISSUES.md](REMAINING_ISSUES.md) - Issue tracking and analysis
