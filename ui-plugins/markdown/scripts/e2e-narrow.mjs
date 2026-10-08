// 响应式 e2e：窄面板（760×900）下无遮挡、无溢出、正文不被大纲挤压。
// 独立于主 e2e（仓库单文件 400 行上限）；产物 06/07 截图供视觉审查。
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import { startFixture } from "./browser-fixture.mjs";

const fixture = await startFixture();
const { url, call } = fixture;
const initial = await call("new_document", {
  path: "docs/e2e.md",
  content: "# E2E 标题\n\n$$E=mc^2$$\n\n```mermaid\ngraph TD; A-->B;\n```\n\n正文段落。",
});
const artifacts = process.env.MARKDOWN_E2E_ARTIFACTS || join(tmpdir(), "markdown-e2e");
await mkdir(artifacts, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 760, height: 900 } });
await context.route("**/*", (route) => {
  const target = route.request().url();
  if (target.startsWith(url)) return route.continue();
  return route.abort();
});
const failures = [];

const probe = (page) =>
  page.evaluate(() => {
    const rect = (el) => {
      const r = el?.getBoundingClientRect();
      return r
        ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height }
        : null;
    };
    return {
      header: rect(document.querySelector("header")),
      toolbar: rect(document.querySelector(".vditor-toolbar")),
      placeholder: rect(document.querySelector("#empty")),
      stage: rect(document.querySelector(".stage")),
      content: rect(document.querySelector(".vditor-ir .vditor-reset")),
      outlineVisible: (() => {
        const el = document.querySelector(".vditor-outline");
        if (!el) return false;
        const style = getComputedStyle(el);
        return style.display !== "none" && el.getBoundingClientRect().width > 0;
      })(),
      pageOverflow: document.body.scrollWidth - document.documentElement.clientWidth,
    };
  });

// 空态：编辑器整体 visibility:hidden（工具栏不可见），覆盖层铺满舞台。
const blank = await context.newPage();
blank.on("pageerror", (error) => failures.push(`blank pageerror: ${error.message}`));
await blank.goto(url);
await blank.waitForSelector(".vditor-toolbar", { timeout: 25000, state: "attached" });
await blank
  .waitForFunction(
    () => {
      const stage = document.querySelector(".stage")?.getBoundingClientRect();
      const placeholder = document.getElementById("empty")?.getBoundingClientRect();
      return (
        stage &&
        placeholder &&
        Math.abs(placeholder.top - stage.top) <= 16 &&
        Math.abs(placeholder.bottom - stage.bottom) <= 16
      );
    },
    null,
    { timeout: 8000, polling: 250 },
  )
  .catch(() => {});
const blankProbe = await probe(blank);
await blank.screenshot({ path: join(artifacts, "06-narrow-blank.png") });
const blankToolbarHidden = await blank.evaluate(() => {
  const el = document.querySelector(".vditor-toolbar");
  if (!el) return false;
  const style = getComputedStyle(el);
  const visible =
    style.visibility !== "hidden" && style.display !== "none" && el.getClientRects().length > 0;
  return !visible;
});
const coversOk =
  blankToolbarHidden &&
  Boolean(blankProbe.placeholder && blankProbe.stage) &&
  blankProbe.placeholder.top <= blankProbe.stage.top + 16 &&
  blankProbe.placeholder.bottom >= blankProbe.stage.bottom - 16 &&
  blankProbe.pageOverflow <= 2;
console.log("narrow blank:", JSON.stringify({ covers: coversOk, overflow: blankProbe.pageOverflow }));

// 有文档：工具栏完整位于 header 之下、无大纲挤压、无页面级横向溢出。
const doc = await context.newPage();
doc.on("pageerror", (error) => failures.push(`doc pageerror: ${error.message}`));
await doc.goto(`${url}/?doc=${initial.document.id}`);
await doc.waitForFunction(() => document.querySelector(".vditor-ir h1"), null, { timeout: 25000 }).catch(() => {});
await new Promise((resolve) => setTimeout(resolve, 1500));
const docProbe = await probe(doc);
await doc.screenshot({ path: join(artifacts, "07-narrow-doc.png") });
await browser.close();
await fixture.close();

const headerClearsToolbar =
  docProbe.header && docProbe.toolbar && docProbe.toolbar.h === 0;
const narrowOk =
  coversOk &&
  headerClearsToolbar &&
  !docProbe.outlineVisible &&
  (docProbe.content?.w ?? 0) > 260 &&
  docProbe.pageOverflow <= 2 &&
  failures.length === 0;
console.log(
  "narrow doc:",
  JSON.stringify({
    headerClearsToolbar,
    outlineVisible: docProbe.outlineVisible,
    contentWidth: Math.round(docProbe.content?.w ?? 0),
    overflow: docProbe.pageOverflow,
  }),
);
console.log(failures.length ? `failures: ${failures.join(" | ")}` : "no page failures");
console.log(narrowOk ? "NARROW E2E OK" : "NARROW E2E FAILED");
process.exit(narrowOk ? 0 : 1);
