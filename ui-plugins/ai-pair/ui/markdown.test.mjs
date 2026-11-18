import { describe, expect, it } from "vitest";
import { esc, renderMarkdown, renderPlain } from "./markdown.mjs";

describe("esc", () => {
  it("转义 HTML 特殊字符", () => {
    expect(esc('<img src=x onerror="alert(1)">&\'')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;",
    );
  });
  it("null/undefined 转空串", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });
});

describe("renderMarkdown", () => {
  it("标题、列表、表格、代码块、引用都渲染成块级元素", () => {
    const html = renderMarkdown(
      "## 发现问题\n\n- 外层\n  - 内层\n- 第二项\n\n| 列1 | 列2 |\n| --- | :---: |\n| a | b |\n\n> 引用\n\n```js\nconst x = 1;\n```",
    );
    expect(html).toContain("<h2>发现问题</h2>");
    expect(html).toContain("<li>外层<ul>");
    expect(html).toContain("<li>内层</li>");
    expect(html).toContain("<table>");
    expect(html).toContain('<td align="center">b</td>');
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<pre><code");
    expect(html).toContain("const x = 1;");
  });

  it("单换行转 <br>（breaks），行内样式齐全", () => {
    const html = renderMarkdown("第一行\n第二行\n\n**加粗** *斜体* ~~删除~~ `code`");
    expect(html).toContain("<br>");
    expect(html).toContain("<strong>加粗</strong>");
    expect(html).toContain("<em>斜体</em>");
    expect(html).toContain("<del>删除</del>");
    expect(html).toContain("<code>code</code>");
  });

  it("内嵌 HTML 被消毒：script 移除、img 的事件属性被剥离", () => {
    const html = renderMarkdown('正文 <img src=x onerror=alert(1)> <script>alert(2)</script> 尾部');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<script");
    expect(html).toContain("尾部");
  });

  it("javascript: 链接被清除，https 链接保留并加 target/rel", () => {
    const html = renderMarkdown("[坏](javascript:alert(1)) [好](https://example.com)");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("CRITICAL/WARNING/SUGGESTION 高亮，且与加粗可叠加", () => {
    const html = renderMarkdown("[CRITICAL] 与 **[WARNING]** 与 SUGGESTION 项");
    expect(html).toContain('<span class="sev-crit">[CRITICAL]</span>');
    expect(html).toContain("<strong>");
    expect(html).toContain('<span class="sev-warn">[WARNING]</span>');
    expect(html).toContain('<span class="sev-sugg">[SUGGESTION]</span>');
  });

  it("代码块里的 severity 不再二次高亮（保持原文本）", () => {
    const html = renderMarkdown("```\nCRITICAL 不高亮\n```");
    expect(html).not.toContain("<span");
    expect(html).toContain("CRITICAL 不高亮");
  });

  it("CRLF 输入与空内容", () => {
    expect(renderMarkdown("## 概要\r\n\r\n正文")).toContain("<h2>概要</h2>");
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown(null)).toBe("");
  });
});

describe("renderPlain（工具文本输出）", () => {
  it("保留旧行内渲染：code、加粗、severity 高亮", () => {
    const html = renderPlain("渠道 `openrouter` **可用** [SUGGESTION] 提示");
    expect(html).toContain("<code>openrouter</code>");
    expect(html).toContain("<strong>可用</strong>");
    expect(html).toContain('<span class="sev-sugg">[SUGGESTION]</span>');
  });

  it("不解析块级 markdown，标签被转义", () => {
    const html = renderPlain("## 不是标题\n\n<div>标签</div>");
    expect(html).not.toContain("<h2>");
    expect(html).not.toContain("<div>");
    expect(html).toContain("## 不是标题");
    expect(html).toContain("&lt;div&gt;");
  });
});
