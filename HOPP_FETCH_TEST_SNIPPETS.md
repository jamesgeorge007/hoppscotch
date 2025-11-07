# hopp.fetch() Test Snippets

Comprehensive test cases for `hopp.fetch()` covering all RFC #5221 requirements and common use cases.

## Pre-Request Script Tests (with top-level await)

### 1. Basic GET Request
```javascript
// Test 1: Simple GET request
console.log('Test 1: Basic GET')
const response = await hopp.fetch('https://echo.hoppscotch.io')
const data = await response.json()
console.log('Status:', response.status)
console.log('Data:', data)
```

### 2. GET with Query Parameters in URL
```javascript
// Test 2: GET with query params
console.log('Test 2: GET with query params')
const response = await hopp.fetch('https://echo.hoppscotch.io?foo=bar&baz=qux')
const data = await response.json()
console.log('Args:', data.args) // Should show foo and baz params
```

### 3. POST with JSON Body
```javascript
// Test 3: POST with JSON
console.log('Test 3: POST with JSON')
const response = await hopp.fetch('https://echo.hoppscotch.io', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'John Doe',
    email: 'john@example.com',
    age: 30
  })
})
const data = await response.json()
console.log('Received:', data.data)
```

### 4. POST with URL-Encoded Form Data
```javascript
// Test 4: POST with URL-encoded body
console.log('Test 4: URL-encoded POST')
const params = new URLSearchParams()
params.append('username', 'testuser')
params.append('password', 'testpass123')

const response = await hopp.fetch('https://echo.hoppscotch.io', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded'
  },
  body: params.toString()
})
const data = await response.json()
console.log('Form data received:', data.data)
```

### 5. POST with FormData (Multipart)
```javascript
// Test 5: POST with FormData
console.log('Test 5: Multipart form data')
const formData = new FormData()
formData.append('field1', 'value1')
formData.append('field2', 'value2')
formData.append('nested[key]', 'nested value')

const response = await hopp.fetch('https://echo.hoppscotch.io', {
  method: 'POST',
  body: formData
})
const data = await response.json()
console.log('FormData received:', data)
```

### 6. Custom Headers
```javascript
// Test 6: Custom headers
console.log('Test 6: Custom headers')
const response = await hopp.fetch('https://echo.hoppscotch.io', {
  headers: {
    'X-Custom-Header': 'CustomValue',
    'User-Agent': 'HoppscotchTest/1.0',
    'Accept': 'application/json'
  }
})
const data = await response.json()
console.log('Headers sent:', data.headers)
```

### 7. PUT Request
```javascript
// Test 7: PUT request
console.log('Test 7: PUT request')
const response = await hopp.fetch('https://echo.hoppscotch.io', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    id: 123,
    name: 'Updated Name'
  })
})
const data = await response.json()
console.log('PUT response:', data)
```

### 8. DELETE Request
```javascript
// Test 8: DELETE request
console.log('Test 8: DELETE request')
const response = await hopp.fetch('https://echo.hoppscotch.io/resource/123', {
  method: 'DELETE'
})
console.log('DELETE status:', response.status)
```

### 9. PATCH Request
```javascript
// Test 9: PATCH request
console.log('Test 9: PATCH request')
const response = await hopp.fetch('https://echo.hoppscotch.io', {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    field: 'updated value'
  })
})
const data = await response.json()
console.log('PATCH response:', data)
```

### 10. Response Headers Access
```javascript
// Test 10: Access response headers
console.log('Test 10: Response headers')
const response = await hopp.fetch('https://echo.hoppscotch.io')
console.log('Content-Type:', response.headers.get('content-type'))
console.log('All headers:', Object.fromEntries(response.headers.entries()))
```

### 11. Response Status Checking
```javascript
// Test 11: Status checking
console.log('Test 11: Status checks')
const response = await hopp.fetch('https://echo.hoppscotch.io')
console.log('Status:', response.status)
console.log('Status Text:', response.statusText)
console.log('OK:', response.ok) // true for 200-299
```

### 12. Text Response
```javascript
// Test 12: Get response as text
console.log('Test 12: Text response')
const response = await hopp.fetch('https://echo.hoppscotch.io')
const text = await response.text()
console.log('Text length:', text.length)
console.log('First 100 chars:', text.substring(0, 100))
```

### 13. Chain Multiple Requests
```javascript
// Test 13: Sequential requests
console.log('Test 13: Chained requests')

// First request
const response1 = await hopp.fetch('https://echo.hoppscotch.io?step=1')
const data1 = await response1.json()
console.log('Step 1 complete:', data1.args.step)

// Second request using data from first
const response2 = await hopp.fetch('https://echo.hoppscotch.io?step=2&prev=' + data1.args.step)
const data2 = await response2.json()
console.log('Step 2 complete:', data2.args)

// Third request
const response3 = await hopp.fetch('https://echo.hoppscotch.io?step=3&final=true')
const data3 = await response3.json()
console.log('All steps complete:', data3.args)
```

### 14. Set Environment Variables from Response
```javascript
// Test 14: Extract and store response data
console.log('Test 14: Store in environment')
const response = await hopp.fetch('https://echo.hoppscotch.io?token=abc123')
const data = await response.json()

// Store token in active environment
hopp.env.active.set('api_token', data.args.token)
console.log('Token stored:', hopp.env.active.get('api_token'))
```

### 15. Error Handling
```javascript
// Test 15: Error handling
console.log('Test 15: Error handling')
try {
  const response = await hopp.fetch('https://echo.hoppscotch.io/404')
  if (!response.ok) {
    console.error('Request failed:', response.status, response.statusText)
  } else {
    const data = await response.json()
    console.log('Success:', data)
  }
} catch (error) {
  console.error('Fetch error:', error.message)
}
```

### 16. Dynamic URL Construction
```javascript
// Test 16: Build URL dynamically
console.log('Test 16: Dynamic URL')
const baseUrl = 'https://echo.hoppscotch.io'
const endpoint = '/users'
const params = {
  page: 1,
  limit: 10,
  sort: 'name'
}

const queryString = Object.entries(params)
  .map(([key, value]) => `${key}=${value}`)
  .join('&')

const response = await hopp.fetch(`${baseUrl}${endpoint}?${queryString}`)
const data = await response.json()
console.log('Request to:', data.url)
```

### 17. Binary Data POST
```javascript
// Test 17: POST binary data
console.log('Test 17: Binary data')
const binaryData = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]) // "Hello"
const response = await hopp.fetch('https://echo.hoppscotch.io', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/octet-stream'
  },
  body: binaryData
})
console.log('Binary POST status:', response.status)
```

### 18. Authentication Header
```javascript
// Test 18: Bearer token auth
console.log('Test 18: Bearer token')
const token = hopp.env.active.get('auth_token') || 'sample_token_123'
const response = await hopp.fetch('https://echo.hoppscotch.io', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})
const data = await response.json()
console.log('Auth header sent:', data.headers['authorization'])
```

### 19. Parallel Requests
```javascript
// Test 19: Parallel requests
console.log('Test 19: Parallel requests')
const [response1, response2, response3] = await Promise.all([
  hopp.fetch('https://echo.hoppscotch.io?id=1'),
  hopp.fetch('https://echo.hoppscotch.io?id=2'),
  hopp.fetch('https://echo.hoppscotch.io?id=3')
])

const [data1, data2, data3] = await Promise.all([
  response1.json(),
  response2.json(),
  response3.json()
])

console.log('All responses:', [data1.args.id, data2.args.id, data3.args.id])
```

### 20. Conditional Requests
```javascript
// Test 20: Conditional logic
console.log('Test 20: Conditional requests')
const useV2 = hopp.env.active.get('use_api_v2') === 'true'
const apiUrl = useV2
  ? 'https://echo.hoppscotch.io/v2/endpoint'
  : 'https://echo.hoppscotch.io/v1/endpoint'

const response = await hopp.fetch(apiUrl)
const data = await response.json()
console.log('API version used:', data.url)
```

---

## Post-Request Script Tests (with hopp.test)

### 1. Basic Status Code Test
```javascript
hopp.test('Status code is 200', () => {
  hopp.expect(hopp.response.status).toBe(200)
})
```

### 2. Response Time Test
```javascript
hopp.test('Response time is acceptable', () => {
  hopp.expect(hopp.response.meta.responseDuration).toBeLessThan(1000)
})
```

### 3. Content-Type Header Test
```javascript
hopp.test('Content-Type is JSON', () => {
  const contentType = hopp.response.headers.find(h =>
    h.key.toLowerCase() === 'content-type'
  )
  hopp.expect(contentType.value).toContain('application/json')
})
```

### 4. JSON Response Structure Test
```javascript
hopp.test('Response has required fields', () => {
  const body = JSON.parse(hopp.response.body)
  hopp.expect(body).toHaveProperty('url')
  hopp.expect(body).toHaveProperty('method')
  hopp.expect(body).toHaveProperty('headers')
})
```

### 5. Response Body Validation
```javascript
hopp.test('Response body is valid JSON', () => {
  hopp.expect(() => JSON.parse(hopp.response.body)).not.toThrow()
})
```

### 6. Multiple Assertions in One Test
```javascript
hopp.test('Complete response validation', () => {
  hopp.expect(hopp.response.status).toBe(200)
  hopp.expect(hopp.response.statusText).toBe('OK')

  const body = JSON.parse(hopp.response.body)
  hopp.expect(body.method).toBe('GET')
  hopp.expect(body.url).toContain('echo.hoppscotch.io')
})
```

### 7. Environment Variable Test
```javascript
hopp.test('Environment variable is set', () => {
  hopp.expect(hopp.env.active.get('api_token')).toBeDefined()
  hopp.expect(hopp.env.active.get('api_token')).not.toBe('')
})
```

### 8. Array Length Test
```javascript
hopp.test('Response contains items', () => {
  const body = JSON.parse(hopp.response.body)
  hopp.expect(body.headers).toBeDefined()
  hopp.expect(Object.keys(body.headers).length).toBeGreaterThan(0)
})
```

### 9. Nested Property Test
```javascript
hopp.test('Nested data structure is correct', () => {
  const body = JSON.parse(hopp.response.body)
  hopp.expect(body.args).toBeDefined()
  hopp.expect(body.args.foo).toBe('bar')
})
```

### 10. Custom Header Sent Test
```javascript
hopp.test('Custom header was sent', () => {
  const body = JSON.parse(hopp.response.body)
  hopp.expect(body.headers).toHaveProperty('x-custom-header')
  hopp.expect(body.headers['x-custom-header']).toBe('CustomValue')
})
```

### 11. Test with hopp.fetch in Post-Request
```javascript
hopp.test('Follow-up request succeeds', async () => {
  const body = JSON.parse(hopp.response.body)
  const token = body.args.token

  const response = await hopp.fetch(`https://echo.hoppscotch.io?verify=${token}`)
  hopp.expect(response.status).toBe(200)

  const data = await response.json()
  hopp.expect(data.args.verify).toBe(token)
})
```

### 12. Store Response Data and Test
```javascript
hopp.test('Extract and validate token', () => {
  const body = JSON.parse(hopp.response.body)
  hopp.expect(body.args.token).toBeDefined()

  // Store for next request
  hopp.env.active.set('auth_token', body.args.token)

  // Verify it's stored
  hopp.expect(hopp.env.active.get('auth_token')).toBe(body.args.token)
})
```

### 13. Async Test with Multiple Fetches
```javascript
hopp.test('Chain validation requests', async () => {
  const body = JSON.parse(hopp.response.body)

  // First validation
  const response1 = await hopp.fetch('https://echo.hoppscotch.io?step=1')
  const data1 = await response1.json()
  hopp.expect(data1.args.step).toBe('1')

  // Second validation
  const response2 = await hopp.fetch('https://echo.hoppscotch.io?step=2')
  const data2 = await response2.json()
  hopp.expect(data2.args.step).toBe('2')
})
```

### 14. Error Response Test
```javascript
hopp.test('Error response structure', () => {
  if (hopp.response.status >= 400) {
    const body = JSON.parse(hopp.response.body)
    hopp.expect(body).toHaveProperty('error')
    hopp.expect(body.error).toHaveProperty('message')
    hopp.expect(body.error.message).toBeDefined()
  }
})
```

### 15. Response Timing Test
```javascript
hopp.test('Response is fast', () => {
  const duration = hopp.response.meta.responseDuration
  hopp.expect(duration).toBeDefined()
  hopp.expect(duration).toBeGreaterThan(0)
  hopp.expect(duration).toBeLessThan(5000)
})
```

### 16. Status Code Range Test
```javascript
hopp.test('Status is successful', () => {
  hopp.expect(hopp.response.status).toBeGreaterThanOrEqual(200)
  hopp.expect(hopp.response.status).toBeLessThan(300)
})
```

### 17. Array Contains Test
```javascript
hopp.test('Response contains expected values', () => {
  const body = JSON.parse(hopp.response.body)
  const headerKeys = Object.keys(body.headers)
  hopp.expect(headerKeys).toContain('user-agent')
  hopp.expect(headerKeys).toContain('accept')
})
```

### 18. Regex Pattern Test
```javascript
hopp.test('URL matches pattern', () => {
  const body = JSON.parse(hopp.response.body)
  hopp.expect(body.url).toMatch(/^https:\/\//)
  hopp.expect(body.url).toMatch(/echo\.hoppscotch\.io/)
})
```

### 19. Type Checking Test
```javascript
hopp.test('Response data types are correct', () => {
  const body = JSON.parse(hopp.response.body)
  hopp.expect(typeof body.url).toBe('string')
  hopp.expect(typeof body.method).toBe('string')
  hopp.expect(typeof body.headers).toBe('object')
  hopp.expect(Array.isArray(body.args)).toBe(false)
})
```

### 20. Complex Validation Test
```javascript
hopp.test('Complete API contract validation', async () => {
  // Status validation
  hopp.expect(hopp.response.status).toBe(200)

  // Parse body
  const body = JSON.parse(hopp.response.body)

  // Structure validation
  hopp.expect(body).toHaveProperty('url')
  hopp.expect(body).toHaveProperty('method')
  hopp.expect(body).toHaveProperty('headers')
  hopp.expect(body).toHaveProperty('args')

  // Type validation
  hopp.expect(typeof body.url).toBe('string')
  hopp.expect(typeof body.method).toBe('string')

  // Content validation
  hopp.expect(body.method).toBe('GET')

  // Follow-up validation request
  const token = body.args.token || 'default_token'
  const verifyResponse = await hopp.fetch(`https://echo.hoppscotch.io?verify=${token}`)
  hopp.expect(verifyResponse.status).toBe(200)

  const verifyData = await verifyResponse.json()
  hopp.expect(verifyData.args.verify).toBe(token)
})
```

---

## Combined Pre-Request + Post-Request Workflow

### Pre-Request Script:
```javascript
// Generate dynamic data
const timestamp = Date.now()
const requestId = Math.random().toString(36).substring(7)

hopp.env.active.set('request_timestamp', timestamp.toString())
hopp.env.active.set('request_id', requestId)

// Fetch authentication token
const authResponse = await hopp.fetch('https://echo.hoppscotch.io?action=auth')
const authData = await authResponse.json()
const token = authData.args.action // In real scenario, this would be a real token

hopp.env.active.set('session_token', token)

console.log('Pre-request setup complete')
console.log('Request ID:', requestId)
console.log('Token:', token)
```

### Post-Request Script:
```javascript
hopp.test('Request ID matches', () => {
  const body = JSON.parse(hopp.response.body)
  const sentId = hopp.env.active.get('request_id')
  // In real scenario, server would echo back the request ID
  hopp.expect(sentId).toBeDefined()
})

hopp.test('Session token was used', () => {
  const body = JSON.parse(hopp.response.body)
  const token = hopp.env.active.get('session_token')
  hopp.expect(body.headers['authorization']).toBe(`Bearer ${token}`)
})

hopp.test('Response time is logged', () => {
  const timestamp = hopp.env.active.get('request_timestamp')
  const now = Date.now()
  const elapsed = now - parseInt(timestamp)

  console.log('Total request time:', elapsed, 'ms')
  hopp.expect(elapsed).toBeGreaterThan(0)
})

// Validate and store response data for next request
hopp.test('Store next request data', async () => {
  const body = JSON.parse(hopp.response.body)

  // Store URL for chaining
  hopp.env.active.set('last_request_url', body.url)

  // Verify with follow-up
  const nextResponse = await hopp.fetch('https://echo.hoppscotch.io?next=true')
  hopp.expect(nextResponse.ok).toBe(true)
})
```

---

## Edge Cases and Advanced Scenarios

### 21. Empty Response Body
```javascript
// Pre-request
const response = await hopp.fetch('https://echo.hoppscotch.io', {
  method: 'HEAD' // HEAD requests have no body
})
console.log('HEAD request status:', response.status)
console.log('Has body:', response.bodyUsed)
```

### 22. Large Payload
```javascript
// Pre-request
const largeData = {
  items: Array.from({ length: 1000 }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
    description: `Description for item ${i}`.repeat(10)
  }))
}

const response = await hopp.fetch('https://echo.hoppscotch.io', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(largeData)
})

console.log('Large payload status:', response.status)
```

### 23. Special Characters in URL
```javascript
// Pre-request
const searchQuery = 'test & special = chars?'
const encodedQuery = encodeURIComponent(searchQuery)
const response = await hopp.fetch(`https://echo.hoppscotch.io?q=${encodedQuery}`)
const data = await response.json()
console.log('Encoded query:', data.args.q)
```

### 24. Timeout Simulation
```javascript
// Pre-request with error handling
console.log('Starting long request...')
try {
  const response = await hopp.fetch('https://echo.hoppscotch.io?delay=1000')
  const data = await response.json()
  console.log('Request completed:', data)
} catch (error) {
  console.error('Request failed or timed out:', error.message)
}
```

### 25. Content Negotiation
```javascript
// Pre-request
const response = await hopp.fetch('https://echo.hoppscotch.io', {
  headers: {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br'
  }
})
const data = await response.json()
console.log('Content negotiation headers:', data.headers)
```
