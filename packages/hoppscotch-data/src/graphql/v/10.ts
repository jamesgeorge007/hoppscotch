import { defineVersion } from "verzod"
import { z } from "zod"
import { V9_SCHEMA } from "./9"
import { HoppRESTRequestVariables } from "../../rest/v/2"
import { generateUniqueRefId } from "../../utils/collection"

/**
 * GraphQL Request Schema v10
 *
 * This version adds feature parity with REST requests:
 * - _ref_id: Unique reference ID for sync tracking
 * - preRequestScript: Script executed before the request
 * - testScript: Script executed after the response
 * - requestVariables: Request-level variables (distinct from GraphQL query variables)
 * - responses: Saved example responses
 */

// GraphQL-specific response type
// Unlike REST which has a single response, GQL can have streaming responses (subscriptions)
export const HoppGQLRequestResponse = z.object({
  id: z.string(),
  name: z.string().optional(),
  timestamp: z.number(),
  body: z.string(),
  statusCode: z.number().optional(),
  headers: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    })
  ).optional(),
})

export type HoppGQLRequestResponse = z.infer<typeof HoppGQLRequestResponse>

export const HoppGQLRequestResponses = z.record(HoppGQLRequestResponse)

export type HoppGQLRequestResponses = z.infer<typeof HoppGQLRequestResponses>

export const V10_SCHEMA = V9_SCHEMA.extend({
  v: z.literal(10),
  _ref_id: z.string().optional(),
  preRequestScript: z.string(),
  testScript: z.string(),
  requestVariables: HoppRESTRequestVariables,
  responses: HoppGQLRequestResponses,
})

export type V10Schema = z.infer<typeof V10_SCHEMA>

export default defineVersion({
  schema: V10_SCHEMA,
  initial: false,
  up(old: z.infer<typeof V9_SCHEMA>): V10Schema {
    return {
      ...old,
      v: 10 as const,
      _ref_id: generateUniqueRefId("gql-req"),
      preRequestScript: "",
      testScript: "",
      requestVariables: [],
      responses: {},
    }
  },
})
