<script setup lang="ts">
import { ContextMenuItem, ContextMenuSeparator } from "reka-ui";
import { useAIChat } from "@/app/ai/chat/use";
import { getSession } from "#ui/web/tabs.ts";
import { addToContext, codegen, text } from "#ui/web/integration.ts";
defineProps<{ itemClass: string }>();
const { activeTab } = useAIChat();
</script>
<template>
  <ContextMenuItem
    :class="itemClass"
    :disabled="!getSession().state.selectedIds.size"
    @select="addToContext"
    >{{ text("添加到对话上下文", "Add to conversation context") }}</ContextMenuItem
  >
  <ContextMenuItem :class="itemClass" @select="activeTab = 'ai'">{{
    text("让 ZCode 修改", "Ask ZCode to edit")
  }}</ContextMenuItem>
  <ContextMenuItem
    :class="itemClass"
    :disabled="!getSession().state.selectedIds.size"
    @select="codegen"
    >{{ text("根据选区生成代码", "Generate code from selection") }}</ContextMenuItem
  >
  <ContextMenuSeparator class="my-1 h-px bg-border" />
</template>
