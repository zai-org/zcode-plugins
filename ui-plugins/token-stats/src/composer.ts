import type { ExtensionContext, SlotItemPatch } from "./host.js";
import type { CardMetrics } from "./metrics.js";

// 对齐 ZCode 插槽契约的字符串上限，保留每一行数值。
const TOOLTIP_LIMIT = 200;

export interface SpeedSample {
  requestId: string;
  outputTokensPerSecond: number;
}

export function createComposerStatus(
  slots: ExtensionContext["slots"],
  restore: (sessionId: string) => void,
) {
  const sessions = new Map<string, { measured?: CardMetrics; estimate?: SpeedSample }>();
  function formatters(locale: string) {
    return {
      isChinese: locale.toLowerCase().startsWith("zh"),
      rate: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
      count: new Intl.NumberFormat(locale),
      seconds: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
      compact: new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }),
    };
  }
  let numbers = formatters("en-US");

  function publish(sessionId?: string): void {
    const state = sessionId ? sessions.get(sessionId) : undefined;
    const estimate = state?.estimate;
    const measured = state?.measured;
    const speed = estimate?.outputTokensPerSecond ?? measured?.latest?.outputTokensPerSecond;
    const total = measured?.observedOutputTokens;
    const latest = measured?.latest;
    const input = measured?.contextInput?.inputTokens;
    const { isChinese, rate, count, compact, seconds } = numbers;

    function value(
      number: number | null | undefined,
      format: Intl.NumberFormat,
      unit: string,
    ): string {
      if (number == null) return "—";
      const formatted = format.format(number);
      const short = formatted.length <= 12 ? formatted : compact.format(number);
      return `${short.length <= 12 ? short : number.toExponential(1)} ${unit}`;
    }

    const title = isChinese ? "Token 统计" : "Token statistics";
    let tooltip = `${title}\n${isChinese ? "暂无实测数据" : "No measured data"}`;
    if (speed !== undefined || total != null || input !== undefined) {
      const speedLabel = isChinese
        ? estimate
          ? "估算速度"
          : "实测速度"
        : estimate
          ? "Estimated speed"
          : "Measured speed";
      const requests = measured?.observedRequests ?? 0;
      const totalLabel = isChinese ? "输出合计" : "Total output";
      const totalCount =
        total == null ? "" : isChinese ? `（${requests} 次）` : ` (${requests} req)`;
      const firstMs = latest?.timeToFirstTokenMs;
      const lines = [
        `${speedLabel} ${value(speed, rate, "tok/s")}`,
        `${isChinese ? "最近输出" : "Latest output"} ${value(latest?.outputTokens, count, "tok")}`,
        `${isChinese ? "首 Token 用时" : "First token"} ${value(firstMs === undefined ? undefined : firstMs / 1000, seconds, "s")}`,
        `${totalLabel} ${value(total, count, "tok")}${totalCount}`,
        `${isChinese ? "最近上下文输入" : "Context input"} ${value(input, count, "tok")}`,
      ];
      const model = latest?.modelId?.replace(/\s+/g, " ").trim();
      if (model) {
        const prefix = isChinese ? "实测模型 " : "Measured model ";
        const max = TOOLTIP_LIMIT - [title, ...lines].join("\n").length - prefix.length - 1;
        if (max > 1) {
          const name =
            model.length <= max
              ? model
              : `${model.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/u, "")}…`;
          lines.unshift(prefix + name);
        }
      }
      tooltip = [title, ...lines].join("\n");
    }

    const speedText = speed === undefined ? "— tok/s" : value(speed, rate, "tok/s");
    const totalText = total == null ? "— tok" : value(total, compact, "tok");
    const patch: SlotItemPatch = {
      text: `${speedText} · ${totalText}`,
      tooltip,
    };
    slots.update("usage", patch, sessionId ? { sessionId } : undefined);
  }

  publish();
  return {
    setLocale(next: string): void {
      numbers = formatters(next);
      publish();
      for (const id of sessions.keys()) publish(id);
    },
    showSessions(ids: readonly string[]): void {
      const visible = new Set(ids);
      for (const id of sessions.keys()) {
        if (visible.has(id)) continue;
        sessions.delete(id);
        slots.update("usage", { text: null, tooltip: null }, { sessionId: id });
      }
      for (const id of visible) {
        if (sessions.has(id)) continue;
        sessions.set(id, {});
        restore(id);
      }
    },
    showEstimate(sessionId: string, sample: SpeedSample): void {
      const state = sessions.get(sessionId);
      if (!state) return;
      state.estimate = sample;
      publish(sessionId);
    },
    showMeasured(sessionId: string, measured: CardMetrics, finalizedRequest?: string): void {
      const state = sessions.get(sessionId);
      if (!state) return;
      state.measured = measured;
      // 较早请求的落盘可能晚于下一次流式事件，只清当前已确认的估算。
      if (state.estimate?.requestId === finalizedRequest) state.estimate = undefined;
      publish(sessionId);
    },
  };
}
