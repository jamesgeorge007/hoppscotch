import type {
  HoppRESTRequest,
  HoppGQLRequest,
  HoppRESTRequestResponse,
} from "@hoppscotch/data"
import { getDefaultRESTRequest, getDefaultGQLRequest } from "@hoppscotch/data"
import { HoppRESTSaveContext, HoppTestRunnerDocument } from "../rest/document"
import { HoppGQLSaveContext } from "../graphql/document"
import { HoppInheritedProperty } from "../types/HoppInheritedProperties"
import { HoppRESTResponse } from "../types/HoppRESTResponse"
import { GQLResponseEvent } from "../graphql/connection"
import { HoppTestResult } from "../types/HoppTestResult"
import { RESTOptionTabs } from "~/components/http/RequestOptions.vue"
import { GQLOptionTabs } from "~/components/graphql/RequestOptions.vue"

export type HoppUnifiedSaveContext = HoppRESTSaveContext | HoppGQLSaveContext

export interface HoppRESTDocumentProps {
  protocol: "rest"
  type: "request"
  request: HoppRESTRequest
  response?: HoppRESTResponse | null
  testResults?: HoppTestResult | null
  responseTabPreference?: string
  optionTabPreference?: RESTOptionTabs
  saveContext?: HoppRESTSaveContext
}

export interface HoppExampleResponseDocumentProps {
  protocol: "rest"
  type: "example-response"
  response: HoppRESTRequestResponse
  request?: undefined
  saveContext?: HoppRESTSaveContext
}

export interface HoppGQLDocumentProps {
  protocol: "graphql"
  request: HoppGQLRequest
  response?: GQLResponseEvent[] | null
  cursorPosition?: number
  responseTabPreference?: string
  optionTabPreference?: GQLOptionTabs
  saveContext?: HoppGQLSaveContext
}

export type HoppUnifiedDocument = (
  | HoppRESTDocumentProps
  | HoppGQLDocumentProps
  | HoppExampleResponseDocumentProps
  | HoppTestRunnerDocument
) & {
  isDirty: boolean
  inheritedProperties?: HoppInheritedProperty
}

export function isRESTDocument(
  doc: HoppUnifiedDocument
): doc is HoppUnifiedDocument & HoppRESTDocumentProps {
  return doc.protocol === "rest" && doc.type === "request"
}

export function isExampleResponseDocument(
  doc: HoppUnifiedDocument
): doc is HoppUnifiedDocument & HoppExampleResponseDocumentProps {
  return doc.protocol === "rest" && doc.type === "example-response"
}

export function isGQLDocument(
  doc: HoppUnifiedDocument
): doc is HoppUnifiedDocument & HoppGQLDocumentProps {
  return doc.protocol === "graphql"
}

export function isTestRunnerDocument(
  doc: HoppUnifiedDocument
): doc is HoppUnifiedDocument & HoppTestRunnerDocument {
  return doc.type === "test-runner"
}

export function createDefaultRESTDocument(
  request?: HoppRESTRequest
): HoppUnifiedDocument & HoppRESTDocumentProps {
  return {
    protocol: "rest",
    type: "request",
    request: request ?? getDefaultRESTRequest(),
    isDirty: false,
    response: null,
    testResults: null,
    optionTabPreference: "params",
  }
}

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
