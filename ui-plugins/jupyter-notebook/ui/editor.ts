import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { CellType } from "#nb/contract.ts";

// 颜色全部取 CSS 变量，随宿主主题切换，无需重建编辑器。
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.definitionKeyword, tags.moduleKeyword], color: "var(--syn-keyword)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--syn-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--syn-number)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--syn-comment)", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--syn-function)" },
  { tag: [tags.definition(tags.variableName), tags.className, tags.definition(tags.className)], color: "var(--syn-def)" },
  { tag: [tags.self, tags.atom, tags.special(tags.variableName)], color: "var(--syn-builtin)" },
  { tag: [tags.operator], color: "var(--syn-operator)" },
  { tag: tags.heading, fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: [tags.link, tags.url], color: "var(--syn-string)", textDecoration: "underline" },
  { tag: tags.monospace, color: "var(--syn-builtin)" },
]);

const theme = EditorView.theme({
  "&": { fontSize: "var(--nb-code)", backgroundColor: "transparent", color: "var(--nb-fg)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--nb-mono)", lineHeight: "20px" },
  ".cm-content": { padding: "9px 0", caretColor: "var(--nb-fg)" },
  ".cm-line": { padding: "0 13px" },
  ".cm-cursor": { borderLeftColor: "var(--nb-fg)", borderLeftWidth: "1.5px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--nb-selection) !important",
  },
  ".cm-matchingBracket": { backgroundColor: "var(--nb-hover-strong)", outline: "none" },
  ".cm-placeholder": { color: "var(--nb-fg3)" },
});

export interface EditorHandlers {
  onChange: (value: string) => void;
  onRun: (mode: "stay" | "next" | "insert") => void;
  onEscape: () => void;
  onFocus: () => void;
  /** 光标在首行按上 / 末行按下时移到相邻 cell。 */
  onLeave: (direction: "up" | "down") => void;
}

const language = (type: CellType): Extension =>
  type === "code" ? python() : type === "markdown" ? markdown() : [];

/** 一个 cell 的 CodeMirror 实例。外部 source 变化经 setValue 写入，保持光标位置。 */
export function createEditor(
  parent: HTMLElement,
  { value, type, placeholder }: { value: string; type: CellType; placeholder?: string },
  handlers: EditorHandlers,
) {
  const lang = new Compartment();
  let applyingExternal = false;
  const cellKeys = Prec.highest(
    keymap.of([
      { key: "Shift-Enter", run: () => (handlers.onRun("next"), true) },
      { key: "Mod-Enter", run: () => (handlers.onRun("stay"), true) },
      // 与 Jupyter 一致：macOS 上 Ctrl+Enter 也运行。
      { key: "Ctrl-Enter", run: () => (handlers.onRun("stay"), true) },
      { key: "Alt-Enter", run: () => (handlers.onRun("insert"), true) },
      { key: "Escape", run: () => (handlers.onEscape(), true) },
      {
        key: "ArrowUp",
        run: (view) => {
          const { head, empty } = view.state.selection.main;
          if (!empty || view.state.doc.lineAt(head).number !== 1) return false;
          handlers.onLeave("up");
          return true;
        },
      },
      {
        key: "ArrowDown",
        run: (view) => {
          const { head, empty } = view.state.selection.main;
          if (!empty || view.state.doc.lineAt(head).number !== view.state.doc.lines) return false;
          handlers.onLeave("down");
          return true;
        },
      },
    ]),
  );
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: value,
      extensions: [
        cellKeys,
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        indentUnit.of("    "),
        EditorState.tabSize.of(4),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        syntaxHighlighting(highlight),
        lang.of(language(type)),
        EditorView.lineWrapping,
        theme,
        placeholder ? placeholderExt(placeholder) : [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingExternal) handlers.onChange(update.state.doc.toString());
          if (update.focusChanged && update.view.hasFocus) handlers.onFocus();
        }),
      ],
    }),
  });

  return {
    view,
    get value() {
      return view.state.doc.toString();
    },
    /** 用外部值替换内容（不进入 onChange），尽量保留光标。 */
    setValue(next: string) {
      const current = view.state.doc.toString();
      if (current === next) return;
      const head = Math.min(view.state.selection.main.head, next.length);
      applyingExternal = true;
      try {
        view.dispatch({ changes: { from: 0, to: current.length, insert: next }, selection: { anchor: head } });
      } finally {
        applyingExternal = false;
      }
    },
    setType(type: CellType) {
      view.dispatch({ effects: lang.reconfigure(language(type)) });
    },
    focus(at: "start" | "end" | "keep" = "keep") {
      if (at !== "keep") {
        const pos = at === "start" ? 0 : view.state.doc.length;
        view.dispatch({ selection: { anchor: pos } });
      }
      view.focus();
    },
    destroy: () => view.destroy(),
  };
}

export type CellEditor = ReturnType<typeof createEditor>;
