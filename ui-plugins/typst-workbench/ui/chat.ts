import type { Diagnostic } from "#t/contract.ts";
import { diagnosticsText } from "#t/domain/format.ts";
import type { SourceMatch } from "#t/domain/match.ts";
import { host } from "#ui/bridge.ts";

/** 面板中选中的内容如何进入对话：作为模型上下文（不发消息），或连同用户的问题作为一条消息。 */

export interface SelectionRef {
  /** 渲染出的文字。 */
  text: string;
  /** 0 起。 */
  pageIndex: number;
  /** 对应的源码（找到时）。 */
  source: SourceMatch | null;
}

function sourceRef(source: SourceMatch): string {
  const lines = source.endLine !== source.line ? `${source.line}–${source.endLine}` : `${source.line}`;
  return `${source.file}:${lines}`;
}

function selectionBlock(selection: SelectionRef): string {
  const quote = selection.text.replace(/\s+/g, " ").trim();
  const parts = [`> ${quote}`, "", `— Typst preview, page ${selection.pageIndex + 1}`];
  if (selection.source) parts.push("", `Source (${sourceRef(selection.source)}):`, "```typst", selection.source.excerpt, "```");
  return parts.join("\n");
}

export async function addSelectionToContext(selection: SelectionRef) {
  await host.updateModelContext(`The user selected this in the Typst preview:\n\n${selectionBlock(selection)}`, {
    typst: {
      page: selection.pageIndex + 1,
      text: selection.text,
      ...(selection.source ? { file: selection.source.file, line: selection.source.line, endLine: selection.source.endLine } : {}),
    },
  });
}

export async function askAboutSelection(question: string, selection: SelectionRef) {
  await host.sendMessage(`${question.trim()}\n\n${selectionBlock(selection)}`);
}

export async function askToFix(intro: string, diagnostics: Diagnostic[]) {
  await host.sendMessage(`${intro}\n\n${diagnosticsText(diagnostics)}`);
}

export async function addProblemsToContext(main: string, diagnostics: Diagnostic[]) {
  await host.updateModelContext(`Current Typst problems in ${main}:\n\n${diagnosticsText(diagnostics)}`, {
    typst: { main, problems: diagnostics.length },
  });
}
