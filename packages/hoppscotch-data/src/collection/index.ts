import { InferredEntity, createVersionedEntity } from "verzod"
import {
  GQL_REQ_SCHEMA_VERSION,
  HoppGQLRequest,
  translateToGQLRequest,
} from "../graphql"
import { translateToNewRequest } from "../rest"

import V0_VERSION from "./v/0"
import V1_VERSION from "./v/1"
import { z } from "zod"

const CURRENT_COLL_SCHEMA_VER = 1

const versionedObject = z.object({
  v: z.number(),
})

export const HoppCollection = createVersionedEntity({
  latestVersion: 1,
  versionMap: {
    0: V0_VERSION,
    1: V1_VERSION,
  },
  getVersion(data) {
    const result = versionedObject.safeParse(data)
    return result.success ? result.data.v : null
  }
})

export type HoppCollection = InferredEntity<typeof HoppCollection>

/**
 * Generates a Collection object. This ignores the version number object
 * so it can be incremented independently without updating it everywhere
 * @param x The Collection Data
 * @returns The final collection
 */
export function makeCollection(
  x: Omit<HoppCollection, "v">
): HoppCollection {
  return {
    v: CURRENT_COLL_SCHEMA_VER,
    ...x,
  }
}

/**
 * Translates an old collection to a new collection
 * @param x The collection object to load
 * @returns The proper new collection format
 */
export function translateToNewRESTCollection(
  x: any
): HoppCollection {
  if (x.v && x.v === 1) return x

  // Legacy
  const name = x.name ?? "Untitled"
  const folders = (x.folders ?? []).map(translateToNewRESTCollection)
  const requests = (x.requests ?? []).map(translateToNewRequest)

  const auth = x.auth ?? "None"
  const headers = x.headers ?? []

  const obj = makeCollection({
    name,
    folders,
    requests,
    auth,
    headers,
  })

  if (x.id) obj.id = x.id

  return obj
}

/**
 * Translates an old collection to a new collection
 * @param x The collection object to load
 * @returns The proper new collection format
 */
export function translateToNewGQLCollection(
  x: any
): HoppCollection {
  if (x.v && x.v === GQL_REQ_SCHEMA_VERSION) return x

  // Legacy
  const name = x.name ?? "Untitled"
  const folders = (x.folders ?? []).map(translateToNewGQLCollection)
  const requests = (x.requests ?? []).map(translateToGQLRequest)

  const auth = x.auth ?? { authType: "inherit", authActive: true }
  const headers = x.headers ?? []

  const obj = makeCollection({
    name,
    folders,
    requests,
    auth,
    headers,
  })

  if (x.id) obj.id = x.id

  return obj
}
