/**
 * Model pricing and context-window tables for zcode-context.
 *
 * All costs are estimates computed from public list prices (USD per million
 * tokens), converted to CNY for display. Models without an entry fall back to
 * DEFAULT_PRICE_USD and are flagged as estimates by the UI.
 */

export const USD_TO_CNY = 7.2;

export const MODEL_PRICES_USD_PER_M = {
  "deepseek-flash": { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
  "deepseek-v4-flash": { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
  "deepseek-v4.1-flash": { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
  "deepseek-v4-1-flash-261017": { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
  "deepseek-v4-flash-vision-exp": { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
  "deepseek-v4-pro": { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0 },
  "deepseek-reasoner": { input: 0.55, output: 1.66, cacheRead: 0.14, cacheWrite: 0 },
  "deepseek-chat": { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0 },
  "doubao-seed-2-0-code-preview-260215": { input: 0.475, output: 2.375, cacheRead: 0.095, cacheWrite: 0 },
  "doubao-seed-2-0-pro-260215": { input: 0.475, output: 2.375, cacheRead: 0.095, cacheWrite: 0 },
  "doubao-seed-2-0-lite-260428": { input: 0.089, output: 0.534, cacheRead: 0.018, cacheWrite: 0 },
  "doubao-seed-2-0-mini-260428": { input: 0.03, output: 0.297, cacheRead: 0.006, cacheWrite: 0 },
  "doubao-seed-2-1-pro-260628": { input: 0.891, output: 4.453, cacheRead: 0.178, cacheWrite: 0 },
  "doubao-seed-2-1-turbo-260628": { input: 0.445, output: 2.227, cacheRead: 0.089, cacheWrite: 0 },
  "glm-5.3": { input: 0.4, output: 1.6, cacheRead: 0.08, cacheWrite: 0.5 },
  "glm-5.3-flash": { input: 0.05, output: 0.2, cacheRead: 0.01, cacheWrite: 0.05 },
};

export const DEFAULT_PRICE_USD = { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 };

/** Context window sizes (input tokens). Longest-suffix match on model id. */
export const MODEL_WINDOWS = [
  { suffix: "deepseek-v4.1", window: 1048576 },
  { suffix: "deepseek-v4", window: 1048576 },
  { suffix: "glm-5.3", window: 204800 },
  { suffix: "glm-4", window: 131072 },
  { suffix: "doubao-seed", window: 262144 },
  { suffix: "claude", window: 204800 },
  { suffix: "gpt", window: 272000 },
  { suffix: "deepseek", window: 131072 },
];

export const DEFAULT_WINDOW = 131072;

export function priceOfModel(modelId) {
  const key = String(modelId || "").toLowerCase();
  return MODEL_PRICES_USD_PER_M[key] || null;
}

export function windowOfModel(modelId) {
  const key = String(modelId || "").toLowerCase();
  for (const entry of MODEL_WINDOWS) {
    if (key.includes(entry.suffix)) return entry.window;
  }
  return DEFAULT_WINDOW;
}

/**
 * Estimated cost (CNY) for one usage row. Cache-write tokens are billed on top
 * of bare input; the caller passes already-split numbers.
 */
export function costOfUsage({ modelId, input = 0, output = 0, cacheRead = 0, cacheWrite = 0 }) {
  const rates = priceOfModel(modelId) || DEFAULT_PRICE_USD;
  const bareInput = Math.max(0, Number(input) - Number(cacheRead) - Number(cacheWrite));
  const usd =
    (bareInput * rates.input +
      Number(cacheRead) * rates.cacheRead +
      Number(cacheWrite) * rates.cacheWrite +
      Number(output) * rates.output) /
    1_000_000;
  return usd * USD_TO_CNY;
}

export function isKnownModel(modelId) {
  return Boolean(priceOfModel(modelId));
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
