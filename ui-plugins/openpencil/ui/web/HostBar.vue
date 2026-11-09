<script setup lang="ts">
import { computed } from "vue";
import { getSession } from "#ui/web/tabs.ts";
import { connected, text, addToContext } from "#ui/web/integration.ts";
import { openFileDialog } from "#ui/web/files.ts";
const session = computed(() => getSession());
const status = computed(() => session.value.documents.status.value);
</script>
<template>
  <div class="zcode-host-bar">
    <button @click="openFileDialog" :title="text('打开工作区设计稿', 'Open workspace design')">
      OpenPencil
    </button>
    <span :title="session.documents.current.value?.path">{{
      connected ? text("已连接", "Connected") : text("连接中", "Connecting")
    }}</span>
    <button @click="session.editor.saveFigFile()" :title="session.documents.error.value ?? status">
      {{ text("保存", "Save") }}<span v-if="status === 'dirty'"> *</span>
    </button>
    <button
      data-testid="op-menu-add-context"
      @click="addToContext"
      :title="text('添加选区到对话上下文', 'Add selection to conversation')"
    >
      ＋
    </button>
    <div v-if="status === 'conflict'" class="zcode-error">
      {{ text("文件已在外部修改", "File changed externally") }}
      <button @click="session.documents.resolveConflict('reload')">
        {{ text("重新载入", "Reload") }}
      </button>
      <button @click="session.documents.resolveConflict('keep-mine')">
        {{ text("保留当前修改", "Keep edits") }}
      </button>
    </div>
    <div v-if="session.documents.error.value" class="zcode-error">
      {{ session.documents.error.value }}
    </div>
  </div>
</template>
