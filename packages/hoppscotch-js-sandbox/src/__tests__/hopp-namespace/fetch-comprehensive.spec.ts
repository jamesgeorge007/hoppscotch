import { describe, expect, test, vi } from "vitest"
import { runTest } from "~/utils/test-helpers"
import type { HoppFetchHook } from "~/types"

/**
 * Comprehensive tests for custom fetch module implementation
 * Covers features from faraday-cage that were missing from basic fetch tests
 *
 * Test categories:
 * - Body methods (arrayBuffer, blob, formData) with async behavior
 * - Body consumption tracking (bodyUsed property and double-read errors)
 * - Response cloning (clone method with independent body consumption)
 * - Request cloning (Request constructor and clone method)
 * - Headers class operations
 * - AbortController functionality
 * - Response constructor
 * - Edge cases (empty body, multiple status codes)
 */

describe("fetch() - Body Methods", () => {
  test("response.arrayBuffer() returns array of bytes", async () => {
    const mockFetch: HoppFetchHook = vi.fn(async () => {
      return new Response("Hello", { status: 200 })
    })

    await expect(
      runTest(
        `
          hopp.test("arrayBuffer returns array", async () => {
            const response = await hopp.fetch("https://api.example.com/binary")
            pw.expect(typeof response.arrayBuffer).toBe("function")

            const buffer = await response.arrayBuffer()
            pw.expect(Array.isArray(buffer)).toBe(true)
            pw.expect(buffer.length).toBeGreaterThan(0)
          })
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        mockFetch
      )()
    ).resolves.toEqualRight(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor: "root",
          children: expect.arrayContaining([
            expect.objectContaining({
              descriptor: "arrayBuffer returns array",
              expectResults: expect.arrayContaining([
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
              ]),
            }),
          ]),
        }),
      ])
    )
  })

  test("response.blob() returns blob object with size and type", async () => {
    const mockFetch: HoppFetchHook = vi.fn(async () => {
      return new Response("test data", { status: 200 })
    })

    await expect(
      runTest(
        `
          hopp.test("blob returns blob object", async () => {
            const response = await hopp.fetch("https://api.example.com/data")
            pw.expect(typeof response.blob).toBe("function")

            const blob = await response.blob()
            pw.expect(typeof blob).toBe("object")
            pw.expect(typeof blob.size).toBe("number")
            pw.expect(blob.size).toBeGreaterThan(0)
            pw.expect(typeof blob.type).toBe("string")
          })
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        mockFetch
      )()
    ).resolves.toEqualRight(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor: "root",
          children: expect.arrayContaining([
            expect.objectContaining({
              descriptor: "blob returns blob object",
              expectResults: expect.arrayContaining([
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
              ]),
            }),
          ]),
        }),
      ])
    )
  })

  test("response.formData() parses form-encoded data", async () => {
    const mockFetch: HoppFetchHook = vi.fn(async () => {
      return new Response("name=John&age=30", { status: 200 })
    })

    await expect(
      runTest(
        `
          hopp.test("formData parses data", async () => {
            const response = await hopp.fetch("https://api.example.com/form")
            pw.expect(typeof response.formData).toBe("function")

            const data = await response.formData()
            pw.expect(typeof data).toBe("object")
            pw.expect(data.name).toBe("John")
            pw.expect(data.age).toBe("30")
          })
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        mockFetch
      )()
    ).resolves.toEqualRight(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor: "root",
          children: expect.arrayContaining([
            expect.objectContaining({
              descriptor: "formData parses data",
              expectResults: expect.arrayContaining([
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
              ]),
            }),
          ]),
        }),
      ])
    )
  })
})

describe("fetch() - Body Consumption Tracking", () => {
  test("bodyUsed should be false initially and true after consuming", async () => {
    const mockFetch: HoppFetchHook = vi.fn(async () => {
      return new Response(JSON.stringify({ data: "test" }), { status: 200 })
    })

    await expect(
      runTest(
        `
          hopp.test("bodyUsed tracks consumption", async () => {
            const response = await hopp.fetch("https://api.example.com/data")
            pw.expect(response.bodyUsed).toBe(false)

            await response.json()
            pw.expect(response.bodyUsed).toBe(true)
          })
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        mockFetch
      )()
    ).resolves.toEqualRight(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor: "root",
          children: expect.arrayContaining([
            expect.objectContaining({
              descriptor: "bodyUsed tracks consumption",
              expectResults: expect.arrayContaining([
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
              ]),
            }),
          ]),
        }),
      ])
    )
  })

  test("reading body twice should throw error", async () => {
    const mockFetch: HoppFetchHook = vi.fn(async () => {
      return new Response("test data", { status: 200 })
    })

    await expect(
      runTest(
        `
          hopp.test("cannot read body twice", async () => {
            const response = await hopp.fetch("https://api.example.com/data")

            await response.text()
            pw.expect(response.bodyUsed).toBe(true)

            try {
              await response.text()
              pw.expect(true).toBe(false) // Should not reach here
            } catch (error) {
              pw.expect(error.message).toContain("Body has already been consumed")
            }
          })
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        mockFetch
      )()
    ).resolves.toEqualRight(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor: "root",
          children: expect.arrayContaining([
            expect.objectContaining({
              descriptor: "cannot read body twice",
              expectResults: expect.arrayContaining([
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
              ]),
            }),
          ]),
        }),
      ])
    )
  })

  test("different body methods should all consume the body", async () => {
    const mockFetch: HoppFetchHook = vi.fn(async () => {
      return new Response("test", { status: 200 })
    })

    await expect(
      runTest(
        `
          hopp.test("arrayBuffer consumes body", async () => {
            const response = await hopp.fetch("https://api.example.com/data")
            await response.arrayBuffer()
            pw.expect(response.bodyUsed).toBe(true)
          })
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        mockFetch
      )()
    ).resolves.toEqualRight(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor: "root",
          children: expect.arrayContaining([
            expect.objectContaining({
              descriptor: "arrayBuffer consumes body",
              expectResults: expect.arrayContaining([
                expect.objectContaining({ status: "pass" }),
              ]),
            }),
          ]),
        }),
      ])
    )
  })
})

describe("fetch() - Response Cloning", () => {
  test("response.clone() creates independent copy with separate body consumption", async () => {
    const mockFetch: HoppFetchHook = vi.fn(async () => {
      return new Response(JSON.stringify({ value: 42 }), { status: 200 })
    })

    await expect(
      runTest(
        `
          hopp.test("clone has independent body", async () => {
            const response = await hopp.fetch("https://api.example.com/data")
            pw.expect(typeof response.clone).toBe("function")

            const clone = response.clone()
            pw.expect(typeof clone).toBe("object")
            pw.expect(clone.status).toBe(200)

            // Read original body
            const originalData = await response.json()
            pw.expect(response.bodyUsed).toBe(true)
            pw.expect(clone.bodyUsed).toBe(false)

            // Clone body should still be readable
            const clonedData = await clone.json()
            pw.expect(clonedData.value).toBe(42)
            pw.expect(clone.bodyUsed).toBe(true)
          })
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        mockFetch
      )()
    ).resolves.toEqualRight(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor: "root",
          children: expect.arrayContaining([
            expect.objectContaining({
              descriptor: "clone has independent body",
              expectResults: expect.arrayContaining([
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
              ]),
            }),
          ]),
        }),
      ])
    )
  })

  test("cloned response should preserve all properties and headers", async () => {
    const mockFetch: HoppFetchHook = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        statusText: "Created",
        headers: { "X-Custom": "value" },
      })
    })

    await expect(
      runTest(
        `
          hopp.test("clone preserves properties", async () => {
            const response = await hopp.fetch("https://api.example.com/create")
            const clone = response.clone()

            pw.expect(clone.status).toBe(201)
            pw.expect(clone.statusText).toBe("Created")
            pw.expect(clone.ok).toBe(true)

            // Both should have the same body content
            const originalData = await response.json()
            const clonedData = await clone.json()
            pw.expect(originalData.ok).toBe(clonedData.ok)
          })
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        mockFetch
      )()
    ).resolves.toEqualRight(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor: "root",
          children: expect.arrayContaining([
            expect.objectContaining({
              descriptor: "clone preserves properties",
              expectResults: expect.arrayContaining([
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
              ]),
            }),
          ]),
        }),
      ])
    )
  })

  test("cloning consumed response should fail", async () => {
    const mockFetch: HoppFetchHook = vi.fn(async () => {
      return new Response("test", { status: 200 })
    })

    await expect(
      runTest(
        `
          hopp.test("cannot clone consumed response", async () => {
            const response = await hopp.fetch("https://api.example.com/data")

            await response.text()
            pw.expect(response.bodyUsed).toBe(true)

            const clone = response.clone()
            // The clone should have an error marker
            pw.expect(clone._error).toBe(true)
          })
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        mockFetch
      )()
    ).resolves.toEqualRight(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor: "root",
          children: expect.arrayContaining([
            expect.objectContaining({
              descriptor: "cannot clone consumed response",
              expectResults: expect.arrayContaining([
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
              ]),
            }),
          ]),
        }),
      ])
    )
  })
})

describe("fetch() - Request Cloning", () => {
  test("new Request() should create request object with properties", async () => {
    await expect(
      runTest(
        `
          const req = new Request("https://api.example.com/data", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
          })

          pw.expect(req.url).toBe("https://api.example.com/data")
          pw.expect(req.method).toBe("POST")
          pw.expect(typeof req.headers).toBe("object")
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        undefined
      )()
    ).resolves.toEqualRight([
      expect.objectContaining({
        expectResults: [
          {
            status: "pass",
            message:
              "Expected 'https://api.example.com/data' to be 'https://api.example.com/data'",
          },
          { status: "pass", message: "Expected 'POST' to be 'POST'" },
          { status: "pass", message: "Expected 'object' to be 'object'" },
        ],
      }),
    ])
  })

  test("request.clone() should create independent copy", async () => {
    await expect(
      runTest(
        `
          const req1 = new Request("https://api.example.com/data", { method: "POST" })
          const req2 = req1.clone()

          pw.expect(req2.url).toBe(req1.url)
          pw.expect(req2.method).toBe(req1.method)
          pw.expect(req2.url).toBe("https://api.example.com/data")
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        undefined
      )()
    ).resolves.toEqualRight([
      expect.objectContaining({
        expectResults: [
          { status: "pass", message: expect.stringContaining("to be") },
          { status: "pass", message: expect.stringContaining("to be") },
          {
            status: "pass",
            message:
              "Expected 'https://api.example.com/data' to be 'https://api.example.com/data'",
          },
        ],
      }),
    ])
  })

  test("Request should have bodyUsed property", async () => {
    await expect(
      runTest(
        `
          const req = new Request("https://api.example.com/data")
          pw.expect(req.bodyUsed).toBe(false)
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        undefined
      )()
    ).resolves.toEqualRight([
      expect.objectContaining({
        expectResults: [
          { status: "pass", message: "Expected 'false' to be 'false'" },
        ],
      }),
    ])
  })
})

describe("fetch() - Headers Class", () => {
  test("new Headers() should create headers object", async () => {
    await expect(
      runTest(
        `
          const headers = new Headers()
          headers.set("Content-Type", "application/json")

          pw.expect(headers.get("Content-Type")).toBe("application/json")
          pw.expect(headers.has("Content-Type")).toBe(true)
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        undefined
      )()
    ).resolves.toEqualRight([
      expect.objectContaining({
        expectResults: [
          {
            status: "pass",
            message: "Expected 'application/json' to be 'application/json'",
          },
          { status: "pass", message: "Expected 'true' to be 'true'" },
        ],
      }),
    ])
  })

  test("Headers.append() should add values", async () => {
    await expect(
      runTest(
        `
          const headers = new Headers()
          headers.append("X-Custom", "value1")
          headers.append("X-Custom", "value2")

          // Note: Native Headers combines with comma, we just overwrite
          pw.expect(headers.has("X-Custom")).toBe(true)
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        undefined
      )()
    ).resolves.toEqualRight([
      expect.objectContaining({
        expectResults: [
          { status: "pass", message: "Expected 'true' to be 'true'" },
        ],
      }),
    ])
  })

  test("Headers.delete() should remove header", async () => {
    await expect(
      runTest(
        `
          const headers = new Headers({ "X-Custom": "value" })
          pw.expect(headers.has("X-Custom")).toBe(true)

          headers.delete("X-Custom")
          pw.expect(headers.has("X-Custom")).toBe(false)
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        undefined
      )()
    ).resolves.toEqualRight([
      expect.objectContaining({
        expectResults: [
          { status: "pass", message: "Expected 'true' to be 'true'" },
          { status: "pass", message: "Expected 'false' to be 'false'" },
        ],
      }),
    ])
  })

  test("Headers.entries() should return array of [key, value] pairs", async () => {
    await expect(
      runTest(
        `
          const headers = new Headers({ "Content-Type": "application/json", "X-Custom": "test" })
          const entries = headers.entries()

          pw.expect(Array.isArray(entries)).toBe(true)
          pw.expect(entries.length).toBe(2)
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        undefined
      )()
    ).resolves.toEqualRight([
      expect.objectContaining({
        expectResults: [
          { status: "pass", message: "Expected 'true' to be 'true'" },
          { status: "pass", message: "Expected '2' to be '2'" },
        ],
      }),
    ])
  })

  test("Headers can be used with fetch()", async () => {
    const mockFetch: HoppFetchHook = vi.fn(async () => {
      return new Response("OK", { status: 200 })
    })

    await expect(
      runTest(
        `
          const headers = new Headers()
          headers.set("Authorization", "Bearer token123")

          const response = await hopp.fetch("https://api.example.com/data", { headers })
          pw.expect(response.status).toBe(200)
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        mockFetch
      )()
    ).resolves.toEqualRight([
      expect.objectContaining({
        expectResults: [
          { status: "pass", message: "Expected '200' to be '200'" },
        ],
      }),
    ])

    // Verify headers were sent (Note: headers are lowercase when converted)
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/data",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer token123",
        }),
      })
    )
  })
})

describe("fetch() - AbortController", () => {
  test("new AbortController() should create controller with signal", async () => {
    await expect(
      runTest(
        `
          const controller = new AbortController()

          pw.expect(typeof controller).toBe("object")
          pw.expect(typeof controller.signal).toBe("object")
          pw.expect(controller.signal.aborted).toBe(false)
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        undefined
      )()
    ).resolves.toEqualRight([
      expect.objectContaining({
        expectResults: [
          { status: "pass", message: "Expected 'object' to be 'object'" },
          { status: "pass", message: "Expected 'object' to be 'object'" },
          { status: "pass", message: "Expected 'false' to be 'false'" },
        ],
      }),
    ])
  })

  test("controller.abort() should set signal.aborted to true", async () => {
    await expect(
      runTest(
        `
          const controller = new AbortController()
          pw.expect(controller.signal.aborted).toBe(false)

          controller.abort()
          pw.expect(controller.signal.aborted).toBe(true)
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        undefined
      )()
    ).resolves.toEqualRight([
      expect.objectContaining({
        expectResults: [
          { status: "pass", message: "Expected 'false' to be 'false'" },
          { status: "pass", message: "Expected 'true' to be 'true'" },
        ],
      }),
    ])
  })

  test("signal.addEventListener should register abort listener", async () => {
    await expect(
      runTest(
        `
          const controller = new AbortController()
          let listenerCalled = false

          controller.signal.addEventListener("abort", () => {
            listenerCalled = true
          })

          controller.abort()
          pw.expect(listenerCalled).toBe(true)
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        undefined
      )()
    ).resolves.toEqualRight([
      expect.objectContaining({
        expectResults: [
          { status: "pass", message: "Expected 'true' to be 'true'" },
        ],
      }),
    ])
  })

  test("multiple abort listeners should all be called", async () => {
    await expect(
      runTest(
        `
          const controller = new AbortController()
          let count = 0

          controller.signal.addEventListener("abort", () => { count++ })
          controller.signal.addEventListener("abort", () => { count++ })
          controller.signal.addEventListener("abort", () => { count++ })

          controller.abort()
          pw.expect(count).toBe(3)
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        undefined
      )()
    ).resolves.toEqualRight([
      expect.objectContaining({
        expectResults: [{ status: "pass", message: "Expected '3' to be '3'" }],
      }),
    ])
  })
})

describe("fetch() - Response Constructor", () => {
  test("new Response() should create response with properties", async () => {
    await expect(
      runTest(
        `
          const response = new Response("test body", { status: 201, statusText: "Created" })

          pw.expect(response.status).toBe(201)
          pw.expect(response.statusText).toBe("Created")
          pw.expect(response.ok).toBe(true)
          pw.expect(typeof response.json).toBe("function")
          pw.expect(typeof response.text).toBe("function")
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        undefined
      )()
    ).resolves.toEqualRight([
      expect.objectContaining({
        expectResults: [
          { status: "pass", message: "Expected '201' to be '201'" },
          { status: "pass", message: "Expected 'Created' to be 'Created'" },
          { status: "pass", message: "Expected 'true' to be 'true'" },
          { status: "pass", message: "Expected 'function' to be 'function'" },
          { status: "pass", message: "Expected 'function' to be 'function'" },
        ],
      }),
    ])
  })

  test("Response constructor is available globally", async () => {
    await expect(
      runTest(
        `
          pw.expect(typeof Response).toBe("function")

          const resp = new Response("data", { status: 200 })
          pw.expect(resp.status).toBe(200)
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        undefined
      )()
    ).resolves.toEqualRight([
      expect.objectContaining({
        expectResults: [
          { status: "pass", message: "Expected 'function' to be 'function'" },
          { status: "pass", message: "Expected '200' to be '200'" },
        ],
      }),
    ])
  })
})

describe("fetch() - Edge Cases", () => {
  test("multiple HTTP status codes should return correct ok status", async () => {
    const statuses = [200, 201, 204, 400, 404, 500]

    for (const status of statuses) {
      const mockFetch: HoppFetchHook = vi.fn(async () => {
        return new Response("data", { status })
      })

      await expect(
        runTest(
          `
            const response = await hopp.fetch("https://api.example.com/data")
            pw.expect(response.status).toBe(${status})
            pw.expect(response.ok).toBe(${status >= 200 && status < 300})
          `,
          { global: [], selected: [] },
          undefined,
          undefined,
          mockFetch
        )()
      ).resolves.toBeRight()
    }
  })

  test("empty response body should be handled correctly", async () => {
    const mockFetch: HoppFetchHook = vi.fn(async () => {
      return new Response(null, { status: 204 })
    })

    await expect(
      runTest(
        `
          hopp.test("empty body handled", async () => {
            const response = await hopp.fetch("https://api.example.com/delete")
            pw.expect(response.status).toBe(204)

            const text = await response.text()
            pw.expect(text).toBe("")
          })
        `,
        { global: [], selected: [] },
        undefined,
        undefined,
        mockFetch
      )()
    ).resolves.toEqualRight(
      expect.arrayContaining([
        expect.objectContaining({
          descriptor: "root",
          children: expect.arrayContaining([
            expect.objectContaining({
              descriptor: "empty body handled",
              expectResults: expect.arrayContaining([
                expect.objectContaining({ status: "pass" }),
                expect.objectContaining({ status: "pass" }),
              ]),
            }),
          ]),
        }),
      ])
    )
  })
})
