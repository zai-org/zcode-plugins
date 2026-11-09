import { createRouter, createMemoryHistory } from "vue-router";
import EditorView from "@/views/EditorView.vue";
export default createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/:pathMatch(.*)*", component: EditorView }],
});
