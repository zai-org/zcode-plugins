<script setup lang="ts">
import { addToContext, text } from "#ui/web/integration.ts";
</script>

<template>
  <!-- 窄屏不能继续创建上游协作房间，选区统一交给宿主当前对话。 -->
  <button
    data-testid="op-mobile-add-context"
    class="flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-panel px-3 text-xs text-surface shadow-md active:bg-hover"
    @click="addToContext"
  >
    {{ text("添加到对话", "Add to conversation") }}
  </button>
</template>
