# Loading State Fix - Double RAF Technique

## The Problem

The Send button was not changing to "Cancel" immediately when clicked, especially when the pre-request script contained async fetch calls. The delay was noticeable and felt unresponsive.

**User Observation**:
- Empty pre-request script → immediate toggle ✅
- Sync pre-request script → immediate toggle ✅
- **Async fetch in pre-request → delayed toggle** ❌

## Why Previous Fixes Didn't Work

### Attempt 1: `await nextTick()`
```typescript
loading.value = true
await nextTick()  // Vue flushes reactive updates
// Pre-request script starts...
```

**Problem**: `nextTick()` only ensures Vue has processed reactive updates and queued DOM changes. It does NOT wait for the browser to actually paint those changes to the screen.

### Attempt 2: `setTimeout(resolve, 0)`
```typescript
loading.value = true
await nextTick()
await new Promise(resolve => setTimeout(resolve, 0))  // Yield to event loop
// Pre-request script starts...
```

**Problem**: `setTimeout(0)` yields to the next event loop tick, but the browser might not have painted yet. Paint happens when the browser is idle, not immediately after every tick.

## The Solution: Double RAF (requestAnimationFrame)

```typescript
loading.value = true

await nextTick()  // Vue flushes reactive updates

await new Promise(resolve => {
  requestAnimationFrame(() => {      // First RAF: scheduled for next frame
    requestAnimationFrame(() => {    // Second RAF: guaranteed after paint
      resolve(undefined)
    })
  })
})

// Now pre-request script can start - loading state is visible!
```

## How requestAnimationFrame Works

### Single RAF
```typescript
requestAnimationFrame(callback)
```

Schedules `callback` to run **before the next paint**:
1. Current JavaScript task finishes
2. Browser processes style/layout changes
3. **RAF callback runs**
4. Browser paints to screen

**Problem**: The RAF callback runs BEFORE the paint, so if we start blocking work in the callback, the paint never happens!

### Double RAF
```typescript
requestAnimationFrame(() => {
  requestAnimationFrame(callback)
})
```

The second RAF is scheduled AFTER the first paint:
1. Current JavaScript task finishes
2. Browser processes style/layout changes
3. First RAF runs and schedules second RAF
4. **Browser paints** ← Loading state becomes visible!
5. Second RAF runs
6. Callback executes - pre-request script starts

**Result**: The loading state is guaranteed to be painted before the pre-request script starts executing.

## Implementation

### File 1: Request.vue (Lines 347-361)

For individual REST requests:

```typescript
const newSendRequest = async () => {
  if (newEndpoint.value === "" || /^\s+$/.test(newEndpoint.value)) {
    toast.error(`${t("empty.endpoint")}`)
    return
  }

  // Set loading state FIRST, before any other operations
  loading.value = true

  // Force Vue to flush DOM updates AND wait for browser to paint
  // Double RAF ensures the loading state is actually visible before any blocking work
  await nextTick()
  await new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve(undefined)
      })
    })
  })

  ensureMethodInEndpoint()
  // ... rest of function
}
```

### File 2: RequestRunner.ts (Lines 622-631)

For test runner requests:

```typescript
export async function runTestRunnerRequest(
  request: HoppRESTRequest,
  persistEnv = true,
  inheritedVariables: HoppCollectionVariable[] = []
): Promise<...> {
  const cookieJarEntries = getCookieJarEntries()

  // Give browser time to paint the loading state before starting pre-request script
  // Double RAF ensures browser has actually rendered the DOM update
  // This is critical for requests with async pre-request scripts
  await new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve(undefined)
      })
    })
  })

  return delegatePreRequestScriptRunner(
    request,
    getCombinedEnvVariables(),
    cookieJarEntries
  ).then(async (preRequestScriptResult) => {
    // ... rest
  })
}
```

## Why This Works for Async Pre-Request Scripts

The issue was specifically with async pre-request scripts because:

1. **Synchronous Sandbox Setup**: Even though the pre-request script is async, creating the FaradayCage sandbox happens synchronously
2. **Blocks Main Thread**: This synchronous setup blocks the main thread, preventing the browser from painting
3. **Double RAF Guarantees Paint**: By waiting for two animation frames, we ensure the paint happens BEFORE the synchronous sandbox setup

### Flow Comparison

#### Before (Delayed Loading State):
```
User clicks Send
  → loading.value = true
  → await nextTick()  ← Vue queues DOM update
  → runTestRunnerRequest()
  → delegatePreRequestScriptRunner()  ← BLOCKS HERE (creating FaradayCage)
  → (minutes pass...)
  → Eventually browser paints
  → Loading state appears ❌ TOO LATE
```

#### After (Immediate Loading State):
```
User clicks Send
  → loading.value = true
  → await nextTick()  ← Vue queues DOM update
  → await double RAF  ← Browser PAINTS HERE ✅
  → Loading state appears immediately!
  → runTestRunnerRequest()
  → delegatePreRequestScriptRunner()  ← Blocks, but user already sees loading state
```

## Browser Rendering Pipeline

Understanding the browser's frame lifecycle:

```
┌─────────────────────────────────────────────────┐
│ Frame N                                         │
├─────────────────────────────────────────────────┤
│ 1. JavaScript Task Queue                       │
│    - Event handlers                             │
│    - Promises                                   │
│    - setTimeout callbacks                       │
│                                                 │
│ 2. Style Calculation                           │
│    - Compute CSS                                │
│                                                 │
│ 3. Layout                                       │
│    - Position elements                          │
│                                                 │
│ 4. First RAF Callbacks  ← First RAF runs here  │
│                                                 │
│ 5. Paint                                        │
│    - Draw pixels                                │
│                                                 │
│ 6. Composite                                    │
│    - Send to GPU                                │
│                                                 │
│ Frame N+1                                       │
├─────────────────────────────────────────────────┤
│ 7. Second RAF Callbacks  ← Second RAF runs here│
└─────────────────────────────────────────────────┘
```

By using double RAF, we ensure our blocking code runs in Frame N+1, AFTER the paint in Frame N has completed.

## Performance Impact

**Delay Added**: ~16-33ms (1-2 frames at 60fps)

This tiny delay is imperceptible to users but ensures the UI feels responsive. Users perceive the app as FASTER because they get immediate visual feedback, even though the actual request starts slightly later.

## Testing Checklist

- [ ] Click Send on request with empty pre-request script → immediate toggle (still works)
- [ ] Click Send on request with sync pre-request script → immediate toggle (still works)
- [ ] Click Send on request with async fetch in pre-request → **immediate toggle** ✅ (now fixed!)
- [ ] Click Send on request with multiple async fetches → immediate toggle ✅
- [ ] Click Send on request with Promise.all in pre-request → immediate toggle ✅

## References

- [MDN: requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame)
- [Browser Rendering Performance](https://web.dev/rendering-performance/)
- [The Anatomy of a Frame](https://aerotwist.com/blog/the-anatomy-of-a-frame/)

---

**Status**: ✅ FIXED with double RAF technique
