<template>
  <div class="flex flex-col h-full">
    <!-- Protocol Switcher Toolbar -->
    <div
      class="flex items-center justify-between px-4 py-2 border-b border-dividerLight bg-primaryLight"
    >
      <div class="text-xs font-medium text-secondary flex items-center gap-2">
        <span
          class="text-xs font-medium px-2 py-0.5 rounded bg-blue-500/20 text-blue-300"
          >REST</span
        >
        <span>Protocol</span>
      </div>
      <button
        v-tippy="{ theme: 'tooltip' }"
        title="Switch to GraphQL"
        class="px-3 py-1 text-xs font-medium rounded bg-surface1 hover:bg-surface2 transition-colors text-secondary hover:text-secondaryLight border border-dividerLight hover:border-dividerDark"
        @click.stop="$emit('switch-protocol')"
      >
        Switch to GraphQL →
      </button>
    </div>

    <AppPaneLayout layout-id="rest-primary">
      <template #primary>
        <HttpRequest v-model="tab" />
        <HttpRequestOptions
          v-model="tab.document.request"
          v-model:option-tab="tab.document.optionTabPreference!"
          v-model:inherited-properties="tab.document.inheritedProperties"
        />
      </template>
      <template #secondary>
        <HttpResponse
          v-model:document="tab.document"
          :tab-id="tab.id"
          :is-embed="false"
        />
      </template>
    </AppPaneLayout>
  </div>
</template>

<script setup lang="ts">
import { watch } from "vue"
import { useVModel } from "@vueuse/core"
import { cloneDeep } from "lodash-es"
import { isEqualHoppRESTRequest } from "@hoppscotch/data"
import { HoppTab } from "~/services/tab"
import { HoppRequestDocument } from "~/helpers/rest/document"
import { HoppUnifiedDocument } from "~/helpers/unified/document"

// TODO: Move Response and Request execution code to over here

const props = defineProps<{
  modelValue: HoppTab<HoppRequestDocument | HoppUnifiedDocument>
}>()

const emit = defineEmits<{
  (
    e: "update:modelValue",
    val: HoppTab<HoppRequestDocument | HoppUnifiedDocument>
  ): void
  (e: "switch-protocol"): void
}>()

const tab = useVModel(props, "modelValue", emit)
// TODO: Come up with a better dirty check
let oldRequest = cloneDeep(tab.value.document.request)
watch(
  () => tab.value.document.request,
  (updatedValue) => {
    if (
      !tab.value.document.isDirty &&
      !isEqualHoppRESTRequest(oldRequest, updatedValue)
    ) {
      tab.value.document.isDirty = true
    }

    oldRequest = cloneDeep(updatedValue)
  },
  { deep: true }
)
</script>
