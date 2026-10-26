import { useCallback, useState } from "react";
import type { SessionState } from "#z/contract.ts";
import { host } from "#ui/bridge.ts";
import { Toast, errorText, useHostContext } from "#ui/common.tsx";
import type { Strings } from "#ui/i18n.ts";
import { Icon } from "#ui/icons.tsx";
import { ItemView } from "#ui/ItemView.tsx";
import { ItemsView, LibraryView } from "#ui/Library.tsx";
import { Reader } from "#ui/Reader.tsx";
import { ZoteroSetup, setupStage, useLaunch } from "#ui/Setup.tsx";
import { back, useSnapshot } from "#ui/store.ts";

/** 对话中的卡片：连接状态、正在看的内容与“在侧栏打开”；Zotero 未就绪时给出下一步。 */
function InlineCard({ state, s }: { state: SessionState | null; s: Strings }) {
  const view = state?.view;
  const ready = state?.status.state === "ready";
  const pending = !state || state.status.state === "unknown";
  const stage = state && !ready && !pending ? setupStage(state) : null;
  const working = !!stage && (stage === "missing" || stage === "too_old") && state!.setup.handoffAt !== null;
  const sub = !state
    ? s.connecting
    : ready || pending
      ? view?.kind === "items"
        ? view.title
        : s.inlineReady(state.highlights.length)
      : working
        ? s.agentSettingUp
        : stage === "missing"
          ? s.notInstalledTitle
          : stage === "too_old"
            ? s.updateTitle
            : stage === "closed"
              ? s.closedTitle
              : stage === "api_off"
                ? s.apiDisabledTitle
                : stage === "error"
                  ? s.errorTitle
                  : s.notRunningTitle;
  return (
    <div className="inline-card">
      <div className="tile">
        <Icon name="library" />
      </div>
      <div className="grow">
        <div className="name">{s.title}</div>
        <div className="sub">
          <span className={`lamp ${ready ? "ok" : working ? "agent" : "bad"}`} />
          <span className="ellipsis">{sub}</span>
        </div>
      </div>
      {stage === "closed" && state ? (
        <OpenZotero state={state} s={s} />
      ) : stage && stage !== "checking" && !working ? (
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

/** 对话卡片上的“打开 Zotero”。 */
function OpenZotero({ state, s }: { state: SessionState; s: Strings }) {
  const { opening, launch } = useLaunch(state);
  return (
    <button type="button" className="btn primary sm" disabled={opening} onClick={launch}>
      <Icon name="power" size={13} />
      {opening ? s.opening : s.openZotero}
    </button>
  );
}

export function App() {
  const snap = useSnapshot();
  const { s, inline } = useHostContext();
  const [toast, setToast] = useState<{ message: string; tone?: "info" | "error" } | null>(null);
  const notify = useCallback((message: string, tone?: "info" | "error") => setToast({ message, tone }), []);
  const dismiss = useCallback(() => setToast(null), []);

  if (inline) return <InlineCard state={snap.state} s={s} />;
  if (!snap.connected || !snap.state)
    return <div className="center">{snap.error ? <pre className="error-box">{snap.error}</pre> : s.connecting}</div>;

  const state = snap.state;
  if (state.status.state !== "ready" && state.status.state !== "unknown") return <ZoteroSetup state={state} s={s} />;

  const route = snap.stack.at(-1)!;
  const onBack = () => back();
  let view;
  switch (route.kind) {
    case "library":
      view = <LibraryView key={`${route.library}`} route={route} state={state} s={s} notify={notify} />;
      break;
    case "items":
      view = <ItemsView key={`${route.title}:${route.keys.join()}`} route={route} s={s} notify={notify} onBack={onBack} />;
      break;
    case "item":
      view = <ItemView key={route.key} route={route} state={state} s={s} notify={notify} onBack={onBack} />;
      break;
    case "reader":
      view = <Reader key={`${route.library}/${route.attachmentKey}`} route={route} state={state} s={s} notify={notify} onBack={onBack} />;
      break;
  }
  return (
    <div className="app">
      {view}
      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismiss} />}
      {state.authorizing && route.kind !== "reader" && <div className="banner">{s.waitingApproval}</div>}
    </div>
  );
}

export { errorText };
