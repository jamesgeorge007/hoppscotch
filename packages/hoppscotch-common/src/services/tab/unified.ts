/**
 * Unified Tab Service
 *
 * This service manages tabs for both REST and GraphQL protocols in a unified interface.
 * It extends the base TabService and provides protocol-aware operations.
 */

import { Container } from "dioc"
import { computed } from "vue"
import { PersistableTabState, TabService } from "./tab"
import {
  HoppUnifiedDocument,
  isRESTDocument,
  isGQLDocument,
  createDefaultRESTDocument,
} from "~/helpers/unified/document"

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
   * Persistence loading is handled by PersistenceService.setupUnifiedTabsPersistence()
   * which calls loadTabsFromPersistedState() directly with migration support.
   */
  protected override async loadPersistedState(): Promise<PersistableTabState<HoppUnifiedDocument> | null> {
    return null
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
