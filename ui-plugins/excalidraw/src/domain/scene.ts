import {
  DiagramError,
  MAX_SCENE_BYTES,
  type Element,
  type Scene,
  type Operation,
} from "#excalidraw/contract.ts";

const TYPES = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "arrow",
  "line",
  "freedraw",
  "image",
  "frame",
]);
const record = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
export function validId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
    throw new DiagramError("invalid_id", "Invalid document or element id");
}
function fail(message: string): never {
  throw new DiagramError("invalid_scene", message);
}

export function validateScene(raw: unknown): Scene {
  if (!record(raw) || !Array.isArray(raw.elements) || !record(raw.appState) || !record(raw.files))
    fail("Expected elements, appState and files");
  if (raw.elements.length > 5000) fail("Scene exceeds 5000 elements");
  const ids = new Set<string>();
  for (const el of raw.elements) {
    if (!record(el)) fail("Invalid element");
    validId(el.id);
    if (ids.has(el.id)) fail(`Duplicate element: ${el.id}`);
    ids.add(el.id);
    if (!TYPES.has(String(el.type))) fail(`Unsupported element type: ${String(el.type)}`);
    for (const key of ["x", "y", "width", "height", "version"]) {
      if (typeof el[key] !== "number" || !Number.isFinite(el[key]))
        fail(`Invalid ${key} on ${el.id}`);
    }
    if (Number(el.width) < 0 || Number(el.height) < 0) fail("Negative element dimensions");
    if (el.type === "text" && typeof el.text !== "string") fail("Text content is required");
    if (
      el.type === "image" &&
      !el.isDeleted &&
      (typeof el.fileId !== "string" || !raw.files[el.fileId])
    )
      fail("Image file is missing");
  }
  for (const file of Object.values(raw.files)) {
    if (
      !record(file) ||
      typeof file.dataURL !== "string" ||
      !/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/.test(file.dataURL)
    )
      fail("Unsupported image data");
  }
  // 只持久化画布配置；选择、视角和协作者属于页面，不能随整图提交覆盖另一窗口的浏览状态。
  const appState = Object.fromEntries(
    Object.entries(raw.appState).filter(([key]) =>
      ["viewBackgroundColor", "gridSize", "gridStep"].includes(key),
    ),
  );
  const scene = { elements: raw.elements, appState, files: raw.files } as Scene;
  if (new TextEncoder().encode(JSON.stringify(scene)).length > MAX_SCENE_BYTES)
    throw new DiagramError("scene_too_large", "Scene exceeds 6 MiB");
  return structuredClone(scene);
}

function element(input: Record<string, unknown>, index: number): Element {
  const type = String(input.type ?? "rectangle");
  const id = input.id ?? `element-${index}`;
  validId(id);
  const el = {
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: index + 1,
    versionNonce: 0,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    ...input,
    id,
    type,
    x: Number(input.x ?? index * 220),
    y: Number(input.y ?? 60),
    width: Number(input.width ?? 180),
    height: Number(input.height ?? 90),
    version: Number(input.version ?? 1),
  } as Element;
  delete el.label;
  if (type === "text") {
    const text = String(input.text ?? "");
    const fontSize = Number(input.fontSize ?? 20);
    Object.assign(el, {
      fontSize,
      fontFamily: 5,
      text,
      originalText: text,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: null,
      autoResize: true,
      lineHeight: 1.25,
      ...input,
      id,
      type,
    });
    el.width = Number(input.width ?? Math.max(fontSize, text.length * fontSize));
    el.height = Number(input.height ?? text.split("\n").length * fontSize * 1.25);
  }
  if (type === "arrow" || type === "line")
    Object.assign(el, {
      points: [
        [0, 0],
        [el.width, el.height],
      ],
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: type === "arrow" ? "arrow" : null,
      elbowed: false,
      ...input,
      id,
      type,
    });
  return el;
}

export function makeScene(inputs: Record<string, unknown>[], files: Scene["files"] = {}): Scene {
  const elements: Element[] = [];
  inputs.forEach((input, i) => {
    const el = element(input, i);
    elements.push(el);
    if (record(input.label) && typeof input.label.text === "string") {
      const label = element(
        {
          ...input.label,
          id: `${el.id}-label`,
          type: "text",
          x: el.x + 8,
          y: el.y + el.height / 2 - 12.5,
          width: el.width - 16,
          containerId: el.id,
          textAlign: "center",
        },
        elements.length,
      );
      el.boundElements = [{ id: label.id, type: "text" }];
      elements.push(label);
    }
  });
  return validateScene({ elements, appState: { viewBackgroundColor: "#ffffff" }, files });
}

export function applyOperations(scene: Scene, operations: Operation[]): Scene {
  const next = structuredClone(scene);
  for (const op of operations) {
    if (op.type === "add") {
      next.elements.push(...makeScene([op.element], next.files).elements);
      continue;
    }
    const el = next.elements.find((item) => item.id === op.id && !item.isDeleted);
    if (!el) fail(`Element not found: ${op.id}`);
    if (op.type === "delete") {
      const deleted = new Set([
        el.id,
        ...next.elements.filter((e) => e.containerId === el.id).map((e) => e.id),
      ]);
      for (const item of next.elements) {
        if (deleted.has(item.id)) {
          item.isDeleted = true;
          item.version++;
        }
        if (Array.isArray(item.boundElements))
          item.boundElements = item.boundElements.filter(
            (b) => !record(b) || !deleted.has(String(b.id)),
          );
        for (const key of ["startBinding", "endBinding"])
          if (record(item[key]) && deleted.has(String(item[key].elementId))) item[key] = null;
      }
    } else {
      if ("id" in op.changes || "type" in op.changes)
        fail("Updates cannot change element identity or type");
      const dx = Number(op.changes.x ?? el.x) - el.x;
      const dy = Number(op.changes.y ?? el.y) - el.y;
      Object.assign(el, op.changes, {
        version: el.version + 1,
        versionNonce: el.versionNonce === 1 ? 2 : 1,
      });
      if (el.type === "text" && "text" in op.changes) el.originalText = el.text;
      for (const label of next.elements.filter((e) => e.containerId === el.id)) {
        label.x += dx;
        label.y += dy;
        label.version++;
      }
    }
  }
  return validateScene(next);
}

export function selectionContext(scene: Scene, ids: string[]): Element[] {
  const selected = new Set(ids);
  return scene.elements.filter(
    (el) =>
      !el.isDeleted &&
      (selected.has(el.id) ||
        selected.has(String(el.containerId)) ||
        [el.startBinding, el.endBinding].some(
          (b) => record(b) && selected.has(String(b.elementId)),
        )),
  );
}
