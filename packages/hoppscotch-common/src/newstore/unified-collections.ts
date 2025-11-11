/**
 * Unified Collection Store
 *
 * This module provides a unified API for managing collections across all protocols.
 * It acts as a compatibility layer over the existing REST and GraphQL stores,
 * allowing gradual migration while maintaining backward compatibility.
 *
 * Architecture:
 * - Wraps existing restCollectionStore and graphqlCollectionStore
 * - Provides protocol-agnostic operations
 * - Routes operations to appropriate store based on protocol
 * - Merges collections for unified views
 */

import {
  HoppCollection,
  HoppRESTRequest,
  HoppGQLRequest,
  HoppRequestWithProtocol,
  isRESTRequest,
  isGQLRequest,
  wrapRESTRequest,
  wrapGQLRequest,
} from "@hoppscotch/data"
import { computed, Ref } from "vue"
import {
  restCollectionStore,
  graphqlCollectionStore,
  restCollections$,
  graphqlCollections$,
} from "./collections"
import { combineLatest } from "rxjs"
import { map } from "rxjs/operators"

/**
 * Protocol type for identifying collection types
 */
export type CollectionProtocol = "rest" | "graphql" | "mixed"

/**
 * Extended collection type with protocol metadata
 */
export interface UnifiedCollection extends HoppCollection {
  protocol: CollectionProtocol
}

/**
 * Detect the dominant protocol in a collection
 */
function detectCollectionProtocol(
  collection: HoppCollection
): CollectionProtocol {
  let hasREST = false
  let hasGraphQL = false

  const checkRequests = (reqs: any[]) => {
    for (const req of reqs) {
      if (req.protocol) {
        if (req.protocol === "rest") hasREST = true
        if (req.protocol === "graphql") hasGraphQL = true
      } else {
        // Legacy detection for non-v11 collections
        if ("method" in req && "endpoint" in req) {
          hasREST = true
        } else if ("query" in req) {
          hasGraphQL = true
        }
      }

      if (hasREST && hasGraphQL) return "mixed"
    }
  }

  const checkFolder = (folder: HoppCollection): void => {
    checkRequests(folder.requests)
    for (const subfolder of folder.folders) {
      checkFolder(subfolder)
    }
  }

  checkFolder(collection)

  if (hasREST && hasGraphQL) return "mixed"
  if (hasREST) return "rest"
  if (hasGraphQL) return "graphql"
  return "rest" // default
}

/**
 * Combined observable of all collections across protocols
 */
export const unifiedCollections$ = combineLatest([
  restCollections$,
  graphqlCollections$,
]).pipe(
  map(([restCollections, graphqlCollections]) => {
    const unified: UnifiedCollection[] = []

    // Add REST collections with protocol metadata
    for (const col of restCollections) {
      unified.push({
        ...col,
        protocol: detectCollectionProtocol(col),
      })
    }

    // Add GraphQL collections with protocol metadata
    for (const col of graphqlCollections) {
      unified.push({
        ...col,
        protocol: detectCollectionProtocol(col),
      })
    }

    return unified
  })
)

/**
 * Unified Collection Operations
 *
 * These functions provide a protocol-agnostic API for collection management.
 * They automatically route to the appropriate store based on protocol detection.
 */

/**
 * Get all collections across all protocols
 */
export function getAllCollections(): UnifiedCollection[] {
  const restCols = restCollectionStore.value.state.map((col) => ({
    ...col,
    protocol: detectCollectionProtocol(col) as CollectionProtocol,
  }))

  const gqlCols = graphqlCollectionStore.value.state.map((col) => ({
    ...col,
    protocol: detectCollectionProtocol(col) as CollectionProtocol,
  }))

  return [...restCols, ...gqlCols]
}

/**
 * Get collections filtered by protocol
 */
export function getCollectionsByProtocol(
  protocol: "rest" | "graphql" | "mixed"
): UnifiedCollection[] {
  return getAllCollections().filter((col) => {
    if (protocol === "mixed") {
      return col.protocol === "mixed"
    }
    return col.protocol === protocol
  })
}

/**
 * Add a request to a collection (protocol-aware)
 */
export function addRequestToCollection(
  collectionPath: string,
  request: HoppRequestWithProtocol,
  protocol: "rest" | "graphql"
) {
  const store = protocol === "rest" ? restCollectionStore : graphqlCollectionStore

  // Get the target collection
  const pathParts = collectionPath.split("/").map((p) => parseInt(p))
  const collections = store.value.state

  // Navigate to folder
  let target: HoppCollection | null = collections[pathParts[0]]
  for (let i = 1; i < pathParts.length; i++) {
    if (!target) break
    target = target.folders[pathParts[i]]
  }

  if (!target) {
    console.error("Collection path not found:", collectionPath)
    return
  }

  // Add request based on protocol
  if (isRESTRequest(request)) {
    target.requests.push(request as any)
  } else if (isGQLRequest(request)) {
    target.requests.push(request as any)
  }

  // Trigger update
  store.dispatch({
    dispatcher: "setCollections",
    payload: { entries: collections },
  })
}

/**
 * Find collection by ID across all stores
 */
export function findCollectionById(
  id: string
): { collection: HoppCollection; protocol: "rest" | "graphql" } | null {
  // Search REST collections
  const searchInCollection = (
    col: HoppCollection,
    targetId: string
  ): HoppCollection | null => {
    if (col.id === targetId || col._ref_id === targetId) {
      return col
    }
    for (const folder of col.folders) {
      const found = searchInCollection(folder, targetId)
      if (found) return found
    }
    return null
  }

  for (const col of restCollectionStore.value.state) {
    const found = searchInCollection(col, id)
    if (found) {
      return { collection: found, protocol: "rest" }
    }
  }

  // Search GraphQL collections
  for (const col of graphqlCollectionStore.value.state) {
    const found = searchInCollection(col, id)
    if (found) {
      return { collection: found, protocol: "graphql" }
    }
  }

  return null
}

/**
 * Get collection statistics
 */
export function getCollectionStats() {
  const countRequests = (col: HoppCollection): { rest: number; graphql: number } => {
    let rest = 0
    let graphql = 0

    for (const req of col.requests) {
      if ((req as any).protocol) {
        if ((req as any).protocol === "rest") rest++
        if ((req as any).protocol === "graphql") graphql++
      } else {
        // Legacy detection
        if ("method" in req) rest++
        else if ("query" in req) graphql++
      }
    }

    for (const folder of col.folders) {
      const subCounts = countRequests(folder)
      rest += subCounts.rest
      graphql += subCounts.graphql
    }

    return { rest, graphql }
  }

  const allCollections = [
    ...restCollectionStore.value.state,
    ...graphqlCollectionStore.value.state,
  ]

  let totalREST = 0
  let totalGraphQL = 0
  let totalCollections = allCollections.length
  let mixedCollections = 0

  for (const col of allCollections) {
    const counts = countRequests(col)
    totalREST += counts.rest
    totalGraphQL += counts.graphql

    if (counts.rest > 0 && counts.graphql > 0) {
      mixedCollections++
    }
  }

  return {
    totalCollections,
    totalRequests: totalREST + totalGraphQL,
    restRequests: totalREST,
    graphqlRequests: totalGraphQL,
    mixedCollections,
  }
}

/**
 * Migration helper: Convert legacy collections to v11 format
 */
export function migrateLegacyCollection(collection: HoppCollection): HoppCollection {
  const migrateRequests = (requests: any[]): any[] => {
    return requests.map((req) => {
      // Skip if already in v11 format
      if (req.protocol && req.request) {
        return req
      }

      // Detect protocol and wrap
      if ("method" in req && "endpoint" in req) {
        return wrapRESTRequest(req as HoppRESTRequest)
      } else if ("query" in req) {
        return wrapGQLRequest(req as HoppGQLRequest)
      }

      // Fallback
      return req
    })
  }

  const migrateFolder = (folder: HoppCollection): HoppCollection => {
    return {
      ...folder,
      requests: migrateRequests(folder.requests),
      folders: folder.folders.map(migrateFolder),
    }
  }

  return migrateFolder(collection)
}

/**
 * Reactive computed for unified collections
 */
export function useUnifiedCollections(): Ref<UnifiedCollection[]> {
  return computed(() => getAllCollections())
}

/**
 * Check if a collection contains mixed protocols
 */
export function isMixedCollection(collection: HoppCollection): boolean {
  return detectCollectionProtocol(collection) === "mixed"
}

/**
 * Export unified collections (for import/export)
 */
export function exportUnifiedCollections(): HoppCollection[] {
  return getAllCollections()
}

/**
 * Import unified collections
 * Automatically detects protocol and routes to correct store
 */
export function importUnifiedCollections(collections: HoppCollection[]) {
  const restCollections: HoppCollection[] = []
  const graphqlCollections: HoppCollection[] = []

  for (const col of collections) {
    const protocol = detectCollectionProtocol(col)

    if (protocol === "rest") {
      restCollections.push(col)
    } else if (protocol === "graphql") {
      graphqlCollections.push(col)
    } else if (protocol === "mixed") {
      // For mixed collections, we keep them in REST store by default
      // This preserves all functionality
      restCollections.push(col)
    }
  }

  // Import to respective stores
  if (restCollections.length > 0) {
    restCollectionStore.dispatch({
      dispatcher: "appendCollections",
      payload: { entries: restCollections },
    })
  }

  if (graphqlCollections.length > 0) {
    graphqlCollectionStore.dispatch({
      dispatcher: "appendCollections",
      payload: { entries: graphqlCollections },
    })
  }
}
