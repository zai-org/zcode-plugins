export type Element = Record<string, unknown> & {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  version: number;
  isDeleted?: boolean;
};
export interface Scene {
  elements: Element[];
  appState: Record<string, unknown>;
  files: Record<string, Record<string, unknown>>;
}
export interface Diagram {
  id: string;
  title: string;
  revision: number;
  scene: Scene;
  updatedAt: number;
}
export interface DiagramRef {
  id: string;
  title: string;
  revision: number;
  uri: string;
  elementCount: number;
}
export type Operation =
  | { type: "add"; element: Record<string, unknown> }
  | { type: "update"; id: string; changes: Record<string, unknown> }
  | { type: "delete"; id: string };
export interface Commit {
  id: string;
  expectedRevision: number;
  operationId: string;
  scene: Scene;
  title?: string;
}
export interface DocumentStore {
  create(title: string, scene: Scene, id?: string): Promise<Diagram>;
  read(id: string): Promise<Diagram>;
  list(): Promise<Array<Omit<Diagram, "scene">>>;
  commit(input: Commit): Promise<Diagram>;
  apply(input: Omit<Commit, "scene"> & { operations: Operation[] }): Promise<Diagram>;
  close(): Promise<void>;
}
export class DiagramError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "DiagramError";
  }
}
export const MAX_SCENE_BYTES = 6 * 1024 * 1024;
export const PANEL_URI = "ui://excalidraw/panel.html";
export const DOCUMENT_PREFIX = "excalidraw://document/";
