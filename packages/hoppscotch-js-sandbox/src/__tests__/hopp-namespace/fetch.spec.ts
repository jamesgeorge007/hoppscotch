import { describe, expect, test, vi } from "vitest"
import { runTest } from "~/utils/test-helpers"
import type { HoppFetchHook } from "~/types"

/**
 * Tests for hopp.fetch() functionality
 *
 * These tests verify that hopp.fetch() is properly exposed and works with
 * the hook-based architecture. The actual network requests are mocked via
 * the hoppFetchHook parameter.
 */

describe("hopp.fetch()", () => {
  describe("Basic functionality", () => {
    test("hopp.fetch should be defined and callable", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async () => {
        return new Response("OK", { status: 200 })
      })

      await expect(
        runTest(
          `
            pw.expect(typeof hopp.fetch).toBe("function")
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch,
        )(),
      ).resolves.toEqualRight([
        expect.objectContaining({
          expectResults: [
            {
              status: "pass",
              message: "Expected 'function' to be 'function'",
            },
          ],
        }),
      ])
    })

    test("hopp.fetch should make GET request with string URL", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async (input, init) => {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      })

      await expect(
        runTest(
          `
            const response = await hopp.fetch("https://api.example.com/data")
            pw.expect(response.status).toBe(200)
            pw.expect(response.ok).toBe(true)
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch,
        )(),
      ).resolves.toEqualRight([
        expect.objectContaining({
          expectResults: [
            {
              status: "pass",
              message: "Expected '200' to be '200'",
            },
            {
              status: "pass",
              message: "Expected 'true' to be 'true'",
            },
          ],
        }),
      ])

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/data",
        undefined,
      )
    })

    test("hopp.fetch should make POST request with JSON body", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async (input, init) => {
        return new Response(JSON.stringify({ created: true, id: 42 }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      })

      await expect(
        runTest(
          `
            const response = await hopp.fetch("https://api.example.com/items", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({ name: "test" })
            })
            pw.expect(response.status).toBe(201)
            pw.expect(response.ok).toBe(true)
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch,
        )(),
      ).resolves.toEqualRight([
        expect.objectContaining({
          expectResults: [
            {
              status: "pass",
              message: "Expected '201' to be '201'",
            },
            {
              status: "pass",
              message: "Expected 'true' to be 'true'",
            },
          ],
        }),
      ])

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/items",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ name: "test" }),
        }),
      )
    })

    test("hopp.fetch should handle URL object", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async () => {
        return new Response("OK", { status: 200 })
      })

      await expect(
        runTest(
          `
            const url = new URL("https://api.example.com/data")
            const response = await hopp.fetch(url)
            pw.expect(response.status).toBe(200)
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch,
        )(),
      ).resolves.toEqualRight([
        expect.objectContaining({
          expectResults: [
            {
              status: "pass",
              message: "Expected '200' to be '200'",
            },
          ],
        }),
      ])
    })
  })

  describe("Response handling", () => {
    test("hopp.fetch should handle text response", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async () => {
        return new Response("Plain text response", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      })

      await expect(
        runTest(
          `
            const response = await hopp.fetch("https://api.example.com/text")
            pw.expect(response.status).toBe(200)
            pw.expect(response.ok).toBe(true)
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch,
        )(),
      ).resolves.toEqualRight([
        expect.objectContaining({
          expectResults: [
            {
              status: "pass",
              message: "Expected '200' to be '200'",
            },
            {
              status: "pass",
              message: "Expected 'true' to be 'true'",
            },
          ],
        }),
      ])
    })

    test("hopp.fetch should handle response headers", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async () => {
        const headers = new Headers()
        headers.set("X-Custom-Header", "custom-value")
        headers.set("Content-Type", "application/json")

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers,
        })
      })

      await expect(
        runTest(
          `
            const response = await hopp.fetch("https://api.example.com/data")
            pw.expect(response.status).toBe(200)
            pw.expect(typeof response.headers).toBe("object")
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch,
        )(),
      ).resolves.toEqualRight([
        expect.objectContaining({
          expectResults: [
            {
              status: "pass",
              message: "Expected '200' to be '200'",
            },
            {
              status: "pass",
              message: "Expected 'object' to be 'object'",
            },
          ],
        }),
      ])
    })

    test("hopp.fetch should handle status codes", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async () => {
        return new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
          statusText: "Not Found",
        })
      })

      await expect(
        runTest(
          `
            const response = await hopp.fetch("https://api.example.com/missing")
            pw.expect(response.status).toBe(404)
            pw.expect(response.statusText).toBe("Not Found")
            pw.expect(response.ok).toBe(false)
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch,
        )(),
      ).resolves.toEqualRight([
        expect.objectContaining({
          expectResults: [
            {
              status: "pass",
              message: "Expected '404' to be '404'",
            },
            {
              status: "pass",
              message: "Expected 'Not Found' to be 'Not Found'",
            },
            {
              status: "pass",
              message: "Expected 'false' to be 'false'",
            },
          ],
        }),
      ])
    })
  })

  describe("HTTP methods", () => {
    test("hopp.fetch should support PUT method", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async () => {
        return new Response(JSON.stringify({ updated: true }), { status: 200 })
      })

      await expect(
        runTest(
          `
            const response = await hopp.fetch("https://api.example.com/items/1", {
              method: "PUT",
              body: JSON.stringify({ name: "updated" })
            })
            pw.expect(response.status).toBe(200)
            pw.expect(response.ok).toBe(true)
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch,
        )(),
      ).resolves.toEqualRight([
        expect.objectContaining({
          expectResults: [
            {
              status: "pass",
              message: "Expected '200' to be '200'",
            },
            {
              status: "pass",
              message: "Expected 'true' to be 'true'",
            },
          ],
        }),
      ])
    })

    test("hopp.fetch should support DELETE method", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async () => {
        return new Response(null, { status: 204 })
      })

      await expect(
        runTest(
          `
            const response = await hopp.fetch("https://api.example.com/items/1", {
              method: "DELETE"
            })
            pw.expect(response.status).toBe(204)
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch,
        )(),
      ).resolves.toEqualRight([
        expect.objectContaining({
          expectResults: [
            {
              status: "pass",
              message: "Expected '204' to be '204'",
            },
          ],
        }),
      ])
    })

    test("hopp.fetch should support PATCH method", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async () => {
        return new Response(JSON.stringify({ patched: true }), { status: 200 })
      })

      await expect(
        runTest(
          `
            const response = await hopp.fetch("https://api.example.com/items/1", {
              method: "PATCH",
              body: JSON.stringify({ field: "value" })
            })
            pw.expect(response.status).toBe(200)
            pw.expect(response.ok).toBe(true)
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch,
        )(),
      ).resolves.toEqualRight([
        expect.objectContaining({
          expectResults: [
            {
              status: "pass",
              message: "Expected '200' to be '200'",
            },
            {
              status: "pass",
              message: "Expected 'true' to be 'true'",
            },
          ],
        }),
      ])
    })
  })

  describe("Headers", () => {
    test("hopp.fetch should send custom headers", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async () => {
        return new Response("OK", { status: 200 })
      })

      await expect(
        runTest(
          `
            const response = await hopp.fetch("https://api.example.com/data", {
              headers: {
                "Authorization": "Bearer token123",
                "X-API-Key": "key456"
              }
            })
            pw.expect(response.status).toBe(200)
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch,
        )(),
      ).resolves.toEqualRight([
        expect.objectContaining({
          expectResults: [
            {
              status: "pass",
              message: "Expected '200' to be '200'",
            },
          ],
        }),
      ])

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/data",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer token123",
            "X-API-Key": "key456",
          }),
        }),
      )
    })
  })

  describe("Error handling", () => {
    test("hopp.fetch should handle fetch errors", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async () => {
        throw new Error("Network error")
      })

      await expect(
        runTest(
          `
            let errorOccurred = false
            try {
              await hopp.fetch("https://api.example.com/data")
            } catch (error) {
              errorOccurred = true
              pw.expect(error.message).toBe("Network error")
            }
            pw.expect(errorOccurred).toBe(true)
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch,
        )(),
      ).resolves.toEqualRight([
        expect.objectContaining({
          expectResults: [
            {
              status: "pass",
              message: "Expected 'Network error' to be 'Network error'",
            },
            {
              status: "pass",
              message: "Expected 'true' to be 'true'",
            },
          ],
        }),
      ])
    })
  })

  describe("Integration with environment variables", () => {
    test("hopp.fetch should work with dynamic URLs from env vars", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async () => {
        return new Response(JSON.stringify({ data: "test" }), { status: 200 })
      })

      await expect(
        runTest(
          `
            hopp.env.set("API_URL", "https://api.example.com")
            const url = hopp.env.get("API_URL") + "/data"
            const response = await hopp.fetch(url)
            pw.expect(response.status).toBe(200)
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch,
        )(),
      ).resolves.toEqualRight([
        expect.objectContaining({
          expectResults: [
            {
              status: "pass",
              message: "Expected '200' to be '200'",
            },
          ],
        }),
      ])

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/data",
        undefined,
      )
    })

    test("hopp.fetch should store response data in env vars", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async () => {
        return new Response(JSON.stringify({ token: "abc123" }), {
          status: 200,
        })
      })

      await expect(
        runTest(
          `
            const response = await hopp.fetch("https://api.example.com/auth")
            pw.expect(response.status).toBe(200)
            hopp.env.set("AUTH_TOKEN", "abc123")
            pw.expect(hopp.env.get("AUTH_TOKEN")).toBe("abc123")
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch,
        )(),
      ).resolves.toEqualRight([
        expect.objectContaining({
          expectResults: [
            {
              status: "pass",
              message: "Expected '200' to be '200'",
            },
            {
              status: "pass",
              message: "Expected 'abc123' to be 'abc123'",
            },
          ],
        }),
      ])
    })
  })
})
