import { Fragment, useRef, useState, type ReactNode, type Ref } from "react";
import { host } from "#ui/bridge.ts";
import { Icon } from "#ui/icons.tsx";

/**
 * 设置页组件（Typst、Zotero、Jupyter 三个插件共用同一份）：缺少本机程序时，
 * 列出检测到的要求、把安装交给 Agent（消息先给用户看）、显示“已交给 Agent”，以及手动安装。
 * 样式见 setup-kit.css。
 */

// ---------------------------------------------------------------------------
// 文案
// ---------------------------------------------------------------------------

export const KIT_EN = {
  requirements: "Requirements",
  checkAgain: "Check again",
  checking: "Checking…",
  watching: "Watching",
  allSet: "All set",
  missing: "Missing",
  waitingFound: "Checked once the step above is done",
  lookingAgain: "Looking every few seconds…",
  handoffSub: "Sends this as your message in the chat. Everything the agent runs shows up there.",
  sendToAgent: "Send to agent",
  sending: "Sending…",
  copy: "Copy",
  copied: "Copied",
  copyMessage: "Copy message",
  pasteAnywhere: "Paste it to any coding agent.",
  selectToCopy: "Select the text and copy it.",
  showAll: "Show all",
  showLess: "Show less",
  sentTitle: "Sent to the agent",
  sentBody: "Approve its commands in the chat when it asks.",
  showMessage: "Show message",
  hideMessage: "Hide message",
  sendAgain: "Send again",
  sendFailed: "The message was not sent.",
};

export type KitStrings = typeof KIT_EN;

export const KIT_ZH: KitStrings = {
  requirements: "要求",
  checkAgain: "重新检查",
  checking: "正在检查…",
  watching: "正在监测",
  allSet: "全部就绪",
  missing: "缺少",
  waitingFound: "上一步完成后检查",
  lookingAgain: "每隔几秒查找一次…",
  handoffSub: "以你的名义发到对话中。Agent 运行的每条命令都会显示在那里。",
  sendToAgent: "发给 Agent",
  sending: "正在发送…",
  copy: "复制",
  copied: "已复制",
  copyMessage: "复制消息",
  pasteAnywhere: "可粘贴给任意编程 Agent。",
  selectToCopy: "请选中文字后复制。",
  showAll: "展开全部",
  showLess: "收起",
  sentTitle: "已交给 Agent",
  sentBody: "Agent 请求运行命令时，在对话中批准即可。",
  showMessage: "查看消息",
  hideMessage: "隐藏消息",
  sendAgain: "再次发送",
  sendFailed: "消息没有发出。",
};

// ---------------------------------------------------------------------------
// 交给 Agent 的消息：开头、本机事实（灰色）、步骤、结尾。纯文本与预览由同一结构生成。
// ---------------------------------------------------------------------------

export interface AgentMessage {
  lead: string;
  facts: { title: string; items: string[] };
  steps: { title: string; items: string[] };
  outro: string;
}

export function messageText(message: AgentMessage): string {
  return [
    message.lead,
    "",
    message.facts.title,
    ...message.facts.items.map((item) => `• ${item}`),
    "",
    message.steps.title,
    ...message.steps.items.map((item, index) => `${index + 1}. ${item}`),
    "",
    message.outro,
  ].join("\n");
}

/** `code` 显示为等宽。 */
function Inline({ text }: { text: string }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, index) => (index % 2 ? <code key={index}>{part}</code> : <Fragment key={index}>{part}</Fragment>))}
    </>
  );
}

function MessageView({ message, full, refEl }: { message: AgentMessage; full: boolean; refEl?: Ref<HTMLDivElement> }) {
  return (
    <div className={`msg${full ? " full" : ""}`} ref={refEl}>
      <p>
        <Inline text={message.lead} />
      </p>
      <div className="facts">
        <p>{message.facts.title}</p>
        <ul>
          {message.facts.items.map((item, index) => (
            <li key={index}>
              • <Inline text={item} />
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p>{message.steps.title}</p>
        <ol>
          {message.steps.items.map((item, index) => (
            <li key={index}>
              {index + 1}. <Inline text={item} />
            </li>
          ))}
        </ol>
      </div>
      <p>
        <Inline text={message.outro} />
      </p>
    </div>
  );
}

/** 复制到剪贴板；沙箱不允许时选中元素中的文字，由用户自己复制。 */
export async function copyText(text: string, element?: HTMLElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (element) {
      const range = document.createRange();
      range.selectNodeContents(element);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    }
    return false;
  }
}

function CopyButton({ k, text, target, size = "lg", primary = false }: { k: KitStrings; text: string; target: () => HTMLElement | null; size?: "lg" | "sm"; primary?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "selected">("idle");
  return (
    <button
      type="button"
      className={`btn ${primary ? "primary" : "outline"} ${size}`}
      title={state === "selected" ? k.selectToCopy : undefined}
      onClick={async () => {
        const copied = await copyText(text, target());
        setState(copied ? "copied" : "selected");
        setTimeout(() => setState("idle"), 1_500);
      }}
    >
      <Icon name={state === "copied" ? "check" : "copy"} size={size === "lg" ? 14 : 13} />
      {state === "copied" ? k.copied : primary ? k.copyMessage : k.copy}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 要求清单
// ---------------------------------------------------------------------------

export type Glyph = "ok" | "todo" | "wait" | "checking" | "fail";

export function StatusGlyph({ glyph }: { glyph: Glyph }) {
  const common = { className: `glyph${glyph === "checking" ? " spin" : ""}`, width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": true } as const;
  switch (glyph) {
    case "ok":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="7" fill="var(--su-success)" />
          <path d="M4.9 8.2l2.1 2.1 4.1-4.5" fill="none" stroke="var(--su-bg)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "todo":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="var(--su-warning)" strokeWidth="1.5" />
          <circle cx="8" cy="8" r="2" fill="var(--su-warning)" />
        </svg>
      );
    case "wait":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="var(--su-fg3)" strokeWidth="1.5" strokeDasharray="2.2 2.6" />
        </svg>
      );
    case "checking":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="var(--su-border-strong)" strokeWidth="1.5" />
          <path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" fill="none" stroke="var(--su-agent)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "fail":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="7" fill="var(--su-danger)" />
          <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="var(--su-bg)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
  }
}

export interface Requirement {
  key: string;
  glyph: Glyph;
  title: string;
  detail?: string;
  mono?: boolean;
  /** 右侧：状态词（tag）或一个直接操作。颜色不是唯一信号：未满足的行都有一个词。 */
  side?: ReactNode;
}

export const Tag = ({ tone, children }: { tone?: "warn" | "bad" | "version"; children: ReactNode }) => (
  <span className={`tag${tone ? ` ${tone}` : ""}`}>{children}</span>
);

/**
 * live：watching 显示“正在监测”（页面会自己发现变化）；done 表示全部满足；否则显示“重新检查”。
 * agentWorking：已交给 Agent，第一个未满足的要求显示为“正在检查”。
 */
export function Requirements({
  k,
  rows,
  foot,
  live,
  agentWorking = false,
  onCheck,
}: {
  k: KitStrings;
  rows: Requirement[];
  foot?: string[] | null;
  live?: "watching" | "done" | null;
  agentWorking?: boolean;
  onCheck?: () => Promise<unknown>;
}) {
  const [checking, setChecking] = useState(false);
  const firstOpen = agentWorking ? rows.findIndex((row) => row.glyph === "todo") : -1;
  return (
    <div className="section req">
      <div className="label">
        {k.requirements}
        {live === "watching" ? (
          <span className="live">
            <Icon name="refresh" size={12} />
            {k.watching}
          </span>
        ) : live === "done" ? (
          <span className="live">{k.allSet}</span>
        ) : onCheck ? (
          <button
            type="button"
            className="check-again"
            disabled={checking}
            onClick={() => {
              setChecking(true);
              void onCheck().finally(() => setChecking(false));
            }}
          >
            <Icon name="refresh" size={12} className={checking ? "su-spin" : undefined} />
            {checking ? k.checking : k.checkAgain}
          </button>
        ) : null}
      </div>
      <div className="card">
        {rows.map((row, index) => {
          const glyph = index === firstOpen ? "checking" : row.glyph;
          return (
            <div key={row.key} className={`row${row.glyph === "wait" ? " dim" : ""}`}>
              <StatusGlyph glyph={glyph} />
              <div className="grow">
                <div className="t">{row.title}</div>
                {(index === firstOpen ? k.lookingAgain : row.detail) && (
                  <div className={`d${row.mono && index !== firstOpen ? " mono" : ""}`} title={row.detail}>
                    {index === firstOpen ? k.lookingAgain : row.detail}
                  </div>
                )}
              </div>
              {index === firstOpen ? null : row.side}
            </div>
          );
        })}
        {foot && foot.length > 0 && (
          <div className="card-foot">
            {foot.map((part, index) => (
              <Fragment key={index}>
                {index > 0 && <span className="sep">·</span>}
                <span>{part}</span>
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 交给 Agent
// ---------------------------------------------------------------------------

/** 发送：先发消息，再告诉 server 已交给 Agent（设置页随之显示“正在设置”）。 */
export function useSend(message: AgentMessage, onHandoff: () => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const send = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await host.sendMessage(messageText(message));
      await onHandoff().catch(() => undefined);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return { busy, failed, send };
}

export function Handoff({ k, title, message, onHandoff }: { k: KitStrings; title: string; message: AgentMessage; onHandoff: () => Promise<unknown> }) {
  const [full, setFull] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { busy, failed, send } = useSend(message, onHandoff);
  const text = messageText(message);
  const canMessage = host.canMessage;
  return (
    <div className="card handoff">
      <div className="head">
        <div className="su-tile">
          <Icon name="sparkles" size={14} />
        </div>
        <div className="grow">
          <div className="t">{title}</div>
          <div className="d">{k.handoffSub}</div>
        </div>
      </div>
      <MessageView message={message} full={full} refEl={ref} />
      <div className="foot">
        {canMessage ? (
          <>
            <button type="button" className="btn primary lg" disabled={busy} onClick={() => void send()}>
              <Icon name="sparkles" size={14} />
              {busy ? k.sending : k.sendToAgent}
            </button>
            <CopyButton k={k} text={text} target={() => ref.current} />
          </>
        ) : (
          <>
            <CopyButton k={k} text={text} target={() => ref.current} primary />
            <span className="hint">{k.pasteAnywhere}</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn link" onClick={() => setFull(!full)}>
          {full ? k.showLess : k.showAll}
        </button>
        {failed && <p className="error">{k.sendFailed}</p>}
      </div>
    </div>
  );
}

/** 已交给 Agent：发送卡片收成一条，消息可以再看、再复制、再发送。 */
export function SentStrip({ k, message, onHandoff }: { k: KitStrings; message: AgentMessage; onHandoff: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { busy, failed, send } = useSend(message, onHandoff);
  return (
    <>
      <div className="sent">
        <div className="su-tile">
          <Icon name="sparkles" size={14} />
        </div>
        <div className="grow">
          <div className="t">{k.sentTitle}</div>
          <div className="d">{k.sentBody}</div>
        </div>
        <button type="button" className="btn ghost sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? k.hideMessage : k.showMessage}
        </button>
      </div>
      {open && (
        <div className="sent-message">
          <MessageView message={message} full refEl={ref} />
          <div className="actions">
            <CopyButton k={k} text={messageText(message)} target={() => ref.current} size="sm" />
            {host.canMessage && (
              <button type="button" className="btn outline sm" disabled={busy} onClick={() => void send()}>
                <Icon name="sparkles" size={13} />
                {busy ? k.sending : k.sendAgain}
              </button>
            )}
          </div>
          {failed && <p className="error">{k.sendFailed}</p>}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 手动安装
// ---------------------------------------------------------------------------

export function Disclosure({ label, children, defaultOpen = false }: { label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <button type="button" className={`label${open ? " open" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="chevronDown" size={12} />
        {label}
      </button>
      {open && children}
    </div>
  );
}

export function OsTabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="seg" role="group">
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Command({ k, command }: { k: KitStrings; command: string }) {
  const ref = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="cmd">
      <code ref={ref}>{command}</code>
      <button
        type="button"
        className="btn ghost sm icon-only"
        aria-label={k.copy}
        title={copied ? k.copied : k.copy}
        onClick={async () => {
          if (await copyText(command, ref.current)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1_500);
          }
        }}
      >
        <Icon name={copied ? "check" : "copy"} size={14} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 本机事实
// ---------------------------------------------------------------------------

export interface FactsLike {
  osName: string;
  arch: string;
  tools: { name: string; version?: string }[];
}

export const toolLabel = (tool: { name: string; version?: string }) => (tool.version ? `${tool.name} ${tool.version}` : tool.name);

/** 页脚：“macOS 15.4 · Apple silicon · Homebrew 4.5.2”。 */
export const factsFoot = (facts: FactsLike | null | undefined) => (facts ? [facts.osName, facts.arch, ...facts.tools.map(toolLabel)] : null);

/** 整页骨架：标题栏 + 可滚动的设置内容。 */
export function SetupShell({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="setup-shell">
      <div className="setup-hdr">
        {icon}
        <span className="name">{title}</span>
      </div>
      <div className="setup-scroll">
        <div className="setup">{children}</div>
      </div>
    </div>
  );
}

export function Intro({ icon, title, lead, ready = false }: { icon: ReactNode; title: string; lead: ReactNode; ready?: boolean }) {
  return (
    <div className="intro">
      <div className="tile lg">
        {icon}
        {ready && (
          <span className="badge">
            <StatusGlyph glyph="ok" />
          </span>
        )}
      </div>
      <h1>{title}</h1>
      <p className="lead">{lead}</p>
    </div>
  );
}
