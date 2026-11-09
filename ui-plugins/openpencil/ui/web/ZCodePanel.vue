<script setup lang="ts">
import { ref } from "vue";
import { text, notice, askZcode, addToContext, codegen } from "#ui/web/integration.ts";
const prompt = ref("");
const busy = ref(false);
async function send() {
  if (!prompt.value.trim()) return;
  busy.value = true;
  try {
    await askZcode(prompt.value);
    prompt.value = "";
  } catch (error) {
    notice.value = String(error);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="zcode-ai-panel">
    <strong>ZCode</strong>
    <p>
      {{
        text(
          "选中画布中的对象，让 ZCode 通过设计工具修改。",
          "Select objects on the canvas and ask ZCode to edit them with design tools.",
        )
      }}
    </p>
    <textarea
      data-testid="op-ask-zcode-input"
      v-model="prompt"
      :placeholder="text('描述你想修改的内容…', 'Describe your changes…')"
    />
    <button :disabled="busy || !prompt.trim()" @click="send">
      {{ text("让 ZCode 修改", "Ask ZCode to edit") }}
    </button>
    <button @click="addToContext">
      {{ text("添加选区到对话上下文", "Add selection to context") }}
    </button>
    <button @click="codegen">{{ text("生成代码", "Generate code") }}</button>
    <p role="status">{{ notice }}</p>
  </div>
</template>
