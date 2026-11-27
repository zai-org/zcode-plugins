import { join } from "node:path";
import { z } from "zod";
import { createKitServer, readPanel } from "./kit/server-kit.ts";
import { KitError, Workspace, safeFileName } from "./kit/workspace.ts";
import { fetchWhiteCanvas, type FetchLike } from "./canvas.ts";
import {
  PRICING_URL,
  SITE,
  WORKFLOWS,
  WORKFLOW_IDS,
  assertDimensions,
  type WorkflowId,
  workflowOf,
} from "./workflows.ts";

export const NAME = "whitebackground";
export const VERSION = "0.1.0";
export const PANEL_URI = "ui://whitebackground/panel.html";

const widthField = z.number().int().describe("Canvas width in pixels, 1–8192. Width × height must be at most 32 million pixels.");
const heightField = z.number().int().describe("Canvas height in pixels, 1–8192. Width × height must be at most 32 million pixels.");

export type ServerOptions = {
  workspaceRoot: string;
  assetRoot: string;
  log?: (line: string) => void;
  fetch?: FetchLike;
};

async function uniquePngPath(ws: Workspace, preferred: string): Promise<string> {
  if (!(await ws.exists(preferred))) return preferred;
  const lower = preferred.toLowerCase();
  const base = lower.endsWith(".png") ? preferred.slice(0, -4) : preferred;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}.png`;
    if (!(await ws.exists(candidate))) return candidate;
  }
  throw new KitError("exists", `Could not find a free filename near ${preferred}.`);
}

function defaultCanvasPath(width: number, height: number): string {
  return `whitebackground/${safeFileName(`white-${width}x${height}`, "white-canvas")}.png`;
}

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const fetcher = options.fetch ?? fetch;
  const { server, tool } = createKitServer({
    name: NAME,
    version: VERSION,
    panelUri: PANEL_URI,
    surface: "editor",
    panelHtml: () => readPanel(join(options.assetRoot, "ui/panel.html")),
    log: options.log,
  });

  tool(
    "panel_open",
    {
      description:
        "Open the WhiteBackground side panel. Use this when the user wants to see the canvas form or the six official editor workflows.",
      input: {},
      openPanel: true,
      readOnly: true,
    },
    async () => ({
      text: "Opened the WhiteBackground panel. The user can create a pure white PNG or open one of the six official local photo editors. This plugin never uploads a photo on the free path and does not spend Cloud credits.",
      structured: { site: SITE, pricingUrl: PRICING_URL, workflows: WORKFLOW_IDS },
    }),
  );

  tool(
    "canvas_create",
    {
      description:
        "Create a pure #FFFFFF PNG via the official public WhiteBackground canvas API, save it in the workspace, and open the side panel. Does not require an account or API key and does not spend credits. Photos are not involved.",
      input: {
        width: widthField,
        height: heightField,
        output: z
          .string()
          .optional()
          .describe("Workspace-relative PNG path. Defaults to whitebackground/white-{width}x{height}.png; existing files are not overwritten."),
      },
      openPanel: true,
      openWorld: true,
      timeoutMs: 60_000,
    },
    async (input) => {
      const { width, height } = assertDimensions(input.width, input.height);
      const requested = String(input.output ?? "").trim() || defaultCanvasPath(width, height);
      if (!requested.toLowerCase().endsWith(".png")) {
        throw new KitError("bad_path", "The output path must end with .png.");
      }
      ws.resolve(requested); // reject paths outside the workspace before fetching
      const { png, officialUrl, downloadUrl } = await fetchWhiteCanvas(width, height, fetcher);
      const path = await uniquePngPath(ws, requested);
      await ws.write(path, png);
      const previewDataUrl = `data:image/png;base64,${png.toString("base64")}`;
      const text =
        `Saved a ${width}×${height} pure white PNG to ${path}. ` +
        `Official download: ${downloadUrl}. ` +
        `This used the public WhiteBackground canvas API (no account, no credits).`;
      return {
        text,
        structured: {
          path,
          width,
          height,
          bytes: png.length,
          officialUrl,
          downloadUrl,
          previewDataUrl,
        },
        images: [{ data: png.toString("base64"), mimeType: "image/png" }],
      };
    },
  );

  tool(
    "editor_open",
    {
      description:
        "Open the official WhiteBackground local photo editor for one workflow (white, transparent, png_to_white, square, shopify, or enhance) and show it in the side panel. The user must choose the photo in that editor; this tool does not accept attachments, file paths, or base64 images and does not spend Cloud credits.",
      input: {
        workflow: z
          .enum(WORKFLOW_IDS)
          .describe("Which official editor to open: white, transparent, png_to_white, square, shopify, or enhance."),
      },
      openPanel: true,
      readOnly: true,
    },
    async (input) => {
      const flow = workflowOf(String(input.workflow));
      const text =
        `Open this official WhiteBackground editor and choose the photo there (this plugin cannot process chat attachments or workspace files on the free path):\n` +
        `${flow.url}\n\n` +
        `${flow.titleEn}: ${flow.hintEn}\n` +
        `Inspect Original and Result before downloading. An embedded preview may be scaled; save the full-resolution file from the editor (or open the site in a browser first). ` +
        `Do not claim the photo is done until the user has downloaded it. Free background-editor exports are capped at 2200 px and do not enlarge the subject. ` +
        `No WhiteBackground account or credits are used. Paid plans: ${PRICING_URL}`;
      return {
        text,
        structured: {
          workflow: flow.id as WorkflowId,
          url: flow.url,
          titleEn: flow.titleEn,
          titleZh: flow.titleZh,
          hintEn: flow.hintEn,
          hintZh: flow.hintZh,
          pricingUrl: PRICING_URL,
        },
      };
    },
  );

  return { server, workspace: ws };
}
