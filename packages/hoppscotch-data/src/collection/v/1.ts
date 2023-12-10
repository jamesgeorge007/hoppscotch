import { defineVersion, entityReference } from "verzod"
import { z } from "zod"

import { HoppRESTRequest, HoppGQLRequest, HoppRESTAuth, HoppGQLAuth, GQLHeader } from "../.."
import { V0_SCHEMA } from "./0"
import { HoppRESTHeaders } from "../../rest/v/1"

// Define the HoppCollection schema
// @ts-expect-error Recursive schema
const V1_SCHEMA = z.object({
  v: z.number(),
  name: z.string(),
  folders: z.array(z.lazy(() => V1_SCHEMA)),
  requests: z.union([entityReference(HoppRESTRequest), entityReference(HoppGQLRequest)]),

  auth: z.union([HoppRESTAuth, HoppGQLAuth]),
  headers: z.union([HoppRESTHeaders, GQLHeader]),

  id: z.optional(z.string()), // For Firestore ID data
});

export default defineVersion({
  initial: false,
  schema: V1_SCHEMA,
  up(old: z.infer<typeof V0_SCHEMA>) {
    const { name, folders, requests } = old

    return {
      v: 1,
      name,
      folders: this.up(folders),
      requests,
      auth: {
        authType: "none",
        authActive: true,
      },
      headers: [],
    };
  }
})
