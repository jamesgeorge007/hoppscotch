<template>
  <div class="protocol-switcher">
    <HoppSmartSelect
      v-model="selectedProtocol"
      :options="protocolOptions"
      class="!min-w-[140px]"
    >
      <template #selected>
        <div class="flex items-center space-x-2">
          <component :is="getProtocolIcon(selectedProtocol)" class="svg-icons" />
          <span>{{ getProtocolLabel(selectedProtocol) }}</span>
        </div>
      </template>
      <template #option="{ option }">
        <div class="flex items-center space-x-2">
          <component :is="getProtocolIcon(option.value)" class="svg-icons" />
          <span>{{ option.label }}</span>
        </div>
      </template>
    </HoppSmartSelect>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import Icon REST from "~icons/lucide/globe"
import IconGraphQL from "~icons/lucide/network"
import { useI18n } from "~/composables/i18n"

const t = useI18n()

const props = defineProps<{
  modelValue: "rest" | "graphql"
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: "update:modelValue", value: "rest" | "graphql"): void
  (e: "change", value: "rest" | "graphql"): void
}>()

const selectedProtocol = computed({
  get: () => props.modelValue,
  set: (val) => {
    emit("update:modelValue", val)
    emit("change", val)
  },
})

const protocolOptions = computed(() => [
  {
    value: "rest" as const,
    label: t("request.rest"),
    description: t("request.rest_description"),
  },
  {
    value: "graphql" as const,
    label: t("request.graphql"),
    description: t("request.graphql_description"),
  },
])

const getProtocolIcon = (protocol: string) => {
  return protocol === "rest" ? IconREST : IconGraphQL
}

const getProtocolLabel = (protocol: string) => {
  return protocol === "rest" ? t("request.rest") : t("request.graphql")
}
</script>

<style scoped>
.protocol-switcher {
  @apply flex items-center;
}
</style>
