import { useCallback, useEffect, useState } from "react";
import type { SessionState } from "#t/contract.ts";
import { host } from "#ui/bridge.ts";
import { Toast, errorText, useHostContext } from "#ui/common.tsx";
import type { Strings } from "#ui/i18n.ts";
import { Icon } from "#ui/icons.tsx";
import { Preview } from "#ui/Preview.tsx";
import { TypstReady, TypstSetup } from "#ui/Setup.tsx";
import { refreshState, useSnapshot } from "#ui/store.ts";

type Notify = (message: string, tone?: "info" | "error") => void;

function CheckAgain({ s, notify }: { s: Strings; notify: Notify }) {
  const [checking, setChecking] = useState(false);
  return (
    <button
      type="button"
      className="btn outline sm"
      disabled={checking}
      onClick={() => {
        setChecking(true);
        void host
          .call("restart")
          .catch((error) => notify(errorText(error), "error"))
          .then(() => refreshState())
          .finally(() => setChecking(false));
      }}
    >
      <Icon name="refresh" size={14} />
      {s.checkAgain}
    </button>
  );
}

/** 刚在这个页面里装好 Typst 时，短暂显示“已就绪”再进入预览。 */
const READY_MS = 2_500;
function useReadyMoment(state: SessionState | null) {
  const [phase, setPhase] = useState<"none" | "setup" | "ready" | "done">("none");
  const ready = state?.toolchain.state === "ready";
  const unusable = !!state && state.toolchain.state !== "ready" && state.toolchain.state !== "unknown";
  useEffect(() => {
    if (unusable && phase !== "setup") setPhase("setup");
    else if (ready && phase === "setup") setPhase("ready");
  }, [unusable, ready, phase]);
  useEffect(() => {
    if (phase !== "ready") return;
    const timer = setTimeout(() => setPhase("done"), READY_MS);
    return () => clearTimeout(timer);
  }, [phase]);
  return { showReady: phase === "ready", dismiss: () => setPhase("done") };
}

/** 没有主文件：列出 .typ 文件供选择，或说明还没有。 */
function ChooseMain({ state, s, notify }: { state: SessionState; s: Strings; notify: Notify }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!state.candidates.length)
    return (
      <div className="center status-screen">
        <div className="tile lg">
          <Icon name="file" size={22} />
        </div>
        <h2>{s.noFilesTitle}</h2>
        <p className="muted">{s.noFilesBody}</p>
        <CheckAgain s={s} notify={notify} />
      </div>
    );
  return (
    <div className="center status-screen">
      <h2>{s.chooseTitle}</h2>
      <p className="muted">{s.chooseBody}</p>
      <ul className="file-list">
        {state.candidates.map((path) => (
          <li key={path}>
            <button
              type="button"
              className="file-row"
              disabled={!!busy}
              onClick={() => {
                setBusy(path);
                void host
                  .call("panel_set_main", { path })
                  .catch((error) => notify(errorText(error), "error"))
                  .finally(() => setBusy(null));
              }}
            >
              <Icon name="file" size={15} />
              <span className="ellipsis grow">{path}</span>
              {busy === path ? <span className="spinner" /> : <Icon name="chevronRight" size={14} />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 对话中的卡片：编译状态与“在侧栏打开”；Typst 不可用时直接进入设置。 */
function InlineCard({ state, s }: { state: SessionState | null; s: Strings }) {
  const errors = state?.diagnostics.filter((entry) => entry.severity === "error").length ?? 0;
  const toolchain = state?.toolchain.state;
  const unusable = !!state && toolchain !== "ready" && toolchain !== "unknown";
  const working = unusable && state.setup.handoffAt !== null;
  const ok = !!state && toolchain === "ready" && !!state.main && errors === 0 && state.status.phase !== "crashed";
  const sub = !state
    ? s.connecting
    : working
      ? s.agentSettingUp
      : toolchain === "missing"
        ? s.missingTitle
        : toolchain === "too_old"
          ? s.tooOldTitle(state.toolchain.version ?? "")
          : toolchain === "error"
            ? s.errorTitle
            : !state.main
              ? s.noFilesTitle
              : errors
                ? `${state.main} · ${s.errors(errors)}`
                : state.snapshot
                  ? `${state.main} · ${s.inlineReady(state.snapshot.pages)}`
                  : `${state.main} · ${s.compiling}`;
  return (
    <div className="inline-card">
      <div className="tile">
        <Icon name="file" />
      </div>
      <div className="grow">
        <div className="name">{s.title}</div>
        <div className="sub">
          <span className={`lamp ${ok ? "ok" : working ? "agent" : "bad"}`} />
          <span className="ellipsis">{sub}</span>
        </div>
      </div>
      {unusable && !working ? (
        <button type="button" className="btn primary sm" onClick={() => void host.requestFullscreen()}>
          {s.setUp}
        </button>
      ) : (
        <button type="button" className="btn outline sm" aria-label={s.openPanel} title={s.openPanel} onClick={() => void host.requestFullscreen()}>
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
  const [toast, setToast] = useState<{ message: string; tone?: "info" | "error" } | null>(null);
  const notify = useCallback((message: string, tone?: "info" | "error") => setToast({ message, tone }), []);
  const dismiss = useCallback(() => setToast(null), []);
  const readyMoment = useReadyMoment(snap.state);

  if (inline) return <InlineCard state={snap.state} s={s} />;
  if (!snap.connected || !snap.state)
    return <div className="center">{snap.error ? <pre className="error-box">{snap.error}</pre> : s.connecting}</div>;

  const state = snap.state;
  let view;
  if (state.toolchain.state === "unknown")
    view = (
      <div className="center">
        <span className="spinner lg" />
        <p className="muted">{s.findingTypst}</p>
      </div>
    );
  else if (state.toolchain.state !== "ready") view = <TypstSetup state={state} s={s} />;
  else if (readyMoment.showReady) view = <TypstReady state={state} s={s} onContinue={readyMoment.dismiss} />;
  else if (!state.main) view = <ChooseMain state={state} s={s} notify={notify} />;
  else view = <Preview state={state} s={s} notify={notify} />;
  return (
    <div className="app">
      {view}
      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismiss} />}
    </div>
  );
}
