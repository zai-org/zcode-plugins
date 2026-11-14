/**
 * One-shot data collector used by the injected sidebar widget.
 * Prints a single JSON document to stdout and exits.
 */
import { getBalances } from "../server/data.mjs";

try {
  const data = await getBalances(process.argv.includes("--force"));
  process.stdout.write(JSON.stringify(data));
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      error: { code: "collect_failed", message: error?.message || String(error) },
    }),
  );
  process.exitCode = 1;
}
