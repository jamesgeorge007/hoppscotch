<template>
  <div class="space-y-4">
    <p class="flex items-center">
      <span
        class="inline-flex items-center justify-center flex-shrink-0 mr-4 border-4 rounded-full border-primary text-dividerDark"
        :class="{
          '!text-green-500': hasURL,
        }"
      >
        <icon-lucide-check-circle class="svg-icons" />
      </span>
      <span>
        {{ t(caption) }}
      </span>
    </p>
    <p class="flex flex-col ml-10">
      <input
        v-model="inputChooseGistToImportFrom"
        type="url"
        class="input"
        :placeholder="`${t('import.from_url')}`"
      />
    </p>

    <div>
      <HoppButtonPrimary
        class="w-full"
        :label="t('import.title')"
        :disabled="!hasURL"
        :loading="isFetchingUrl"
        @click="fetchUrlData"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "@composables/i18n"
import { useService } from "dioc/vue"
import { ref, watch } from "vue"
import { useToast } from "~/composables/toast"
import { InterceptorService } from "~/services/interceptor.service"

import * as E from "fp-ts/Either"

const interceptorService = useService(InterceptorService)

const t = useI18n()

const toast = useToast()

const props = defineProps<{
  caption: string
  fetchLogic?: (url: string) => Promise<E.Either<string, string>>
}>()

const emit = defineEmits<{
  (e: "importFromURL", content: unknown): void
}>()

const inputChooseGistToImportFrom = ref<string>("")
const hasURL = ref(false)

const isFetchingUrl = ref(false)

watch(inputChooseGistToImportFrom, (url) => {
  hasURL.value = !!url
})

const urlFetchLogic =
  props.fetchLogic ??
  async function (url: string) {
    const res = await interceptorService.runRequest({
      url,
      transitional: {
        forcedJSONParsing: false,
        silentJSONParsing: false,
        clarifyTimeoutError: true,
      },
    }).response

    if (E.isLeft(res)) {
      return E.left("REQUEST_FAILED")
    }

    // convert ArrayBuffer to string
    if (!(res.right.data instanceof ArrayBuffer)) {
      return E.left("REQUEST_FAILED")
    }

    const data = new TextDecoder().decode(res.right.data).replace(/\0+$/, "")
    return E.right(data)
  }

async function fetchUrlData() {
  isFetchingUrl.value = true

  try {
    const res = await urlFetchLogic(inputChooseGistToImportFrom.value)

    if (E.isLeft(res)) {
      toast.error(t("import.failed"))
      console.error(res.left)
      return
    }

    emit("importFromURL", res.right)
  } catch (err) {
    toast.error(t("import.failed"))
    console.error(err)
  } finally {
    isFetchingUrl.value = false
  }
}
</script>
