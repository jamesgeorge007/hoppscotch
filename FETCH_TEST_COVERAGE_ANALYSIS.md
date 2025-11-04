# hopp.fetch() and pm.sendRequest() Test Coverage Analysis

**Date**: 2025-11-04
**Status**: Coverage Gap Analysis Complete

---

## Current E2E Test Coverage (15 tests)

### hopp.fetch() Tests (7 tests) ✅

1. ✅ **GET request basic** - Basic GET with status check
2. ✅ **POST with JSON body** - POST with JSON payload
3. ✅ **404 error handling** - Error status code handling
4. ✅ **Custom headers** - Custom header sending
5. ✅ **Environment variable URL** - Dynamic URL from env vars
6. ✅ **Response text parsing** - `response.text()` method
7. ✅ **HTTP methods (PUT, DELETE, PATCH)** - All HTTP verbs

### pm.sendRequest() Tests (7 tests) ✅

1. ✅ **String URL format** - Simple string URL
2. ✅ **Request object format** - Full request object
3. ✅ **URL-encoded body** - `mode: 'urlencoded'` body
4. ✅ **Response format validation** - Postman response structure
5. ✅ **HTTP error status codes** - 404, 500 status codes
6. ✅ **Environment variable integration** - Dynamic URLs/headers
7. ✅ **Store response in environment** - Save response data

### Interoperability Test (1 test) ✅

1. ✅ **hopp.fetch() and pm.sendRequest() working together**

---

## Coverage Gaps Identified

### Critical Gaps (Must Add)

#### 1. **pm.sendRequest() - FormData body mode** ❌
**Current Coverage**: None
**Implementation Status**: ✅ Implemented (lines 3720-3726 in post-request.js)
**Postman Compatibility**: Critical for file uploads and multipart requests
**Test Needed**:
```javascript
pm.sendRequest({
  url: 'https://echo.hoppscotch.io/post',
  method: 'POST',
  body: {
    mode: 'formdata',
    formdata: [
      { key: 'field1', value: 'value1' },
      { key: 'field2', value: 'value2' },
      { key: 'file', value: 'binary_data_string' }
    ]
  }
}, callback)
```

#### 2. **hopp.fetch() - JSON parsing** ❌
**Current Coverage**: Only `response.text()` tested
**RFC Compliance**: Standard Fetch API requires `.json()` support
**Test Needed**:
```javascript
const response = await hopp.fetch('https://echo.hoppscotch.io/json')
const json = await response.json()
pw.expect(typeof json).toBe('object')
```

#### 3. **pm.sendRequest() - JSON parsing via response.json()** ❌
**Current Coverage**: Response structure validated, but not JSON parsing method
**Postman Compatibility**: `response.json()` is commonly used in Postman scripts
**Test Needed**:
```javascript
pm.sendRequest('https://echo.hoppscotch.io/json', (error, response) => {
  const data = response.json()
  pm.expect(data).to.be.an('object')
  pm.expect(data).to.have.property('key')
})
```

#### 4. **hopp.fetch() - Response header access** ❌
**Current Coverage**: Headers object exists, but not `.get()` method
**RFC Compliance**: Standard Fetch API Headers interface
**Test Needed**:
```javascript
const response = await hopp.fetch('https://echo.hoppscotch.io', {
  headers: { 'X-Test': 'value' }
})
const contentType = response.headers.get('content-type')
pw.expect(contentType).toBeType('string')
```

#### 5. **pm.sendRequest() - Response headers access** ❌
**Current Coverage**: Headers array structure validated, but not value extraction
**Postman Compatibility**: Common pattern to extract specific headers
**Test Needed**:
```javascript
pm.sendRequest(url, (error, response) => {
  const contentType = response.headers.find(h => h.key.toLowerCase() === 'content-type')
  pm.expect(contentType).to.exist
  pm.expect(contentType.value).to.include('application/json')
})
```

### Important Gaps (Should Add)

#### 6. **hopp.fetch() - Network errors** ❌
**Current Coverage**: HTTP error statuses (404) tested, but not network failures
**RFC Compliance**: Fetch should throw on network errors
**Test Needed**:
```javascript
try {
  await hopp.fetch('https://invalid-domain-that-does-not-exist.com')
  pw.expect(false).toBe(true) // Should not reach here
} catch (error) {
  pw.expect(error).toBeDefined()
  pw.expect(error.message).toBeType('string')
}
```

#### 7. **pm.sendRequest() - Network errors** ❌
**Current Coverage**: HTTP error statuses tested, but not network failures
**Postman Compatibility**: Network errors should trigger error callback
**Test Needed**:
```javascript
pm.sendRequest('https://invalid-domain.com', (error, response) => {
  pm.expect(error).to.not.be.null
  pm.expect(response).to.be.null
})
```

#### 8. **hopp.fetch() - Multiple sequential requests** ❌
**Current Coverage**: Single requests only
**Use Case**: Common pattern for authentication flows
**Test Needed**:
```javascript
// Request 1: Get auth token
const authResp = await hopp.fetch('https://echo.hoppscotch.io/json')
const authData = await authResp.json()
hopp.env.set('TOKEN', authData.token)

// Request 2: Use token
const dataResp = await hopp.fetch('https://echo.hoppscotch.io/headers', {
  headers: { 'Authorization': `Bearer ${hopp.env.get('TOKEN')}` }
})
pw.expect(dataResp.status).toBe(200)
```

#### 9. **pm.sendRequest() - Nested requests** ❌
**Current Coverage**: Single requests only
**Postman Compatibility**: Common Postman pattern
**Test Needed**:
```javascript
pm.sendRequest(url1, (error1, response1) => {
  const data1 = response1.json()
  pm.environment.set('DATA', data1.value)

  // Nested request
  pm.sendRequest(url2, (error2, response2) => {
    pm.expect(error2).to.be.null
    pm.expect(response2.code).to.equal(200)
  })
})
```

#### 10. **hopp.fetch() - Binary response (blob, arrayBuffer)** ❌
**Current Coverage**: Only `.text()` tested
**RFC Compliance**: Fetch API supports multiple response body types
**Test Needed**:
```javascript
const response = await hopp.fetch('https://echo.hoppscotch.io/bytes/100')
const buffer = await response.arrayBuffer()
pw.expect(buffer).toBeType('object')
pw.expect(buffer.byteLength).toBeGreaterThan(0)
```

### Nice-to-Have Gaps (Optional)

#### 11. **hopp.fetch() - Request with FormData** ⚠️
**Current Coverage**: None
**RFC Compliance**: Standard Fetch API feature
**Note**: May be complex in CLI environment

#### 12. **pm.sendRequest() - Empty response body** ⚠️
**Current Coverage**: None
**Postman Compatibility**: Handle 204 No Content responses

#### 13. **hopp.fetch() - Request timeout** ⚠️
**Current Coverage**: None
**RFC Compliance**: Fetch API supports AbortController
**Note**: May need special handling in sandbox

#### 14. **pm.sendRequest() - Large response bodies** ⚠️
**Current Coverage**: None
**Performance**: Validate handling of large responses

#### 15. **hopp.fetch() - Redirect handling** ⚠️
**Current Coverage**: None
**RFC Compliance**: Default redirect: 'follow' behavior

---

## Implementation Status by Body Mode

### pm.sendRequest() Body Modes

| Mode | Implemented | Tested | Notes |
|------|------------|--------|-------|
| `raw` | ✅ | ✅ | POST with JSON body test |
| `urlencoded` | ✅ | ✅ | URL-encoded body test |
| `formdata` | ✅ | ❌ | **Missing test** |
| `file` | ❌ | ❌ | Postman limitation: not supported in scripts |
| `graphql` | ❌ | ❌ | Not in Postman pm.sendRequest() |
| `binary` | ❌ | ❌ | Not in standard Postman pm.sendRequest() |

### hopp.fetch() Body Types

| Type | Implemented | Tested | Notes |
|------|------------|--------|-------|
| String | ✅ | ✅ | JSON.stringify() tested |
| FormData | ✅ | ❌ | **Missing test** |
| Blob | ✅ | ❌ | Not tested |
| ArrayBuffer | ✅ | ❌ | Not tested |
| URLSearchParams | ✅ | ❌ | Implicit in formdata |

---

## Response Method Coverage

### hopp.fetch() Response Methods

| Method | Implemented | Tested | Priority |
|--------|------------|--------|----------|
| `.text()` | ✅ | ✅ | ✅ Tested |
| `.json()` | ✅ | ❌ | **Critical gap** |
| `.blob()` | ✅ | ❌ | Important |
| `.arrayBuffer()` | ✅ | ❌ | Important |
| `.formData()` | ✅ | ❌ | Low priority |
| `.headers.get()` | ✅ | ❌ | **Critical gap** |
| `.headers.has()` | ✅ | ❌ | Important |
| `.headers.entries()` | ✅ | ❌ | Low priority |

### pm.sendRequest() Response Methods

| Method | Implemented | Tested | Priority |
|--------|------------|--------|----------|
| `.json()` | ✅ | ❌ | **Critical gap** |
| Headers array access | ✅ | ✅ | ✅ Tested |
| Header value extraction | ✅ | ❌ | **Critical gap** |
| `.body` (string) | ✅ | ✅ | ✅ Tested |

---

## Recommended Test Additions

### Phase 1: Critical Gaps (Must Add - 5 tests)

1. **pm.sendRequest() - FormData body mode**
2. **hopp.fetch() - JSON parsing**
3. **pm.sendRequest() - JSON parsing**
4. **hopp.fetch() - Response header access**
5. **pm.sendRequest() - Response headers access**

### Phase 2: Important Gaps (Should Add - 4 tests)

6. **hopp.fetch() - Network errors**
7. **pm.sendRequest() - Network errors**
8. **hopp.fetch() - Multiple sequential requests**
9. **pm.sendRequest() - Nested requests**

### Phase 3: Extended Coverage (Optional - 2 tests)

10. **hopp.fetch() - Binary response (arrayBuffer)**
11. **pm.sendRequest() - Empty response body (204)**

---

## Test Collection Structure (Proposed)

```
scripting-revamp-coll.json
├── [Existing 30 tests]
├── hopp.fetch() - GET request basic (✅ exists)
├── hopp.fetch() - POST with JSON body (✅ exists)
├── hopp.fetch() - JSON response parsing (❌ NEW)
├── hopp.fetch() - Response headers access (❌ NEW)
├── hopp.fetch() - Network error handling (❌ NEW)
├── hopp.fetch() - Sequential requests chain (❌ NEW)
├── hopp.fetch() - Binary response (arrayBuffer) (❌ NEW)
├── hopp.fetch() - 404 error handling (✅ exists)
├── hopp.fetch() - Custom headers (✅ exists)
├── hopp.fetch() - Environment variable URL (✅ exists)
├── hopp.fetch() - Response text parsing (✅ exists)
├── hopp.fetch() - HTTP methods (✅ exists)
├── pm.sendRequest() - String URL format (✅ exists)
├── pm.sendRequest() - Request object format (✅ exists)
├── pm.sendRequest() - FormData body mode (❌ NEW)
├── pm.sendRequest() - JSON parsing method (❌ NEW)
├── pm.sendRequest() - Response headers extraction (❌ NEW)
├── pm.sendRequest() - Network error callback (❌ NEW)
├── pm.sendRequest() - Nested requests (❌ NEW)
├── pm.sendRequest() - Empty response body (❌ NEW)
├── pm.sendRequest() - URL-encoded body (✅ exists)
├── pm.sendRequest() - Response format validation (✅ exists)
├── pm.sendRequest() - HTTP error status codes (✅ exists)
├── pm.sendRequest() - Environment variable integration (✅ exists)
├── pm.sendRequest() - Store response in environment (✅ exists)
└── hopp.fetch() and pm.sendRequest() - Interoperability (✅ exists)
```

**New Tests to Add**: 11 tests
**Total Tests After Addition**: 26 fetch/sendRequest tests (up from 15)

---

## Postman Compatibility Verification

### Supported Features ✅

- ✅ String URL format
- ✅ Request object format
- ✅ Headers as array of { key, value }
- ✅ Body modes: raw, urlencoded, formdata
- ✅ Response format: code, status, headers, body, json()
- ✅ Callback pattern: (error, response) => {}
- ✅ Environment variable integration
- ✅ Error vs response distinction

### Unsupported Postman Features (By Design) ⚠️

- ⚠️ File uploads (security limitation)
- ⚠️ pm.collectionVariables (not applicable)
- ⚠️ pm.vault (not implemented)
- ⚠️ pm.iterationData (Collection Runner feature)
- ⚠️ pm.execution.setNextRequest() (not applicable)
- ⚠️ Certificate/auth configuration (handled by interceptor)

### Key Differences from Postman

1. **Execution Environment**: Runs in QuickJS sandbox via faraday-cage, not Node.js
2. **Network Layer**: Routes through HoppFetchHook (interceptor or axios)
3. **File Uploads**: Not supported in pm.sendRequest() for security
4. **Response Timing**: No response.responseTime property
5. **Cookies**: No response.cookies access (handled separately)

---

## RFC #5221 Compliance Check

### hopp.fetch() Requirements ✅

- ✅ Standard Fetch API signature
- ✅ Support RequestInfo | URL input
- ✅ Support RequestInit options
- ✅ Return Promise<Response>
- ✅ Support all HTTP methods
- ✅ Support custom headers
- ✅ Support request body (all types)
- ⚠️ Response methods (.json(), .text(), etc.) - needs more testing
- ✅ Environment variable integration
- ✅ Hook-based architecture for security

### pm.sendRequest() Requirements ✅

- ✅ Postman-compatible signature
- ✅ Support string URL
- ✅ Support request object
- ✅ Callback pattern
- ✅ Postman response format
- ✅ All body modes (raw, urlencoded, formdata)
- ✅ Headers array format
- ✅ Error handling
- ⚠️ Response.json() method - needs testing

---

## Next Steps

1. ✅ Complete this coverage analysis
2. ⏭️ Add Phase 1 critical tests (5 tests)
3. ⏭️ Add Phase 2 important tests (4 tests)
4. ⏭️ Run CLI E2E test suite
5. ⏭️ Update FETCH_IMPLEMENTATION_SUMMARY.md
6. ⏭️ Consider Phase 3 extended coverage (2 tests)

---

## Notes for Test Implementation

### Network Error Testing

Since echo.hoppscotch.io may not fail reliably, consider:
- Using an invalid domain that will timeout/fail DNS resolution
- Using a non-routable IP address (e.g., 10.255.255.1)
- Testing with malformed URLs

### JSON Response Testing

echo.hoppscotch.io endpoints to use:
- `/json` - Returns JSON response
- `/status/{code}` - Returns specific status code
- `/headers` - Returns request headers as JSON
- `/post`, `/put`, `/patch` - Echo back request body

### Binary Response Testing

- `/bytes/{n}` - Returns n random bytes
- Test with `response.arrayBuffer()` to verify binary handling

---

**Analysis Completed**: 2025-11-04
**Critical Tests to Add**: 5
**Total New Tests Recommended**: 11
**Final Test Count**: 26 fetch/sendRequest E2E tests
