/**
 * Unified Tab Service
 *
 * This service manages tabs for both REST and GraphQL protocols in a unified interface.
 * It extends the base TabService and provides protocol-aware operations.
 */

import { Container } from "dioc"
import { computed } from "vue"
import { TabService } from "./tab"
import { PersistableTabState } from "."
import {
  HoppUnifiedDocument,
  isRESTDocument,
  isGQLDocument,
  createDefaultRESTDocument,
} from "~/helpers/unified/document"
import { getService } from "~/modules/dioc"
import { PersistenceService, STORE_KEYS } from "../persistence"

export class UnifiedTabService extends TabService<HoppUnifiedDocument> {
  public static readonly ID = "UNIFIED_TAB_SERVICE"

  constructor(c: Container) {
    super(c)

    // Initialize with a default REST tab
    this.tabMap.set("test", {
      id: "test",
      document: createDefaultRESTDocument(),
    })

    this.watchCurrentTabID()
  }

  /**
   * Override persistable state to handle protocol-specific persistence
   */
  public override persistableTabState = computed(() => ({
    lastActiveTabID: this.currentTabID.value,
    orderedDocs: this.tabOrdering.value.map((tabID) => {
      const tab = this.tabMap.get(tabID)!

      // Protocol-specific persistence logic
      if (isRESTDocument(tab.document)) {
        // REST: Remove response to save space
        return {
          tabID: tab.id,
          doc: {
            ...tab.document,
            response: null,
            testResults: null,
          },
        }
      } else if (isGQLDocument(tab.document)) {
        // GraphQL: Remove response to save space (matches GQLTabService behaviour)
        return {
          tabID: tab.id,
          doc: {
            ...tab.document,
            response: null,
          },
        }
      }

      return {
        tabID: tab.id,
        doc: tab.document,
      }
    }),
  }))

  protected async loadPersistedState(): Promise<PersistableTabState<HoppUnifiedDocument> | null> {
    const persistenceService = getService(PersistenceService)

    // Try loading unified tabs first
    const unifiedState = await persistenceService.getNullable<
      PersistableTabState<HoppUnifiedDocument>
    >(STORE_KEYS.UNIFIED_TABS)

    if (unifiedState) {
      return unifiedState
    }

    // Fallback: Try loading both REST and GQL tabs and convert
    const restState = await persistenceService.getNullable<any>(
      STORE_KEYS.REST_TABS
    )
    const gqlState = await persistenceService.getNullable<any>(
      STORE_KEYS.GQL_TABS
    )

    const orderedDocs: any[] = []

    if (restState) {
      orderedDocs.push(
        ...(restState.orderedDocs ?? []).map((item: any) => ({
          tabID: item.tabID,
          doc: {
            protocol: "rest" as const,
            ...item.doc,
          } as HoppUnifiedDocument,
        }))
      )
    }

    if (gqlState) {
      orderedDocs.push(
        ...(gqlState.orderedDocs ?? []).map((item: any) => ({
          tabID: item.tabID,
          doc: {
            protocol: "graphql" as const,
            ...item.doc,
          } as HoppUnifiedDocument,
        }))
      )
    }

    if (orderedDocs.length > 0) {
      return {
        lastActiveTabID:
          restState?.lastActiveTabID ??
          gqlState?.lastActiveTabID ??
          orderedDocs[0].tabID,
        orderedDocs,
      }
    }

    return null
  }

  /**
   * Get tab by save context (protocol-aware)
   */
  public getTabRefWithSaveContext(
    protocol: "rest" | "graphql",
    saveContext: any
  ) {
    for (const tab of this.tabMap.values()) {
      // Skip tabs of different protocol
      if (tab.document.protocol !== protocol) continue

      if (protocol === "rest" && isRESTDocument(tab.document)) {
        // REST-specific matching logic
        const ctx = tab.document.saveContext

        if (!ctx || !saveContext) continue

        if (saveContext.originLocation === "team-collection") {
          if (
            ctx.originLocation === "team-collection" &&
            ctx.requestID === saveContext.requestID &&
            ctx.exampleID === saveContext.exampleID
          ) {
            return this.getTabRef(tab.id)
          }
        } else if (
          ctx.originLocation === "user-collection" &&
          ctx.folderPath === saveContext.folderPath &&
          ctx.requestIndex === saveContext.requestIndex &&
          ctx.exampleID === saveContext.exampleID &&
          ctx.requestRefID === saveContext.requestRefID
        ) {
          return this.getTabRef(tab.id)
        }
      } else if (protocol === "graphql" && isGQLDocument(tab.document)) {
        // GraphQL-specific matching logic
        const ctx = tab.document.saveContext

        if (!ctx || !saveContext) continue

        if (saveContext.originLocation === "team-collection") {
          if (
            ctx.originLocation === "team-collection" &&
            ctx.requestID === saveContext.requestID
          ) {
            return this.getTabRef(tab.id)
          }
        } else if (
          ctx.originLocation === "user-collection" &&
          ctx.folderPath === saveContext.folderPath &&
          ctx.requestIndex === saveContext.requestIndex
        ) {
          return this.getTabRef(tab.id)
        }
      }
    }

    return null
  }

  /**
   * Get tab by request reference ID.
   * Only supports REST tabs — HoppGQLRequest v9 does not have _ref_id.
   */
  public getTabRefWithRefId(refId: string) {
    for (const tab of this.tabMap.values()) {
      if (!isRESTDocument(tab.document)) continue

      if (tab.document.request._ref_id === refId) {
        return this.getTabRef(tab.id)
      }
    }

    return null
  }

  /**
   * Get count of dirty tabs (protocol-agnostic)
   */
  public getDirtyTabsCount() {
    let count = 0

    for (const tab of this.tabMap.values()) {
      if (tab.document.isDirty) count++
    }

    return count
  }

  /**
   * Get tabs filtered by protocol
   */
  public getTabsByProtocol(protocol: "rest" | "graphql") {
    return Array.from(this.tabMap.values()).filter(
      (tab) => tab.document.protocol === protocol
    )
  }

}
