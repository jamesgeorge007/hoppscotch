import axios, { AxiosRequestConfig, Method } from "axios";
import type { HoppFetchHook } from "@hoppscotch/js-sandbox";

/**
 * Creates a hopp.fetch() hook implementation for CLI.
 * Uses axios directly for network requests since CLI has no interceptor concept.
 *
 * @returns HoppFetchHook implementation
 */
export const createHoppFetchHook = (): HoppFetchHook => {
  return async (input, init) => {
    const urlStr = typeof input === "string" ? input : input.url;

    // Convert Fetch API options to axios config
    const config: AxiosRequestConfig = {
      url: urlStr,
      method: (init?.method || "GET") as Method,
      headers: init?.headers ? headersToObject(init.headers) : {},
      data: init?.body,
      responseType: "arraybuffer", // For binary safety: Prevents corruption from string encoding/decoding
      validateStatus: () => true, // Don't throw on any status code
    };

    try {
      const axiosResponse = await axios(config);

      // Convert axios response to serializable response (with _bodyBytes)
      // CRITICAL: Cannot return native Response - it cannot cross QuickJS boundary
      return createSerializableResponse(
        axiosResponse.status,
        axiosResponse.statusText,
        axiosResponse.headers,
        axiosResponse.data
      );
    } catch (error) {
      // Handle axios errors
      if (axios.isAxiosError(error) && error.response) {
        // Return error response as serializable Response object
        return createSerializableResponse(
          error.response.status,
          error.response.statusText,
          error.response.headers,
          error.response.data
        );
      }

      // Network error or other failure
      throw new Error(
        `Fetch failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  };
};

/**
 * Creates a serializable Response-like object with _bodyBytes.
 *
 * CRITICAL: We cannot return a native Response object because:
 * 1. Native Response has internal C++ state that cannot be cloned
 * 2. When passed to QuickJS, it becomes a proxy that dies when cage ends
 * 3. User scripts access Response after async operations complete
 *
 * Solution: Create a plain object that implements the Response interface
 * with all data eagerly loaded and serializable.
 */
function createSerializableResponse(
  status: number,
  statusText: string,
  headers: any,
  body: any
): Response {
  const ok = status >= 200 && status < 300;

  // Convert headers to plain object (serializable)
  const headersObj: Record<string, string> = {};
  Object.entries(headers).forEach(([key, value]) => {
    if (value !== undefined) {
      headersObj[key] = Array.isArray(value) ? value.join(", ") : String(value);
    }
  });

  // Store body as number array (serializable across QuickJS boundary)
  let bodyBytes: number[] = [];

  if (body) {
    if (Array.isArray(body)) {
      // Already an array
      bodyBytes = body;
    } else if (body instanceof ArrayBuffer) {
      // ArrayBuffer (from axios) - convert to plain array
      bodyBytes = Array.from(new Uint8Array(body));
    } else if (body instanceof Uint8Array) {
      // Uint8Array - convert to plain array
      bodyBytes = Array.from(body);
    } else if (ArrayBuffer.isView(body)) {
      // Other typed array
      bodyBytes = Array.from(new Uint8Array(body.buffer));
    } else if (typeof body === "string") {
      // String body
      bodyBytes = Array.from(new TextEncoder().encode(body));
    } else if (typeof body === "object") {
      // Check if it's a Buffer-like object with 'type' and 'data' properties
      if ("type" in body && "data" in body && Array.isArray(body.data)) {
        bodyBytes = body.data;
      } else {
        // Plain object with numeric keys (like {0: 72, 1: 101, ...})
        const keys = Object.keys(body)
          .map(Number)
          .filter((n) => !isNaN(n))
          .sort((a, b) => a - b);
        bodyBytes = keys.map((k) => body[k]);
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
        const lowerName = name.toLowerCase();
        for (const [key, value] of Object.entries(headersObj)) {
          if (key.toLowerCase() === lowerName) {
            return value;
          }
        }
        return null;
      },
      has(name: string): boolean {
        return this.get(name) !== null;
      },
      entries(): IterableIterator<[string, string]> {
        return Object.entries(headersObj)[Symbol.iterator]();
      },
      keys(): IterableIterator<string> {
        return Object.keys(headersObj)[Symbol.iterator]();
      },
      values(): IterableIterator<string> {
        return Object.values(headersObj)[Symbol.iterator]();
      },
      forEach(callback: (value: string, key: string) => void) {
        Object.entries(headersObj).forEach(([key, value]) =>
          callback(value, key)
        );
      },
    },
    _bodyBytes: bodyBytes,

    // Body methods - will be overridden by custom fetch module with VM-native versions
    async text(): Promise<string> {
      return new TextDecoder().decode(new Uint8Array(bodyBytes));
    },

    async json(): Promise<any> {
      const text = await this.text();
      return JSON.parse(text);
    },

    async arrayBuffer(): Promise<ArrayBuffer> {
      return new Uint8Array(bodyBytes).buffer;
    },

    async blob(): Promise<Blob> {
      return new Blob([new Uint8Array(bodyBytes)]);
    },

    // Required Response properties
    type: "basic" as ResponseType,
    url: "",
    redirected: false,
    bodyUsed: false,
  };

  // Cast to Response for type compatibility
  return serializableResponse as unknown as Response;
}

/**
 * Converts Fetch API headers to plain object for axios
 */
function headersToObject(headers: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key] = value;
    });
  } else if (Array.isArray(headers)) {
    headers.forEach(([key, value]) => {
      result[key] = value;
    });
  } else {
    Object.entries(headers).forEach(([key, value]) => {
      result[key] = value;
    });
  }

  return result;
}
