<template>
  <div>
    <AppPaneLayout layout-id="unified">
      <template #primary>
        <HoppSmartWindows
          v-if="currentTabID"
          :id="'unified_windows'"
          v-model="currentTabID"
          @remove-tab="removeTab"
          @add-tab="addNewTab"
          @sort="sortTabs"
        >
          <HoppSmartWindow
            v-for="tab in activeTabs"
            :id="tab.id"
            :key="tab.id"
            :label="getTabName(tab)"
            :is-removable="activeTabs.length > 1"
            :close-visibility="'hover'"
          >
            <template v-if="isRESTDocument(tab.document)" #tabhead>
              <!-- REST TabHead -->
              <HttpTabHead
                :tab="tab"
                :is-removable="activeTabs.length > 1"
                @open-rename-modal="openReqRenameModal(tab.id)"
                @close-tab="removeTab(tab.id)"
                @close-other-tabs="closeOtherTabsAction(tab.id)"
                @duplicate-tab="duplicateTab(tab.id)"
                @share-tab-request="shareTabRequest(tab.id)"
              />
            </template>
            <template v-else-if="isGQLDocument(tab.document)" #tabhead>
              <!-- GraphQL TabHead -->
              <GraphqlTabHead
                :tab="tab"
                :is-removable="activeTabs.length > 1"
                @open-rename-modal="openReqRenameModal(tab.id)"
                @close-tab="removeTab(tab.id)"
                @close-other-tabs="closeOtherTabsAction(tab.id)"
                @duplicate-tab="duplicateTab(tab.id)"
              />
            </template>
            <template v-else #tabhead>
              <!-- Fallback: Unknown protocol -->
              <div class="text-red-500">
                Unknown Protocol: {{ tab.document.protocol }}
              </div>
            </template>
            <template #suffix>
              <span
                v-if="tab.document.isDirty"
                class="flex w-4 items-center justify-center text-secondary group-hover:hidden"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="1.2em"
                  height="1.2em"
                  class="h-1.5 w-1.5"
                >
                  <circle cx="12" cy="12" r="12" fill="currentColor"></circle>
                </svg>
              </span>
            </template>

            <!-- Dynamic Request Panel based on protocol -->
            <component
              :is="getRequestComponent(tab.document.protocol)"
              :model-value="tab"
              @update:model-value="onTabUpdate"
              @switch-protocol="
                switchTabProtocol(
                  tab.id,
                  tab.document.protocol === 'rest' ? 'graphql' : 'rest'
                )
              "
            />
          </HoppSmartWindow>
          <template #actions>
            <EnvironmentsSelector class="h-full" />
          </template>
        </HoppSmartWindows>
      </template>
      <template #sidebar>
        <UnifiedSidebar :protocol="currentProtocol" />
      </template>
    </AppPaneLayout>
    <CollectionsEditRequest
      v-model="reqName"
      :request-context="requestToRename"
      :show="showRenamingReqNameModal"
      @submit="renameReqName"
      @hide-modal="showRenamingReqNameModal = false"
    />
    <HoppSmartConfirmModal
      :show="confirmingCloseAllTabs"
      :confirm="t('modal.close_unsaved_tab')"
      :title="t('confirm.close_unsaved_tabs', { count: unsavedTabsCount })"
      @hide-modal="confirmingCloseAllTabs = false"
      @resolve="onResolveConfirmCloseAllTabs"
    />
    <HoppSmartModal
      v-if="confirmingCloseForTabID !== null"
      dialog
      role="dialog"
      aria-modal="true"
      :title="t('modal.close_unsaved_tab')"
      @close="confirmingCloseForTabID = null"
    >
      <template #body>
        <div class="text-center">
          {{ t("confirm.save_unsaved_tab") }}
        </div>
      </template>
      <template #footer>
        <span class="flex space-x-2">
          <HoppButtonPrimary
            v-focus
            :label="t?.('action.yes')"
            outline
            @click="onResolveConfirmSaveTab"
          />
          <HoppButtonSecondary
            :label="t?.('action.no')"
            filled
            outline
            @click="onCloseConfirmSaveTab"
          />
        </span>
      </template>
    </HoppSmartModal>
    <CollectionsSaveRequest
      v-if="savingRequest"
      :mode="saveMode"
      :show="savingRequest"
      @hide-modal="onSaveModalClose"
    />
    <AppContextMenu
      v-if="contextMenu.show"
      :show="contextMenu.show"
      :position="contextMenu.position"
      :text="contextMenu.text"
      @hide-modal="contextMenu.show = false"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, computed, defineAsyncComponent } from "vue"
import { safelyExtractRESTRequest, generateUniqueRefId } from "@hoppscotch/data"
import { translateExtURLParams } from "~/helpers/RESTExtURLParams"
import { useRoute } from "vue-router"
import { useI18n } from "@composables/i18n"
import { getDefaultRESTRequest } from "~/helpers/rest/default"
import { getDefaultGQLRequest } from "@hoppscotch/data"
import { defineActionHandler, invokeAction } from "~/helpers/actions"
import { platform } from "~/platform"
import { useReadonlyStream } from "~/composables/stream"
import { useService } from "dioc/vue"
import { InspectionService } from "~/services/inspection"
import { RequestInspectorService } from "~/services/inspection/inspectors/request.inspector"
import { EnvironmentInspectorService } from "~/services/inspection/inspectors/environment.inspector"
import { ResponseInspectorService } from "~/services/inspection/inspectors/response.inspector"
import { ScriptingInterceptorInspectorService } from "~/services/inspection/inspectors/scripting-interceptor.inspector"
import { cloneDeep } from "lodash-es"
import { UnifiedTabService } from "~/services/tab/unified"
import { HoppTab } from "~/services/tab"
import {
  HoppUnifiedDocument,
  isRESTDocument,
  isGQLDocument,
  createDefaultRESTDocument,
  createDefaultGQLDocument,
} from "~/helpers/unified/document"
import { ScrollService } from "~/services/scroll.service"

// Lazy load request components
const HttpRequestTab = defineAsyncComponent(
  () => import("~/components/http/RequestTab.vue")
)
const GraphqlRequestTab = defineAsyncComponent(
  () => import("~/components/graphql/RequestTab.vue")
)
const UnifiedSidebar = defineAsyncComponent(
  () => import("~/components/app/UnifiedSidebar.vue")
)
const HttpTabHead = defineAsyncComponent(
  () => import("~/components/http/TabHead.vue")
)
const GraphqlTabHead = defineAsyncComponent(
  () => import("~/components/graphql/TabHead.vue")
)

const scrollService = useService(ScrollService)

const savingRequest = ref(false)
const confirmingCloseForTabID = ref<string | null>(null)
const confirmingCloseAllTabs = ref(false)
const showRenamingReqNameModal = ref(false)
const reqName = ref<string>("")
const unsavedTabsCount = ref(0)
const exceptedTabID = ref<string | null>(null)
const renameTabID = ref<string | null>(null)

const t = useI18n()

const tabs = useService(UnifiedTabService)

const currentTabID = tabs.currentTabID

const currentUser = useReadonlyStream(
  platform.auth.getCurrentUserStream(),
  platform.auth.getCurrentUser()
)

type PopupDetails = {
  show: boolean
  position: {
    top: number
    left: number
  }
  text: string | null
}

const contextMenu = ref<PopupDetails>({
  show: false,
  position: {
    top: 0,
    left: 0,
  },
  text: null,
})

const activeTabs = tabs.getActiveTabs()

// Get current protocol from active tab
const currentProtocol = computed(() => {
  const tab = tabs.currentActiveTab.value
  return tab?.document.protocol ?? "rest"
})

// Get save mode based on current protocol
const saveMode = computed(() => {
  return currentProtocol.value === "graphql" ? "graphql" : "rest"
})

// Get request component based on protocol
function getRequestComponent(protocol: "rest" | "graphql") {
  return protocol === "rest" ? HttpRequestTab : GraphqlRequestTab
}

// Get tab name based on protocol
function getTabName(tab: HoppTab<HoppUnifiedDocument>) {
  return tab.document.request.name || "Untitled"
}

function bindRequestToURLParams() {
  const route = useRoute()
  // Get URL parameters and set that as the request
  onMounted(() => {
    const query = route.query
    // If query params are empty, or contains code or error param (these are from Oauth Redirect)
    // We skip URL params parsing
    if (Object.keys(query).length === 0 || query.code || query.error) return

    const tab = tabs.currentActiveTab.value
    if (!isRESTDocument(tab.document)) return

    const request = tab.document.request

    tab.document.request = safelyExtractRESTRequest(
      translateExtURLParams(query, request),
      getDefaultRESTRequest()
    )
    tabs.updateTab(tab)
  })
}

const onTabUpdate = (tab: HoppTab<HoppUnifiedDocument>) => {
  tabs.updateTab(tab)
}

const addNewTab = () => {
  // Create new tab based on current protocol or default to REST
  const protocol = currentProtocol.value
  const document =
    protocol === "graphql"
      ? createDefaultGQLDocument()
      : createDefaultRESTDocument()

  const tab = tabs.createNewTab(document)
  tabs.setActiveTab(tab.id)
}

const sortTabs = (e: { oldIndex: number; newIndex: number }) => {
  tabs.updateTabOrdering(e.oldIndex, e.newIndex)
}

const inspectionService = useService(InspectionService)

const removeTab = (tabID: string) => {
  const tabState = tabs.getTabRef(tabID).value

  if (tabState.document.isDirty) {
    confirmingCloseForTabID.value = tabID
  } else {
    scrollService.cleanupScrollForTab(tabState.id)
    tabs.closeTab(tabState.id)
    inspectionService.deleteTabInspectorResult(tabState.id)
  }
}

const closeOtherTabsAction = (tabID: string) => {
  const isTabDirty = tabs.getTabRef(tabID).value?.document.isDirty
  const dirtyTabCount = tabs.getDirtyTabsCount()
  // If current tab is dirty, so we need to subtract 1 from the dirty tab count
  const balanceDirtyTabCount = isTabDirty ? dirtyTabCount - 1 : dirtyTabCount

  // If there are dirty tabs, show the confirm modal
  if (balanceDirtyTabCount > 0) {
    confirmingCloseAllTabs.value = true
    unsavedTabsCount.value = balanceDirtyTabCount
    exceptedTabID.value = tabID
  } else {
    scrollService.cleanupAllScroll(tabID)
    tabs.closeOtherTabs(tabID)
  }
}

const duplicateTab = (tabID: string) => {
  const tab = tabs.getTabRef(tabID)
  if (tab.value) {
    const newDocument = cloneDeep(tab.value.document)
    newDocument.isDirty = true
    // Regenerate ref_id for requests to ensure uniqueness
    if (isRESTDocument(newDocument) && newDocument.request._ref_id) {
      newDocument.request._ref_id = generateUniqueRefId("req")
    }

    const newTab = tabs.createNewTab(newDocument)
    tabs.setActiveTab(newTab.id)
  }
}

const switchTabProtocol = (
  tabID: string,
  targetProtocol: "rest" | "graphql"
) => {
  const tabRef = tabs.getTabRef(tabID)
  const currentTab = tabRef.value

  if (!currentTab) return

  const currentDoc = currentTab.document
  const requestName = currentDoc.request.name

  let newDocument: HoppUnifiedDocument

  if (targetProtocol === "graphql") {
    const req = getDefaultGQLRequest()
    if (requestName) req.name = requestName
    newDocument = createDefaultGQLDocument(req)
  } else {
    const req = getDefaultRESTRequest()
    if (requestName) req.name = requestName
    newDocument = createDefaultRESTDocument(req)
  }

  newDocument.isDirty = currentDoc.isDirty
  newDocument.inheritedProperties = currentDoc.inheritedProperties

  tabRef.value = {
    ...currentTab,
    document: newDocument,
  }
}

const onResolveConfirmCloseAllTabs = () => {
  if (exceptedTabID.value) {
    scrollService.cleanupAllScroll(exceptedTabID.value)
    tabs.closeOtherTabs(exceptedTabID.value)
  }
  confirmingCloseAllTabs.value = false
}

const requestToRename = computed(() => {
  if (!renameTabID.value) return null
  const tab = tabs.getTabRef(renameTabID.value)
  return tab.value?.document.request ?? null
})

const openReqRenameModal = (tabID?: string) => {
  if (tabID) {
    const tab = tabs.getTabRef(tabID)
    reqName.value = tab.value.document.request.name
    renameTabID.value = tabID
  } else {
    const { id, document } = tabs.currentActiveTab.value
    reqName.value = document.request.name
    renameTabID.value = id
  }
  showRenamingReqNameModal.value = true
}

const renameReqName = () => {
  const tab = tabs.getTabRef(renameTabID.value ?? currentTabID.value)
  if (tab.value) {
    tab.value.document.request.name = reqName.value
    tabs.updateTab(tab.value)
  }
  showRenamingReqNameModal.value = false
}

/**
 * This function is closed when the confirm tab is closed by some means (even saving triggers close)
 */
const onCloseConfirmSaveTab = () => {
  if (!savingRequest.value && confirmingCloseForTabID.value) {
    tabs.closeTab(confirmingCloseForTabID.value)
    inspectionService.deleteTabInspectorResult(confirmingCloseForTabID.value)
    confirmingCloseForTabID.value = null
  }
}

/**
 * Called when the user confirms they want to save the tab
 */
const onResolveConfirmSaveTab = () => {
  if (tabs.currentActiveTab.value.document.saveContext) {
    invokeAction("request-response.save")

    if (confirmingCloseForTabID.value) {
      tabs.closeTab(confirmingCloseForTabID.value)
      confirmingCloseForTabID.value = null
    }
  } else {
    savingRequest.value = true
  }
}

/**
 * Called when the Save Request modal is done and is closed
 */
const onSaveModalClose = () => {
  savingRequest.value = false
  if (confirmingCloseForTabID.value) {
    tabs.closeTab(confirmingCloseForTabID.value)
    confirmingCloseForTabID.value = null
  }
}

const shareTabRequest = (tabID: string) => {
  const tab = tabs.getTabRef(tabID)
  if (tab.value && isRESTDocument(tab.value.document)) {
    if (currentUser.value) {
      invokeAction("share.request", {
        request: tab.value.document.request,
      })
    } else {
      invokeAction("modals.login.toggle")
    }
  }
}

defineActionHandler("contextmenu.open", ({ position, text }) => {
  if (text) {
    contextMenu.value = {
      show: true,
      position,
      text,
    }
  } else {
    contextMenu.value = {
      show: false,
      position,
      text,
    }
  }
})

bindRequestToURLParams()

defineActionHandler("rest.request.open", ({ doc }) => {
  const document = createDefaultRESTDocument(doc.request)
  document.isDirty = doc.isDirty
  if (doc.saveContext) {
    document.saveContext = doc.saveContext
  }
  tabs.createNewTab(document)
})

defineActionHandler("gql.request.open", ({ request, saveContext }) => {
  const document = createDefaultGQLDocument(request)
  if (saveContext) {
    document.saveContext = saveContext
  }
  tabs.createNewTab(document)
})

defineActionHandler("request.rename", () => {
  openReqRenameModal(tabs.currentActiveTab.value.id)
})

defineActionHandler("tab.duplicate-tab", ({ tabID }) => {
  duplicateTab(tabID ?? currentTabID.value)
})

defineActionHandler("tab.close-current", () => {
  removeTab(currentTabID.value)
})

defineActionHandler("tab.close-other", () => {
  tabs.closeOtherTabs(currentTabID.value)
})

defineActionHandler("tab.open-new", addNewTab)

defineActionHandler("tab.next", () => {
  tabs.goToNextTab()
})

defineActionHandler("tab.prev", () => {
  tabs.goToPreviousTab()
})

defineActionHandler("tab.switch-to-first", () => {
  tabs.goToFirstTab()
})

defineActionHandler("tab.switch-to-last", () => {
  tabs.goToLastTab()
})

defineActionHandler("tab.reopen-closed", () => {
  tabs.reopenClosedTab()
})

defineActionHandler("tab.mru-switch", () => {
  tabs.goToMRUTab()
})

defineActionHandler("tab.mru-switch-reverse", () => {
  tabs.goToPreviousMRUTab()
})

useService(RequestInspectorService)
useService(EnvironmentInspectorService)
useService(ResponseInspectorService)
useService(ScriptingInterceptorInspectorService)

for (const inspectorDef of platform.additionalInspectors ?? []) {
  useService(inspectorDef.service)
}
</script>
