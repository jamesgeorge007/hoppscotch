import { Container } from "dioc"
import { computed } from "vue"
import { TabService } from "./tab"
import type { PersistableTabState } from "."
import {
  HoppUnifiedDocument,
  HoppUnifiedSaveContext,
  isRESTDocument,
  isGQLDocument,
  isExampleResponseDocument,
  isTestRunnerDocument,
  createDefaultRESTDocument,
} from "~/helpers/unified/document"

export class UnifiedTabService extends TabService<HoppUnifiedDocument> {
  public static readonly ID = "UNIFIED_TAB_SERVICE"

  constructor(c: Container) {
    super(c)

    this.tabMap.set("test", {
      id: "test",
      document: createDefaultRESTDocument(),
    })

    this.watchCurrentTabID()
  }

  // Persistence loading handled by PersistenceService.setupUnifiedTabsPersistence()
  protected override async loadPersistedState(): Promise<PersistableTabState<HoppUnifiedDocument> | null> {
    return null
  }

  public override persistableTabState = computed(() => {
    const orderedDocs = this.tabOrdering.value
      .filter((tabID) => {
        const tab = this.tabMap.get(tabID)
        // Don't persist transient tabs (example responses, test runner)
        return tab && !isExampleResponseDocument(tab.document) && !isTestRunnerDocument(tab.document)
      })
      .map((tabID) => {
        const tab = this.tabMap.get(tabID)!

        if (isRESTDocument(tab.document)) {
          return {
            tabID: tab.id,
            doc: {
              ...tab.document,
              response: null,
              testResults: null,
            },
          }
        }

        if (isGQLDocument(tab.document)) {
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
      })

    const persistedIDs = new Set(orderedDocs.map((d) => d.tabID))
    const lastActiveTabID = persistedIDs.has(this.currentTabID.value)
      ? this.currentTabID.value
      : orderedDocs[0]?.tabID ?? this.currentTabID.value

    return { lastActiveTabID, orderedDocs }
  })

  public getTabRefWithSaveContext(
    protocol: "rest" | "graphql",
    saveContext: HoppUnifiedSaveContext
  ) {
    for (const tab of this.tabMap.values()) {
      if (isTestRunnerDocument(tab.document)) continue
      if (tab.document.protocol !== protocol) continue

      if (
        protocol === "rest" &&
        (isRESTDocument(tab.document) || isExampleResponseDocument(tab.document))
      ) {
        const ctx = tab.document.saveContext
        const restSaveCtx = saveContext as Exclude<
          import("~/helpers/rest/document").HoppRESTSaveContext,
          null
        >

        if (!ctx || !restSaveCtx) continue

        if (restSaveCtx.originLocation === "team-collection") {
          if (
            ctx.originLocation === "team-collection" &&
            ctx.requestID === restSaveCtx.requestID &&
            ctx.exampleID === restSaveCtx.exampleID
          ) {
            return this.getTabRef(tab.id)
          }
        } else if (
          restSaveCtx.originLocation === "user-collection" &&
          ctx.originLocation === "user-collection" &&
          ctx.folderPath === restSaveCtx.folderPath &&
          ctx.requestIndex === restSaveCtx.requestIndex &&
          ctx.exampleID === restSaveCtx.exampleID &&
          ctx.requestRefID === restSaveCtx.requestRefID
        ) {
          return this.getTabRef(tab.id)
        }
      } else if (protocol === "graphql" && isGQLDocument(tab.document)) {
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
          saveContext.originLocation === "user-collection" &&
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

  // Only supports REST tabs — HoppGQLRequest v9 does not have _ref_id
  public getTabRefWithRefId(refId: string) {
    for (const tab of this.tabMap.values()) {
      if (!isRESTDocument(tab.document)) continue

      if (tab.document.request._ref_id === refId) {
        return this.getTabRef(tab.id)
      }
    }

    return null
  }

  public getDirtyTabsCount() {
    let count = 0

    for (const tab of this.tabMap.values()) {
      if (tab.document.isDirty) count++
    }

    return count
  }

}
