/**
 * Protocol Detection for Imports
 *
 * This module provides utilities to detect the protocol type of imported requests.
 * It supports detection from various import formats (Postman, OpenAPI, Hoppscotch, etc.)
 */

import {
  wrapRESTRequest,
  wrapGQLRequest,
  HoppRequestWithProtocol,
} from "@hoppscotch/data"
import { translateToNewRequest } from "@hoppscotch/data"
import { translateToGQLRequest } from "@hoppscotch/data"

/**
 * Detects the protocol type of a request based on its structure
 *
 * Detection heuristics (in priority order):
 * 1. Explicit `protocol` field
 * 2. GraphQL-specific fields (query string starting with query/mutation/subscription/{)
 * 3. REST-specific fields (method + endpoint)
 * 4. Postman GraphQL detection (body.mode === "graphql", body.graphql, /graphql URL)
 * 5. URL-based detection (contains "/graphql")
 * 6. operationId/operation → REST (OpenAPI-style)
 * 7. Default → REST (backward compatible)
 */
export function detectRequestProtocol(request: any): "rest" | "graphql" {
  // 1. Explicit protocol field (Hoppscotch format)
  if (request.protocol === "rest" || request.protocol === "graphql") {
    return request.protocol
  }

  // 2. Check for GraphQL-specific fields
  if ("query" in request && typeof request.query === "string") {
    // Check if it looks like a GraphQL query
    const trimmedQuery = request.query.trim()
    if (
      trimmedQuery.startsWith("query") ||
      trimmedQuery.startsWith("mutation") ||
      trimmedQuery.startsWith("subscription") ||
      trimmedQuery.startsWith("{")
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

    // Check URL for /graphql endpoint (full path segment only)
    if (pmRequest.url) {
      const url =
        typeof pmRequest.url === "string" ? pmRequest.url : pmRequest.url.raw
      if (url && /\/graphql(?:[/?#]|$)/.test(url)) {
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

  // 5. Direct URL check for Hoppscotch format (full path segment only)
  if (request.url && typeof request.url === "string") {
    if (/\/graphql(?:[/?#]|$)/.test(request.url)) {
      return "graphql"
    }
  }

  // 6. Check if it has OpenAPI-style operation
  if (request.operationId || request.operation) {
    return "rest"
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
  }
  const gqlRequest = translateToGQLRequest(request)
  return wrapGQLRequest(gqlRequest)
}

/**
 * Unwraps a request object — handles both protocol-wrapped ({ protocol, request })
 * and flat request formats.
 */
function getRequestObject(req: any): any {
  return req.request || req
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
      const protocol = detectRequestProtocol(getRequestObject(req))
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
      const protocol = detectRequestProtocol(getRequestObject(req))
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
