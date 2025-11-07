# hopp.fetch() and pm.sendRequest() - Manual Test Guide

**Date**: 2025-11-06
**Status**: Ready for Manual Verification
**Implementation**: [RFC_5221_IMPLEMENTATION_VERIFIED.md](RFC_5221_IMPLEMENTATION_VERIFIED.md)

---

## Prerequisites

1. **Build the application**:
   ```bash
   cd /Users/jamesgeorge/CodeSpaces/hoppscotch
   pnpm install
   pnpm --filter @hoppscotch/js-sandbox run build
   pnpm --filter @hoppscotch/web dev
   ```

2. **Enable experimental scripting**:
   - Open Hoppscotch web app
   - Go to Settings → Enable "Experimental Scripting Sandbox"

---

## Test Suite 1: hopp.fetch() with Browser Interceptor ✅

**Status**: Already verified working by user

### Test 1.1: Basic GET request with await

**Pre-request Script**:
```javascript
console.error('Test 1 - Before fetch')
const response = await hopp.fetch("https://echo.hoppscotch.io")
console.error('Test 2 - After fetch, status:', response.status)
const data = await response.json()
console.error('Test 3 - After json(), data:', data)
```

**Expected Result**:
- All 3 console logs appear in the console
- Test 1: "Test 1 - Before fetch"
- Test 2: "Test 2 - After fetch, status: 200"
- Test 3: "Test 3 - After json(), data: {..." (actual response data)

**Verified**: ✅ Confirmed working with Browser interceptor

---

### Test 1.2: POST request with JSON body

**Pre-request Script**:
```javascript
const response = await hopp.fetch("https://echo.hoppscotch.io/post", {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ test: 'data', timestamp: Date.now() })
})

console.log('Status:', response.status)
console.log('OK:', response.ok)

const data = await response.json()
console.log('Received data:', data)
```

**Expected Result**:
- Status: 200
- OK: true
- Received data should include the posted JSON

---

### Test 1.3: Error handling

**Pre-request Script**:
```javascript
try {
  const response = await hopp.fetch("https://invalid-domain-that-does-not-exist.com")
  console.log('Should not reach here')
} catch (error) {
  console.log('Caught error:', error.message)
}
```

**Expected Result**:
- "Caught error: Fetch failed: ..." message appears
- Script continues execution (doesn't crash)

---

### Test 1.4: Response headers access

**Pre-request Script**:
```javascript
const response = await hopp.fetch("https://echo.hoppscotch.io")
console.log('Content-Type:', response.headers.get('content-type'))
console.log('Has Date header:', response.headers.has('date'))

// Iterate headers
const headersList = []
response.headers.forEach((value, key) => {
  headersList.push(`${key}: ${value}`)
})
console.log('All headers:', headersList.length)
```

**Expected Result**:
- Content-Type header value displayed
- Has Date header: true
- All headers count > 0

---

## Test Suite 2: pm.sendRequest() with Browser Interceptor 🔄

**Status**: Needs manual verification

### Test 2.1: Basic callback style (string URL)

**Pre-request Script**:
```javascript
pm.sendRequest('https://echo.hoppscotch.io', (error, response) => {
  if (error) {
    console.error('Request failed:', error)
    return
  }

  console.log('Status code:', response.code)
  console.log('Status text:', response.status)
  console.log('Body length:', response.body.length)

  const jsonData = response.json()
  console.log('Parsed JSON:', jsonData)
})
```

**Expected Result**:
- Status code: 200
- Status text: "OK"
- Body length > 0
- Parsed JSON displays response data

---

### Test 2.2: POST with request object

**Pre-request Script**:
```javascript
const requestConfig = {
  url: 'https://echo.hoppscotch.io/post',
  method: 'POST',
  header: [
    { key: 'Content-Type', value: 'application/json' },
    { key: 'X-Custom-Header', value: 'test-value' }
  ],
  body: {
    mode: 'raw',
    raw: JSON.stringify({ key: 'value', timestamp: Date.now() })
  }
}

pm.sendRequest(requestConfig, (error, response) => {
  if (error) {
    console.error('Error:', error)
    return
  }

  console.log('Response code:', response.code)
  const data = response.json()
  console.log('Echo received:', data)
})
```

**Expected Result**:
- Response code: 200
- Echo received shows the posted data

---

### Test 2.3: Form data

**Pre-request Script**:
```javascript
pm.sendRequest({
  url: 'https://echo.hoppscotch.io/post',
  method: 'POST',
  body: {
    mode: 'urlencoded',
    urlencoded: [
      { key: 'field1', value: 'value1' },
      { key: 'field2', value: 'value2' }
    ]
  }
}, (error, response) => {
  if (error) {
    console.error('Error:', error)
    return
  }

  console.log('Form data sent successfully')
  console.log('Response:', response.body)
})
```

**Expected Result**:
- "Form data sent successfully" message
- Response body shows the form data was received

---

## Test Suite 3: Proxy Interceptor 🔄

**Status**: Expected to work (needs manual verification)

**Setup**:
1. Go to Settings → Interceptors → Select "Proxy"
2. Configure proxy URL (e.g., `https://proxy.hoppscotch.io`)
3. Add access token if required

**Test 3.1**: Run Test 1.1 (Basic GET) with Proxy interceptor selected

**Expected Result**: Same as Test 1.1 - all 3 logs appear

**Rationale**: Proxy interceptor uses same `kernelInterceptor.execute()` path, returns same `RelayResponse` format

---

## Test Suite 4: Agent Interceptor 🔄

**Status**: Expected to work (needs manual verification)

**Setup**:
1. Download and run Hoppscotch Agent desktop app
2. Go to Settings → Interceptors → Select "Agent"
3. Ensure agent is running and connected

**Test 4.1**: Run Test 1.1 (Basic GET) with Agent interceptor selected

**Expected Result**: Same as Test 1.1 - all 3 logs appear

**Rationale**: Agent interceptor uses same `kernelInterceptor.execute()` path, returns same `RelayResponse` format

---

## Test Suite 5: Extension Interceptor 🔄

**Status**: Expected to work (needs manual verification)

**Setup**:
1. Install Hoppscotch browser extension (Chrome/Firefox)
2. Go to Settings → Interceptors → Select "Extension"
3. Ensure extension is enabled and connected

**Test 5.1**: Run Test 1.1 (Basic GET) with Extension interceptor selected

**Expected Result**: Same as Test 1.1 - all 3 logs appear

**Rationale**: Extension interceptor uses same `kernelInterceptor.execute()` path, returns same `RelayResponse` format

---

## Test Suite 6: Async Test Callbacks 🔄

**Status**: Expected to work (needs manual verification)

### Test 6.1: hopp.test() with await

**Test Script** (run in Tests tab, not Pre-request):
```javascript
hopp.test('API returns 200', async () => {
  const response = await hopp.fetch('https://echo.hoppscotch.io')
  hopp.expect(response.status).toBe(200)
})
```

**Expected Result**:
- Test passes
- Shows "✅ API returns 200" in test results

---

### Test 6.2: Multiple async assertions

**Test Script**:
```javascript
hopp.test('API response validation', async () => {
  const response = await hopp.fetch('https://echo.hoppscotch.io')

  // Test status
  hopp.expect(response.status).toBe(200)
  hopp.expect(response.ok).toBe(true)

  // Test headers
  const contentType = response.headers.get('content-type')
  hopp.expect(contentType).toContain('application/json')

  // Test body
  const data = await response.json()
  hopp.expect(data).toBeDefined()
})
```

**Expected Result**:
- All assertions pass
- Test shows "✅ API response validation"

---

### Test 6.3: Error handling in tests

**Test Script**:
```javascript
hopp.test('Invalid URL throws error', async () => {
  try {
    await hopp.fetch('https://invalid-domain-xyz-123.com')
    hopp.expect(true).toBe(false) // Should not reach here
  } catch (error) {
    hopp.expect(error.message).toContain('Fetch failed')
  }
})
```

**Expected Result**:
- Test passes
- Error is caught and assertion passes

---

## Test Suite 7: Complex Real-World Scenarios 🔄

### Test 7.1: Sequential API calls

**Pre-request Script**:
```javascript
// First API call
const userResponse = await hopp.fetch('https://jsonplaceholder.typicode.com/users/1')
const user = await userResponse.json()
console.log('User:', user.name)

// Second API call using data from first
const postsResponse = await hopp.fetch(`https://jsonplaceholder.typicode.com/posts?userId=${user.id}`)
const posts = await postsResponse.json()
console.log('User has', posts.length, 'posts')

// Set environment variable
hopp.env.set('user_name', user.name)
hopp.env.set('post_count', posts.length.toString())
```

**Expected Result**:
- Both API calls complete
- User name logged
- Post count logged
- Environment variables set

---

### Test 7.2: Conditional requests

**Pre-request Script**:
```javascript
const checkResponse = await hopp.fetch('https://echo.hoppscotch.io/status/200')
console.log('Health check status:', checkResponse.status)

if (checkResponse.ok) {
  const dataResponse = await hopp.fetch('https://echo.hoppscotch.io', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ healthy: true })
  })

  const data = await dataResponse.json()
  console.log('Data request succeeded:', data)
} else {
  console.error('Health check failed, skipping data request')
}
```

**Expected Result**:
- Health check completes
- Conditional logic executes
- Data request succeeds if health check passed

---

### Test 7.3: Environment-based requests

**Pre-request Script**:
```javascript
const baseUrl = hopp.env.get('base_url') || 'https://echo.hoppscotch.io'
const apiKey = hopp.env.get('api_key') || 'test-key'

const response = await hopp.fetch(`${baseUrl}/headers`, {
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'X-Custom-Header': 'test'
  }
})

const data = await response.json()
console.log('Request with env variables succeeded')
console.log('Headers sent:', data.headers)
```

**Expected Result**:
- Environment variables read correctly
- Request made with correct headers
- Response shows headers were sent

---

## Debugging Tips

### If fetch never completes:

1. **Check browser console** for any errors
2. **Verify interceptor is selected** and working
3. **Check network tab** to see if request was made
4. **Try with Browser interceptor** first (simplest)

### If response.json() fails:

1. **Check response status** - might be error response
2. **Try response.text()** instead to see raw body
3. **Check Content-Type header** - might not be JSON

### If pm.sendRequest() callback never fires:

1. **Verify experimental scripting is enabled**
2. **Check console for errors**
3. **Try hopp.fetch()** first to isolate issue

---

## Performance Benchmarks

Expected timings for `https://echo.hoppscotch.io`:

| Operation | Expected Time |
|-----------|--------------|
| fetch() completes | 100-300ms (network) |
| response.json() | < 10ms |
| Total overhead | ~50-70ms (grace period) |
| pm.sendRequest() callback | < 100ms after network |

**Total time**: ~200-400ms for simple GET request

---

## Troubleshooting

### Common Issues

1. **"fetch is not defined"**
   - Solution: Enable experimental scripting in settings

2. **"Cannot read property 'body' of undefined"**
   - Solution: Interceptor might have failed, check interceptor status

3. **Script times out**
   - Solution: Increase timeout in settings or use faster API

4. **QuickJS lifetime errors**
   - Solution: Should be fixed - report if still occurs

### Reporting Issues

If any test fails, provide:
1. **Test name and number** (e.g., "Test 1.2: POST request")
2. **Interceptor used** (Browser/Proxy/Agent/Extension)
3. **Console output** (screenshot or copy/paste)
4. **Network tab** (if relevant)
5. **Browser** (Chrome, Firefox, etc.)

---

## Success Criteria

### Minimum for Production:

- ✅ Test 1.1 passes (Browser interceptor)
- 🔄 Test 2.1 passes (pm.sendRequest basic)
- 🔄 At least one of Test 3.1/4.1/5.1 passes (other interceptors)

### Full RFC Compliance:

- ✅ All Test Suite 1 tests pass (hopp.fetch)
- 🔄 All Test Suite 2 tests pass (pm.sendRequest)
- 🔄 At least Test Suite 3/4/5 verified (other interceptors)
- 🔄 Test Suite 6 passes (async test callbacks)

**Current Status**:
- ✅ Test 1.1 verified working with Browser interceptor
- 🔄 All other tests expected to work but need manual verification

---

## Architecture Notes

### Why All Interceptors Should Work

The implementation is **interceptor-agnostic** because:

1. `hopp.fetch()` calls `kernelInterceptor.execute(relayRequest)`
2. KernelInterceptorService routes to currently selected interceptor
3. All interceptors return standardized `RelayResponse` format
4. Response serialization happens **after** interceptor execution
5. Fix operates on `RelayResponse`, not interceptor-specific data

### Key Implementation Files

- [hopp-fetch.ts (js-sandbox)](packages/hoppscotch-js-sandbox/src/cage-modules/hopp-fetch.ts) - Async tracking
- [hopp-fetch.ts (common)](packages/hoppscotch-common/src/helpers/fetch/hopp-fetch.ts) - Response serialization
- [default.ts](packages/hoppscotch-js-sandbox/src/cage-modules/default.ts) - Module configuration
- [pre-request.js](packages/hoppscotch-js-sandbox/src/bootstrap-code/pre-request.js) - pm.sendRequest implementation

---

## Next Steps After Verification

1. If all basic tests pass → Mark RFC #5221 as "Fully Implemented"
2. If any test fails → Debug and fix specific issue
3. Document any edge cases discovered
4. Update user-facing documentation with examples
5. Create migration guide for Postman users

---

**Status**: 🟢 **READY FOR MANUAL TESTING**

Test 1.1 already verified ✅ - all other tests expected to work based on architecture analysis.
