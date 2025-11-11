/**
 * Protocol Detection for Imports
 *
 * This module provides utilities to detect the protocol type of imported requests.
 * It supports detection from various import formats (Postman, OpenAPI, Hoppscotch, etc.)
 */

import { wrapRESTRequest, wrapGQLRequest, HoppRequestWithProtocol } from "@hoppscotch/data"
import { translateToNewRequest } from "@hoppscotch/data"
import { translateToGQLRequest } from "@hoppscotch/data"

/**
 * Detects the protocol type of a request based on its structure
 *
 * Detection heuristics:
 * 1. Explicit `protocol` field
 * 2. GraphQL-specific fields (query, variables as JSON)
 * 3. REST-specific fields (method, endpoint)
 * 4. Postman GraphQL detection (body.mode === "graphql")
 * 5. URL-based detection (contains "/graphql")
 * 6. Content-Type detection (application/graphql)
 */
export function detectRequestProtocol(request: any): "rest" | "graphql" {
  // 1. Explicit protocol field (Hoppscotch format)
  if (request.protocol) {
    return request.protocol
  }

  // 2. Check for GraphQL-specific fields
  if ("query" in request && typeof request.query === "string") {
    // Check if it looks like a GraphQL query
    if (
      request.query.trim().startsWith("query") ||
      request.query.trim().startsWith("mutation") ||
      request.query.trim().startsWith("subscription") ||
      request.query.trim().startsWith("{")
    ) {
      return "graphql"
    }
  }

  // 3. Check for REST-specific fields
  if ("method" in request && "endpoint" in request) {
    return "rest"
  }

  // 4. Postman GraphQL detection
  if (request.request?.body?.mode === "graphql") {
    return "graphql"
  }

  // Handle Postman request structure
  if (request.request) {
    const pmRequest = request.request

    // Check body for GraphQL
    if (pmRequest.body?.graphql) {
      return "graphql"
    }

    // Check URL for /graphql endpoint
    if (pmRequest.url) {
      const url = typeof pmRequest.url === "string" ? pmRequest.url : pmRequest.url.raw
      if (url && url.includes("/graphql")) {
        return "graphql"
      }
    }

    // Check headers for GraphQL content type
    if (Array.isArray(pmRequest.header)) {
      const hasGraphQLContentType = pmRequest.header.some(
        (h: any) =>
          h.key?.toLowerCase() === "content-type" &&
          h.value?.toLowerCase().includes("graphql")
      )
      if (hasGraphQLContentType) {
        return "graphql"
      }
    }
  }

  // 5. Direct URL check for Hoppscotch format
  if (request.url && typeof request.url === "string") {
    if (request.url.includes("/graphql")) {
      return "graphql"
    }
  }

  // 6. Check if it has OpenAPI-style operation
  if (request.operationId || request.operation) {
    return "rest"
  }

  // 7. Heuristic: GraphQL requests typically don't have a method field
  if (!("method" in request) && "url" in request) {
    return "graphql"
  }

  // Default to REST for backward compatibility
  return "rest"
}

/**
 * Wraps a request with the appropriate protocol discriminator
 *
 * This automatically detects the protocol and wraps the request in the
 * unified format expected by collection v11+
 */
export function wrapRequestWithProtocol(request: any): HoppRequestWithProtocol {
  const protocol = detectRequestProtocol(request)

  if (protocol === "rest") {
    const restRequest = translateToNewRequest(request)
    return wrapRESTRequest(restRequest)
  } else {
    const gqlRequest = translateToGQLRequest(request)
    return wrapGQLRequest(gqlRequest)
  }
}

/**
 * Migrates an imported collection to include protocol discriminators
 *
 * This recursively processes all requests and folders in a collection
 * and adds the `protocol` field to each request.
 */
export function migrateImportedCollection(collection: any): any {
  const migrateRequests = (requests: any[]): HoppRequestWithProtocol[] => {
    return requests.map((req) => {
      // If already wrapped with protocol, return as-is
      if (req.protocol && req.request) {
        return req
      }

      // Otherwise, detect and wrap
      return wrapRequestWithProtocol(req)
    })
  }

  const migrateFolder = (folder: any): any => {
    return {
      ...folder,
      requests: migrateRequests(folder.requests || []),
      folders: (folder.folders || []).map(migrateFolder),
    }
  }

  return migrateFolder(collection)
}

/**
 * Detects if a collection contains mixed protocols
 *
 * Useful for showing warnings or info to users during import
 */
export function hasMixedProtocols(collection: any): boolean {
  let hasREST = false
  let hasGraphQL = false

  const checkRequests = (requests: any[]) => {
    for (const req of requests) {
      const protocol = detectRequestProtocol(req.request || req)
      if (protocol === "rest") hasREST = true
      if (protocol === "graphql") hasGraphQL = true

      if (hasREST && hasGraphQL) return true
    }
    return false
  }

  const checkFolder = (folder: any): boolean => {
    if (checkRequests(folder.requests || [])) return true

    for (const subfolder of folder.folders || []) {
      if (checkFolder(subfolder)) return true
    }

    return false
  }

  return checkFolder(collection)
}

/**
 * Counts requests by protocol type
 */
export function countRequestsByProtocol(collection: any): {
  rest: number
  graphql: number
  total: number
} {
  const counts = { rest: 0, graphql: 0, total: 0 }

  const countRequests = (requests: any[]) => {
    for (const req of requests) {
      const protocol = detectRequestProtocol(req.request || req)
      counts.total++
      if (protocol === "rest") {
        counts.rest++
      } else {
        counts.graphql++
      }
    }
  }

  const countFolder = (folder: any) => {
    countRequests(folder.requests || [])
    for (const subfolder of folder.folders || []) {
      countFolder(subfolder)
    }
  }

  countFolder(collection)

  return counts
}
