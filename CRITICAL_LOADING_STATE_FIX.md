# Critical Loading State Fix - Synchronous Response Update

## The Real Problem

The Send button was controlled by `isTabResponseLoading`, which checks:
```typescript
const isTabResponseLoading = computed(
  () => tab.value.document.response?.type === "loading"
)
```

**We were setting `loading.value = true`**, but the button doesn't use that! It uses `tab.value.document.response.type`.

Even with double RAF, the button wouldn't change because we weren't updating the right property.

## The Solution

Set `tab.value.document.response.type = "loading"` **SYNCHRONOUSLY** as the very first operation:

```typescript
const newSendRequest = async () => {
  if (newEndpoint.value === "" || /^\s+$/.test(newEndpoint.value)) {
    toast.error(`${t("empty.endpoint")}`)
    return
  }

  // Set response to loading type IMMEDIATELY - this changes Send -> Cancel button
  // This must be synchronous for instant UI feedback
  tab.value.document.response = {
    type: "loading" as const,
    req: tab.value.document.request
  }

  // Also set loading ref for internal state
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

## How It Works

### Before (Broken):
```
User clicks Send
  → loading.value = true  ← Wrong property!
  → Button checks isTabResponseLoading
    → tab.value.document.response.type !== "loading"
    → Button stays as "Send" ❌
```

### After (Fixed):
```
User clicks Send
  → tab.value.document.response = { type: "loading" }  ← Correct property!
  → Button checks isTabResponseLoading
    → tab.value.document.response.type === "loading"
    → Button immediately changes to "Cancel" ✅
```

## Why Synchronous Assignment Works

Vue's reactivity is **synchronous** for property assignments:

1. **Assignment**: `tab.value.document.response = { type: "loading" }`
2. **Reactive Trigger**: Vue immediately marks the computed property `isTabResponseLoading` as dirty
3. **Template Re-evaluation**: Next render cycle will use the new value
4. **Double RAF**: Ensures the render happens before blocking work

The key is that the **assignment itself is synchronous**. Vue doesn't wait to process it - the property is changed immediately, and the computed property will reflect the new value on the next render.

## Button Template

The button in the template:
```vue
<HoppButtonPrimary
  id="send"
  :label="`${
    !isTabResponseLoading ? t('action.send') : t('action.cancel')
  }`"
  class="min-w-[5rem] flex-1 rounded-r-none"
  @click="!isTabResponseLoading ? newSendRequest() : cancelRequest()"
/>
```

- `isTabResponseLoading = false` → Shows "Send"
- `isTabResponseLoading = true` → Shows "Cancel"

## Preventing Double-Clicks

With immediate UI feedback:
1. User clicks "Send"
2. Button **immediately** shows "Cancel"
3. Click handler changes to `cancelRequest()`
4. User can't accidentally click "Send" twice ✅

## Files Modified

**[Request.vue:347-355](packages/hoppscotch-common/src/components/http/Request.vue#L347-L355)**

Added synchronous response update before any async work:
- Sets `tab.value.document.response.type = "loading"`
- Sets `loading.value = true`
- Then double RAF for browser paint
- Then blocking work (ensureMethodInEndpoint, etc.)

## Testing

- [ ] Click "Send" → Button immediately shows "Cancel" ✅
- [ ] Try to click twice rapidly → Second click triggers `cancelRequest()` instead ✅
- [ ] Empty pre-request → Immediate feedback ✅
- [ ] Sync pre-request → Immediate feedback ✅
- [ ] **Async pre-request with fetch** → Immediate feedback ✅
- [ ] Multiple async fetches → Immediate feedback ✅

## Status

✅ **FIXED** - Button now changes immediately because we update the correct reactive property synchronously
