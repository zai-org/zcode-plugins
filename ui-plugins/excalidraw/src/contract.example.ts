import type { Commit, Scene } from "#excalidraw/contract.ts";
export const emptyScene: Scene = { elements: [], appState: {}, files: {} };
export const commitExample: Commit = {
  id: "demo",
  expectedRevision: 1,
  operationId: "edit-1",
  scene: emptyScene,
};
