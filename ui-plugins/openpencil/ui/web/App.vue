<script setup lang="ts">
import { onMounted, onBeforeUnmount } from "vue";
import { TooltipProvider } from "reka-ui";
import { RouterView } from "vue-router";
import { useAppTheme } from "@/app/shell/theme";
import { setLocale } from "@open-pencil/vue";
import { resolveBrowserLocale } from "#vue/i18n/locale";
import AppToast from "@/components/Shell/AppToast.vue";
import { host, onHostGlobals } from "#ui/host.ts";
import { dialog } from "#ui/web/dialog.ts";
import { connect, disconnect, chinese, text } from "#ui/web/integration.ts";
import { openDocument } from "#ui/web/tabs.ts";
import type { DesignRef } from "#openpencil/contract.ts";
import { settingsDialogOpen } from "@/app/settings/dialog";
import { connected } from "#ui/web/integration.ts";
const { setTheme } = useAppTheme();
function updateHost() {
  setTheme(host().theme === "dark" ? "dark" : "light");
  chinese.value = host().locale?.startsWith("zh") ?? false;
  setLocale(resolveBrowserLocale([host().locale ?? "en"]));
}
updateHost();
const stop = onHostGlobals(() => {
  updateHost();
  const output = host().toolOutput as { document?: DesignRef } | undefined;
  if (output?.document) void openDocument(output.document);
});
onMounted(() => {
  void connect().catch((error) => {
    console.error("[openpencil] host connection failed", error);
  });
});
onBeforeUnmount(() => {
  stop();
  disconnect();
});
</script>
<template>
  <TooltipProvider>
    <RouterView />
    <AppToast />
    <div
      v-if="settingsDialogOpen"
      class="zcode-dialog-backdrop"
      @keydown.esc="settingsDialogOpen = false"
    >
      <section role="dialog" aria-label="OpenPencil" class="zcode-path-dialog">
        <strong>OpenPencil · ZCode</strong>
        <p>
          {{
            text(
              "设计稿保存在当前工作区，AI 请求使用 ZCode 当前对话的模型与工具。",
              "Designs are saved in this workspace. AI requests use the model and tools of the current ZCode conversation.",
            )
          }}
        </p>
        <p>MCP: {{ connected ? text("已连接", "Connected") : text("连接中", "Connecting") }}</p>
        <div class="zcode-dialog-actions">
          <button @click="settingsDialogOpen = false">{{ text("关闭", "Close") }}</button>
        </div>
      </section>
    </div>
    <div v-if="dialog" class="zcode-dialog-backdrop" @keydown.esc="dialog.resolve(null)">
      <form class="zcode-path-dialog" @submit.prevent="dialog.resolve(dialog.value.trim())">
        <strong>{{ dialog.title }}</strong>
        <input
          autofocus
          v-model="dialog.value"
          :placeholder="text('工作区相对路径', 'Workspace relative path')"
        />
        <div class="zcode-file-list" v-if="dialog.paths">
          <button
            v-for="path in dialog.paths"
            :key="path"
            type="button"
            @click="dialog.resolve(path)"
          >
            {{ path }}
          </button>
        </div>
        <div class="zcode-dialog-actions">
          <button type="button" @click="dialog.resolve(null)">{{ text("取消", "Cancel") }}</button>
          <button type="submit" :disabled="!dialog.value.trim()">
            {{ text("确定", "Continue") }}
          </button>
        </div>
      </form>
    </div>
  </TooltipProvider>
</template>
