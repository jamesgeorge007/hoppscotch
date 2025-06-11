<template>
  <div class="flex flex-1 flex-col">
    <div
      class="sticky top-upperMobileSecondaryStickyFold z-10 flex flex-shrink-0 items-center justify-between overflow-x-auto border-b border-dividerLight bg-primary pl-4 sm:top-upperSecondaryStickyFold"
    >
      <label class="truncate font-semibold text-secondaryLight">
        {{ t("preRequest.javascript_code") }}
      </label>
      <div class="flex">
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          to="https://docs.hoppscotch.io/documentation/getting-started/rest/pre-request-scripts"
          blank
          :title="t('app.wiki')"
          :icon="IconHelpCircle"
        />
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          :title="t('action.clear')"
          :icon="IconTrash2"
          @click="clearContent"
        />
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          :title="t('state.linewrap')"
          :class="{ '!text-accent': WRAP_LINES }"
          :icon="IconWrapText"
          @click.prevent="toggleNestedSetting('WRAP_LINES', 'httpPreRequest')"
        />
        <HoppButtonSecondary
          v-if="shouldEnableAIFeatures && currentRequest"
          v-tippy="{ theme: 'tooltip' }"
          :title="t('ai_experiments.modify_with_ai')"
          :icon="IconSparkles"
          @click="showModifyPreRequestModal"
        />
      </div>
    </div>
    <div class="flex flex-1 border-b border-dividerLight">
      <div class="w-2/3 border-r border-dividerLight h-full relative">
        <!-- <div ref="preRequestEditor" class="h-full absolute inset-0"></div> -->
        <vue-monaco-editor
          v-model:value="preRequestScript"
          theme="vs-dark"
          language="typescript"
          :options="MONACO_EDITOR_OPTIONS"
          @mount="onEditorMounted"
        />
      </div>
      <div
        class="z-[9] sticky top-upperTertiaryStickyFold h-full min-w-[12rem] max-w-1/3 flex-shrink-0 overflow-auto overflow-x-auto bg-primary p-4"
      >
        <div class="pb-2 text-secondaryLight">
          {{ t("helpers.pre_request_script") }}
        </div>
        <HoppSmartAnchor
          :label="`${t('preRequest.learn')}`"
          to="https://docs.hoppscotch.io/documentation/getting-started/rest/pre-request-scripts"
          blank
        />
        <h4 class="pt-6 font-bold text-secondaryLight">
          {{ t("preRequest.snippets") }}
        </h4>
        <div class="flex flex-col pt-4">
          <TabSecondary
            v-for="(snippet, index) in snippets"
            :key="`snippet-${index}`"
            :label="snippet.name"
            active
            @click="useSnippet(snippet.script)"
          />
        </div>
      </div>
    </div>
    <AiexperimentsModifyPreRequestModal
      v-if="isModifyPreRequestModalOpen && currentRequest"
      :current-script="preRequestScript"
      :request-info="currentRequest"
      @close-modal="isModifyPreRequestModalOpen = false"
      @update-script="(updatedScript) => (preRequestScript = updatedScript)"
    />
  </div>
</template>

<script setup lang="ts">
import AiexperimentsModifyPreRequestModal from "@components/aiexperiments/ModifyPreRequestModal.vue"
import { useCodemirror } from "@composables/codemirror"
import { useI18n } from "@composables/i18n"
import snippets from "@helpers/preRequestScriptSnippets"
import { useVModel } from "@vueuse/core"
import { useService } from "dioc/vue"
import * as monaco from "monaco-editor"
import { computed, reactive, ref, shallowRef } from "vue"

import { useAIExperiments } from "~/composables/ai-experiments"
import { useNestedSetting } from "~/composables/settings"
import { useReadonlyStream } from "~/composables/stream"
import { invokeAction } from "~/helpers/actions"
import completer from "~/helpers/editor/completion/preRequest"
import linter from "~/helpers/editor/linting/preRequest"
import { toggleNestedSetting } from "~/newstore/settings"
import { platform } from "~/platform"
import { RESTTabService } from "~/services/tab/rest"
import IconHelpCircle from "~icons/lucide/help-circle"
import IconSparkles from "~icons/lucide/sparkles"
import IconTrash2 from "~icons/lucide/trash-2"
import IconWrapText from "~icons/lucide/wrap-text"
import {
  getPreRequestScriptCompletions,
  performPreRequestLinting,
} from "../../helpers/tern"

import { VueMonacoEditor } from "@guolao/vue-monaco-editor"

const t = useI18n()

const props = defineProps<{
  modelValue: string
}>()
const emit = defineEmits<{
  (e: "update:modelValue", value: string): void
}>()

const preRequestScript = useVModel(props, "modelValue", emit)

const preRequestEditor = ref<any | null>(null)
const WRAP_LINES = useNestedSetting("WRAP_LINES", "httpPreRequest")

const MONACO_EDITOR_OPTIONS = {
  automaticLayout: true,
  formatOnType: true,
  formatOnPaste: true,
}

useCodemirror(
  preRequestEditor,
  preRequestScript,
  reactive({
    extendedEditorConfig: {
      mode: "application/javascript",
      lineWrapping: WRAP_LINES,
      placeholder: `${t("preRequest.javascript_code")}`,
    },
    linter,
    completer,
    environmentHighlights: false,
    contextMenuEnabled: false,
  })
)

const onEditorMounted = (editor: monaco.editor.IStandaloneCodeEditor) => {
  const model = editor.getModel()
  if (!model) return

  editor.onDidChangeModelContent(async () => {
    const value = model.getValue()
    const lints = await performPreRequestLinting(value)

    const markers = lints.map((lint: any) => ({
      severity: monaco.MarkerSeverity.Error,
      message: lint.message,
      startLineNumber: lint.from.line + 1,
      startColumn: lint.from.ch + 1,
      endLineNumber: lint.to.line + 1,
      endColumn: lint.to.ch + 1,
    }))

    monaco.editor.setModelMarkers(model, "owner", markers)
  })
}

// Register autocomplete
;["javascript", "typescript"].forEach((lang) => {
  monaco.languages.registerCompletionItemProvider(lang, {
    triggerCharacters: [".", "(", '"', "'", "/", " "],
    provideCompletionItems: async (model, position) => {
      const code = model.getValue()
      const row = position.lineNumber - 1
      const col = position.column - 1

      const result = await getPreRequestScriptCompletions(code, row, col)

      return {
        suggestions: result.completions.map((c: any) => ({
          label: c.name,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: c.name,
          detail: c.type,
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: position.column,
            endColumn: position.column,
          },
        })),
      }
    },
  })
})

const useSnippet = (script: string) => {
  preRequestScript.value += script
}

const clearContent = () => {
  preRequestScript.value = ""
}
const tabService = useService(RESTTabService)

const currentRequest = computed(() =>
  tabService.currentActiveTab.value?.document.type === "request"
    ? tabService.currentActiveTab.value?.document.request
    : null
)

const { shouldEnableAIFeatures } = useAIExperiments()
const isModifyPreRequestModalOpen = ref(false)

const currentUser = useReadonlyStream(
  platform.auth.getCurrentUserStream(),
  platform.auth.getCurrentUser()
)

const showModifyPreRequestModal = () => {
  if (!currentUser.value) {
    invokeAction("modals.login.toggle")
    return
  }
  isModifyPreRequestModalOpen.value = true
}
</script>

<style lang="scss" scoped>
:deep(.cm-panels) {
  @apply top-upperTertiaryStickyFold #{!important};
}
</style>
