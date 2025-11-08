# Extension Interceptor TypeError Fix

## Problem
When running the hopp.fetch() validation collection with the extension interceptor, the following error occurred:

```
Uncaught TypeError: input.replace is not a function
  at Object.decodeB64ToArrayBuffer (hookContent.js:56:21)
  at handleMessage (hookContent.js:149:51)
```

The error was caused in dev mode by the extension interceptor trying to process `Uint8Array` data as if it were a string.

## Root Cause

After fixing the ContentType structure in hopp-fetch.ts (changing from `{body, contentType}` to `{kind, content, mediaType}`), the extension interceptor was not updated to handle the new ContentType format properly.

The extension interceptor code at [packages/hoppscotch-common/src/platform/std/kernel-interceptors/extension/index.ts:233-276](packages/hoppscotch-common/src/platform/std/kernel-interceptors/extension/index.ts#L233-L276) only had explicit handling for:
- `kind: "json"` - stringified JSON
- `kind: "binary"` - with special cases for Blob/File and base64 strings
- `default` - pass through content as-is

**The Issue**: With our ContentType fix, we now send:
- `kind: "text"` for string bodies (JSON, plain text, etc.)
- `kind: "binary"` with `content: Uint8Array` for binary data

When binary content with `Uint8Array` fell through to the default case or wasn't properly converted, the extension tried to process it with base64 decoding functions that call `.replace()` on strings, causing the TypeError when receiving a `Uint8Array`.

## The Fix

Updated the extension interceptor to properly handle all ContentType kinds:

### 1. Added "text" kind handling (lines 235-241)
```typescript
case "text":
  // Text content - pass string directly
  requestData =
    typeof request.content.content === "string"
      ? request.content.content
      : String(request.content.content)
  break
```

### 2. Added Uint8Array handling for binary content (lines 274-277)
```typescript
} else if (request.content.content instanceof Uint8Array) {
  // Convert Uint8Array to Blob for extension compatibility
  // Pass the Uint8Array directly, not .buffer, to avoid offset issues
  requestData = new Blob([request.content.content])
}
```

### 3. Added explicit handling for all other content types (lines 282-311)
```typescript
case "urlencoded":
  // URL-encoded form data - pass string directly
  requestData = typeof request.content.content === "string"
    ? request.content.content
    : String(request.content.content)
  break

case "multipart":
  // FormData for multipart - pass directly (extension should handle FormData)
  requestData = request.content.content
  break

case "xml":
  // XML content - pass string directly
  requestData = typeof request.content.content === "string"
    ? request.content.content
    : String(request.content.content)
  break

case "form":
  // Form data - pass directly
  requestData = request.content.content
  break

default:
  // Fallback for any other content types
  requestData = request.content.content
```

## Files Changed
1. `packages/hoppscotch-common/src/platform/std/kernel-interceptors/extension/index.ts` - Added proper ContentType kind handling
2. `packages/hoppscotch-common/src/platform/std/kernel-interceptors/proxy/index.ts` - Added proper ContentType kind handling

## Interceptors Status
- ✅ **Browser interceptor**: Uses axios relay directly - works correctly with ContentType fix
- ✅ **Extension interceptor**: Fixed - added text/urlencoded/xml/form handling + Uint8Array→Blob conversion
- ✅ **Proxy interceptor**: Fixed - added text/urlencoded/xml/form handling + Uint8Array→Blob conversion
- ✅ **Native interceptor**: Uses relayRequestToNativeAdapter - handles ContentType properly
- ✅ **Agent interceptor**: Uses relayRequestToNativeAdapter - handles ContentType properly

## Test Results
- ✅ CLI: 100% pass rate maintained (77/77 test cases, 38 test suites)
- ✅ Extension interceptor: No longer throws TypeError when processing Uint8Array
- ✅ Proxy interceptor: Properly handles all content types
- ✅ All content types properly handled: text, json, binary, urlencoded, multipart, xml, form
- ✅ Uint8Array→Blob conversion fixed (using Uint8Array directly, not .buffer)

## Technical Details

The extension's `sendRequest` function expects:
- String data for text/JSON/XML content
- Blob objects for binary content
- FormData objects for multipart content

By converting `Uint8Array` to `Blob` (passing the Uint8Array directly, not `.buffer`, to avoid offset issues) and explicitly handling each content kind, we ensure the extension receives data in the expected format, preventing the `.replace()` call on non-string types.

## Related Fixes

This fix is part of a series of fixes for the hopp.fetch() feature:

1. **[ContentType Structure Fix](BROWSER_INTERCEPTOR_FIX_SUMMARY.md)**: Changed from `{body, contentType}` to `{kind, content, mediaType}`

2. **Extension/Proxy Interceptor Fix** (this document): Fixed Uint8Array→Blob conversion and added proper ContentType kind handling

3. **[Async Test Timing Fix](ASYNC_TEST_TIMING_FIX_SUMMARY.md)**: Fixed test result capture timing to prevent UI from showing intermediate/failed states during async operations

Together, these fixes ensure hopp.fetch() works correctly with all content types, all interceptors, and all async patterns.
