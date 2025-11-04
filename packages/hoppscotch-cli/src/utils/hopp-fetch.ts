import axios, { AxiosRequestConfig, Method } from "axios"
import type { HoppFetchHook } from "@hoppscotch/js-sandbox"

/**
 * Creates a hopp.fetch() hook implementation for CLI.
 * Uses axios directly for network requests since CLI has no interceptor concept.
 *
 * @returns HoppFetchHook implementation
 */
export const createHoppFetchHook = (): HoppFetchHook => {
  return async (input, init) => {
    const urlStr = typeof input === "string" ? input : input.url

    // Convert Fetch API options to axios config
    const config: AxiosRequestConfig = {
      url: urlStr,
      method: (init?.method || "GET") as Method,
      headers: init?.headers ? headersToObject(init.headers) : {},
      data: init?.body,
      responseType: "arraybuffer", // For binary safety
      validateStatus: () => true, // Don't throw on any status code
    }

    try {
      const axiosResponse = await axios(config)

      // Convert axios response to Fetch Response
      const headers = new Headers()
      Object.entries(axiosResponse.headers).forEach(([key, value]) => {
        if (value !== undefined) {
          headers.set(key, Array.isArray(value) ? value.join(", ") : String(value))
        }
      })

      return new Response(axiosResponse.data, {
        status: axiosResponse.status,
        statusText: axiosResponse.statusText,
        headers,
      })
    } catch (error) {
      // Handle axios errors
      if (axios.isAxiosError(error) && error.response) {
        // Return error response as Response object
        const headers = new Headers()
        Object.entries(error.response.headers).forEach(([key, value]) => {
          if (value !== undefined) {
            headers.set(key, String(value))
          }
        })

        return new Response(error.response.data, {
          status: error.response.status,
          statusText: error.response.statusText,
          headers,
        })
      }

      // Network error or other failure
      throw new Error(
        `Fetch failed: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }
}

/**
 * Converts Fetch API headers to plain object for axios
 */
function headersToObject(
  headers: HeadersInit
): Record<string, string> {
  const result: Record<string, string> = {}

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key] = value
    })
  } else if (Array.isArray(headers)) {
    headers.forEach(([key, value]) => {
      result[key] = value
    })
  } else {
    Object.entries(headers).forEach(([key, value]) => {
      result[key] = value
    })
  }

  return result
}
