<template>
  <div class="flex flex-col">
    <label v-if="!hideLabel" for="requestType" class="px-4 pb-4">
      {{ t("request.choose_language") }}
    </label>
    <tippy
      interactive
      trigger="click"
      theme="popover"
      placement="bottom"
      :on-shown="() => tippyActions.focus()"
    >
      <HoppSmartSelectWrapper>
        <HoppButtonSecondary
          :label="
            CodegenDefinitions.find((x) => x.name === codegenType)!.caption
          "
          outline
          class="flex-1 pr-8"
        />
      </HoppSmartSelectWrapper>
      <template #content="{ hide }">
        <div class="flex flex-col space-y-2">
          <div class="sticky top-0 z-10 flex-shrink-0 overflow-x-auto">
            <input
              v-model="searchQuery"
              type="search"
              autocomplete="off"
              class="input flex w-full !bg-primaryContrast p-4 py-2"
              :placeholder="`${t('action.search')}`"
            />
          </div>
          <div
            ref="tippyActions"
            class="flex flex-col focus:outline-none"
            tabindex="0"
            @keyup.escape="hide()"
          >
            <HoppSmartItem
              v-for="codegen in filteredCodegenDefinitions"
              :key="codegen.name"
              :label="codegen.caption"
              :info-icon="codegen.name === codegenType ? IconCheck : undefined"
              :active-info-icon="codegen.name === codegenType"
              @click="
                () => {
                  codegenType = codegen.name
                  codegenMode = codegen.lang
                  hide()
                }
              "
            />
            <HoppSmartPlaceholder
              v-if="filteredCodegenDefinitions.length === 0"
              :text="`${t('state.nothing_found')} ‟${searchQuery}”`"
            >
              <template #icon>
                <icon-lucide-search class="svg-icons opacity-75" />
              </template>
            </HoppSmartPlaceholder>
          </div>
        </div>
      </template>
    </tippy>
    <div
      v-if="errorState"
      class="mt-4 w-full overflow-auto whitespace-normal rounded bg-primaryLight px-4 py-2 font-mono text-red-400"
    >
      {{ t("error.something_went_wrong") }}
    </div>
    <div
      v-else-if="codegenType"
      class="mt-4 rounded border border-dividerLight"
    >
      <div class="flex items-center justify-between pl-4">
        <label class="truncate font-semibold text-secondaryLight">
          {{ t("request.generated_code") }}
        </label>
        <div class="flex items-center">
          <HoppButtonSecondary
            v-tippy="{ theme: 'tooltip' }"
            :title="t('state.linewrap')"
            :class="{ '!text-accent': WRAP_LINES }"
            :icon="IconWrapText"
            @click.prevent="toggleNestedSetting('WRAP_LINES', 'codeGen')"
          />
          <HoppButtonSecondary
            v-tippy="{ theme: 'tooltip', allowHTML: true }"
            :title="t('action.download_file')"
            :icon="downloadIcon"
            @click="downloadResponse"
          />
          <HoppButtonSecondary
            v-tippy="{ theme: 'tooltip', allowHTML: true }"
            :title="t('action.copy')"
            :icon="copyIcon"
            @click="copyResponse"
          />
        </div>
      </div>
      <div
        ref="generatedCode"
        class="rounded-b border-t border-dividerLight"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useCodemirror } from "@composables/codemirror"
import { useI18n } from "@composables/i18n"
import {
  Environment,
  HoppRESTAuth,
  HoppRESTHeaders,
  makeRESTRequest,
} from "@hoppscotch/data"
import * as O from "fp-ts/Option"
import { computed, reactive, ref } from "vue"
import {
  useCopyResponse,
  useDownloadResponse,
} from "~/composables/lens-actions"
import {
  CodegenDefinitions,
  CodegenName,
  generateCode,
  CodegenLang,
} from "~/helpers/new-codegen"
import {
  getEffectiveRESTRequest,
  resolvesEnvsInBody,
} from "~/helpers/utils/EffectiveURL"
import {
  AggregateEnvironment,
  getAggregateEnvsWithCurrentValue,
} from "~/newstore/environments"

import { useService } from "dioc/vue"
import cloneDeep from "lodash-es/cloneDeep"
import { onMounted } from "vue"
import { useNestedSetting } from "~/composables/settings"
import { toggleNestedSetting } from "~/newstore/settings"
import { platform } from "~/platform"
import { UnifiedTabService } from "~/services/tab/unified"
import { isRESTDocument, isExampleResponseDocument } from "~/helpers/unified/document"
import IconCheck from "~icons/lucide/check"
import IconWrapText from "~icons/lucide/wrap-text"
import { asyncComputed } from "@vueuse/core"
import { getDefaultRESTRequest } from "~/helpers/rest/default"
import { CurrentValueService } from "~/services/current-environment-value.service"
import { getCurrentEnvironment } from "../../newstore/environments"
import { transformInheritedCollectionVariablesToAggregateEnv } from "~/helpers/utils/inheritedCollectionVarTransformer"
import { filterNonEmptyEnvironmentVariables } from "~/helpers/RequestRunner"

const t = useI18n()

const tabs = useService(UnifiedTabService)
const currentEnvironmentValueService = useService(CurrentValueService)

const currentActiveRequest = computed(() => {
  const doc = currentActiveTabDocument.value

  if (isExampleResponseDocument(doc)) {
    return cloneDeep(doc.response.originalRequest)
  }
  if (isRESTDocument(doc)) {
    return cloneDeep(doc.request)
  }
  return getDefaultRESTRequest()
})

const currentActiveTabDocument = computed(() =>
  cloneDeep(tabs.currentActiveTab.value.document)
)

const codegenType = ref<CodegenName>("shell-curl")
const codegenMode = ref<CodegenLang>("shell")
const errorState = ref(false)

defineProps({
  hideLabel: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits<{
  (e: "request-code", value: string): void
}>()

const getCurrentValue = (env: AggregateEnvironment) => {
  const currentSelectedEnvironment = getCurrentEnvironment()

  if (env && env.secret) {
    return env.currentValue
  }
  return currentEnvironmentValueService.getEnvironmentByKey(
    env?.sourceEnv !== "Global" ? currentSelectedEnvironment.id : "Global",
    env?.key ?? ""
  )?.currentValue
}

const getFinalURL = (input: string): string => {
  if (!input) {
    return "https://"
  }

  let url = input.trim()

  url = url.replace(/^https?:\s*\/+\s*/i, (match) =>
    match.toLowerCase().startsWith("https") ? "https://" : "http://"
  )

  if (!/^https?:\/\//i.test(url) && !url.startsWith("<<")) {
    const endpoint = url
    const domain = endpoint.split(/[/:#?]+/)[0]
    const isLocalOrIP = /^(localhost|(\d{1,3}\.){3}\d{1,3})$/.test(domain)
    url = (isLocalOrIP ? "http://" : "https://") + endpoint
  }

  return url
}

const buildFinalEnvironment = (): Environment => {
  const aggregateEnvs = getAggregateEnvsWithCurrentValue()
  const inheritedVariables =
    currentActiveTabDocument.value.inheritedProperties?.variables || []

  const requestVariables = (currentActiveRequest.value?.requestVariables || [])
    .filter((variable) => variable.active)
    .map((variable) => ({
      key: variable.key,
      initialValue: variable.value,
      currentValue: variable.value,
      secret: false,
    }))

  const collectionVariables =
    transformInheritedCollectionVariablesToAggregateEnv(inheritedVariables).map(
      ({ key, initialValue, currentValue, secret }) => ({
        key,
        initialValue,
        currentValue,
        secret,
      })
    )

  const environmentVariables = aggregateEnvs.map((env) => ({
    key: env.key,
    secret: env.secret,
    initialValue: env.initialValue,
    currentValue: getCurrentValue(env) || env.initialValue,
  }))

  const allVariables = [
    ...requestVariables,
    ...collectionVariables,
    ...environmentVariables,
  ]

  const filteredVariables = filterNonEmptyEnvironmentVariables(allVariables)

  return {
    v: 2,
    id: "env",
    name: "Env",
    variables: filteredVariables,
  }
}

const resolveRequestAuthAndHeaders = () => {
  const { auth, headers } = currentActiveRequest.value
  const { inheritedProperties } = currentActiveTabDocument.value

  const resolvedAuth: HoppRESTAuth =
    auth.authType === "inherit" && auth.authActive
      ? ((inheritedProperties?.auth?.inheritedAuth as HoppRESTAuth) ?? {
          authType: "none",
          authActive: false,
        })
      : auth

  const inheritedHeaders =
    inheritedProperties?.headers
      ?.flatMap((header) => header.inheritedHeader)
      ?.filter(Boolean) ?? []

  const resolvedHeaders: HoppRESTHeaders = [...inheritedHeaders, ...headers]

  return { auth: resolvedAuth, headers: resolvedHeaders }
}

const buildFinalRequest = (auth: HoppRESTAuth, headers: HoppRESTHeaders) => {
  return {
    ...currentActiveRequest.value,
    auth,
    headers,
  }
}

const requestCode = asyncComputed(async (): Promise<string> => {
  try {
    const doc = currentActiveTabDocument.value
    if (!isRESTDocument(doc) && !isExampleResponseDocument(doc)) {
      errorState.value = true
      return ""
    }

    const selectedCodegenType = codegenType.value

    const environment = buildFinalEnvironment()
    const { auth, headers } = resolveRequestAuthAndHeaders()

    const finalRequest = buildFinalRequest(auth, headers)

    const effectiveRequest = await getEffectiveRESTRequest(
      finalRequest,
      environment,
      true
    )

    const codegenRequest = makeRESTRequest({
      ...effectiveRequest,
      body: resolvesEnvsInBody(effectiveRequest.body, environment),
      headers: effectiveRequest.effectiveFinalHeaders.map((header) => ({
        ...header,
        active: true,
      })),
      params: effectiveRequest.effectiveFinalParams.map((param) => ({
        ...param,
        active: true,
      })),
      endpoint: getFinalURL(effectiveRequest.effectiveFinalURL),
      requestVariables: effectiveRequest.effectiveFinalRequestVariables.map(
        (requestVariable) => ({
          ...requestVariable,
          active: true,
        })
      ),
    })

    const codeResult = generateCode(selectedCodegenType, codegenRequest)

    if (O.isSome(codeResult)) {
      errorState.value = false
      const generatedCode = codeResult.value
      emit("request-code", generatedCode)
      return generatedCode
    }

    console.warn("Code generation failed for type:", selectedCodegenType)
    errorState.value = true
    return ""
  } catch (error) {
    console.error("Error generating request code:", error)
    errorState.value = true
    return ""
  }
})

// Template refs
const tippyActions = ref<any | null>(null)
const generatedCode = ref<any | null>(null)
const WRAP_LINES = useNestedSetting("WRAP_LINES", "codeGen")

useCodemirror(
  generatedCode,
  requestCode,
  reactive({
    extendedEditorConfig: {
      mode: codegenMode,
      readOnly: true,
      lineWrapping: WRAP_LINES,
    },
    linter: null,
    completer: null,
    environmentHighlights: false,
  })
)

onMounted(() => {
  platform.analytics?.logEvent({
    type: "HOPP_REST_CODEGEN_OPENED",
  })
})

const searchQuery = ref("")

const filteredCodegenDefinitions = computed(() => {
  return CodegenDefinitions.filter((obj) =>
    Object.values(obj).some((val) =>
      val.toLowerCase().includes(searchQuery.value.toLowerCase())
    )
  )
})

const { copyIcon, copyResponse } = useCopyResponse(requestCode)
const { downloadIcon, downloadResponse } = useDownloadResponse(
  "",
  computed(() => requestCode.value || ""),
  t("filename.codegen", {
    request_name: currentActiveRequest.value.name,
  })
)
</script>
