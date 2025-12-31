<template>
  <div class="flex flex-col h-full">
    <!-- Protocol Switcher -->
    <div class="flex items-center gap-2 px-4 py-2 border-b border-dividerLight bg-primary">
      <span class="text-xs font-semibold text-secondaryLight">{{ t("label.protocol") }}:</span>
      <div class="flex gap-1">
        <button
          class="px-3 py-1 text-xs font-medium rounded transition-colors bg-surface2 text-secondary hover:bg-surface1"
          @click="switchProtocol('rest')"
        >
          REST
        </button>
        <button
          class="px-3 py-1 text-xs font-medium rounded transition-colors"
          :class="{
            'bg-accent text-accentContrast': true,
            'bg-surface2 text-secondary hover:bg-surface1': false,
          }"
          @click="switchProtocol('graphql')"
        >
          GraphQL
        </button>
      </div>
    </div>

    <AppPaneLayout layout-id="gql-primary">
      <template #primary>
        <GraphqlRequestOptions
          v-model="tab.document.request"
          v-model:response="tab.document.response"
          v-model:option-tab="tab.document.optionTabPreference"
          v-model:inherited-properties="tab.document.inheritedProperties"
          :tab-id="tab.id"
        />
      </template>
      <template #secondary>
        <GraphqlResponse :response="tab.document.response" />
      </template>
    </AppPaneLayout>
  </div>
</template>

<script setup lang="ts">
import { useVModel } from "@vueuse/core"
import { cloneDeep } from "lodash-es"
import { watch } from "vue"
import { isEqualHoppGQLRequest } from "~/helpers/graphql"
import { HoppGQLDocument } from "~/helpers/graphql/document"
import { HoppTab } from "~/services/tab"
import { useI18n } from "~/composables/i18n"
import { createDefaultRESTDocument } from "~/helpers/unified/document"
import { useService } from "dioc/vue"
import { UnifiedTabService } from "~/services/tab/unified"

// TODO: Move Response and Request execution code to over here

const t = useI18n()
const tabs = useService(UnifiedTabService)

const props = defineProps<{ modelValue: HoppTab<HoppGQLDocument> }>()

const emit = defineEmits<{
  (e: "update:modelValue", val: HoppTab<HoppGQLDocument>): void
}>()

const tab = useVModel(props, "modelValue", emit)

// Protocol switcher
const switchProtocol = (protocol: "rest" | "graphql") => {
  if (protocol === "graphql") {
    return // Already on GraphQL
  }

  // Switch to REST
  const newTab = {
    ...tab.value,
    document: createDefaultRESTDocument(),
  }
  tabs.updateTab(newTab)
}

// TODO: Come up with a better dirty check
let oldRequest = cloneDeep(tab.value.document.request)
watch(
  () => tab.value.document.request,
  (updatedValue) => {
    // TODO: Check equality of request
    if (
      !tab.value.document.isDirty &&
      !isEqualHoppGQLRequest(oldRequest, updatedValue)
    ) {
      tab.value.document.isDirty = true
    }

    oldRequest = cloneDeep(updatedValue)
  },
  { deep: true }
)
</script>
