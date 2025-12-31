<template>
  <div class="flex flex-col h-full">
    <!-- Loading state during protocol switch -->
    <transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div v-if="isSwitching" class="absolute inset-0 z-20 flex items-center justify-center bg-primary/80 backdrop-blur-sm">
        <div class="flex flex-col items-center gap-2">
          <div class="animate-spin rounded-full h-8 w-8 border-2 border-accent border-t-transparent"></div>
          <span class="text-xs text-secondary">{{ t("state.loading") }}</span>
        </div>
      </div>
    </transition>

    <AppPaneLayout layout-id="rest-primary">
      <template #primary>
        <div class="flex flex-col h-full">
          <div class="flex items-center justify-end px-4 py-2 gap-2 border-b border-dividerLight">
            <button
              v-tippy="{ theme: 'tooltip' }"
              title="Switch to GraphQL"
              class="p-1.5 rounded hover:bg-surface2 transition-colors text-secondary hover:text-secondaryLight"
              @click="$emit('switch-protocol', 'graphql')"
            >
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"></path>
              </svg>
            </button>
          </div>
          <HttpRequest v-model="tab" />
          <HttpRequestOptions
            v-model="tab.document.request"
            v-model:option-tab="tab.document.optionTabPreference!"
            v-model:inherited-properties="tab.document.inheritedProperties"
          />
        </div>
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
import { watch, ref } from "vue"
import { useVModel } from "@vueuse/core"
import { cloneDeep } from "lodash-es"
import { isEqualHoppRESTRequest } from "@hoppscotch/data"
import { HoppTab } from "~/services/tab"
import { HoppRequestDocument } from "~/helpers/rest/document"
import { useI18n } from "~/composables/i18n"

// TODO: Move Response and Request execution code to over here

const t = useI18n()

const props = defineProps<{ modelValue: HoppTab<HoppRequestDocument> }>()

const emit = defineEmits<{
  (e: "update:modelValue", val: HoppTab<HoppRequestDocument>): void
  (e: "switch-protocol", protocol: "graphql"): void
}>()

const tab = useVModel(props, "modelValue", emit)
const isSwitching = ref(false)

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
