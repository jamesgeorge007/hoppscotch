import { defineVersion, entityReference } from "verzod"
import { z } from "zod"

import { HoppRESTRequest, HoppGQLRequest } from "../.."

// Define the HoppCollection schema
// @ts-expect-error Recursive schema
export const V0_SCHEMA = z.object({
  v: z.number(),
  name: z.string(),
  folders: z.array(z.lazy(() => V0_SCHEMA)),
  requests: z.union([entityReference(HoppRESTRequest), entityReference(HoppGQLRequest)]),

  id: z.optional(z.string()), // For Firestore ID data
});

export default defineVersion({
  initial: true,
  schema: V0_SCHEMA,
})
