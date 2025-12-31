import { defineVersion, entityRefUptoVersion } from "verzod"
import { z } from "zod"
import { HoppCollection } from ".."
import { v11_baseCollectionSchema } from "./11"
import { HoppRESTRequest } from "../../rest"
import { HoppGQLRequest } from "../../graphql"

/**
 * Collection Schema v12
 *
 * This version introduces explicit protocol discrimination for requests.
 * Previously, requests were implicitly typed (REST or GQL) based on their structure.
 * Now, each request has an explicit `protocol` field for better type safety and extensibility.
 *
 * Migration strategy:
 * - Detect protocol by inspecting request structure
 * - REST requests have: method, endpoint
 * - GraphQL requests have: query, url (without method)
 */

// Protocol discriminated union for requests
// Note: We use z.any() here because HoppRESTRequest and HoppGQLRequest are verzod entities
// and their actual schema structure is complex. The migration function handles proper parsing.
export const HoppRESTRequestWrapper = z.object({
  protocol: z.literal("rest"),
  request: z.any(),
})

export const HoppGQLRequestWrapper = z.object({
  protocol: z.literal("graphql"),
  request: z.any(),
})

export const HoppRequestWithProtocol = z.discriminatedUnion("protocol", [
  HoppRESTRequestWrapper,
  HoppGQLRequestWrapper,
])

export type HoppRequestWithProtocol = z.infer<typeof HoppRequestWithProtocol>

export const v12_baseCollectionSchema = v11_baseCollectionSchema
  .omit({ requests: true })
  .extend({
    v: z.literal(12),
    requests: z.array(HoppRequestWithProtocol),
  })

type Input = z.input<typeof v12_baseCollectionSchema> & {
  folders: Input[]
}

type Output = z.output<typeof v12_baseCollectionSchema> & {
  folders: Output[]
}

export const V12_SCHEMA = v12_baseCollectionSchema.extend({
  folders: z.lazy(() => z.array(entityRefUptoVersion(HoppCollection, 12))),
}) as z.ZodType<Output, z.ZodTypeDef, Input>

/**
 * Detects the protocol type of a request based on its structure
 */
function detectRequestProtocol(req: any): "rest" | "graphql" {
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

export default defineVersion({
  initial: false,
  schema: V12_SCHEMA,
  up(old: any): z.infer<typeof V12_SCHEMA> {
    // Migration from v11 → v12
    // Add explicit protocol discriminator to all requests

    const migrateRequests = (requests: any[]): HoppRequestWithProtocol[] => {
      return requests.map((req: any) => {
        const protocol = detectRequestProtocol(req)

        if (protocol === "rest") {
          // Parse as REST request (with migration if needed)
          const restResult = HoppRESTRequest.safeParse(req)
          if (restResult.type === "ok") {
            return {
              protocol: "rest" as const,
              request: restResult.value,
            }
          }
          // Fallback: use the raw request (will be validated later)
          return {
            protocol: "rest" as const,
            request: req,
          }
        } else {
          // Parse as GraphQL request (with migration if needed)
          const gqlResult = HoppGQLRequest.safeParse(req)
          if (gqlResult.type === "ok") {
            return {
              protocol: "graphql" as const,
              request: gqlResult.value,
            }
          }
          // Fallback: use the raw request (will be validated later)
          return {
            protocol: "graphql" as const,
            request: req,
          }
        }
      })
    }

    const migrateFolder = (folder: any): any => {
      return {
        ...folder,
        v: 12 as const,
        requests: migrateRequests(folder.requests || []),
        folders: (folder.folders || []).map((subfolder: any) => {
          const result = HoppCollection.safeParseUpToVersion(subfolder, 12)
          if (result.type !== "ok") {
            // Try manual migration
            return migrateFolder(subfolder)
          }
          return result.value
        }),
      }
    }

    const migrated = migrateFolder(old)

    return migrated
  },
})
