export const PLUGIN_VERSION = "0.2.3";
export const TOOL_NAME = "show_token_stats";
export const VIEW_URI = "ui://token-stats/card.html";
export const REQUEST_LIMIT = 20;

export interface RequestMetrics {
  requestId: string;
  modelId: string;
  outputTokens: number;
  outputTokensPerSecond: number;
  timeToFirstTokenMs?: number;
}

export interface ContextInput {
  modelId: string;
  inputTokens: number;
  measuredAt: number;
  revision?: number;
}

export interface SessionMetrics {
  requests: RequestMetrics[];
  contextInput?: ContextInput;
}

export interface CardMetrics {
  latest: Omit<RequestMetrics, "requestId"> | null;
  contextInput: Omit<ContextInput, "measuredAt" | "revision"> | null;
  observedRequests: number;
  observedOutputTokens: number | null;
}

export function toCardMetrics(state: SessionMetrics): CardMetrics {
  const last = state.requests.at(-1);
  return {
    latest: last
      ? {
          modelId: last.modelId,
          outputTokens: last.outputTokens,
          outputTokensPerSecond: last.outputTokensPerSecond,
          timeToFirstTokenMs: last.timeToFirstTokenMs,
        }
      : null,
    contextInput: state.contextInput
      ? { modelId: state.contextInput.modelId, inputTokens: state.contextInput.inputTokens }
      : null,
    observedRequests: state.requests.length,
    observedOutputTokens: last
      ? state.requests.reduce((total, request) => total + request.outputTokens, 0)
      : null,
  };
}
