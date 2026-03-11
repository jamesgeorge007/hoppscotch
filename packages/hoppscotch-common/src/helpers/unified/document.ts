/**
 * Unified Document Types
 *
 * This module defines document types that support both REST and GraphQL protocols.
 * It provides a unified interface while preserving protocol-specific features.
 */

import type {
  HoppRESTRequest,
  HoppGQLRequest,
  HoppRESTRequestResponse,
} from "@hoppscotch/data"
import { getDefaultRESTRequest, getDefaultGQLRequest } from "@hoppscotch/data"
import { HoppRESTSaveContext } from "../rest/document"
import { HoppGQLSaveContext } from "../graphql/document"
import { HoppInheritedProperty } from "../types/HoppInheritedProperties"
import { HoppRESTResponse } from "../types/HoppRESTResponse"
import { GQLResponseEvent } from "../graphql/connection"
import { HoppTestResult } from "../types/HoppTestResult"
import { RESTOptionTabs } from "~/components/http/RequestOptions.vue"
import { GQLOptionTabs } from "~/components/graphql/RequestOptions.vue"

/**
 * Unified save context supporting both REST and GraphQL
 */
export type HoppUnifiedSaveContext = HoppRESTSaveContext | HoppGQLSaveContext

/**
 * REST-specific document properties for request editing tabs
 */
export interface HoppRESTDocumentProps {
  protocol: "rest"
  type?: "request"
  request: HoppRESTRequest
  response?: HoppRESTResponse | null
  testResults?: HoppTestResult | null
  responseTabPreference?: string
  optionTabPreference?: RESTOptionTabs
  saveContext?: HoppRESTSaveContext
}

/**
 * REST example-response document properties for viewing saved example responses
 */
export interface HoppExampleResponseDocumentProps {
  protocol: "rest"
  type: "example-response"
  response: HoppRESTRequestResponse
  request?: undefined
  saveContext?: HoppRESTSaveContext
}

/**
 * GraphQL-specific document properties
 */
export interface HoppGQLDocumentProps {
  protocol: "graphql"
  request: HoppGQLRequest
  response?: GQLResponseEvent[] | null
  cursorPosition?: number
  responseTabPreference?: string
  optionTabPreference?: GQLOptionTabs
  saveContext?: HoppGQLSaveContext
}

/**
 * Unified document type supporting both REST and GraphQL
 */
export type HoppUnifiedDocument = {
  /**
   * Whether the request has any unsaved changes
   */
  isDirty: boolean

  /**
   * The inherited properties from the parent collection
   */
  inheritedProperties?: HoppInheritedProperty
} & (HoppRESTDocumentProps | HoppGQLDocumentProps | HoppExampleResponseDocumentProps)

/**
 * Type guard to check if a document is a REST request document (not an example-response)
 */
export function isRESTDocument(
  doc: HoppUnifiedDocument
): doc is HoppUnifiedDocument & HoppRESTDocumentProps {
  return doc.protocol === "rest" && doc.type !== "example-response"
}

/**
 * Type guard to check if a document is an example-response document
 */
export function isExampleResponseDocument(
  doc: HoppUnifiedDocument
): doc is HoppUnifiedDocument & HoppExampleResponseDocumentProps {
  return doc.protocol === "rest" && doc.type === "example-response"
}

/**
 * Type guard to check if a document is a GraphQL document
 */
export function isGQLDocument(
  doc: HoppUnifiedDocument
): doc is HoppUnifiedDocument & HoppGQLDocumentProps {
  return doc.protocol === "graphql"
}

/**
 * Create a default REST document
 */
export function createDefaultRESTDocument(
  request?: HoppRESTRequest
): HoppUnifiedDocument & HoppRESTDocumentProps {
  return {
    protocol: "rest",
    request: request ?? getDefaultRESTRequest(),
    isDirty: false,
    response: null,
    testResults: null,
    optionTabPreference: "params",
  }
}

/**
 * Create a default GraphQL document
 */
export function createDefaultGQLDocument(
  request?: HoppGQLRequest
): HoppUnifiedDocument & HoppGQLDocumentProps {
  return {
    protocol: "graphql",
    request: request ?? getDefaultGQLRequest(),
    isDirty: false,
    response: null,
  }
}

