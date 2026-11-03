#!/usr/bin/env node
/**
 * Narrow bridge to the Apache-2.0 @huaqiu/part-search library bundled with
 * Huaqiu KiCad. The Python MCP server owns validation and chooses both paths;
 * this process accepts no module name, URL, command, or JavaScript from tools.
 */
import { pathToFileURL } from "node:url";

const modulePath = process.argv[2];

function answer(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function readInput() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text);
}

try {
  if (!modulePath) throw new Error("Huaqiu part-search module path is missing");
  const request = await readInput();
  const allowed = new Set(["search", "detail", "models", "supply"]);
  if (!request || !allowed.has(request.operation) || typeof request.arguments !== "object") {
    throw new Error("Invalid Huaqiu part-search bridge request");
  }

  const library = await import(pathToFileURL(modulePath).href);
  const service = library.createPartSearchService();
  const args = request.arguments;
  let result;
  if (request.operation === "search") {
    result = await service.searchParts(args);
  } else if (request.operation === "detail") {
    result = await service.getPart(
      { manufacturerId: args.manufacturerId, mpn: args.mpn },
      args.language,
    );
  } else if (request.operation === "models") {
    result = await service.getEdaModels(
      { manufacturerId: args.manufacturerId, mpn: args.mpn },
      args.language,
    );
  } else {
    result = await service.getSupplyChain(args.parts);
  }
  answer({ ok: true, result });
} catch (error) {
  answer({
    ok: false,
    error: {
      name: error?.name || "Error",
      code: error?.code || null,
      message: String(error?.message || error).slice(0, 1000),
      status: Number.isInteger(error?.status) ? error.status : null,
    },
  });
  process.exitCode = 1;
}
