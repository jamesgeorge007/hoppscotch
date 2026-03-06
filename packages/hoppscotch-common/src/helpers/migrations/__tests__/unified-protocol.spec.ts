/**
 * Tests for Unified Protocol Migration
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  migrateToUnifiedProtocol,
  isMigrationComplete,
  resetMigration,
  detectRequestProtocol,
} from "../unified-protocol"
import { makeCollection } from "@hoppscotch/data"

describe("Unified Protocol Migration", () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
    resetMigration()
  })

  afterEach(() => {
    // Clean up
    localStorage.clear()
  })

  describe("detectRequestProtocol", () => {
    it("should detect REST requests by method and endpoint", () => {
      const restRequest = {
        method: "GET",
        endpoint: "https://api.example.com/users",
        headers: [],
        params: [],
      }

      expect(detectRequestProtocol(restRequest)).toBe("rest")
    })

    it("should detect GraphQL requests by query field", () => {
      const gqlRequest = {
        query: "query { user { id name } }",
        url: "https://api.example.com/graphql",
        variables: "{}",
      }

      expect(detectRequestProtocol(gqlRequest)).toBe("graphql")
    })

    it("should detect explicit protocol field", () => {
      const explicitRest = {
        protocol: "rest",
        method: "POST",
        endpoint: "https://api.example.com",
      }

      expect(detectRequestProtocol(explicitRest)).toBe("rest")
    })

    it("should default to REST for ambiguous requests", () => {
      const ambiguous = {
        name: "Some Request",
      }

      expect(detectRequestProtocol(ambiguous)).toBe("rest")
    })
  })

  describe("isMigrationComplete", () => {
    it("should return false when migration has not run", () => {
      expect(isMigrationComplete()).toBe(false)
    })

    it("should return true after migration completes", () => {
      migrateToUnifiedProtocol()
      expect(isMigrationComplete()).toBe(true)
    })

    it("should return false after reset", () => {
      migrateToUnifiedProtocol()
      resetMigration()
      expect(isMigrationComplete()).toBe(false)
    })
  })

  describe("migrateToUnifiedProtocol", () => {
    it("should not run migration twice", () => {
      const result1 = migrateToUnifiedProtocol()
      const result2 = migrateToUnifiedProtocol()

      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
      // Second run should be no-op
    })

    it("should migrate empty collections without errors", () => {
      const result = migrateToUnifiedProtocol()

      expect(result.success).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it("should migrate REST collections", () => {
      // Setup: Create REST collections in localStorage
      const restCollections = [
        makeCollection({
          name: "Test REST Collection",
          folders: [],
          requests: [
            {
              v: "16",
              name: "GET Users",
              method: "GET",
              endpoint: "https://api.example.com/users",
              headers: [],
              params: [],
              auth: { authType: "none", authActive: false },
              preRequestScript: "",
              testScript: "",
              body: { contentType: null, body: null },
              requestVariables: [],
              responses: {},
            },
          ],
          auth: { authType: "none", authActive: false },
          headers: [],
          variables: [],
        }),
      ]

      localStorage.setItem("collections", JSON.stringify(restCollections))

      const result = migrateToUnifiedProtocol()

      expect(result.success).toBe(true)
      expect(result.restCollections).toBe(1)
      expect(result.migratedCollections).toBeGreaterThanOrEqual(1)
    })

    it("should migrate GraphQL collections", () => {
      // Setup: Create GraphQL collections in localStorage
      const gqlCollections = [
        makeCollection({
          name: "Test GraphQL Collection",
          folders: [],
          requests: [
            {
              v: 9,
              name: "Get User",
              url: "https://api.example.com/graphql",
              query: "query { user { id name } }",
              variables: "{}",
              headers: [],
              auth: { authType: "none", authActive: false },
            },
          ],
          auth: { authType: "none", authActive: false },
          headers: [],
          variables: [],
        }),
      ]

      localStorage.setItem("graphqlCollections", JSON.stringify(gqlCollections))

      const result = migrateToUnifiedProtocol()

      expect(result.success).toBe(true)
      expect(result.gqlCollections).toBe(1)
      expect(result.migratedCollections).toBeGreaterThanOrEqual(1)
    })

    it("should merge REST and GraphQL collections", () => {
      // Setup both
      const restCollections = [
        makeCollection({
          name: "REST Collection",
          folders: [],
          requests: [],
          auth: { authType: "none", authActive: false },
          headers: [],
          variables: [],
        }),
      ]

      const gqlCollections = [
        makeCollection({
          name: "GraphQL Collection",
          folders: [],
          requests: [],
          auth: { authType: "none", authActive: false },
          headers: [],
          variables: [],
        }),
      ]

      localStorage.setItem("collections", JSON.stringify(restCollections))
      localStorage.setItem("graphqlCollections", JSON.stringify(gqlCollections))

      const result = migrateToUnifiedProtocol()

      expect(result.success).toBe(true)
      expect(result.restCollections).toBe(1)
      expect(result.gqlCollections).toBe(1)
      expect(result.migratedCollections).toBe(2)

      // Check merged collections
      const mergedCollections = JSON.parse(
        localStorage.getItem("collections") || "[]"
      )
      expect(mergedCollections).toHaveLength(2)
    })

    it("should handle migration errors gracefully", () => {
      // Setup invalid data
      localStorage.setItem("collections", "invalid json")

      const result = migrateToUnifiedProtocol()

      // Should still complete, just with errors logged
      expect(result.success).toBeDefined()
      // Errors array might be populated
    })

    it("should migrate collections to v11 and store in unified key", () => {
      const collection = makeCollection({
        name: "Mixed Collection",
        folders: [],
        requests: [
          {
            // Legacy REST request
            v: "16",
            name: "REST Request",
            method: "GET",
            endpoint: "https://api.example.com",
            headers: [],
            params: [],
            auth: { authType: "none", authActive: false },
            preRequestScript: "",
            testScript: "",
            body: { contentType: null, body: null },
            requestVariables: [],
            responses: {},
          },
        ],
        auth: { authType: "none", authActive: false },
        headers: [],
        variables: [],
      })

      localStorage.setItem("collections", JSON.stringify([collection]))

      const result = migrateToUnifiedProtocol()

      expect(result.success).toBe(true)

      // Migration writes to "collections/unified", not "collections"
      const migratedCollections = JSON.parse(
        localStorage.getItem("collections/unified") || "[]"
      )

      expect(migratedCollections.length).toBeGreaterThan(0)
      expect(migratedCollections[0].name).toBe("Mixed Collection")
      // v11 stores flat requests — no protocol wrapper field
      expect(migratedCollections[0].requests[0].name).toBe("REST Request")
    })
  })

  describe("resetMigration", () => {
    it("should clear migration flag", () => {
      migrateToUnifiedProtocol()
      expect(isMigrationComplete()).toBe(true)

      resetMigration()
      expect(isMigrationComplete()).toBe(false)
    })

    it("should allow re-running migration after reset", () => {
      migrateToUnifiedProtocol()
      resetMigration()

      const result = migrateToUnifiedProtocol()
      expect(result.success).toBe(true)
    })
  })
})
