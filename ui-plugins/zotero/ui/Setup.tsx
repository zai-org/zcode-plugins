import { useEffect, useState } from "react";
import { MIN_ZOTERO, type SessionState } from "#z/contract.ts";
import { host } from "#ui/bridge.ts";
import { DOWNLOAD_URL, MANUAL_COMMANDS, type Strings } from "#ui/i18n.ts";
import { Icon } from "#ui/icons.tsx";
import { Command, Disclosure, Handoff, Intro, OsTabs, Requirements, SentStrip, SetupShell, Tag, factsFoot, type Requirement } from "#ui/setup-kit.tsx";
import { setupAction } from "#ui/store.ts";

type Os = keyof typeof MANUAL_COMMANDS;
const libraryIcon = <Icon name="library" size={20} />;

/** Zotero 未就绪时处在哪一步。 */
export type SetupStage = "checking" | "missing" | "too_old" | "closed" | "api_off" | "error";

export function setupStage(state: SessionState): SetupStage {
  const { status, setup } = state;
  const app = setup.app;
  const old = app?.state === "found" && !!app.version && Number.parseInt(app.version, 10) < MIN_ZOTERO;
  // Zotero 6 及更早在运行时没有本地 API（/api/ 返回 404）。
  if (status.state === "api_disabled") return old || /version/i.test(status.error ?? "") ? "too_old" : "api_off";
  if (status.state === "error") return "error";
  if (!app) return "checking";
  if (app.state === "missing") return "missing";
  return old ? "too_old" : "closed";
}

/** 打开已安装的 Zotero。工具调用（会运行程序），宿主可能先请用户批准。 */
export function useLaunch(state: SessionState) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = state.status.state !== "not_running";
  useEffect(() => {
    if (running) setOpening(false);
  }, [running]);
  useEffect(() => {
    if (!opening) return;
    // Zotero 迟迟没有应答时恢复按钮，用户可以再试。
    const timer = setTimeout(() => setOpening(false), 45_000);
    return () => clearTimeout(timer);
  }, [opening]);
  const launch = () => {
    setOpening(true);
    setError(null);
    void host.call("panel_launch_zotero").catch((caught) => {
      setOpening(false);
      setError(caught instanceof Error ? caught.message : String(caught));
    });
  };
  return { opening, error, launch };
}

function Manual({ s, os }: { s: Strings; os: Os }) {
  const [tab, setTab] = useState<Os>(os);
  const [before, after] = s.manualHint;
  return (
    <Disclosure label={s.installYourself}>
      <OsTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "macos", label: "macOS" },
          { value: "windows", label: "Windows" },
          { value: "linux", label: "Linux" },
        ]}
      />
      <Command k={s.kit} command={MANUAL_COMMANDS[tab]} />
      <p className="hint">
        {before}
        <a
          href={DOWNLOAD_URL}
          onClick={(event) => {
            event.preventDefault();
            void host.openLink(DOWNLOAD_URL);
          }}
        >
          zotero.org/download
        </a>
        {after}
      </p>
    </Disclosure>
  );
}

/** 本地 API 未开启：在 Zotero 自己的设置里勾选一项，只有用户能做。 */
function ApiSteps({ s, mac }: { s: Strings; mac: boolean }) {
  const [before, pane, after] = s.stepPane;
  return (
    <div className="section">
      <div className="label">{s.inZotero}</div>
      <div className="card">
        <ol className="steps">
          <li>
            <span className="n">1</span>
            <div className="body">
              {s.stepOpen}{" "}
              <span className="crumbs">
                <b>{mac ? s.menuApp : s.menuEdit}</b>
                <Icon name="chevronRight" size={12} />
                <b>{s.menuSettings}</b>
              </span>{" "}
              {mac && <span className="keys">(⌘ ,)</span>}
            </div>
          </li>
          <li>
            <span className="n">2</span>
            <div className="body">
              {before}
              <span className="crumbs">
                <b>{pane}</b>
              </span>
              {after}
            </div>
          </li>
          <li>
            <span className="n">3</span>
            <div className="body">
              {s.stepTick}
              <div className="pref">
                <span className="box" />
                <span>{s.prefLabel}</span>
              </div>
            </div>
          </li>
        </ol>
      </div>
    </div>
  );
}

/** Zotero 未就绪时的设置页：未安装 / 版本过旧（交给 Agent）、未打开（一键打开）、本地 API 未开启（应用内步骤）。 */
export function ZoteroSetup({ state, s }: { state: SessionState; s: Strings }) {
  const { status, setup } = state;
  const stage = setupStage(state);
  const app = setup.app;
  const { opening, error, launch } = useLaunch(state);
  const installing = stage === "missing" || stage === "too_old";
  const working = setup.handoffAt !== null && installing;
  const os: Os = setup.facts?.os === "windows" || setup.facts?.os === "linux" ? setup.facts.os : "macos";
  const handoff = () => setupAction("handoff");
  const message = s.setupMessage({ app, facts: setup.facts, tooOld: stage === "too_old", address: setup.address });

  const appRow: Requirement =
    stage === "missing" || !app
      ? { key: "app", glyph: app ? "todo" : "checking", title: s.reqApp, detail: app ? s.notIn(app.searched) : undefined, side: app ? <Tag tone="warn">{s.kit.missing}</Tag> : undefined }
      : stage === "too_old"
        ? { key: "app", glyph: "todo", title: s.reqApp, detail: app.version ? s.needsVersion(app.version) : app.path, side: <Tag tone="warn">{s.tooOld}</Tag> }
        : { key: "app", glyph: "ok", title: s.reqApp, detail: status.state === "not_running" ? app.path : undefined, mono: true, side: app.version ? <Tag tone="version">{app.version}</Tag> : undefined };
  const openRow: Requirement =
    stage === "closed"
      ? {
          key: "open",
          glyph: "todo",
          title: s.reqOpen,
          detail: s.nothingAnswers(setup.address),
          side: (
            <button type="button" className="btn primary sm" disabled={opening} onClick={launch}>
              {opening ? <span className="su-spin" style={{ display: "inline-flex" }}><Icon name="refresh" size={12} /></span> : <Icon name="power" size={12} />}
              {opening ? s.opening : s.openZotero}
            </button>
          ),
        }
      : stage === "api_off"
        ? { key: "open", glyph: "ok", title: s.reqOpen }
        : stage === "error"
          ? { key: "open", glyph: "fail", title: s.reqOpen, side: <Tag tone="bad">{s.failed}</Tag> }
          : { key: "open", glyph: "wait", title: s.reqOpen };
  const apiRow: Requirement =
    stage === "api_off"
      ? { key: "api", glyph: "todo", title: s.reqApi, detail: s.refused, side: <Tag tone="warn">{s.off}</Tag> }
      : { key: "api", glyph: "wait", title: s.reqApi, detail: stage === "closed" ? s.checkedOnceOpen : undefined };

  const title = working
    ? s.workingTitle
    : stage === "too_old"
      ? s.updateTitle
      : stage === "closed"
        ? s.openTitle
        : stage === "api_off"
          ? s.apiDisabledTitle
          : stage === "error"
            ? s.errorTitle
            : s.setupTitle;
  const lead = working
    ? s.workingLead
    : stage === "too_old"
      ? s.updateLead(app?.version ?? "")
      : stage === "closed"
        ? s.openLead
        : stage === "api_off"
          ? s.apiLead
          : stage === "error"
            ? s.errorLead
            : s.setupLead;
  const live = working || stage === "closed" || stage === "api_off" ? "watching" : null;

  return (
    <SetupShell icon={<Icon name="library" />} title={s.title}>
      <Intro icon={libraryIcon} title={title} lead={lead} />
      <Requirements
        k={s.kit}
        rows={[appRow, openRow, apiRow]}
        foot={stage === "api_off" || stage === "error" ? null : factsFoot(setup.facts)}
        live={live}
        agentWorking={working}
        onCheck={() => setupAction("check")}
      />
      {stage === "error" && status.error && <pre className="error-box">{status.error}</pre>}
      {error && <pre className="error-box">{error}</pre>}
      {installing &&
        (working ? (
          <SentStrip k={s.kit} message={message} onHandoff={handoff} />
        ) : (
          <Handoff k={s.kit} title={stage === "too_old" ? s.handoffUpdate : s.handoffInstall} message={message} onHandoff={handoff} />
        ))}
      {stage === "missing" && <Manual s={s} os={os} />}
      {stage === "closed" && <p className="hint">{s.slowStart}</p>}
      {stage === "api_off" && (
        <>
          <ApiSteps s={s} mac={setup.facts ? setup.facts.os === "macos" : /Mac/.test(navigator.platform)} />
          <p className="hint">{s.apiHint}</p>
        </>
      )}
    </SetupShell>
  );
}
