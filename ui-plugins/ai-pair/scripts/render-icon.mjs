/**
 * Render ui-plugins/ai-pair/icon.svg to a 256×256 PNG
 * (assets/ai-pair/icon.png) using system Chrome via playwright-core.
 * Dev-time tool only; not part of the plugin build.
 */
import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url))); // ui-plugins/ai-pair
const svgPath = join(root, "icon.svg");
const outPath = process.argv[2] || join(root, "..", "..", "assets", "ai-pair", "icon.png");
const size = Number(process.argv[3] || 256);

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" },
);
const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
const svg = await readFile(svgPath, "utf8");
await page.setContent(
  `<body style="margin:0"><div id="icon" style="width:${size}px;height:${size}px">${svg.replace('width="256" height="256"', `width="${size}" height="${size}"`)}</div></body>`,
);
await page.locator("#icon").screenshot({ path: outPath });
await browser.close();
console.log(`rendered ${outPath} @${size}`);
