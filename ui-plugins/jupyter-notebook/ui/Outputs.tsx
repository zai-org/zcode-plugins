import { memo, useMemo, useState } from "react";
import type { ErrorOutput, MimeBundle, Output } from "#nb/contract.ts";
import type { Strings } from "#ui/i18n.ts";
import { Icon } from "#ui/icons.tsx";
import {
  ansiToHtml,
  hasVisibleHtml,
  pickMime,
  renderLatexOutput,
  renderMarkdown,
  sanitizeHtml,
  svgDataUrl,
} from "#ui/render.ts";
import { shortTraceback } from "#ui/text.ts";

const str = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value, null, 2));

function imageSize(metadata: Record<string, unknown>, mime: string) {
  const meta = (metadata[mime] ?? metadata) as { width?: number; height?: number };
  return {
    width: typeof meta.width === "number" ? meta.width : undefined,
    height: typeof meta.height === "number" ? meta.height : undefined,
  };
}

const MimeView = memo(function MimeView({
  data,
  metadata,
  s,
}: {
  data: MimeBundle;
  metadata: Record<string, unknown>;
  s: Strings;
}) {
  const mime = pickMime(data);
  const html = useMemo(() => {
    if (!mime) return null;
    const value = data[mime];
    switch (mime) {
      case "text/html":
        return sanitizeHtml(str(value));
      case "text/markdown":
        return renderMarkdown(str(value));
      case "text/latex":
        return renderLatexOutput(str(value));
      case "text/plain":
        return ansiToHtml(str(value));
      default:
        return null;
    }
  }, [data, mime]);
  if (!mime) return null;
  const value = data[mime];
  if (mime === "application/vnd.jupyter.widget-view+json") {
    return (
      <div className="mime">
        <div className="note">{s.widgetUnsupported}</div>
        {data["text/plain"] !== undefined && (
          <pre className="mime plain" dangerouslySetInnerHTML={{ __html: ansiToHtml(str(data["text/plain"])) }} />
        )}
      </div>
    );
  }
  if (mime.startsWith("image/")) {
    // 图片放在白底上：matplotlib 等透明背景的图在深色主题下仍然可读。
    const src =
      mime === "image/svg+xml" ? svgDataUrl(str(value)) : `data:${mime};base64,${str(value).replace(/\s+/g, "")}`;
    return (
      <div className="mime image">
        <div className="plate">
          <img alt="" src={src} {...imageSize(metadata, mime)} />
        </div>
      </div>
    );
  }
  if (mime === "application/json") return <pre className="mime json">{str(value)}</pre>;
  if (mime === "text/plain") return <pre className="mime plain" dangerouslySetInnerHTML={{ __html: html ?? "" }} />;
  const needsScript = mime === "text/html" && /<script[\s>]/i.test(str(value)) && !hasVisibleHtml(str(value));
  return (
    <div className="mime">
      <div className={mime === "text/html" ? "html" : "md"} dangerouslySetInnerHTML={{ __html: html ?? "" }} />
      {needsScript && <div className="note">{s.scriptOutput}</div>}
    </div>
  );
});

function ErrorView({ output, s, onFix }: { output: ErrorOutput; s: Strings; onFix?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const { frame, total } = useMemo(() => shortTraceback(output), [output]);
  const frameLines = frame ? frame.split("\n").length : 0;
  const expandable = total > frameLines + 1;
  return (
    <div className="output error err">
      <div className="err-head">
        <b>{output.ename}</b>
        {output.evalue ? `: ${output.evalue}` : ""}
      </div>
      {expanded ? (
        <pre dangerouslySetInnerHTML={{ __html: ansiToHtml(output.traceback.join("\n")) }} />
      ) : (
        frame && <pre dangerouslySetInnerHTML={{ __html: ansiToHtml(frame) }} />
      )}
      {(expandable || onFix) && (
        <div className="err-foot">
          {expandable && (
            <button type="button" className={`more ${expanded ? "open" : ""}`} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              <Icon name="chevronRight" size={12} />
              {expanded ? s.shortTraceback : s.fullTraceback(total)}
            </button>
          )}
          <span className="spacer" />
          {onFix && (
            <button type="button" className="btn sm outline" onClick={onFix}>
              <Icon name="sparkles" size={13} />
              {s.fixWithAgent}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** tqdm 一类的进度条写在 stderr，但不是警告：不加警告底色。 */
const PROGRESS = /\d+%\|/;

const OutputView = memo(function OutputView({ output, s, onFix }: { output: Output; s: Strings; onFix?: () => void }) {
  switch (output.output_type) {
    case "stream":
      return (
        <pre
          className={`output stream ${output.name} ${output.name === "stderr" && PROGRESS.test(output.text) ? "progress" : ""}`}
          dangerouslySetInnerHTML={{ __html: ansiToHtml(output.text.replace(/\n$/, "")) }}
        />
      );
    case "error":
      return <ErrorView output={output} s={s} onFix={onFix} />;
    case "display_data":
    case "execute_result":
      return (
        <div className={`output ${output.output_type === "execute_result" ? "result" : "display"}`}>
          <MimeView data={output.data} metadata={output.metadata} s={s} />
        </div>
      );
  }
});

export function Outputs({
  outputs,
  s,
  onLink,
  onFix,
  running = false,
}: {
  outputs: Output[];
  s: Strings;
  onLink: (url: string) => void;
  /** 有错误输出且可以给 Agent 发消息时提供。 */
  onFix?: () => void;
  /** 运行中：末尾闪烁的光标表示还会有输出。 */
  running?: boolean;
}) {
  if (!outputs.length && !running) return null;
  return (
    <div
      className="outputs"
      onClick={(event) => {
        const anchor = (event.target as Element).closest("a[href]");
        if (!anchor) return;
        event.preventDefault();
        const href = anchor.getAttribute("href") ?? "";
        if (/^https?:\/\//i.test(href)) onLink(href);
      }}
    >
      {outputs.map((output, index) => (
        <OutputView key={index} output={output} s={s} onFix={output.output_type === "error" ? onFix : undefined} />
      ))}
      {running && (
        <div className="caret-line" aria-hidden="true">
          <span className="caret" />
        </div>
      )}
    </div>
  );
}
