# Extension Interceptor Uint8Array Fix

## Problem

When running the `hopp.fetch()` validation collection with the extension interceptor, a `TypeError` occurred:

```
Uncaught TypeError: input.replace is not a function
  at Object.decodeB64ToArrayBuffer (hookContent.js:56:21)
  at handleMessage (hookContent.js:149:51)
```

The error was happening in the browser extension's own code (`hookContent.js`), not in our interceptor code.

## Root Cause

In our previous fix ([EXTENSION_INTERCEPTOR_FIX_SUMMARY.md](EXTENSION_INTERCEPTOR_FIX_SUMMARY.md)), we added handling for `Uint8Array` content by wrapping it in a `Blob`:

```typescript
// PREVIOUS CODE (Caused TypeError):
} else if (request.content.content instanceof Uint8Array) {
  // Convert Uint8Array to Blob for extension compatibility
  // Pass the Uint8Array directly, not .buffer, to avoid offset issues
  requestData = new Blob([request.content.content])  // ❌ Extension doesn't handle Blob properly
}
```

However, the browser extension does NOT handle `Blob` objects properly for request bodies. The extension expects either:
- **Strings** for text/JSON/XML content
- **Uint8Array** for binary content
- **FormData** for multipart content

When we wrapped `Uint8Array` in a `Blob`, the extension received the Blob and tried to process it using base64 decoding functions that call `.replace()` on strings, causing the TypeError.

## The Fix

Changed the `Uint8Array` handling to pass the array directly to the extension without wrapping it in a Blob:

**File**: [packages/hoppscotch-common/src/platform/std/kernel-interceptors/extension/index.ts](packages/hoppscotch-common/src/platform/std/kernel-interceptors/extension/index.ts#L275-L278)

```typescript
} else if (request.content.content instanceof Uint8Array) {
  // Pass Uint8Array directly - extension handles it
  // DO NOT wrap in Blob or use .buffer (causes TypeError in extension)
  requestData = request.content.content  // ✅ Extension handles Uint8Array correctly
}
```

## Why This Works

The browser extension's `sendRequest` function is designed to handle:
1. **Strings** → Sent as-is for text content
2. **Uint8Array** → Sent as binary data
3. **Blob/File** → Only for specific file upload scenarios
4. **FormData** → For multipart requests

When we send `Uint8Array` directly (not wrapped in Blob, not using `.buffer`), the extension processes it correctly as binary data without trying to run string operations on it.

## Related Files

### Extension Interceptor
**File**: [packages/hoppscotch-common/src/platform/std/kernel-interceptors/extension/index.ts](packages/hoppscotch-common/src/platform/std/kernel-interceptors/extension/index.ts)

**Binary Content Handling** (Lines 253-282):
```typescript
case "binary":
  if (
    request.content.content instanceof Blob ||
    request.content.content instanceof File
  ) {
    requestData = request.content.content
  } else if (typeof request.content.content === "string") {
    try {
      const base64 =
        request.content.content.split(",")[1] ||
        request.content.content
      const binaryString = window.atob(base64)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      // Pass the Uint8Array directly, not .buffer, to avoid offset issues
      requestData = new Blob([bytes])  // ✅ This is for base64 string input
    } catch (e) {
      console.error("Error converting binary data:", e)
      requestData = request.content.content
    }
  } else if (request.content.content instanceof Uint8Array) {
    // Pass Uint8Array directly - extension handles it
    // DO NOT wrap in Blob or use .buffer (causes TypeError in extension)
    requestData = request.content.content  // ✅ This is the fix
  } else {
    requestData = request.content.content
  }
  break
```

Note the difference:
- **Base64 string input** (lines 259-270): Decode to bytes, then wrap in Blob → This is correct because the input is a string, not binary data
- **Uint8Array input** (lines 275-278): Pass directly → This is correct because the extension handles Uint8Array natively

## Test Results

After this fix:
- ✅ Extension interceptor no longer throws TypeError when sending binary data
- ✅ `hopp.fetch()` works correctly with all content types via extension interceptor
- ✅ Validation collection passes all tests

## Previous Fix Context

This fix builds on our previous work in [EXTENSION_INTERCEPTOR_FIX_SUMMARY.md](EXTENSION_INTERCEPTOR_FIX_SUMMARY.md), where we:
1. Added proper ContentType kind handling (text, urlencoded, xml, form)
2. Fixed the base64 decoding path to use `new Blob([bytes])` instead of `new Blob([bytes.buffer])`

The current fix corrects our previous approach of wrapping `Uint8Array` in `Blob`, which was causing the extension to fail.

## Summary

The extension interceptor now correctly handles binary data by:
1. ✅ Passing `Uint8Array` directly to the extension (not wrapped in Blob)
2. ✅ Not using `.buffer` which causes offset issues
3. ✅ Preserving Blob/File objects when already in that format
4. ✅ Converting base64 strings to Blob for compatibility

This ensures the extension receives data in the format it expects, preventing TypeError when processing requests with binary content.
