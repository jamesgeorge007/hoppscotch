import * as E from "fp-ts/Either"
import type { HoppFetchHook, FetchCallMeta } from "@hoppscotch/js-sandbox"
import type { KernelInterceptorService } from "~/services/kernel-interceptor.service"
import type { RelayRequest } from "@hoppscotch/kernel"

/**
 * Creates a hopp.fetch() hook implementation for the web app.
 * Routes fetch requests through the KernelInterceptorService to respect
 * user's interceptor preference (browser/proxy/extension/native).
 *
 * @param kernelInterceptor - The kernel interceptor service instance
 * @param onFetchCall - Optional callback to track fetch calls for inspector warnings
 * @returns HoppFetchHook implementation
 */
export const createHoppFetchHook = (
  kernelInterceptor: KernelInterceptorService,
  onFetchCall?: (meta: FetchCallMeta) => void
): HoppFetchHook => {
  return async (input, init) => {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const method = (init?.method || "GET").toUpperCase()

    // Track the fetch call for inspector warnings
    onFetchCall?.({
      url: urlStr,
      method,
      timestamp: Date.now(),
    })

    // Convert Fetch API request to RelayRequest
    const relayRequest = await convertFetchToRelayRequest(input, init)

    // Execute via interceptor
    const execution = kernelInterceptor.execute(relayRequest)
    const result = await execution.response

    if (E.isLeft(result)) {
      const error = result.left

      const errorMessage =
        typeof error === "string"
          ? error
          : typeof error === "object" && error !== null && "humanMessage" in error
            ? typeof error.humanMessage.heading === "function"
              ? error.humanMessage.heading(() => "Unknown error")
              : "Unknown error"
            : "Unknown error"
      throw new Error(`Fetch failed: ${errorMessage}`)
    }

    // Convert RelayResponse to serializable Response-like object
    // CRITICAL: Cannot return native Response - it cannot cross QuickJS boundary
    // Native Response has internal state that becomes invalid after cage disposal
    return convertRelayResponseToSerializableResponse(result.right)
  }
}

/**
 * Converts Fetch API request to RelayRequest format
 */
async function convertFetchToRelayRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<RelayRequest> {
  const urlStr =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url
  const method = (init?.method || "GET").toUpperCase() as RelayRequest["method"]

  // Convert headers
  const headers: Record<string, string> = {}
  if (init?.headers) {
    const headersObj =
      init.headers instanceof Headers
        ? init.headers
        : new Headers(init.headers)

    headersObj.forEach((value, key) => {
      headers[key] = value
    })
  }

  // Handle body based on type
  let content: RelayRequest["content"] | undefined

  if (init?.body) {
    if (typeof init.body === "string") {
      // Text/JSON body - use proper ContentType structure
      // Case-insensitive header lookup (Headers API normalizes to lowercase)
      const mediaType = headers["content-type"] || headers["Content-Type"] || "text/plain"

      // Use "text" kind for string bodies - Axios will handle it correctly
      content = {
        kind: "text",
        content: init.body,
        mediaType,
      }
    } else if (init.body instanceof FormData) {
      // FormData - convert to multipart using proper ContentType structure
      content = {
        kind: "multipart",
        content: init.body,
        mediaType: "multipart/form-data",
      }
    } else if (init.body instanceof Blob) {
      // Blob/File - convert to binary using proper ContentType structure
      const arrayBuffer = await init.body.arrayBuffer()
      content = {
        kind: "binary",
        content: new Uint8Array(arrayBuffer),
        mediaType: init.body.type || "application/octet-stream",
      }
    } else if (init.body instanceof ArrayBuffer) {
      // Raw binary using proper ContentType structure
      content = {
        kind: "binary",
        content: new Uint8Array(init.body),
        mediaType: "application/octet-stream",
      }
    } else if (ArrayBuffer.isView(init.body)) {
      // Typed array using proper ContentType structure
      content = {
        kind: "binary",
        content: new Uint8Array(
          init.body.buffer,
          init.body.byteOffset,
          init.body.byteLength
        ),
        mediaType: "application/octet-stream",
      }
    }
  }

  const relayRequest = {
    id: Math.floor(Math.random() * 1000000), // Random ID for tracking
    url: urlStr,
    method,
    version: "HTTP/1.1", // HTTP version
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    params: undefined, // Undefined so preProcessRelayRequest doesn't try to process it
    auth: { kind: "none" }, // Required field - no auth for fetch()
    content,
    // Note: auth, proxy, security are inherited from interceptor configuration
  }

  return relayRequest
}

/**
 * Converts RelayResponse to a serializable Response-like object.
 *
 * CRITICAL: We cannot return a native Response object because:
 * 1. Native Response has internal C++ state that cannot be cloned
 * 2. When passed to QuickJS, it becomes a proxy that dies when cage ends
 * 3. User scripts access Response after async operations complete
 *
 * Solution: Create a plain object that implements the Response interface
 * with all data eagerly loaded and serializable.
 */
function convertRelayResponseToSerializableResponse(
  relayResponse: any
): Response {
  const status = relayResponse.status || 200
  const statusText = relayResponse.statusText || ""
  const ok = status >= 200 && status < 300

  // Convert headers to plain object (serializable)
  const headersObj: Record<string, string> = {}
  if (relayResponse.headers) {
    Object.entries(relayResponse.headers).forEach(([key, value]) => {
      headersObj[key] = String(value)
    })
  }

  // Store body as array (serializable across QuickJS boundary)
  // RelayResponse has structure: {body: {body: Uint8Array, mediaType: string}, ...}
  // So we need to access the nested body property
  let bodyBytes: number[] = []

  // Extract the actual body data - it's nested inside relayResponse.body.body
  const actualBody = relayResponse.body?.body || relayResponse.body

  if (actualBody) {
    if (Array.isArray(actualBody)) {
      // Already an array
      bodyBytes = actualBody
    } else if (actualBody instanceof ArrayBuffer) {
      // ArrayBuffer (used by Agent interceptor) - convert to plain array
      bodyBytes = Array.from(new Uint8Array(actualBody))
    } else if (actualBody instanceof Uint8Array) {
      // Uint8Array - convert to plain array
      bodyBytes = Array.from(actualBody)
    } else if (ArrayBuffer.isView(actualBody)) {
      // Other typed array
      bodyBytes = Array.from(new Uint8Array(actualBody.buffer))
    } else if (typeof actualBody === 'object') {
      // Check if it's a Buffer-like object with 'type' and 'data' properties
      if ('type' in actualBody && 'data' in actualBody) {
        // This is likely a serialized Buffer: {type: 'Buffer', data: [1,2,3,...]}
        if (Array.isArray(actualBody.data)) {
          bodyBytes = actualBody.data
        }
      } else {
        // Plain object with numeric keys (like {0: 72, 1: 101, ...})
        const keys = Object.keys(actualBody).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b)
        bodyBytes = keys.map(k => actualBody[k])
      }
    }
  }

  // Create Response-like object with all methods implemented using stored data
  const serializableResponse = {
    status,
    statusText,
    ok,
    // Store raw headers data for custom-fetch to use
    _headersData: headersObj,
    headers: {
      get(name: string): string | null {
        // Case-insensitive header lookup
        const lowerName = name.toLowerCase()
        for (const [key, value] of Object.entries(headersObj)) {
          if (key.toLowerCase() === lowerName) {
            return value
          }
        }
        return null
      },
      has(name: string): boolean {
        return this.get(name) !== null
      },
      entries(): IterableIterator<[string, string]> {
        return Object.entries(headersObj)[Symbol.iterator]()
      },
      keys(): IterableIterator<string> {
        return Object.keys(headersObj)[Symbol.iterator]()
      },
      values(): IterableIterator<string> {
        return Object.values(headersObj)[Symbol.iterator]()
      },
      forEach(callback: (value: string, key: string) => void) {
        Object.entries(headersObj).forEach(([key, value]) => callback(value, key))
      },
    },
    _bodyBytes: bodyBytes,

    // Body methods - will be overridden by custom fetch module with VM-native versions
    async text(): Promise<string> {
      return new TextDecoder().decode(new Uint8Array(bodyBytes))
    },

    async json(): Promise<any> {
      const text = await this.text()
      return JSON.parse(text)
    },

    async arrayBuffer(): Promise<ArrayBuffer> {
      return new Uint8Array(bodyBytes).buffer
    },

    async blob(): Promise<Blob> {
      return new Blob([new Uint8Array(bodyBytes)])
    },

    // Required Response properties
    type: "basic" as ResponseType,
    url: "",
    redirected: false,
    bodyUsed: false,
  }

  // Cast to Response for type compatibility
  return serializableResponse as unknown as Response
}
