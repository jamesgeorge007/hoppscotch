<template>
  <div class="flex flex-col h-full">
    <!-- Protocol Switcher Toolbar -->
    <div
      class="flex items-center justify-between px-4 py-2 border-b border-dividerLight bg-primaryLight"
    >
      <div class="text-xs font-medium text-secondary flex items-center gap-2">
        <span
          class="text-xs font-medium px-2 py-0.5 rounded bg-purple-500/20 text-purple-300"
          >GQL</span
        >
        <span>Protocol</span>
      </div>
      <button
        v-tippy="{ theme: 'tooltip' }"
        title="Switch to REST"
        class="px-3 py-1 text-xs font-medium rounded bg-surface1 hover:bg-surface2 transition-colors text-secondary hover:text-secondaryLight border border-dividerLight hover:border-dividerDark"
        @click.stop="$emit('switch-protocol')"
      >
        ← Switch to REST
      </button>
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
import { HoppUnifiedDocument } from "~/helpers/unified/document"

// TODO: Move Response and Request execution code to over here

const props = defineProps<{
  modelValue: HoppTab<HoppGQLDocument | HoppUnifiedDocument>
}>()

const emit = defineEmits<{
  (
    e: "update:modelValue",
    val: HoppTab<HoppGQLDocument | HoppUnifiedDocument>
  ): void
  (e: "switch-protocol"): void
}>()

const tab = useVModel(props, "modelValue", emit)
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
