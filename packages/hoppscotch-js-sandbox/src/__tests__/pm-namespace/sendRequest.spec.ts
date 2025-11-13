import { describe, expect, test, vi } from "vitest"
import { runTest } from "~/utils/test-helpers"
import type { HoppFetchHook } from "~/types"

/**
 * Tests for pm.sendRequest() functionality
 *
 * NOTE: These unit tests validate API availability but have limited coverage
 * due to QuickJS async callback timing issues. Callback assertions don't
 * execute reliably in the test context.
 *
 * For production validation, see the comprehensive E2E tests in:
 * packages/hoppscotch-cli/src/__tests__/e2e/fixtures/collections/scripting-revamp-coll.json
 *
 * The E2E tests make real HTTP requests and fully validate:
 * - String URL format
 * - Request object format
 * - URL-encoded body
 * - Response format validation
 * - HTTP error status codes
 * - Environment variable integration
 * - Store response in environment
 */

describe("pm.sendRequest()", () => {
  describe("Basic functionality", () => {
    test("pm.sendRequest should be defined and callable", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async () => {
        return new Response("OK", { status: 200 })
      })

      await expect(
        runTest(
          `
            pm.expect(typeof pm.sendRequest).toBe("function")
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch
        )()
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

    test("pm.sendRequest accepts string URL and callback", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async () => {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "application/json" },
        })
      })

      await expect(
        runTest(
          `
            // pm.sendRequest is callable - full validation in E2E tests
            pm.expect(typeof pm.sendRequest).toBe("function")

            // Note: Callback execution isn't testable in QuickJS unit tests
            // due to event loop timing. See E2E tests for full validation.
            pm.sendRequest("https://api.example.com/data", (error, response) => {
              // This callback executes but assertions here don't work reliably
            })
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch
        )()
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
  })

  describe("Request object format", () => {
    test("pm.sendRequest accepts request object format", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async () => {
        return new Response(JSON.stringify({ created: true }), {
          status: 201,
          statusText: "Created",
          headers: { "Content-Type": "application/json" },
        })
      })

      await expect(
        runTest(
          `
            pm.expect(typeof pm.sendRequest).toBe("function")

            // Full validation in E2E tests
            pm.sendRequest({
              url: "https://api.example.com/items",
              method: "POST",
              header: [
                { key: "Content-Type", value: "application/json" }
              ],
              body: {
                mode: "raw",
                raw: JSON.stringify({ name: "test" })
              }
            }, (error, response) => {
              // Callback executes but isn't reliably testable in unit tests
            })
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch
        )()
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
  })

  describe("Body modes", () => {
    test("pm.sendRequest handles different body modes", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async () => {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      })

      await expect(
        runTest(
          `
            pm.expect(typeof pm.sendRequest).toBe("function")

            // Test raw body mode (full validation in E2E tests)
            pm.sendRequest({
              url: "https://api.example.com/items",
              method: "POST",
              body: {
                mode: "raw",
                raw: JSON.stringify({ name: "test item" })
              }
            }, (error, response) => {})

            // Test urlencoded body mode
            pm.sendRequest({
              url: "https://api.example.com/login",
              method: "POST",
              body: {
                mode: "urlencoded",
                urlencoded: [
                  { key: "username", value: "john" },
                  { key: "password", value: "secret123" }
                ]
              }
            }, (error, response) => {})
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch
        )()
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
  })

  describe("Integration with environment variables", () => {
    test("pm.sendRequest works with environment variables", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async () => {
        return new Response(JSON.stringify({ data: "test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      })

      await expect(
        runTest(
          `
            // Set environment variables
            pm.environment.set("API_URL", "https://api.example.com")
            pm.environment.set("AUTH_TOKEN", "Bearer token123")

            pm.expect(pm.environment.get("API_URL")).toBe("https://api.example.com")
            pm.expect(pm.environment.get("AUTH_TOKEN")).toBe("Bearer token123")

            // pm.sendRequest can use these (full validation in E2E tests)
            const url = pm.environment.get("API_URL") + "/data"
            const token = pm.environment.get("AUTH_TOKEN")

            pm.sendRequest({
              url: url,
              header: [
                { key: "Authorization", value: token }
              ]
            }, (error, response) => {})
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch
        )()
      ).resolves.toEqualRight([
        expect.objectContaining({
          expectResults: [
            {
              status: "pass",
              message:
                "Expected 'https://api.example.com' to be 'https://api.example.com'",
            },
            {
              status: "pass",
              message: "Expected 'Bearer token123' to be 'Bearer token123'",
            },
          ],
        }),
      ])
    })
  })

  describe("Documentation and E2E reference", () => {
    test("pm.sendRequest - see E2E tests for full validation", async () => {
      const mockFetch: HoppFetchHook = vi.fn(async () => {
        return new Response("OK", { status: 200 })
      })

      await expect(
        runTest(
          `
            // Unit tests validate API availability
            pm.expect(typeof pm.sendRequest).toBe("function")

            // For comprehensive validation including:
            // - Callback execution and response format
            // - HTTP methods (GET, POST, PUT, DELETE, PATCH)
            // - Body modes (raw, urlencoded, formdata)
            // - Error handling
            // - Response JSON parsing
            // - Multi-request workflows
            //
            // See E2E tests in:
            // packages/hoppscotch-cli/src/__tests__/e2e/fixtures/collections/scripting-revamp-coll.json
            //
            // Run with: pnpm --filter @hoppscotch/cli test:e2e
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch
        )()
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
  })
})
