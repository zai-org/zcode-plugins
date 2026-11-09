import { useState } from "react";
import { MIN_TYPST, type SessionState } from "#t/contract.ts";
import { host } from "#ui/bridge.ts";
import { MANUAL_COMMANDS, RELEASES_URL, type Strings } from "#ui/i18n.ts";
import { Icon } from "#ui/icons.tsx";
import { Command, Disclosure, Handoff, Intro, OsTabs, Requirements, SentStrip, SetupShell, Tag, factsFoot, type Requirement } from "#ui/setup-kit.tsx";
import { setupAction } from "#ui/store.ts";

type Os = keyof typeof MANUAL_COMMANDS;

const min = `${MIN_TYPST[0]}.${MIN_TYPST[1]}`;
const fileIcon = <Icon name="file" size={20} />;

function SettingHint({ s }: { s: Strings }) {
  const [before, name, after] = s.settingHint;
  return (
    <p className="hint">
      {before}
      <b>{name}</b>
      {after}
    </p>
  );
}

/** 手动安装：按本机系统选中的标签，一条命令与发行版链接。 */
function Manual({ s, os }: { s: Strings; os: Os }) {
  const [tab, setTab] = useState<Os>(os);
  const [before, after] = s.manualHint(tab);
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
          href={RELEASES_URL}
          onClick={(event) => {
            event.preventDefault();
            void host.openLink(RELEASES_URL);
          }}
        >
          github.com/typst/typst
        </a>
        {after}
      </p>
    </Disclosure>
  );
}

/** Typst 不可用（未安装、版本过旧、无法运行）时的设置页；交给 Agent 后显示“正在安装”。 */
export function TypstSetup({ state, s }: { state: SessionState; s: Strings }) {
  const { toolchain, setup } = state;
  const working = setup.handoffAt !== null;
  const rows: Requirement[] =
    toolchain.state === "missing"
      ? [
          { key: "cli", glyph: "todo", title: s.reqCli, detail: s.notFoundIn(setup.searched), side: <Tag tone="warn">{s.kit.missing}</Tag> },
          { key: "version", glyph: "wait", title: s.reqVersion(min), detail: s.checkedOnceFound },
        ]
      : toolchain.state === "too_old"
        ? [
            { key: "cli", glyph: "ok", title: s.reqCli, detail: toolchain.path, mono: true },
            { key: "version", glyph: "todo", title: s.reqVersion(min), detail: toolchain.version, side: <Tag tone="warn">{s.tooOld}</Tag> },
          ]
        : [
            { key: "cli", glyph: "fail", title: s.reqCli, detail: toolchain.path, mono: true, side: <Tag tone="bad">{s.failed}</Tag> },
            { key: "version", glyph: "wait", title: s.reqVersion(min), detail: s.checkedOnceFound },
          ];
  const title = working ? s.workingTitle : toolchain.state === "too_old" ? s.updateTitle : toolchain.state === "error" ? s.errorTitle : s.setupTitle;
  const lead = working
    ? s.workingLead
    : toolchain.state === "too_old"
      ? s.updateLead(min, toolchain.version ?? "")
      : toolchain.state === "error"
        ? s.errorLead
        : s.setupLead;
  const message = s.setupMessage({ toolchain, facts: setup.facts, searched: setup.searched, min });
  const handoff = () => setupAction("handoff");
  const os: Os = setup.facts?.os === "windows" || setup.facts?.os === "linux" ? setup.facts.os : "macos";
  return (
    <SetupShell icon={<Icon name="file" />} title={s.title}>
      <Intro icon={fileIcon} title={title} lead={lead} />
      <Requirements k={s.kit} rows={rows} foot={factsFoot(setup.facts)} live={working ? "watching" : null} agentWorking={working} onCheck={() => setupAction("check")} />
      {toolchain.state === "error" && toolchain.error && <pre className="error-box">{toolchain.error}</pre>}
      {working ? (
        <SentStrip k={s.kit} message={message} onHandoff={handoff} />
      ) : (
        <Handoff
          k={s.kit}
          title={toolchain.state === "too_old" ? s.handoffUpdate : toolchain.state === "error" ? s.handoffFix : s.handoffInstall}
          message={message}
          onHandoff={handoff}
        />
      )}
      {toolchain.state !== "error" && <Manual s={s} os={os} />}
      <SettingHint s={s} />
    </SetupShell>
  );
}

/** 刚装好：所有要求满足，片刻后自动进入预览。 */
export function TypstReady({ state, s, onContinue }: { state: SessionState; s: Strings; onContinue: () => void }) {
  const { toolchain } = state;
  return (
    <SetupShell icon={<Icon name="file" />} title={s.title}>
      <Intro
        icon={fileIcon}
        title={s.readyTitle}
        lead={
          <>
            {s.readyLead(toolchain.version ?? "")}
            <code>{toolchain.path}</code>.
          </>
        }
        ready
      />
      <Requirements
        k={s.kit}
        rows={[
          { key: "cli", glyph: "ok", title: s.reqCli, detail: toolchain.path, mono: true },
          { key: "version", glyph: "ok", title: s.reqVersion(min), side: <Tag tone="version">{toolchain.version}</Tag> },
        ]}
        foot={factsFoot(state.setup.facts)}
        live="done"
      />
      <div className="continue">
        <button type="button" className="btn primary lg" onClick={onContinue}>
          {s.openPreview}
        </button>
        <span className="hint">{s.continuesSoon}</span>
      </div>
    </SetupShell>
  );
}
