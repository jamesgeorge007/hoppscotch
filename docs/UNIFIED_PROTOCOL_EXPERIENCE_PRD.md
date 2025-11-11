# Unified Protocol Experience - Product Requirements Document

**Status:** Draft
**Version:** 1.0
**Last Updated:** 2025-11-11
**Owner:** Engineering Team

---

## Executive Summary

This document outlines the requirements and implementation strategy for unifying the REST and GraphQL experiences in Hoppscotch into a single, cohesive interface. Currently, REST and GraphQL are separated into distinct views with different feature sets, causing inconsistent user experience and maintenance overhead. This project will consolidate both protocols into a unified workspace while ensuring feature parity and backward compatibility.

---

## Table of Contents

1. [Background & Context](#background--context)
2. [Current State Analysis](#current-state-analysis)
3. [Goals & Non-Goals](#goals--non-goals)
4. [User Stories](#user-stories)
5. [Technical Requirements](#technical-requirements)
6. [Data Model Changes](#data-model-changes)
7. [Migration Strategy](#migration-strategy)
8. [Implementation Plan](#implementation-plan)
9. [Testing Strategy](#testing-strategy)
10. [Risks & Mitigations](#risks--mitigations)
11. [Success Metrics](#success-metrics)

---

## Background & Context

### Current Pain Points

1. **Inconsistent Experience**: REST has team workspaces, GQL doesn't
2. **Feature Disparity**: GQL lacks drag-and-drop, sorting, environment UI
3. **Dual Maintenance**: Separate code paths for similar functionality
4. **User Confusion**: Switching between protocols requires navigation to different pages
5. **Limited GQL Adoption**: Missing features discourage GraphQL usage

### Historical Context

- Collections use a shared `HoppCollection` type (v10) for both protocols
- REST requests are at v16, GQL requests at v9
- Workspace service already has hooks for both protocols
- Environment system is protocol-agnostic
- Previous unification work: Unified scripting editors (PR #50)

---

## Current State Analysis

### Architecture Overview

#### Page Structure
| Aspect | REST | GraphQL |
|--------|------|---------|
| **Route** | `/` (index.vue) | `/graphql` (graphql.vue) |
| **Layout** | `AppPaneLayout` (layout-id="http") | `AppPaneLayout` (layout-id="graphql") |
| **Tab Service** | `RESTTabService` | `GQLTabService` |
| **Tab Types** | `request`, `test-runner`, `example-response` | Single type with GQL document |

#### Data Model

**Collections** ([packages/hoppscotch-data/src/collection/index.ts](packages/hoppscotch-data/src/collection/index.ts))
```typescript
// Shared collection structure (v10)
type HoppCollection = {
  v: 10
  id?: string
  _ref_id: string
  name: string
  folders: HoppCollection[]
  requests: Array<HoppRESTRequest | HoppGQLRequest>  // Protocol-specific
  auth: HoppRESTAuth | HoppGQLAuth
  headers: HoppRESTHeaders | GQLHeader[]
  variables: CollectionVariable[]
}
```

**REST Request** (v16) - [packages/hoppscotch-data/src/rest/index.ts](packages/hoppscotch-data/src/rest/index.ts:113)
- Supports: method, endpoint, headers, params, body, auth, scripts, requestVariables, responses, `_ref_id`

**GQL Request** (v9) - [packages/hoppscotch-data/src/graphql/index.ts](packages/hoppscotch-data/src/graphql/index.ts:51)
- Supports: url, query, variables (JSON string), headers, auth
- Missing: `_ref_id`, responses, scripts

#### State Management

**Collections Store** ([packages/hoppscotch-common/src/newstore/collections.ts](packages/hoppscotch-common/src/newstore/collections.ts))
```typescript
// Separate store instances
export const restCollectionStore = new DispatchingStore(
  defaultRESTCollectionState,
  restCollectionDispatchers  // Lines 257-952
)

export const graphqlCollectionStore = new DispatchingStore(
  defaultGraphqlCollectionState,
  gqlCollectionDispatchers  // Lines 954-1299
)
```

**Key Differences in Dispatchers:**
| Operation | REST | GraphQL |
|-----------|------|---------|
| Sorting | ✅ `sortRESTCollection` (lines 320-349) | ❌ Missing |
| Reordering | ✅ `updateRequestOrder`, `updateCollectionOrder` | ❌ Missing |
| Drag & Drop | ✅ `moveFolder`, `moveRequest` | ❌ Limited |
| Duplication | ✅ Regenerates `_ref_id` (lines 641-701) | ⚠️ No `_ref_id` handling |

#### Workspace Support

**Workspace Service** ([packages/hoppscotch-common/src/services/workspace.service.ts](packages/hoppscotch-common/src/services/workspace.service.ts))
- Lines 108-135: `setupTeamCollectionServiceSync()` - only syncs REST collections
- GQL has no team collection integration

#### Feature Comparison Matrix

| Feature | REST | GraphQL | Gap Analysis |
|---------|------|---------|--------------|
| **Team Workspaces** | ✅ Full support | ❌ Not implemented | High priority |
| **Personal Workspace** | ✅ | ✅ | ✓ |
| **Collection Drag & Drop** | ✅ | ❌ | High priority |
| **Collection Sorting** | ✅ Asc/Desc | ❌ | Medium priority |
| **Environment UI** | ✅ Sidebar tab | ❌ No UI | High priority |
| **Test Runner** | ✅ Dedicated tab | ❌ | Medium priority |
| **Example Responses** | ✅ Saved responses | ❌ | Low priority |
| **Request Variables** | ✅ | ❌ | Medium priority |
| **Pre-request Scripts** | ✅ | ❌ | Medium priority |
| **Test Scripts** | ✅ | ❌ | Medium priority |
| **Subscriptions** | N/A | ✅ WebSocket | Protocol-specific |
| **Schema Introspection** | N/A | ✅ Auto-docs | Protocol-specific |
| **`_ref_id` Tracking** | ✅ | ❌ | Critical for sync |

---

## Goals & Non-Goals

### Goals

#### Primary Goals
1. **Unified Interface**: Single page/view for all protocols with seamless switching
2. **Feature Parity**: Bring GraphQL to feature parity with REST
3. **Team Workspace Support**: Enable team collections for GraphQL
4. **Backward Compatibility**: Migrate existing collections without data loss
5. **Extensibility**: Architecture supports future protocol additions (gRPC, WebSocket, etc.)

#### Secondary Goals
6. **Improved UX**: Protocol switcher within request tabs
7. **Environment UI for GQL**: Dedicated environment management
8. **Unified Tab System**: Single tab service handling all protocol types
9. **Consistent Collection Operations**: Same capabilities across all protocols

### Non-Goals

1. **Breaking API Changes**: Avoid breaking backend APIs
2. **UI Redesign**: Keep existing UI patterns and components
3. **Performance Overhaul**: Focus on functionality, not performance optimization
4. **gRPC/WebSocket Integration**: Future protocols not in scope
5. **Mobile App Changes**: Desktop/web only for this phase

---

## User Stories

### As a REST User
- I want to add GraphQL requests to my existing REST collections
- I want GraphQL to support team workspaces like REST does
- I want to organize mixed protocol collections with drag-and-drop

### As a GraphQL User
- I want access to test scripts and pre-request scripts
- I want to manage environments from the sidebar
- I want example responses saved to requests
- I want my collections synced to team workspaces

### As a Team Admin
- I want to create collections with mixed REST and GraphQL requests
- I want all protocols to respect team permissions
- I want unified import/export across protocols

### As a Developer
- I want to import Postman collections with both REST and GraphQL
- I want collection variables to work consistently
- I want seamless protocol switching without losing context

---

## Technical Requirements

### R1: Unified Collection Model

**Priority:** P0 (Critical)
**Effort:** Large

**Requirements:**
- Extend `HoppCollection` to explicitly support protocol type discrimination
- Add protocol discriminator to requests: `{ protocol: "rest" | "graphql" | "generic" }`
- Maintain backward compatibility with existing v10 collections
- Bump collection version to v11 with migration path

**Acceptance Criteria:**
- [ ] Collection schema v11 defined
- [ ] Protocol type added to request metadata
- [ ] Migration function from v10 → v11 implemented
- [ ] All existing collections migrate without data loss

**Files Affected:**
- [packages/hoppscotch-data/src/collection/index.ts](packages/hoppscotch-data/src/collection/index.ts)
- [packages/hoppscotch-data/src/collection/v/11.ts](packages/hoppscotch-data/src/collection/v/11.ts) (new)

---

### R2: Unified Request Type

**Priority:** P0 (Critical)
**Effort:** Large

**Requirements:**
- Create `HoppRequest` union type: `HoppRESTRequest | HoppGQLRequest`
- Add discriminated union with `protocol` field
- Ensure both request types have `_ref_id` for sync
- Bump GQL request version to v10 (align with REST v16 features)

**Acceptance Criteria:**
- [ ] `HoppRequest` type defined with protocol discriminator
- [ ] GQL request schema updated to v10 with `_ref_id`, `preRequestScript`, `testScript`
- [ ] Type guards: `isRESTRequest()`, `isGQLRequest()`
- [ ] Migration functions for old GQL requests

**Files Affected:**
- [packages/hoppscotch-data/src/graphql/index.ts](packages/hoppscotch-data/src/graphql/index.ts)
- [packages/hoppscotch-data/src/graphql/v/10.ts](packages/hoppscotch-data/src/graphql/v/10.ts) (new)
- [packages/hoppscotch-data/src/collection/v/11.ts](packages/hoppscotch-data/src/collection/v/11.ts)

---

### R3: GQL Feature Parity

**Priority:** P0 (Critical)
**Effort:** Large

**Requirements:**

#### R3.1: GraphQL `_ref_id` Support
- Add `_ref_id` to GQL requests for sync tracking
- Update `makeGQLRequest` to generate unique ref IDs

#### R3.2: GraphQL Scripts
- Add `preRequestScript: string` to GQL request schema
- Add `testScript: string` to GQL request schema
- Integrate with existing script execution engine

#### R3.3: GraphQL Request Variables
- Add `requestVariables: Array<{ key: string, value: string, active: boolean }>` to GQL schema
- Note: Distinct from GraphQL query variables (JSON)

#### R3.4: GraphQL Example Responses
- Add `responses: HoppGQLRequestResponses` to GQL schema
- Create `HoppGQLRequestResponse` type (similar to REST)

**Acceptance Criteria:**
- [ ] All fields added to GQL request schema
- [ ] Script execution works for GQL requests
- [ ] Request variables resolve in GQL queries
- [ ] Example responses can be saved/loaded

**Files Affected:**
- [packages/hoppscotch-data/src/graphql/v/10.ts](packages/hoppscotch-data/src/graphql/v/10.ts) (new)
- [packages/hoppscotch-common/src/helpers/graphql](packages/hoppscotch-common/src/helpers/graphql/)

---

### R4: Unified Store

**Priority:** P0 (Critical)
**Effort:** Large

**Requirements:**
- Merge `restCollectionStore` and `graphqlCollectionStore` into single `collectionStore`
- Support protocol-agnostic collection operations
- Implement unified dispatchers for add/edit/remove/move operations
- Maintain protocol-specific logic where necessary (e.g., subscriptions)

**Acceptance Criteria:**
- [ ] Single `collectionStore` replaces both stores
- [ ] All REST operations work unchanged
- [ ] All GQL operations work unchanged
- [ ] Protocol-specific operations properly routed

**Files Affected:**
- [packages/hoppscotch-common/src/newstore/collections.ts](packages/hoppscotch-common/src/newstore/collections.ts)

---

### R5: Unified Tab Service

**Priority:** P0 (Critical)
**Effort:** Medium

**Requirements:**
- Create `UnifiedTabService` extending `TabService<HoppTabDocument>`
- Support document types: `{ protocol: "rest" | "graphql", ...}`
- Handle protocol-specific rendering and state
- Migrate existing tabs on first load

**Acceptance Criteria:**
- [ ] `UnifiedTabService` implemented
- [ ] REST tabs render correctly
- [ ] GQL tabs render correctly
- [ ] Tab switching preserves protocol state
- [ ] Save context works for both protocols

**Files Affected:**
- [packages/hoppscotch-common/src/services/tab/unified.ts](packages/hoppscotch-common/src/services/tab/unified.ts) (new)
- [packages/hoppscotch-common/src/services/tab/rest.ts](packages/hoppscotch-common/src/services/tab/rest.ts)
- [packages/hoppscotch-common/src/services/tab/graphql.ts](packages/hoppscotch-common/src/services/tab/graphql.ts)

---

### R6: Unified Page Component

**Priority:** P0 (Critical)
**Effort:** Large

**Requirements:**
- Create unified page at `/` (replace current REST-only page)
- Protocol switcher in tab header (dropdown: REST / GraphQL)
- Dynamic component rendering based on active protocol
- Preserve GQL-specific features (schema explorer, subscriptions)
- Support mixed collections in sidebar

**Acceptance Criteria:**
- [ ] Unified page component created
- [ ] Protocol switcher functional
- [ ] REST requests render correctly
- [ ] GQL requests render correctly
- [ ] Schema explorer available for GQL
- [ ] Subscription state managed properly

**Files Affected:**
- [packages/hoppscotch-common/src/pages/index.vue](packages/hoppscotch-common/src/pages/index.vue)
- [packages/hoppscotch-common/src/pages/graphql.vue](packages/hoppscotch-common/src/pages/graphql.vue) (deprecate)

---

### R7: Unified Collection Tree

**Priority:** P0 (Critical)
**Effort:** Medium

**Requirements:**
- Extend existing collection tree to show protocol icons
- Support drag-and-drop for both REST and GQL requests
- Show protocol badge on requests (REST icon / GQL icon)
- Support sorting for GQL collections
- Context menu works for all request types

**Acceptance Criteria:**
- [ ] Protocol icons displayed
- [ ] Drag-and-drop works for all protocols
- [ ] Sorting works for GQL
- [ ] Context menu actions work correctly
- [ ] Request type changes supported (REST ↔ GQL)

**Files Affected:**
- [packages/hoppscotch-common/src/components/collections/MyCollections.vue](packages/hoppscotch-common/src/components/collections/MyCollections.vue)
- [packages/hoppscotch-common/src/components/collections/graphql/](packages/hoppscotch-common/src/components/collections/graphql/) (deprecate)

---

### R8: GQL Team Workspace Support

**Priority:** P0 (Critical)
**Effort:** Large

**Requirements:**
- Extend `TeamCollectionsService` to support GQL collections
- Update backend API to handle GQL team collections (if needed)
- Sync GQL collections to/from backend
- Implement GQL collection mappers for sync

**Acceptance Criteria:**
- [ ] GQL collections appear in team workspace
- [ ] GQL collections sync to backend
- [ ] Permissions respected for GQL
- [ ] Real-time updates work

**Files Affected:**
- [packages/hoppscotch-common/src/services/team-collection.service.ts](packages/hoppscotch-common/src/services/team-collection.service.ts)
- [packages/hoppscotch-selfhost-desktop/src/platform/collections/gqlCollections.sync.ts](packages/hoppscotch-selfhost-desktop/src/platform/collections/gqlCollections.sync.ts)

---

### R9: Environment UI for GraphQL

**Priority:** P1 (High)
**Effort:** Small

**Requirements:**
- Add "Environments" tab to unified sidebar
- Reuse existing environment components
- Environment selector in GQL request tabs
- Variable interpolation in GQL queries/variables

**Acceptance Criteria:**
- [ ] Environments tab visible
- [ ] Environment switching works
- [ ] Variables resolve in GQL queries
- [ ] Global + selected environment merging

**Files Affected:**
- [packages/hoppscotch-common/src/components/graphql/Sidebar.vue](packages/hoppscotch-common/src/components/graphql/Sidebar.vue) (deprecate)
- Unified sidebar component (new)

---

### R10: Migration System

**Priority:** P0 (Critical)
**Effort:** Large

**Requirements:**

#### R10.1: Data Migration
- Detect collection version on load
- Auto-migrate v10 → v11 collections
- Auto-migrate GQL requests v9 → v10
- Preserve all existing data
- Log migration errors

#### R10.2: Store Migration
- Detect separate `restCollectionStore` and `graphqlCollectionStore` in localStorage
- Merge stores on first load
- Set migration flag to prevent re-migration

#### R10.3: Tab Migration
- Detect legacy tab format in persistence
- Convert to unified format
- Preserve open tabs and state

**Acceptance Criteria:**
- [ ] Version detection logic implemented
- [ ] Collection migration automated
- [ ] Request migration automated
- [ ] Store merging functional
- [ ] No data loss in migration
- [ ] Migration logs available

**Files Affected:**
- [packages/hoppscotch-common/src/helpers/migrations.ts](packages/hoppscotch-common/src/helpers/migrations.ts)
- New: `packages/hoppscotch-common/src/helpers/migrations/unified-protocol.ts`

---

### R11: Import/Export Updates

**Priority:** P1 (High)
**Effort:** Medium

**Requirements:**
- Update collection exporters to handle mixed collections
- Update importers to detect protocol types
- Add protocol field to exported JSON
- Ensure Postman import detects GraphQL requests
- Support legacy format imports

**Acceptance Criteria:**
- [ ] Exported collections include protocol metadata
- [ ] Imported collections auto-detect protocols
- [ ] Postman GraphQL requests import correctly
- [ ] Legacy collections import correctly

**Files Affected:**
- [packages/hoppscotch-common/src/helpers/import-export/export/](packages/hoppscotch-common/src/helpers/import-export/export/)
- [packages/hoppscotch-common/src/helpers/import-export/import/](packages/hoppscotch-common/src/helpers/import-export/import/)

---

### R12: Routing Updates

**Priority:** P1 (High)
**Effort:** Small

**Requirements:**
- Redirect `/graphql` → `/?protocol=graphql`
- Support deep links: `/?protocol=graphql&request=<id>`
- Preserve query parameters during navigation
- Update all internal links

**Acceptance Criteria:**
- [ ] `/graphql` redirects properly
- [ ] Protocol query param works
- [ ] Deep links functional
- [ ] No broken links

**Files Affected:**
- Router configuration
- Navigation guards

---

## Data Model Changes

### Collection Schema v11

**Location:** `packages/hoppscotch-data/src/collection/v/11.ts` (new)

```typescript
import { defineVersion, entityRefUptoVersion } from "verzod"
import { z } from "zod"
import { HoppCollection } from ".."
import { v10_baseCollectionSchema } from "./10"
import { HoppRESTRequest } from "../../rest"
import { HoppGQLRequest } from "../../graphql"

// Unified request with protocol discriminator
export const HoppRequestWithProtocol = z.discriminatedUnion("protocol", [
  z.object({
    protocol: z.literal("rest"),
    request: HoppRESTRequest.schema,
  }),
  z.object({
    protocol: z.literal("graphql"),
    request: HoppGQLRequest.schema,
  }),
])

export const v11_baseCollectionSchema = v10_baseCollectionSchema.extend({
  v: z.literal(11),
  requests: z.array(HoppRequestWithProtocol),
})

type Input = z.input<typeof v11_baseCollectionSchema> & {
  folders: Input[]
}

type Output = z.output<typeof v11_baseCollectionSchema> & {
  folders: Output[]
}

export const V11_SCHEMA = v11_baseCollectionSchema.extend({
  folders: z.lazy(() => z.array(entityRefUptoVersion(HoppCollection, 11))),
}) as z.ZodType<Output, z.ZodTypeDef, Input>

export default defineVersion({
  initial: false,
  schema: V11_SCHEMA,
  up(old: z.infer<typeof v10_baseCollectionSchema>) {
    // Migration from v10 → v11
    // Infer protocol from request structure
    const requests = old.requests.map((req: any) => {
      // Detect REST vs GQL by checking for method/endpoint vs url/query
      if ("method" in req && "endpoint" in req) {
        return {
          protocol: "rest" as const,
          request: req,
        }
      } else if ("query" in req && "url" in req) {
        return {
          protocol: "graphql" as const,
          request: req,
        }
      }
      // Fallback: try to parse as REST
      return {
        protocol: "rest" as const,
        request: req,
      }
    })

    const result: z.infer<typeof V11_SCHEMA> = {
      ...old,
      v: 11 as const,
      requests,
      folders: old.folders.map((folder) => {
        const result = HoppCollection.safeParseUpToVersion(folder, 11)
        if (result.type !== "ok") {
          throw new Error("Failed to migrate child collections")
        }
        return result.value
      }),
    }

    return result
  },
})
```

### GraphQL Request Schema v10

**Location:** `packages/hoppscotch-data/src/graphql/v/10.ts` (new)

```typescript
import { defineVersion } from "verzod"
import { z } from "zod"
import { v9_schema } from "./9"
import { HoppRESTRequestVariables } from "../../rest/v/2"
import { generateUniqueRefId } from "../../utils/collection"

export const v10_schema = v9_schema.extend({
  v: z.literal(10),
  _ref_id: z.string().optional(),
  preRequestScript: z.string().default(""),
  testScript: z.string().default(""),
  requestVariables: HoppRESTRequestVariables.default([]),
  responses: z.record(z.any()).default({}),  // Similar to REST responses
})

export default defineVersion({
  initial: false,
  schema: v10_schema,
  up(old: z.infer<typeof v9_schema>) {
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
```

---

## Migration Strategy

### Phase 1: Data Structure Migration (Week 1-2)

#### Step 1.1: Collection Schema Update
- Implement collection v11 schema
- Add migration logic v10 → v11
- Test with sample collections
- Verify no data loss

#### Step 1.2: GQL Request Update
- Implement GQL request v10 schema
- Add migration logic v9 → v10
- Generate `_ref_id` for existing GQL requests
- Test script execution

#### Step 1.3: Migration Utilities
**File:** `packages/hoppscotch-common/src/helpers/migrations/unified-protocol.ts`

```typescript
import { restCollectionStore, graphqlCollectionStore } from "~/newstore/collections"
import { HoppCollection } from "@hoppscotch/data"

export function migrateToUnifiedProtocol(): void {
  const MIGRATION_KEY = "unified_protocol_migrated"

  // Check if already migrated
  if (localStorage.getItem(MIGRATION_KEY) === "true") {
    return
  }

  try {
    console.log("[Migration] Starting unified protocol migration...")

    // Step 1: Get current collections
    const restCollections = restCollectionStore.value.state
    const gqlCollections = graphqlCollectionStore.value.state

    // Step 2: Migrate collections to v11
    const migratedRestCollections = restCollections.map((col: any) => {
      const result = HoppCollection.safeParse(col)
      return result.type === "ok" ? result.value : col
    })

    const migratedGQLCollections = gqlCollections.map((col: any) => {
      const result = HoppCollection.safeParse(col)
      return result.type === "ok" ? result.value : col
    })

    // Step 3: Merge into unified store (handled by new store initialization)
    // Step 4: Mark migration complete
    localStorage.setItem(MIGRATION_KEY, "true")

    console.log("[Migration] Unified protocol migration complete")
    console.log(`[Migration] Migrated ${migratedRestCollections.length} REST collections`)
    console.log(`[Migration] Migrated ${migratedGQLCollections.length} GQL collections`)

  } catch (error) {
    console.error("[Migration] Failed to migrate to unified protocol:", error)
    // Don't set migration flag - allow retry on next load
  }
}
```

**Integration:** Call `migrateToUnifiedProtocol()` in [packages/hoppscotch-common/src/helpers/migrations.ts](packages/hoppscotch-common/src/helpers/migrations.ts:8)

```typescript
export function performMigrations(): void {
  // Existing migrations...

  // Unified protocol migration
  migrateToUnifiedProtocol()
}
```

### Phase 2: Store Unification (Week 2-3)

#### Step 2.1: Unified Store Implementation
- Refactor `collections.ts` to single store
- Implement protocol-aware dispatchers
- Add protocol discriminator logic
- Maintain separate localStorage keys initially (for rollback)

#### Step 2.2: Store Migration on Load
- Detect old store structure
- Load both `restCollectionStore` and `graphqlCollectionStore` from localStorage
- Merge into new `collectionStore`
- Write back to unified storage key

#### Step 2.3: Backward Compatibility Layer
- Keep old store exports for gradual migration
- Add deprecation warnings
- Update all consumers to use new store

### Phase 3: Tab Service Unification (Week 3-4)

#### Step 3.1: Unified Tab Service
**File:** `packages/hoppscotch-common/src/services/tab/unified.ts`

```typescript
import { TabService, HoppTab } from "./tab"
import { HoppRESTDocument } from "~/helpers/rest/document"
import { HoppGQLDocument } from "~/helpers/graphql/document"

export type HoppUnifiedDocument =
  | { protocol: "rest"; doc: HoppRESTDocument }
  | { protocol: "graphql"; doc: HoppGQLDocument }

export class UnifiedTabService extends TabService<HoppUnifiedDocument> {
  // Override methods to handle protocol-specific logic

  getTabRefWithSaveContext(
    protocol: "rest" | "graphql",
    saveContext: any
  ): Ref<HoppTab<HoppUnifiedDocument>> | null {
    return this.tabTree.value.find((tab) => {
      if (tab.document.protocol !== protocol) return false

      if (protocol === "rest") {
        const restDoc = tab.document.doc as HoppRESTDocument
        // REST-specific matching logic
      } else {
        const gqlDoc = tab.document.doc as HoppGQLDocument
        // GQL-specific matching logic
      }
    })
  }

  getTabRefWithRefId(
    protocol: "rest" | "graphql",
    refId: string
  ): Ref<HoppTab<HoppUnifiedDocument>> | null {
    return this.tabTree.value.find((tab) => {
      if (tab.document.protocol !== protocol) return false

      if (protocol === "rest") {
        const restDoc = tab.document.doc as HoppRESTDocument
        return restDoc.request._ref_id === refId
      } else {
        const gqlDoc = tab.document.doc as HoppGQLDocument
        return gqlDoc.request._ref_id === refId
      }
    })
  }

  // Protocol-specific persistable state
  getPersistableTabState(tab: HoppTab<HoppUnifiedDocument>) {
    if (tab.document.protocol === "rest") {
      // REST-specific: remove response
      const restDoc = tab.document.doc as HoppRESTDocument
      return {
        ...tab,
        document: {
          protocol: "rest",
          doc: {
            ...restDoc,
            response: null,
          }
        }
      }
    } else {
      // GQL-specific: keep all state
      return tab
    }
  }
}
```

#### Step 3.2: Tab Migration
- Detect legacy tab format in localStorage
- Convert REST tabs to `{ protocol: "rest", doc: ... }`
- Convert GQL tabs to `{ protocol: "graphql", doc: ... }`
- Write back to storage

### Phase 4: UI Unification (Week 4-6)

#### Step 4.1: Unified Page Component
- Create new unified page at `/`
- Add protocol switcher in tab header
- Implement dynamic component rendering
- Integrate REST and GQL request panels

#### Step 4.2: Protocol Switcher Component
**File:** `packages/hoppscotch-common/src/components/app/ProtocolSwitcher.vue`

```vue
<template>
  <HoppSmartSelect
    v-model="selectedProtocol"
    :options="protocolOptions"
    @update:modelValue="onProtocolChange"
  >
    <template #selected>
      <component :is="getProtocolIcon(selectedProtocol)" class="svg-icons" />
      {{ getProtocolLabel(selectedProtocol) }}
    </template>
  </HoppSmartSelect>
</template>

<script setup lang="ts">
import { ref, computed } from "vue"
import { useRouter } from "vue-router"
import IconRest from "~icons/custom/rest"
import IconGraphQL from "~icons/custom/graphql"

const props = defineProps<{
  modelValue: "rest" | "graphql"
}>()

const emit = defineEmits<{
  (e: "update:modelValue", value: "rest" | "graphql"): void
}>()

const selectedProtocol = computed({
  get: () => props.modelValue,
  set: (val) => emit("update:modelValue", val),
})

const protocolOptions = [
  { value: "rest", label: "REST" },
  { value: "graphql", label: "GraphQL" },
]

const getProtocolIcon = (protocol: string) => {
  return protocol === "rest" ? IconRest : IconGraphQL
}

const getProtocolLabel = (protocol: string) => {
  return protocol === "rest" ? "REST" : "GraphQL"
}

const onProtocolChange = (protocol: "rest" | "graphql") => {
  // Convert current request to new protocol (optional)
  // Or create new blank request
  emit("update:modelValue", protocol)
}
</script>
```

#### Step 4.3: Collection Tree Updates
- Add protocol icons to request items
- Implement mixed collection support
- Enable drag-and-drop across protocols
- Add protocol filter (optional)

#### Step 4.4: Unified Sidebar
- Merge REST and GQL sidebars
- Add Environments tab (always visible)
- Schema explorer (GQL-only, conditional)
- Unified history (all protocols)

### Phase 5: GQL Feature Parity (Week 6-7)

#### Step 5.1: GQL Scripts
- Integrate script runner with GQL requests
- Execute pre-request scripts before GQL operations
- Execute test scripts after GQL responses
- Handle subscriptions (continuous responses)

#### Step 5.2: GQL Request Variables
- Add request variables UI to GQL panel
- Resolve variables in GQL query before execution
- Maintain separation from GraphQL query variables (JSON)

#### Step 5.3: GQL Team Workspaces
- Update `TeamCollectionsService` to handle GQL
- Implement GQL collection sync
- Test permissions and access control
- Real-time updates for GQL collections

#### Step 5.4: Environment UI
- Add environment selector to GQL request tabs
- Ensure variable resolution works in queries and variables
- Test global + selected environment merging

### Phase 6: Import/Export (Week 7-8)

#### Step 6.1: Export Updates
- Update collection exporter to preserve protocol metadata
- Ensure exported JSON includes `{ protocol: "rest" | "graphql" }`
- Test round-trip (export → import)

#### Step 6.2: Import Updates
- Update Postman importer to detect GraphQL requests
- Update Hoppscotch importer to handle protocol field
- Add fallback logic for protocol detection
- Test legacy collection imports

#### Step 6.3: AST Parsing for Smart Detection
**File:** `packages/hoppscotch-common/src/helpers/import-export/import/protocol-detector.ts`

```typescript
import { parse } from "graphql"

export function detectRequestProtocol(request: any): "rest" | "graphql" {
  // Explicit protocol field
  if (request.protocol) {
    return request.protocol
  }

  // Heuristic detection

  // Check for GraphQL-specific fields
  if ("query" in request || "graphql" in request) {
    return "graphql"
  }

  // Check for REST-specific fields
  if ("method" in request && "endpoint" in request) {
    return "rest"
  }

  // Try parsing request body as GraphQL
  if (request.body?.graphql?.query) {
    try {
      parse(request.body.graphql.query)
      return "graphql"
    } catch {
      // Not valid GraphQL
    }
  }

  // Postman GraphQL detection
  if (request.request?.body?.mode === "graphql") {
    return "graphql"
  }

  // Default to REST
  return "rest"
}

export function migrateImportedCollection(collection: any): HoppCollection {
  // Recursively process requests and add protocol field
  const migrateRequests = (requests: any[]) => {
    return requests.map((req) => {
      const protocol = detectRequestProtocol(req)
      return {
        protocol,
        request: protocol === "rest"
          ? translateToRESTRequest(req)
          : translateToGQLRequest(req),
      }
    })
  }

  const migrateCollection = (col: any): HoppCollection => {
    return {
      ...col,
      requests: migrateRequests(col.requests || []),
      folders: (col.folders || []).map(migrateCollection),
    }
  }

  return migrateCollection(collection)
}
```

### Phase 7: Testing & Refinement (Week 8-9)

#### Step 7.1: Unit Tests
- Collection migration tests
- Request migration tests
- Store unification tests
- Protocol detection tests

#### Step 7.2: Integration Tests
- Tab service tests
- Workspace sync tests
- Import/export tests
- Script execution tests

#### Step 7.3: E2E Tests
- Full user flows
- Protocol switching
- Mixed collections
- Team collaboration

### Phase 8: Documentation & Rollout (Week 9-10)

#### Step 8.1: User Documentation
- Migration guide for existing users
- New features guide (GQL parity)
- Protocol switching guide
- Mixed collections best practices

#### Step 8.2: Developer Documentation
- Architecture changes
- API updates
- Extension guidelines (future protocols)

#### Step 8.3: Rollout Plan
- Feature flag for gradual rollout
- Beta testing with select users
- Monitor error rates and performance
- Full release

---

## Implementation Plan

### Timeline: 10 Weeks

#### Week 1-2: Data Model & Migration Foundation
- [ ] Implement collection v11 schema
- [ ] Implement GQL request v10 schema
- [ ] Build migration utilities
- [ ] Test migrations thoroughly

#### Week 2-3: Store Unification
- [ ] Refactor collection store
- [ ] Implement unified dispatchers
- [ ] Add protocol-aware operations
- [ ] Test store operations

#### Week 3-4: Tab Service
- [ ] Implement UnifiedTabService
- [ ] Tab migration logic
- [ ] Protocol-specific state handling
- [ ] Test tab switching

#### Week 4-6: UI Unification
- [ ] Create unified page component
- [ ] Protocol switcher component
- [ ] Collection tree updates
- [ ] Unified sidebar

#### Week 6-7: GQL Feature Parity
- [ ] GQL scripts integration
- [ ] GQL request variables
- [ ] GQL team workspaces
- [ ] Environment UI

#### Week 7-8: Import/Export
- [ ] Update exporters
- [ ] Update importers
- [ ] Protocol detection
- [ ] Legacy support

#### Week 8-9: Testing
- [ ] Unit tests
- [ ] Integration tests
- [ ] E2E tests
- [ ] Bug fixes

#### Week 9-10: Documentation & Rollout
- [ ] User docs
- [ ] Developer docs
- [ ] Beta testing
- [ ] Full release

---

## Testing Strategy

### Unit Tests

#### Data Model Tests
```typescript
// packages/hoppscotch-data/__tests__/collection-v11.spec.ts
describe("Collection v11 Migration", () => {
  it("should migrate v10 REST collection to v11", () => {
    const v10Collection = {
      v: 10,
      name: "Test Collection",
      requests: [
        {
          v: "16",
          name: "GET Request",
          method: "GET",
          endpoint: "https://api.example.com",
          // ... other REST fields
        },
      ],
      folders: [],
      auth: { authType: "none", authActive: false },
      headers: [],
      variables: [],
    }

    const result = HoppCollection.safeParse(v10Collection)

    expect(result.type).toBe("ok")
    expect(result.value.v).toBe(11)
    expect(result.value.requests[0].protocol).toBe("rest")
  })

  it("should migrate v10 GQL collection to v11", () => {
    const v10Collection = {
      v: 10,
      name: "GraphQL Collection",
      requests: [
        {
          v: 9,
          name: "Query",
          url: "https://api.example.com/graphql",
          query: "query { user { id name } }",
          variables: "{}",
          headers: [],
          auth: { authType: "none", authActive: false },
        },
      ],
      folders: [],
      auth: { authType: "none", authActive: false },
      headers: [],
      variables: [],
    }

    const result = HoppCollection.safeParse(v10Collection)

    expect(result.type).toBe("ok")
    expect(result.value.v).toBe(11)
    expect(result.value.requests[0].protocol).toBe("graphql")
  })
})
```

#### Store Tests
```typescript
// packages/hoppscotch-common/__tests__/newstore/unified-collections.spec.ts
describe("Unified Collection Store", () => {
  it("should add REST request to collection", () => {
    const restRequest = getDefaultRESTRequest()
    collectionStore.dispatch(addRequest({ collectionIndex: 0, request: restRequest }))

    const collection = collectionStore.value.state[0]
    expect(collection.requests[0].protocol).toBe("rest")
  })

  it("should add GQL request to collection", () => {
    const gqlRequest = getDefaultGQLRequest()
    collectionStore.dispatch(addRequest({ collectionIndex: 0, request: gqlRequest }))

    const collection = collectionStore.value.state[0]
    expect(collection.requests[0].protocol).toBe("graphql")
  })

  it("should support mixed requests in same collection", () => {
    const restRequest = getDefaultRESTRequest()
    const gqlRequest = getDefaultGQLRequest()

    collectionStore.dispatch(addRequest({ collectionIndex: 0, request: restRequest }))
    collectionStore.dispatch(addRequest({ collectionIndex: 0, request: gqlRequest }))

    const collection = collectionStore.value.state[0]
    expect(collection.requests.length).toBe(2)
    expect(collection.requests[0].protocol).toBe("rest")
    expect(collection.requests[1].protocol).toBe("graphql")
  })
})
```

### Integration Tests

#### Tab Service Tests
```typescript
// packages/hoppscotch-common/__tests__/services/unified-tab.spec.ts
describe("UnifiedTabService", () => {
  it("should create REST tab", () => {
    const tabService = new UnifiedTabService()
    const restDoc = { protocol: "rest", doc: createRESTDocument() }

    const tab = tabService.createNewTab(restDoc)
    expect(tab.document.protocol).toBe("rest")
  })

  it("should switch protocol in tab", () => {
    const tabService = new UnifiedTabService()
    const restDoc = { protocol: "rest", doc: createRESTDocument() }
    const tab = tabService.createNewTab(restDoc)

    // Switch to GraphQL
    const gqlDoc = { protocol: "graphql", doc: createGQLDocument() }
    tabService.updateTabDocument(tab.id, gqlDoc)

    expect(tab.document.protocol).toBe("graphql")
  })
})
```

### E2E Tests

#### User Flow Tests
```typescript
// packages/hoppscotch-common/__tests__/e2e/unified-protocol.spec.ts
describe("Unified Protocol Experience", () => {
  it("should create mixed collection", () => {
    // User creates collection
    cy.visit("/")
    cy.get("[data-testid='new-collection']").click()
    cy.get("[data-testid='collection-name']").type("Mixed Collection")

    // Add REST request
    cy.get("[data-testid='new-request']").click()
    cy.get("[data-testid='protocol-switcher']").select("REST")
    cy.get("[data-testid='request-name']").type("GET Users")

    // Add GraphQL request
    cy.get("[data-testid='new-request']").click()
    cy.get("[data-testid='protocol-switcher']").select("GraphQL")
    cy.get("[data-testid='request-name']").type("Get User Query")

    // Verify both requests exist
    cy.get("[data-testid='request-item']").should("have.length", 2)
  })

  it("should switch protocols in tab", () => {
    cy.visit("/")

    // Open REST request
    cy.get("[data-testid='rest-request']").click()
    expect(cy.get("[data-testid='method-select']")).toExist()

    // Switch to GraphQL
    cy.get("[data-testid='protocol-switcher']").select("GraphQL")
    expect(cy.get("[data-testid='graphql-query-editor']")).toExist()
  })
})
```

---

## Risks & Mitigations

### Risk 1: Data Loss During Migration

**Severity:** Critical
**Likelihood:** Medium

**Mitigation:**
- Comprehensive testing on sample datasets
- Backup mechanism before migration
- Rollback capability if migration fails
- Migration dry-run mode for validation
- Extensive logging of migration steps

### Risk 2: Performance Degradation

**Severity:** High
**Likelihood:** Low

**Mitigation:**
- Protocol discriminator is lightweight
- No additional network requests
- Lazy loading of protocol-specific components
- Performance benchmarks before/after
- Profiling of critical paths

### Risk 3: Breaking Changes for Extensions/Plugins

**Severity:** Medium
**Likelihood:** High

**Mitigation:**
- Deprecation warnings in advance
- Backward compatibility layer for 2-3 releases
- Migration guide for extension developers
- Early communication with extension authors

### Risk 4: User Confusion

**Severity:** Medium
**Likelihood:** Medium

**Mitigation:**
- Clear in-app onboarding for new unified experience
- Tooltips and help text for protocol switcher
- Video tutorials demonstrating new features
- Gradual rollout with feature flag

### Risk 5: Backend API Incompatibility

**Severity:** High
**Likelihood:** Low

**Mitigation:**
- Verify backend API supports GQL team collections
- Coordinate with backend team for changes
- Feature detection for API capabilities
- Graceful degradation if features unavailable

---

## Success Metrics

### User Adoption
- **Target:** 80% of users successfully migrated within 1 month
- **Measure:** Track migration completion rate via telemetry

### Feature Usage
- **Target:** 30% increase in GraphQL usage within 3 months
- **Measure:** Track GQL request counts vs REST

### Mixed Collections
- **Target:** 20% of collections contain both REST and GQL requests
- **Measure:** Collection composition analysis

### User Satisfaction
- **Target:** NPS score ≥ 50 for unified experience
- **Measure:** In-app surveys and feedback

### Performance
- **Target:** No regression in page load time or request execution
- **Measure:** Performance monitoring before/after release

### Support Tickets
- **Target:** < 5% increase in support tickets post-release
- **Measure:** Support ticket volume and categories

---

## Appendix

### A. Key Files Reference

#### Data Model
- [packages/hoppscotch-data/src/collection/index.ts](packages/hoppscotch-data/src/collection/index.ts) - Collection types
- [packages/hoppscotch-data/src/rest/index.ts](packages/hoppscotch-data/src/rest/index.ts) - REST request types
- [packages/hoppscotch-data/src/graphql/index.ts](packages/hoppscotch-data/src/graphql/index.ts) - GQL request types

#### State Management
- [packages/hoppscotch-common/src/newstore/collections.ts](packages/hoppscotch-common/src/newstore/collections.ts) - Collection stores
- [packages/hoppscotch-common/src/newstore/environments.ts](packages/hoppscotch-common/src/newstore/environments.ts) - Environment store

#### Services
- [packages/hoppscotch-common/src/services/workspace.service.ts](packages/hoppscotch-common/src/services/workspace.service.ts) - Workspace management
- [packages/hoppscotch-common/src/services/team-collection.service.ts](packages/hoppscotch-common/src/services/team-collection.service.ts) - Team collections
- [packages/hoppscotch-common/src/services/tab/rest.ts](packages/hoppscotch-common/src/services/tab/rest.ts) - REST tab service
- [packages/hoppscotch-common/src/services/tab/graphql.ts](packages/hoppscotch-common/src/services/tab/graphql.ts) - GQL tab service

#### Components
- [packages/hoppscotch-common/src/pages/index.vue](packages/hoppscotch-common/src/pages/index.vue) - REST page
- [packages/hoppscotch-common/src/pages/graphql.vue](packages/hoppscotch-common/src/pages/graphql.vue) - GraphQL page
- [packages/hoppscotch-common/src/components/collections/MyCollections.vue](packages/hoppscotch-common/src/components/collections/MyCollections.vue) - Collection tree

#### Migrations
- [packages/hoppscotch-common/src/helpers/migrations.ts](packages/hoppscotch-common/src/helpers/migrations.ts) - Migration runner

### B. Glossary

- **Protocol:** The API protocol type (REST, GraphQL, gRPC, etc.)
- **Collection:** A folder containing requests, subfolders, and metadata
- **Request:** A single API call definition (method, URL, body, etc.)
- **Workspace:** A context for organizing collections (personal or team)
- **Tab:** An open request in the UI editor
- **Save Context:** Metadata linking a tab to its collection location
- **`_ref_id`:** Unique reference ID for sync tracking
- **Verzod:** Version-aware Zod schema library used for data migrations

### C. Related Documents

- GraphQL Connection Architecture: [packages/hoppscotch-common/src/helpers/graphql/connection.ts](packages/hoppscotch-common/src/helpers/graphql/connection.ts)
- REST Document Structure: [packages/hoppscotch-common/src/helpers/rest/document.ts](packages/hoppscotch-common/src/helpers/rest/document.ts)
- GQL Document Structure: [packages/hoppscotch-common/src/helpers/graphql/document.ts](packages/hoppscotch-common/src/helpers/graphql/document.ts)
- Import/Export System: [packages/hoppscotch-common/src/helpers/import-export/](packages/hoppscotch-common/src/helpers/import-export/)

---

**Document Version:** 1.0
**Last Updated:** 2025-11-11
**Next Review:** After Phase 1 completion
