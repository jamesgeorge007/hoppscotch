import { z } from "zod"
import { defineVersion } from "verzod"
import { V0_SCHEMA } from "./0"

export const V1_SCHEMA = z.object({
  v: z.literal(1),
})
.and(
z.union([
  z.object({
    key: z.string(),
    value: z.string(),
    secret: z.literal(false),
  }),
  z.object({
    key: z.string(),
    secret: z.literal(true),
  })
]))

export default defineVersion({
  initial: false,
  schema: V1_SCHEMA,
  up(old: z.infer<typeof V0_SCHEMA>) {
    if ("value" in old) {
      return <z.infer<typeof V1_SCHEMA>>{
        v: 1,
        key: old.key,
        value: old.value,
        secret: false,
      }
    }

    return <z.infer<typeof V1_SCHEMA>>{
      v: 1,
      key: old.key,
      secret: old.secret,
    }
  },
})
