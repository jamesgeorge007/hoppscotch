<template>
  <HoppSmartModal
    v-if="show"
    dialog
    :title="t('request.new')"
    @close="$emit('hide-modal')"
  >
    <template #body>
      <div class="flex gap-1">
        <HoppSmartInput
          v-model="editingName"
          class="flex-grow"
          placeholder=" "
          :label="t('action.label')"
          input-styles="floating-input"
          @submit="addRequest"
        />
        <HoppButtonSecondary
          v-if="canDoRequestNameGeneration"
          v-tippy="{ theme: 'tooltip' }"
          :icon="IconSparkle"
          :disabled="isGenerateRequestNamePending"
          class="rounded-md"
          :class="{
            'animate-pulse': isGenerateRequestNamePending,
          }"
          :title="t('ai_experiments.generate_request_name')"
          @click="generateRequestName(props.requestContext)"
        />
      </div>
    </template>
    <template #footer>
      <span class="flex space-x-2">
        <HoppButtonPrimary
          :label="t('action.save')"
          :loading="loadingState"
          outline
          @click="addRequest"
        />
        <HoppButtonSecondary
          :label="t('action.cancel')"
          outline
          filled
          @click="hideModal"
        />
      </span>
    </template>
  </HoppSmartModal>
</template>

<script setup lang="ts">
import { ref, watch } from "vue"
import { useI18n } from "@composables/i18n"
import { useToast } from "@composables/toast"
import { useService } from "dioc/vue"
import { RESTTabService } from "~/services/tab/rest"
import { useRequestNameGeneration } from "~/composables/ai-experiments"
import { HoppRESTRequest } from "@hoppscotch/data"
import IconSparkle from "~icons/lucide/sparkles"

const toast = useToast()
const t = useI18n()

const props = withDefaults(
  defineProps<{
    show: boolean
    loadingState: boolean
    requestContext: HoppRESTRequest | null
  }>(),
  {
    show: false,
    loadingState: false,
    requestContext: null,
  }
)

const emit = defineEmits<{
  (event: "hide-modal"): void
  (event: "add-request", name: string): void
}>()

const editingName = ref("")

const {
  generateRequestName,
  isGenerateRequestNamePending,
  canDoRequestNameGeneration,
} = useRequestNameGeneration(editingName)

const tabs = useService(RESTTabService)
watch(
  () => props.show,
  (show) => {
    if (show) {
      editingName.value = tabs.currentActiveTab.value.document.request.name
    }
  }
)

const addRequest = () => {
  if (editingName.value.trim() === "") {
    toast.error(`${t("error.empty_req_name")}`)
    return
  }
  emit("add-request", editingName.value)
}

const hideModal = () => {
  emit("hide-modal")
}
</script>
