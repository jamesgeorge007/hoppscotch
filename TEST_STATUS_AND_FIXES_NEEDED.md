# Test Status and Fixes Needed

## Current Status

### JS-Sandbox Tests
- **91 tests failing** out of 1165 total
- **1074 tests passing**
- Main failure categories:
  1. pm.request mutations (24 failures)
  2. hopp.request tests (19 failures)
  3. async/await support (12 failures)
  4. Fetch API classes (9 failures)
  5. URL properties/helpers (11 failures)
  6. Other misc (16 failures)

### CLI Tests
- **70 test cases failing** out of 753 total
- **683 test cases passing**
- **All 57 requests passing** (0 failed)
- **All 57 scripts passing** (0 failed)
- Main failure categories:
  1. Request mutation tests (tests expect mutations to be applied to actual HTTP request)
  2. URL PropertyList tests (missing methods: update(), addQueryParams(), etc.)
  3. Status code tests (fixed with httpbin.org endpoints)

## Fixes Applied

### 1. Status Code Tests - FIXED ✅
**Files Changed:**
- `scripting-revamp-coll.json` - Updated endpoints to use httpbin.org
- Added fault tolerance for 5xx errors from httpbin

**Tests Fixed:**
- hopp.fetch() - 404 error handling
- pm.sendRequest() - HTTP error status codes (500, 404)
- pm.sendRequest() - Empty response body (204)

### 2. Response.json() and Response.text() - FIXED ✅
**Files Changed:**
- `custom-fetch.ts` - Added setTimeout(0) for async promise resolution in QuickJS

**Issue:** QuickJS requires setTimeout wrapping for proper async promise handling
**Tests Fixed:** Response class methods work in CLI e2e tests

### 3. CLI Pre-Request Mutations - PARTIAL FIX ⚠️
**Files Changed:**
- `pre-request.ts` lines 85-89 - Use complete updatedRequest instead of shallow merge

**Issue:** The fix is correct but request mutations may not be working in js-sandbox itself
**Status:** Needs verification that js-sandbox mutation methods work

## Remaining Issues

### Priority 1: Request Mutation Implementation

**Problem:** `hopp.request.setUrl()`, `setMethod()`, `setHeader()` etc. are not properly mutating the request

**Evidence:**
- CLI tests show mutations not applied (URL still original, method still GET)
- JS-sandbox tests have QuickJS runtime errors for these methods

**Files to Fix:**
- `packages/hoppscotch-js-sandbox/src/cage-modules/pre-request.ts`
- Bootstrap code that defines hopp.request and pm.request objects

**What Needs to Happen:**
1. Ensure hopp.request.setUrl() actually modifies the underlying request object
2. Ensure pm.request.url = "..." assignment works
3. Ensure mutations are captured and returned in `updatedRequest`

### Priority 2: URL PropertyList Methods

**Missing Methods:**
- `pm.request.url.update(url)`
- `pm.request.url.addQueryParams(params)`
- `pm.request.url.removeQueryParams(params)`
- `pm.request.url.getPath()`
- `pm.request.url.getPathWithQuery()`
- `pm.request.url.getQueryString()`
- URL property setters (protocol, host, path, hash)

**Files to Fix:**
- `packages/hoppscotch-js-sandbox/src/cage-modules/pre-request.ts`
- URL proxy object implementation

### Priority 3: PropertyList Advanced Methods

**Missing Methods:**
- `query.find(keyOrPredicate)`
- `query.insert(item, before)`
- `query.append(item)`
- `query.assimilate(objectOrArray)`
- Same methods for headers PropertyList

**Files to Fix:**
- PropertyList implementation in pre-request module

### Priority 4: Fetch API Unit Test Fixes

**Issue:** Tests use top-level await with pw.expect() but expectations aren't captured properly

**Failing Tests:**
- Headers iteration methods (entries, keys, values)
- Response.json() and Response.text() in unit tests
- AbortController in certain test structures

**Solution:** Tests need restructuring to properly capture async expectations

**Note:** The actual functionality WORKS (proven by CLI e2e tests passing). Only unit test structure needs fixing.

### Priority 5: Async/Await Test Support

**Issue:** Some tests with async/await have timing issues

**Files:**
- `combined/async-await-support.spec.ts` - 12 failures

## Test Execution Commands

### JS-Sandbox Tests
```bash
cd /Users/jamesgeorge/CodeSpaces/hoppscotch/packages/hoppscotch-js-sandbox
pnpm test --run
```

### CLI Tests
```bash
cd /Users/jamesgeorge/CodeSpaces/hoppscotch/packages/hoppscotch-cli
node bin/hopp.js test src/__tests__/e2e/fixtures/collections/scripting-revamp-coll.json
```

### Specific Test Files
```bash
# Test specific file
pnpm test src/__tests__/fetch-api-classes/headers.spec.ts --run

# Test with pattern
pnpm test --run --reporter=verbose -t "Headers class"
```

## Next Steps

1. **Fix request mutation methods in js-sandbox** - This will fix ~50 tests
2. **Implement missing URL PropertyList methods** - This will fix ~20 tests
3. **Fix Fetch API unit test structure** - This will fix ~9 tests
4. **Implement advanced PropertyList methods** - This will fix ~10 tests
5. **Fix remaining async/await issues** - This will fix ~12 tests

## Important Notes

- **DO NOT change test expectations to make them pass** - Only fix actual implementation issues or valid test structure problems
- The Fetch API implementation WORKS correctly (CLI e2e proves this)
- Focus on implementation bugs, not test workarounds
- Request mutations are the highest priority as they block the most tests
