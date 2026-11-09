import { LIMITS, formatLocation, type Diagnostic } from "#t/contract.ts";

/** 一条诊断的文字形式（工具结果与面板发到对话的消息共用）。 */
export function diagnosticText(diagnostic: Diagnostic): string {
  const lines = [`${diagnostic.severity}: ${diagnostic.message}`, `  at ${formatLocation(diagnostic.location)}`];
  if (diagnostic.excerpt !== undefined) lines.push(`  | ${diagnostic.excerpt.trim()}`);
  for (const hint of diagnostic.hints) lines.push(`  hint: ${hint}`);
  for (const point of diagnostic.trace) lines.push(`  from ${formatLocation(point.location)}: ${point.message}`);
  return lines.join("\n");
}

export function diagnosticsText(diagnostics: Diagnostic[], limit: number = LIMITS.diagnostics): string {
  const shown = diagnostics.slice(0, limit);
  const more = diagnostics.length - shown.length;
  return shown.map(diagnosticText).join("\n\n") + (more > 0 ? `\n\n… and ${more} more.` : "");
}
