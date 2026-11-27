import { KitError } from "./kit/workspace.ts";

/** Official WhiteBackground public editor workflows. URLs are from whitebackground.app. */

export const SITE = "https://whitebackground.app";
export const MCP_URL = `${SITE}/mcp`;
export const CANVAS_API = `${SITE}/api/mcp/canvas`;
export const PRICING_URL = `${SITE}/pricing`;
export const MAX_SIDE = 8192;
export const MAX_PIXELS = 32_000_000;

export const WORKFLOW_IDS = ["white", "transparent", "png_to_white", "square", "shopify", "enhance"] as const;
export type WorkflowId = (typeof WORKFLOW_IDS)[number];

export type Workflow = {
  id: WorkflowId;
  path: string;
  url: string;
  titleZh: string;
  titleEn: string;
  hintZh: string;
  hintEn: string;
};

export const WORKFLOWS: Record<WorkflowId, Workflow> = {
  white: {
    id: "white",
    path: "/make-background-white",
    url: `${SITE}/make-background-white`,
    titleZh: "做成白底图",
    titleEn: "White background",
    hintZh: "在编辑器里选一张照片，检查边缘后下载白底 JPG 或 PNG。免费导出最长边 2200 px，不放大主体。",
    hintEn: "Choose a photo in the editor, check the edges, then download a white JPG or PNG. Free exports are capped at 2200 px and do not enlarge the subject.",
  },
  transparent: {
    id: "transparent",
    path: "/transparent-background-maker",
    url: `${SITE}/transparent-background-maker`,
    titleZh: "透明 PNG 抠图",
    titleEn: "Transparent PNG",
    hintZh: "在编辑器里选照片，检查轮廓后下载透明 PNG。JPG 不能保存透明。",
    hintEn: "Choose a photo in the editor, inspect the cutout, then download a transparent PNG. JPG cannot store transparency.",
  },
  png_to_white: {
    id: "png_to_white",
    path: "/add-white-background-to-png",
    url: `${SITE}/add-white-background-to-png`,
    titleZh: "透明 PNG 铺到白底",
    titleEn: "PNG onto white",
    hintZh: "选择已有的透明 PNG，沿用现成抠图铺到白底，不再做一次去背。",
    hintEn: "Choose an existing transparent PNG. Its cutout is composed on white without another removal pass.",
  },
  square: {
    id: "square",
    path: "/make-image-square",
    url: `${SITE}/make-image-square`,
    titleZh: "做成不裁切的正方形",
    titleEn: "Square without cropping",
    hintZh: "选图前先取消勾选去背，即可保留整张原图并加白边。主体占比默认 85%，可在 70%–95% 调整。",
    hintEn: "Leave background removal unchecked before choosing the photo to keep the whole scene and add white padding. Subject fill defaults to 85% and can be set from 70% to 95%.",
  },
  shopify: {
    id: "shopify",
    path: "/shopify-image-resizer",
    url: `${SITE}/shopify-image-resizer`,
    titleZh: "Shopify 商品图尺寸",
    titleEn: "Shopify sizing",
    hintZh: "使用 2048 px 预设或自定义画布，下载前核对实际导出尺寸。",
    hintEn: "Use the 2048 px preset or a custom canvas, and check the actual export dimensions before downloading.",
  },
  enhance: {
    id: "enhance",
    path: "/product-photo-enhancer",
    url: `${SITE}/product-photo-enhancer`,
    titleZh: "本地放大商品图",
    titleEn: "Local enlargement",
    hintZh: "比较普通放大与 AI 放大。保护文字和 logo。2× 输出最长边最多 2200 px，4× 最多 4096 px；AI 可能改变细节。",
    hintEn: "Compare standard and AI enlargement. Protect lettering and logos. 2× outputs up to 2200 px, 4× up to 4096 px; AI may change fine details.",
  },
};

export function isWorkflowId(value: string): value is WorkflowId {
  return (WORKFLOW_IDS as readonly string[]).includes(value);
}

export function workflowOf(id: string): Workflow {
  if (!isWorkflowId(id)) {
    throw new KitError("bad_workflow", `Unknown workflow “${id}”. Use one of: ${WORKFLOW_IDS.join(", ")}.`);
  }
  return WORKFLOWS[id];
}

export function assertDimensions(width: unknown, height: unknown): { width: number; height: number } {
  const w = typeof width === "number" ? width : Number(width);
  const h = typeof height === "number" ? height : Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h)) {
    throw new KitError("bad_size", "Width and height must be whole numbers.");
  }
  if (w < 1 || h < 1 || w > MAX_SIDE || h > MAX_SIDE) {
    throw new KitError("bad_size", `Each side must be between 1 and ${MAX_SIDE} pixels.`);
  }
  if (w * h > MAX_PIXELS) {
    throw new KitError(
      "too_many_pixels",
      `Width × height must be at most ${MAX_PIXELS.toLocaleString("en-US")} pixels.`,
    );
  }
  return { width: w, height: h };
}

export function canvasUrl(width: number, height: number, download = false): string {
  const url = `${CANVAS_API}?width=${width}&height=${height}`;
  return download ? `${url}&download=1` : url;
}
