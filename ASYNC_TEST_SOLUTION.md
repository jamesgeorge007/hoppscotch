# Async Test Function Solution

**Date**: 2025-11-05
**Issue**: hopp.test() and pm.test() don't wait for async functions
**Root Cause**: Test function implementations call `testFn()` without awaiting

---

## Problem Analysis

### Current Implementation

In [post-request.js:2156-2160](packages/hoppscotch-js-sandbox/src/bootstrap-code/post-request.js#L2156-L2160):

```javascript
test: (descriptor, testFn) => {
  inputs.preTest(descriptor)
  testFn()  // ❌ NOT awaited!
  inputs.postTest()
},
```

### What Happens

1. User writes async test:
   ```javascript
   hopp.test('test', async () => {
     const response = await hopp.fetch('...')
     hopp.expect(response.status).toBe(200)
   })
   ```

2. Bootstrap calls `testFn()` which returns a Promise immediately
3. `inputs.postTest()` runs before promise resolves
4. `cage.runCode()` completes before assertions execute
5. Test results are empty: `expectResults: []`

---

## Solution Approach

### Option 1: Make test() Return Promise (RECOMMENDED)

Modify bootstrap code to return the promise:

```javascript
test: (descriptor, testFn) => {
  inputs.preTest(descriptor)
  const result = testFn()

  // If testFn returns a Promise, return it and call postTest after
  if (result && typeof result.then === 'function') {
    return result.then(() => inputs.postTest())
  }

  // Synchronous test
  inputs.postTest()
},
```

Then wrap the entire user script to await all tests:

```javascript
// User script:
hopp.test('test 1', async () => { await hopp.fetch('...') })
hopp.test('test 2', async () => { await hopp.fetch('...') })

// Wrapped by runner:
(async () => {
  hopp.test('test 1', async () => { await hopp.fetch('...') })
  hopp.test('test 2', async () => { await hopp.fetch('...') })
})()
```

**Problem**: This requires modifying how scripts are executed. FaradayCage.runCode() needs to handle the top-level async wrapper.

### Option 2: Collect Promises and Await Them

Track all test promises and await them after script completes:

```javascript
const testPromises = []

test: (descriptor, testFn) => {
  inputs.preTest(descriptor)
  const result = testFn()

  if (result && typeof result.then === 'function') {
    testPromises.push(result.then(() => inputs.postTest()))
  } else {
    inputs.postTest()
  }
},
```

Then after `cage.runCode()` completes, await all promises:

```javascript
const result = await cage.runCode(testScript, [...modules])

// Wait for all async tests to complete
if (globalThis.__testPromises__) {
  await Promise.all(globalThis.__testPromises__)
}
```

**Problem**: Need to expose `testPromises` array to the host. Could use a global or a special module export.

### Option 3: Queue-Based Execution

Implement a test queue that processes tests sequentially:

```javascript
const testQueue = []

test: (descriptor, testFn) => {
  testQueue.push({ descriptor, testFn })
},

// After script loads, execute queue:
async function runTests() {
  for (const { descriptor, testFn } of testQueue) {
    inputs.preTest(descriptor)
    await testFn()  // Always await (Promise or sync)
    inputs.postTest()
  }
}
```

**Problem**: Changes test execution model - tests run after script completes instead of during.

---

## Recommended Implementation

**Hybrid Approach**: Use Option 1 with proper script wrapping

### Step 1: Update Bootstrap Code

Edit `post-request.js` lines 2156-2160 and 2383-2387:

```javascript
test: (descriptor, testFn) => {
  inputs.preTest(descriptor)
  const result = testFn()

  // Handle async test functions
  if (result && typeof result.then === 'function') {
    // Store promise globally so runner can await it
    if (!globalThis.__hoppTestPromises__) {
      globalThis.__hoppTestPromises__ = []
    }
    const promise = result.then(
      () => inputs.postTest(),
      (error) => {
        inputs.postTest()
        throw error
      }
    )
    globalThis.__hoppTestPromises__.push(promise)
    return promise
  }

  // Synchronous test
  inputs.postTest()
},
```

### Step 2: Update Test Runner

Modify `experimental.ts` and `index.ts` (web) to await test promises:

```typescript
const result = await cage.runCode(testScript, [...modules])

if (result.type === "error") {
  throw result.err
}

// Wait for any async test functions to complete
const testPromises = cage.context.global.__hoppTestPromises__
if (testPromises && Array.isArray(testPromises) && testPromises.length > 0) {
  try {
    await Promise.all(testPromises)
  } catch (error) {
    // Test assertions may have failed
    console.error('Async test error:', error)
  }
}

return {
  tests: finalTestResults,
  envs: finalEnvs,
}
```

---

## Implementation Steps

1. ✅ **Immediate**: Update post-request.js bootstrap code (2 locations)
2. ✅ **Immediate**: Update test-runner experimental.ts (Node)
3. ✅ **Immediate**: Update test-runner index.ts (Web)
4. ⚠️ **Testing**: Run CLI collection to verify fix
5. ⚠️ **Testing**: Run unit tests to verify assertions captured

---

## Expected Outcome

### Before Fix:
```
❯ src/__tests__/hopp-namespace/fetch.spec.ts (14 tests | 7 failed)
  Array [
    Object {
      "children": Array [],
      "descriptor": "root",
      "expectResults": Array [],  // ❌ EMPTY!
    },
  ]
```

### After Fix:
```
✓ src/__tests__/hopp-namespace/fetch.spec.ts (14 tests)
  Array [
    Object {
      "expectResults": Array [
        Object {
          "message": "Expected '200' to be '200'",
          "status": "pass",
        },
      ],
    },
  ]
```

---

## Edge Cases to Handle

1. **Multiple async tests**: All should complete before results returned
2. **Mixed sync/async tests**: Both should work
3. **Test errors**: Errors in async tests should be caught
4. **Nested async**: `hopp.fetch()` inside async test inside user script
5. **QuickJS lifetime**: Ensure cage stays alive until all promises resolve

---

## Alternative if This Fails

If waiting for promises after runCode() doesn't work due to QuickJS limitations:

**Use Top-Level Await Pattern**:
```javascript
// Instead of:
hopp.test('test', async () => {
  const response = await hopp.fetch('...')
  hopp.expect(response.status).toBe(200)
})

// Require users to use:
const response = await hopp.fetch('...')
hopp.test('test', () => {
  hopp.expect(response.status).toBe(200)
})
```

Document this as a limitation and update all examples/tests accordingly.

---

**Next**: Implement Step 1 (bootstrap code fix)
