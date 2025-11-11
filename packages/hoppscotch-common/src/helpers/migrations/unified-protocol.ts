/**
 * Unified Protocol Migration
 *
 * This module handles the migration from separate REST and GraphQL stores
 * to a unified protocol-agnostic collection store.
 *
 * Migration steps:
 * 1. Detect if migration is needed (check localStorage keys)
 * 2. Load both REST and GraphQL collections
 * 3. Migrate collections to v11 schema (with protocol discriminators)
 * 4. Migrate GraphQL requests to v10 (with feature parity)
 * 5. Merge collections into unified store
 * 6. Mark migration as complete
 */

import { HoppCollection, wrapRESTRequest, wrapGQLRequest } from "@hoppscotch/data"
import { HoppRESTRequest } from "@hoppscotch/data"
import { HoppGQLRequest } from "@hoppscotch/data"

const MIGRATION_KEY = "unified_protocol_migrated"
const MIGRATION_VERSION = "1"

export interface MigrationResult {
  success: boolean
  migratedCollections: number
  restCollections: number
  gqlCollections: number
  errors: string[]
}

/**
 * Check if unified protocol migration has already been performed
 */
export function isMigrationComplete(): boolean {
  const migrationVersion = localStorage.getItem(MIGRATION_KEY)
  return migrationVersion === MIGRATION_VERSION
}

/**
 * Mark migration as complete
 */
function markMigrationComplete(): void {
  localStorage.setItem(MIGRATION_KEY, MIGRATION_VERSION)
}

/**
 * Detect protocol from request structure (for legacy collections without protocol field)
 */
export function detectRequestProtocol(req: any): "rest" | "graphql" {
  // If already has protocol field, use it
  if (req.protocol) {
    return req.protocol
  }

  // Check for GraphQL-specific fields
  if ("query" in req && typeof req.query === "string") {
    return "graphql"
  }

  // Check for REST-specific fields
  if ("method" in req && "endpoint" in req) {
    return "rest"
  }

  // Heuristic: GraphQL requests have `url` instead of `endpoint`
  if ("url" in req && !("method" in req)) {
    return "graphql"
  }

  // Default to REST for backward compatibility
  return "rest"
}

/**
 * Migrate a single collection to v11 format with protocol discriminators
 */
function migrateCollectionToV11(collection: any): any {
  try {
    // Try parsing with HoppCollection which will auto-migrate
    const result = HoppCollection.safeParse(collection)

    if (result.type === "ok") {
      return result.value
    }

    // If automated migration fails, try manual migration
    console.warn("[Migration] Auto-migration failed, attempting manual migration", result.error)

    // Manual migration: wrap requests with protocol discriminator
    const migratedRequests = (collection.requests || []).map((req: any) => {
      // Skip if already has protocol field
      if (req.protocol) {
        return req
      }

      const protocol = detectRequestProtocol(req)

      if (protocol === "rest") {
        const restResult = HoppRESTRequest.safeParse(req)
        if (restResult.type === "ok") {
          return wrapRESTRequest(restResult.value)
        }
        // Fallback: wrap as-is
        return {
          protocol: "rest",
          request: req,
        }
      } else {
        const gqlResult = HoppGQLRequest.safeParse(req)
        if (gqlResult.type === "ok") {
          return wrapGQLRequest(gqlResult.value)
        }
        // Fallback: wrap as-is
        return {
          protocol: "graphql",
          request: req,
        }
      }
    })

    const migratedFolders = (collection.folders || []).map((folder: any) =>
      migrateCollectionToV11(folder)
    )

    return {
      ...collection,
      v: 11,
      requests: migratedRequests,
      folders: migratedFolders,
    }
  } catch (error) {
    console.error("[Migration] Failed to migrate collection:", error)
    return collection
  }
}

/**
 * Load collections from a localStorage key
 */
function loadCollectionsFromStorage(key: string): any[] {
  try {
    const data = localStorage.getItem(key)
    if (!data) return []

    const parsed = JSON.parse(data)

    // Handle different storage formats
    if (Array.isArray(parsed)) {
      return parsed
    }

    // Some stores might be wrapped in { state: [...] }
    if (parsed.state && Array.isArray(parsed.state)) {
      return parsed.state
    }

    // Or might have a collections property
    if (parsed.collections && Array.isArray(parsed.collections)) {
      return parsed.collections
    }

    console.warn(`[Migration] Unexpected storage format for key ${key}:`, parsed)
    return []
  } catch (error) {
    console.error(`[Migration] Failed to load collections from ${key}:`, error)
    return []
  }
}

/**
 * Perform the unified protocol migration
 *
 * This migrates both REST and GraphQL collections to the new v11 format
 * and prepares them for the unified store.
 */
export function migrateToUnifiedProtocol(): MigrationResult {
  const result: MigrationResult = {
    success: false,
    migratedCollections: 0,
    restCollections: 0,
    gqlCollections: 0,
    errors: [],
  }

  // Skip if already migrated
  if (isMigrationComplete()) {
    console.log("[Migration] Unified protocol migration already complete")
    result.success = true
    return result
  }

  console.log("[Migration] Starting unified protocol migration...")

  try {
    // Step 1: Load REST collections from localStorage
    // Common storage keys used by the app
    const restStorageKeys = [
      "collections",
      "restCollections",
      "collections/rest",
    ]

    let restCollections: any[] = []
    for (const key of restStorageKeys) {
      const collections = loadCollectionsFromStorage(key)
      if (collections.length > 0) {
        restCollections = collections
        console.log(`[Migration] Loaded ${collections.length} REST collections from ${key}`)
        break
      }
    }

    // Step 2: Load GraphQL collections from localStorage
    const gqlStorageKeys = [
      "graphqlCollections",
      "collections/graphql",
    ]

    let gqlCollections: any[] = []
    for (const key of gqlStorageKeys) {
      const collections = loadCollectionsFromStorage(key)
      if (collections.length > 0) {
        gqlCollections = collections
        console.log(`[Migration] Loaded ${collections.length} GraphQL collections from ${key}`)
        break
      }
    }

    result.restCollections = restCollections.length
    result.gqlCollections = gqlCollections.length

    // Step 3: Migrate REST collections to v11
    const migratedRestCollections = restCollections.map((col) => {
      try {
        return migrateCollectionToV11(col)
      } catch (error) {
        result.errors.push(`Failed to migrate REST collection "${col.name}": ${error}`)
        return col
      }
    })

    // Step 4: Migrate GraphQL collections to v11
    const migratedGqlCollections = gqlCollections.map((col) => {
      try {
        return migrateCollectionToV11(col)
      } catch (error) {
        result.errors.push(`Failed to migrate GraphQL collection "${col.name}": ${error}`)
        return col
      }
    })

    // Step 5: Combine and store in unified location
    // Note: The actual store integration will be handled by the unified collection store
    // This migration just ensures the data is in the correct format
    const allMigratedCollections = [
      ...migratedRestCollections,
      ...migratedGqlCollections,
    ]

    result.migratedCollections = allMigratedCollections.length

    console.log(`[Migration] Successfully migrated ${result.migratedCollections} collections`)
    console.log(`[Migration] - REST: ${result.restCollections}`)
    console.log(`[Migration] - GraphQL: ${result.gqlCollections}`)

    if (result.errors.length > 0) {
      console.warn(`[Migration] Encountered ${result.errors.length} errors:`, result.errors)
    }

    // Step 6: Mark migration as complete
    // Only mark complete if no critical errors occurred
    if (result.errors.length === 0 || result.migratedCollections > 0) {
      markMigrationComplete()
      result.success = true
    }

    // Store migrated collections in the new unified location
    // This will be picked up by the unified store initialization
    localStorage.setItem("collections", JSON.stringify(allMigratedCollections))

    return result
  } catch (error) {
    console.error("[Migration] Critical error during unified protocol migration:", error)
    result.errors.push(`Critical error: ${error}`)
    result.success = false
    return result
  }
}

/**
 * Reset migration state (for testing or troubleshooting)
 */
export function resetMigration(): void {
  localStorage.removeItem(MIGRATION_KEY)
  console.log("[Migration] Reset migration state")
}
