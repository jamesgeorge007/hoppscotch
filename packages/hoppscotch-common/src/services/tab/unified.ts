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
        // GraphQL: Keep all state (responses are streamed events)
        return {
          tabID: tab.id,
          doc: tab.document,
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

    // Fallback: Try loading REST tabs and convert
    const restState = await persistenceService.getNullable<any>(
      STORE_KEYS.REST_TABS
    )

    if (restState) {
      // Convert REST tabs to unified format
      return {
        lastActiveTabID: restState.lastActiveTabID,
        orderedDocs: restState.orderedDocs.map((item: any) => ({
          tabID: item.tabID,
          doc: {
            protocol: "rest",
            ...item.doc,
          } as HoppUnifiedDocument,
        })),
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
   * Get tab by request reference ID (protocol-aware)
   */
  public getTabRefWithRefId(protocol: "rest" | "graphql", refId: string) {
    for (const tab of this.tabMap.values()) {
      if (tab.document.protocol !== protocol) continue

      if (protocol === "rest" && isRESTDocument(tab.document)) {
        if (tab.document.request._ref_id === refId) {
          return this.getTabRef(tab.id)
        }
      } else if (protocol === "graphql" && isGQLDocument(tab.document)) {
        if (tab.document.request._ref_id === refId) {
          return this.getTabRef(tab.id)
        }
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

  /**
   * Convert a tab to a different protocol
   * This creates a new request of the target protocol
   */
  public async convertTabProtocol(
    tabID: string,
    targetProtocol: "rest" | "graphql"
  ) {
    const tab = this.tabMap.get(tabID)
    if (!tab) return

    if (tab.document.protocol === targetProtocol) {
      // Already the target protocol
      return
    }

    // Create a new document of the target protocol
    if (targetProtocol === "rest") {
      const newDoc = createDefaultRESTDocument()
      newDoc.isDirty = true // Mark as dirty since it's a conversion

      // Try to preserve some fields
      if (isGQLDocument(tab.document)) {
        newDoc.request.name = tab.document.request.name || "Converted Request"
        newDoc.request.endpoint =
          tab.document.request.url || "https://echo.hoppscotch.io"
      }

      tab.document = newDoc
    } else if (targetProtocol === "graphql") {
      const { createDefaultGQLDocument } =
        await import("~/helpers/unified/document")
      const newDoc = createDefaultGQLDocument()
      newDoc.isDirty = true

      // Try to preserve some fields
      if (isRESTDocument(tab.document)) {
        newDoc.request.name = tab.document.request.name || "Converted Query"
        newDoc.request.url =
          tab.document.request.endpoint || "https://echo.hoppscotch.io/graphql"
      }

      tab.document = newDoc
    }

    // Update the tab
    this.updateTab(tab)
  }
}
