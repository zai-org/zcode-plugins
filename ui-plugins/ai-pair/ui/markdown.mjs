/**
 * 评审报告 markdown 渲染 —— marked 解析 + DOMPurify 消毒。
 *
 * 报告正文来自外部评审模型（不可信输入），marked 不拦截 javascript: 链接
 * 也不清除内嵌 HTML，所以渲染结果必须先过 DOMPurify 白名单再注入面板；
 * severity 高亮在消毒后的 HTML 上做，避免把高亮标签写进未消毒内容。
 * 无 DOM 的环境（异常兜底）退回纯文本转义，绝不放行未消毒 HTML。
 *
 * renderMarkdown：报告/质证正文（完整 GFM：标题、列表、表格、代码块…）；
 * renderPlain：设置页的工具文本输出（渠道列表、保存结果），保留旧行内渲染。
 */
import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

const SEVERITIES = [
  ["CRITICAL", "sev-crit"],
  ["WARNING", "sev-warn"],
  ["SUGGESTION", "sev-sugg"],
];

// 链接在新窗口打开并补上 rel，防止 opener（DOMPurify 官方 recipe：afterSanitizeAttributes）
DOMPurify.addHook("afterSanitizeAttributes", function (node) {
  if (node.tagName === "A" && node.getAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

// severity 高亮：在消毒后的 HTML 上做 DOM 遍历，只处理普通文本节点，
// 跳过代码块/行内代码（里面的 CRITICAL 是引文，不是评级标记）
var SEV_CLASS = { CRITICAL: "sev-crit", WARNING: "sev-warn", SUGGESTION: "sev-sugg" };
var SEV_SPLIT = /(\[?\b(?:CRITICAL|WARNING|SUGGESTION)\b\]?)/;

function highlightSev(html) {
  var root = document.createElement("div");
  root.innerHTML = html; // 已过 DOMPurify，注入安全
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  var hits = [];
  while (walker.nextNode()) {
    var node = walker.currentNode;
    if (node.parentElement && node.parentElement.closest("pre, code")) continue;
    if (SEV_SPLIT.test(node.nodeValue)) hits.push(node);
  }
  hits.forEach(function (node) {
    var frag = document.createDocumentFragment();
    node.nodeValue.split(SEV_SPLIT).forEach(function (part) {
      if (!part) return;
      var m = part.match(/^\[?(CRITICAL|WARNING|SUGGESTION)\b\]?$/);
      if (m) {
        var span = document.createElement("span");
        span.className = SEV_CLASS[m[1]];
        span.textContent = "[" + m[1] + "]";
        frag.appendChild(span);
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    });
    node.parentNode.replaceChild(frag, node);
  });
  return root.innerHTML;
}

export function renderMarkdown(text) {
  var src = String(text == null ? "" : text);
  if (!DOMPurify.isSupported) return esc(src);
  return highlightSev(DOMPurify.sanitize(marked.parse(src), { FORBID_ATTR: ["style"] }));
}

// 工具输出是纯文本：转义 + 行内 code/加粗 + severity 高亮（旧行为），不解析块级 markdown
export function renderPlain(text) {
  var safe = esc(text);
  safe = safe.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  safe = safe.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  SEVERITIES.forEach(function (sev) {
    safe = safe.replace(
      new RegExp("\\[?\\b" + sev[0] + "\\b\\]?", "g"),
      '<span class="' + sev[1] + '">[' + sev[0] + "]</span>",
    );
  });
  return safe;
}
