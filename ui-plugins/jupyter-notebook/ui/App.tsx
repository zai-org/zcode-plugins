import { useCallback, useEffect, useReducer, useState } from "react";
import { applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import type { NotebookDoc, SessionState } from "#nb/contract.ts";
import { host } from "#ui/bridge.ts";
import { strings, type Strings } from "#ui/i18n.ts";
import { Icon } from "#ui/icons.tsx";
import { Notebook } from "#ui/Notebook.tsx";
import { NotebookPicker, ServerSetup } from "#ui/Setup.tsx";
import { refreshState, useSnapshot } from "#ui/store.ts";
import { duration, lampOf } from "#ui/text.ts";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** 跟随宿主：主题、样式变量（颜色、字体、字号、圆角）、语言与显示模式。 */
function useHostContext() {
  const [, rerender] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const off = host.onContextChange(rerender);
    return () => void off();
  }, []);
  const context = host.context;
  const theme = context?.theme === "dark" ? "dark" : "light";
  const variables = context?.styles?.variables;
  const fonts = context?.styles?.css?.fonts;
  const inline = context?.displayMode === "inline";
  useEffect(() => applyDocumentTheme(theme), [theme]);
  useEffect(() => {
    if (variables) applyHostStyleVariables(variables);
  }, [variables]);
  useEffect(() => {
    if (fonts) applyHostFonts(fonts);
  }, [fonts]);
  useEffect(() => {
    document.documentElement.classList.toggle("inline", inline);
  }, [inline]);
  return { s: strings(context?.locale ?? navigator.language), inline };
}

/** 对话中的卡片：notebook 概要与“在侧栏打开”；缺少依赖时给出下一步。 */
function InlineCard({ doc, state, s }: { doc: NotebookDoc | undefined; state: SessionState; s: Strings }) {
  const active = doc?.cells.findIndex((cell) => cell.run?.state === "running") ?? -1;
  const runningCell = active >= 0 ? doc!.cells[active] : undefined;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!runningCell) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runningCell]);
  const kernel = doc?.kernel;
  const needsSetup = !doc && state.environment.state === "missing" && !state.servers.some((server) => server.status === "ready");
  const working = needsSetup && state.setup.handoffAt !== null;
  return (
    <div className="inline-card">
      <div className="tile">
        <Icon name="notebook" />
      </div>
      <div className="grow">
        <div className="name inline-title">{doc?.name ?? s.title}</div>
        {doc && kernel && (
          <div className="sub">
            <span className={`lamp ${lampOf(kernel.status)}`} />
            {runningCell
              ? `${s.runningCell(active + 1, doc.cells.length)}${runningCell.run?.startedAt ? ` · ${duration(now - runningCell.run.startedAt)}` : ""}`
              : [s.cells(doc.cells.length), kernel.displayName ?? kernel.name ?? s.noKernel, s.kernelStatus[kernel.status].toLowerCase()].join(
                  " · ",
                )}
          </div>
        )}
        {needsSetup && (
          <div className="sub">
            <span className={`lamp ${working ? "agent" : "warn"}`} />
            {working ? s.agentInstalling : s.missingTitle}
          </div>
        )}
      </div>
      {needsSetup && !working ? (
        <button type="button" className="btn primary" onClick={() => void host.requestFullscreen()}>
          {s.setUp}
        </button>
      ) : (
        <button type="button" className="btn outline" aria-label={s.openPanel} title={s.openPanel} onClick={() => void host.requestFullscreen()}>
          <Icon name="panel" size={15} />
          {s.open}
        </button>
      )}
    </div>
  );
}

export function App() {
  const snap = useSnapshot();
  const { s, inline } = useHostContext();
  const [picker, setPicker] = useState<null | "open" | "new">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const onError = useCallback((error: unknown) => setNotice(message(error)), []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8_000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!snap.connected || !snap.state)
    return <div className="center">{snap.error ? <pre className="error-box">{snap.error}</pre> : s.connecting}</div>;

  const state = snap.state;
  const doc = snap.active ? snap.docs[snap.active] : undefined;
  if (inline) return <InlineCard doc={doc} state={state} s={s} />;

  const hasServer = state.servers.some((server) => server.status === "ready");
  if (!hasServer && !state.notebooks.length) return <ServerSetup state={state} s={s} />;
  if (picker || !state.notebooks.length)
    return (
      <NotebookPicker
        key={picker ?? "open"}
        state={state}
        s={s}
        initialCreate={picker === "new"}
        onClose={state.notebooks.length ? () => setPicker(null) : undefined}
      />
    );

  if (!doc)
    return (
      <div className="center">{snap.active && snap.missing[snap.active] ? s.notebookClosed : s.loading}</div>
    );

  const close = (id: string) =>
    void host
      .call("close_notebook", { notebook: id })
      .then(() => refreshState())
      .catch(onError);

  return (
    <Notebook
      key={doc.id}
      doc={doc}
      state={state}
      s={s}
      notice={notice}
      onDismiss={() => setNotice(null)}
      onError={onError}
      onOpenPicker={setPicker}
      onClose={close}
    />
  );
}
