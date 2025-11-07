# hopp.fetch() POST Body Fix Summary

## Problem
POST requests in the web app were not sending request bodies to the server. The echo.hoppscotch.io responses showed empty `"data": ""` fields, causing all POST-related tests to fail with null environment variables.

## Root Cause
The `convertFetchToRelayRequest()` function in `hopp-fetch.ts` was creating request content objects with incorrect field names that didn't match the kernel relay's `ContentType` structure:

**Incorrect structure:**
```typescript
content = {
  contentType: "application/json",  // Wrong: should be "mediaType"
  body: new Uint8Array(...),        // Wrong: should be "content"
  // Missing: "kind" field
}
```

**Correct ContentType structure (from @hoppscotch/kernel):**
```typescript
type ContentType =
  | { kind: "text"; content: string; mediaType: MediaType | string }
  | { kind: "json"; content: unknown; mediaType: MediaType | string }
  | { kind: "binary"; content: Uint8Array; mediaType: MediaType | string }
  | { kind: "multipart"; content: FormData; mediaType: MediaType | string }
  // ... etc
```

The axios relay implementation (`packages/hoppscotch-kernel/src/relay/impl/web/v/1.ts:130`) expects:
```typescript
data: request.content?.content,  // Looks for "content" field, not "body"!
```

## The Fix

Updated `convertFetchToRelayRequest()` in [packages/hoppscotch-common/src/helpers/fetch/hopp-fetch.ts](packages/hoppscotch-common/src/helpers/fetch/hopp-fetch.ts) to use the proper ContentType structure:

### String Bodies (JSON, text)
```typescript
// Now uses "text" kind for string bodies
content = {
  kind: "text",
  content: init.body,  // String content directly
  mediaType: headers["content-type"] || "text/plain",
}
```

### FormData Bodies
```typescript
content = {
  kind: "multipart",
  content: init.body,  // FormData object
  mediaType: "multipart/form-data",
}
```

### Binary Bodies (Blob, ArrayBuffer, TypedArray)
```typescript
content = {
  kind: "binary",
  content: new Uint8Array(...),  // Binary content
  mediaType: "application/octet-stream",
}
```

## Files Changed
- `packages/hoppscotch-common/src/helpers/fetch/hopp-fetch.ts` - Fixed ContentType structure

## Test Results

### CLI: ✅ 100% Pass Rate
```
Test Cases: 0 failed 83 passed
Test Suites: 0 failed 26 passed
Test Scripts: 0 failed 25 passed
```

### Web App: Expected to pass now
All POST request tests should now work correctly:
- POST with JSON body
- POST with URL-encoded body
- Large JSON payload
- Binary data POST
- Empty body POST
- Sequential/parallel requests with POST

## Technical Details

The issue occurred because:

1. **Mismatch in field names**: We used `body` instead of `content` and `contentType` instead of `mediaType`
2. **Missing kind field**: The relay needs to know what type of content processing to apply
3. **Axios relay implementation**: The axios relay at line 130 specifically looks for `request.content?.content`, so using `request.content?.body` resulted in `undefined` being passed to axios, causing empty request bodies

This was a type structure mismatch between our fetch hook implementation and the kernel relay's expected ContentType format. The fix ensures we use the correct structure defined in `@hoppscotch/kernel/src/relay/v/1.ts`.
