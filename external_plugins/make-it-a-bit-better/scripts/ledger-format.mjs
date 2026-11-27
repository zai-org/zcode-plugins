export const MARKER = "<!-- mabb-ledger v2 -->";
export const BUDGET_BYTES = 12000;

export const CAPS = Object.freeze({
  angle: 80,
  files: 120,
  evidence: 80,
  archiveLine: 100,
  archiveNote: 80,
  backlogText: 120,
  backlogEntries: 8,
  iceboxText: 160,
  iceboxEntries: 12,
  nextRound: 200,
  minLenses: 3,
  maxLenses: 6,
  fullRowsKept: 10,
});

const SECTION_ORDER = ["Archive", "Backlog", "Dimensions touched", "Next round", "Icebox", "Lenses used"];
const REQUIRED_SECTIONS = ["Dimensions touched", "Next round", "Lenses used"];
const TABLE_HEAD = ["#", "date", "dimension", "angle", "commit", "files", "evidence"];
const HASH = /^[0-9a-f]{7,40}$/;
const LEGACY_HASH = /^v1 ([0-9a-f]{7,40})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ANGLE_TAG = /\[(lands|slices) ((?:IB-\d+)(?:, IB-\d+)*)\]$/;
const ANGLE_TAG_LOOSE = /\b(?:lands|slices) IB-\d+/;
const ARCHIVE_LINE = /^#(\d+) (\d{4}-\d{2}-\d{2}) ([^:]+?)(?:: (.*))?$/;
const ARCHIVE_RANGE = /^#(\d+)\.\.#(\d+) (\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2}): (.+)$/;
const BACKLOG_LINE = /^(B-\d+) \(([^)]+)\) (.+) — ([SML]) — since #(\d+)$/;
const ICEBOX_LINE = /^(IB-\d+) \(([^)]+)\) (.+) — ([SML])(?: — remainder after #(\d+))?$/;
const LENSES_LINE = /^#(\d+): (.+)$/;
const SEED_HINT = 'use one from "## Dimension seeds" (its parenthetical optional) or "other"';

export const normalizeName = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const bareName = (value) => value.replace(/\s*\([^()]*\)\s*$/, "").trim();

export function parseSkillVocab(skillText) {
  const seeds = listItems(skillText, "## Dimension seeds");
  const lenses = listItems(skillText, "## Lens pool");
  if (seeds.length < 8 || lenses.length < 6) {
    throw new Error(`SKILL.md vocabulary unreadable: ${seeds.length} dimension seeds, ${lenses.length} lenses`);
  }
  return { seeds, lenses };
}

function listItems(text, heading) {
  const start = text.indexOf(`\n${heading}\n`);
  if (start < 0) return [];
  const paragraph = text.slice(start + heading.length + 2).split(/\n\s*\n/)[0];
  return paragraph
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .split(" · ")
    .map((item) => bareName(item))
    .filter(Boolean);
}

export function validateLedger(text, vocab) {
  const bytes = Buffer.byteLength(text, "utf8");
  if (!text.trimStart().startsWith(MARKER)) {
    const nextRound = looseNextRound(text);
    const base = { nextRound, bytes, rows: [], archiveNs: [], backlog: [], icebox: [], maxN: nextRound - 1 };
    if (!text.includes(TABLE_HEAD.join(" | "))) return { legacy: true, unmarked: false, findings: [], ...base };
    return {
      legacy: false,
      unmarked: true,
      findings: [`the ledger is in the current format but its first line must be exactly \`${MARKER}\``],
      ...base,
    };
  }
  const findings = [];
  const fail = (message) => findings.push(message);
  const blocks = [];
  let block = { heading: null, lines: [] };
  for (const line of text.split(/\r?\n/).slice(1)) {
    const match = /^## (.+)$/.exec(line);
    if (match) {
      blocks.push(block);
      block = { heading: match[1].trim(), lines: [] };
    } else {
      block.lines.push(line);
    }
  }
  blocks.push(block);

  const sections = new Map();
  for (const item of blocks.slice(1)) {
    const key = sectionKey(item.heading);
    if (!key) {
      fail(`unknown section "## ${item.heading}" — only ${SECTION_ORDER.join(", ")}`);
      continue;
    }
    if (sections.has(key)) {
      fail(`section "## ${key}" appears twice`);
      continue;
    }
    sections.set(key, item);
  }
  for (const key of REQUIRED_SECTIONS) {
    if (!sections.has(key)) fail(`missing section "## ${key}"`);
  }
  const actualOrder = [
    ...new Set(blocks.slice(1).map((item) => sectionKey(item.heading)).filter(Boolean)),
  ];
  if (actualOrder.join("|") !== SECTION_ORDER.filter((key) => actualOrder.includes(key)).join("|")) {
    fail(`sections out of order — expected ${SECTION_ORDER.filter((key) => actualOrder.includes(key)).join(" → ")}`);
  }

  const vocabSet = new Set(vocab.seeds.map((seed) => normalizeName(bareName(seed))));
  const lensSet = new Set(vocab.lenses.map((lens) => normalizeName(bareName(lens))));
  const isDimension = (value) => {
    const key = normalizeName(bareName(value));
    return key === "other" || vocabSet.has(key);
  };

  const rows = parseTable(blocks[0].lines, isDimension, fail);
  const archive = parseArchive(sections.get("Archive"), isDimension, fail);
  const backlog = parseBacklog(sections.get("Backlog"), isDimension, fail);
  parseDimensions(sections.get("Dimensions touched"), isDimension, fail);
  parseNext(sections.get("Next round"), fail);
  const icebox = parseIcebox(sections.get("Icebox"), isDimension, fail);
  const lenses = parseLenses(sections.get("Lenses used"), lensSet, fail);

  const covered = new Map();
  const cover = (n) => covered.set(n, (covered.get(n) ?? 0) + 1);
  archive.forEach((item) => {
    for (let n = item.from; n <= item.to; n += 1) cover(n);
  });
  rows.forEach((row) => cover(row.n));
  const maxN = Math.max(0, ...covered.keys());
  const nextRound = maxN + 1;
  const roundExists = new Set(covered.keys());
  const archiveNs = archive.flatMap((item) => Array.from({ length: item.to - item.from + 1 }, (_, index) => item.from + index));

  for (let n = 1; n <= maxN; n += 1) {
    const count = covered.get(n) ?? 0;
    if (count !== 1) {
      fail(count === 0 ? `round numbers must run 1..N — #${n} has neither a row nor an Archive line` : `round #${n} is recorded more than once`);
      break;
    }
  }
  archive.forEach((item, index) => {
    if (index > 0 && item.from <= archive[index - 1].to) {
      fail(`Archive must climb by round number without overlap — #${item.from} follows one ending at #${archive[index - 1].to}`);
    }
    if (rows.length && item.to >= rows[0].n) {
      fail(`Archive reaches #${item.to} but full rows go back to #${rows[0].n} — archived rounds must be older than every full row`);
    }
  });
  if (archive.length && rows.length < Math.min(CAPS.fullRowsKept, maxN)) {
    fail(`Archive is in use but only ${rows.length} full rows remain — keep the latest ${CAPS.fullRowsKept}`);
  }
  rows.forEach((row, index) => {
    if (index > 0 && row.n <= rows[index - 1].n) fail(`table rows must ascend by round number — #${row.n} follows #${rows[index - 1].n}`);
  });

  backlog.forEach((entry, index) => {
    if (entry.number !== index + 1) {
      fail(`Backlog ids follow rank — B-1 is the top entry, then B-2, B-3, … (${entry.id} sits at position ${index + 1})`);
    }
    if (entry.since > maxN + 1) fail(`${entry.id}: "since #${entry.since}" is ahead of the round being brainstormed (#${maxN + 1})`);
  });
  idsAscending(icebox.map((entry) => entry.number), "Icebox", "IB-", fail);
  if (backlog.length > CAPS.backlogEntries) fail(`Backlog holds ${backlog.length} entries, at most ${CAPS.backlogEntries} — keep the top ${CAPS.backlogEntries}`);
  if (icebox.length > CAPS.iceboxEntries) fail(`Icebox holds ${icebox.length} entries, at most ${CAPS.iceboxEntries} — land a slice or drop the weakest`);

  const iceboxById = new Map(icebox.map((entry) => [entry.id, entry]));
  const lastSlice = new Map();
  const lastLand = new Map();
  rows.forEach((row) => {
    for (const id of row.slices) lastSlice.set(id, Math.max(lastSlice.get(id) ?? 0, row.n));
    for (const id of row.lands) lastLand.set(id, Math.max(lastLand.get(id) ?? 0, row.n));
  });
  rows.forEach((row) => {
    for (const id of row.lands) {
      if (iceboxById.has(id)) {
        fail(`row #${row.n} lands ${id} but ${id} is still in the Icebox — delete it (a slice that leaves work behind is "slices", not "lands")`);
      }
    }
    for (const id of row.slices) {
      if (!iceboxById.has(id) && !lastLand.has(id)) {
        fail(`row #${row.n} slices ${id} but the Icebox has no ${id} — rewrite the entry into what remains (only a later [lands ${id}] row deletes it)`);
      }
    }
  });
  icebox.forEach((entry) => {
    const slicedBy = lastSlice.get(entry.id);
    if (entry.remainderAfter === null) {
      if (slicedBy !== undefined) fail(`${entry.id}: a slice landed in #${slicedBy} but the entry is not marked "— remainder after #${slicedBy}"`);
      return;
    }
    const k = entry.remainderAfter;
    if (k !== slicedBy) {
      const why = !roundExists.has(k)
        ? `"remainder after #${k}" — there is no round #${k}`
        : slicedBy === undefined
          ? `marked "remainder after #${k}" but no row cites [slices ${entry.id}]`
          : `marked "remainder after #${k}" but the latest slice of it landed in row #${slicedBy}`;
      fail(`${entry.id}: ${why}`);
    }
  });

  if (lenses && (lenses.round < 1 || lenses.round > nextRound)) {
    fail(`Lenses used cites #${lenses.round} — it must name the round just brainstormed (1..${nextRound})`);
  }

  if (bytes > BUDGET_BYTES) {
    fail(
      `ledger is ${bytes} bytes, budget ${BUDGET_BYTES} — fold the oldest full rows into Archive lines (keep the latest ${CAPS.fullRowsKept}); still over, fold the oldest Archive lines into a range line (- #a..#b <first date>..<last date>: note)`,
    );
  }

  return { legacy: false, unmarked: false, findings, nextRound, bytes, rows, archiveNs, backlog, icebox, maxN };
}

function sectionKey(heading) {
  return SECTION_ORDER.find((key) => heading === key || heading.startsWith(`${key} (`)) ?? null;
}

function looseNextRound(text) {
  let max = 0;
  for (const match of text.matchAll(/^\|\s*(\d+)\s*\|/gm)) max = Math.max(max, Number(match[1]));
  return max + 1;
}

function splitCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function bullets(section, fail) {
  if (!section) return [];
  const items = [];
  for (const line of section.lines) {
    if (!line.trim()) continue;
    if (!line.startsWith("- ")) {
      fail(`section "## ${sectionKey(section.heading)}": every line must be a "- " bullet — "${line.trim().slice(0, 60)}"`);
      continue;
    }
    items.push(line.slice(2).trim());
  }
  return items;
}

function parseTable(lines, isDimension, fail) {
  const rows = [];
  const table = lines.filter((line) => line.trim().startsWith("|"));
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("|") || trimmed.startsWith("# ")) continue;
    fail(`unexpected line before the first section — "${trimmed.slice(0, 60)}"`);
  }
  if (!table.length) return rows;
  if (splitCells(table[0]).join("|") !== TABLE_HEAD.join("|")) {
    fail(`table header must be | ${TABLE_HEAD.join(" | ")} |`);
  }
  table.slice(1).forEach((line) => {
    if (/^\|\s*-{3,}/.test(line.trim())) return;
    const cells = splitCells(line);
    if (cells.length !== TABLE_HEAD.length) {
      fail(`table row needs ${TABLE_HEAD.length} cells, got ${cells.length} — "${line.trim().slice(0, 60)}"`);
      return;
    }
    const [number, date, dimension, angle, commit, files, evidence] = cells;
    const n = Number(number);
    if (!Number.isInteger(n) || n < 1 || String(n) !== number) fail(`table row "#${number}": the first cell is the round number`);
    if (!DATE.test(date)) fail(`row #${number}: date must be YYYY-MM-DD, got "${date}"`);
    if (!isDimension(dimension)) fail(`row #${number}: dimension "${dimension}" is not a seed name — ${SEED_HINT}`);
    const tag = ANGLE_TAG.exec(angle);
    const bare = (tag ? angle.slice(0, tag.index) : angle).trim();
    if (!bare) fail(`row #${number}: angle is empty`);
    if (angle.length > CAPS.angle) fail(`row #${number}: angle is ${angle.length} chars, at most ${CAPS.angle}`);
    if (!tag && ANGLE_TAG_LOOSE.test(angle)) fail(`row #${number}: [lands IB-n] / [slices IB-n] must be the last thing in the angle`);
    const legacy = LEGACY_HASH.exec(commit);
    const hash = legacy ? legacy[1] : commit;
    if (commit !== "lost" && commit !== "no-git" && !HASH.test(hash)) {
      fail(`row #${number}: commit must be a 7–40 char hash, "v1 <hash>", "lost" or "no-git", got "${commit}"`);
    }
    const overflow = / \+(\d+)$/.exec(files);
    const fileList = files.replace(/ \+\d+$/, "").split(", ").map((item) => item.trim()).filter(Boolean);
    if (!fileList.length) fail(`row #${number}: files is empty`);
    if (files.length > CAPS.files) fail(`row #${number}: files is ${files.length} chars, at most ${CAPS.files}`);
    if (!evidence) fail(`row #${number}: evidence is empty`);
    if (evidence.length > CAPS.evidence) fail(`row #${number}: evidence is ${evidence.length} chars, at most ${CAPS.evidence}`);
    rows.push({
      n: Number.isFinite(n) ? n : 0,
      date,
      dimension,
      angle,
      commit: hash,
      legacy: Boolean(legacy),
      files: fileList,
      evidence,
      lands: tag && tag[1] === "lands" ? tag[2].split(", ") : [],
      slices: tag && tag[1] === "slices" ? tag[2].split(", ") : [],
      failed: angle.startsWith("failed, reverted"),
      overflow: overflow ? Number(overflow[1]) : 0,
    });
  });
  return rows;
}

function parseArchive(section, isDimension, fail) {
  if (!section) return [];
  const items = bullets(section, fail);
  if (items.length === 1 && items[0] === "none") return [];
  return items
    .map((item) => {
      const range = ARCHIVE_RANGE.exec(item);
      if (range) {
        const [, from, to, first, last, note] = range;
        if (Number(to) < Number(from)) fail(`Archive range #${from}..#${to} runs backwards`);
        if (item.length > CAPS.archiveLine) fail(`Archive range #${from}..#${to} is ${item.length} chars, at most ${CAPS.archiveLine}`);
        if (note.length > CAPS.archiveNote) fail(`Archive range #${from}..#${to}: note is ${note.length} chars, at most ${CAPS.archiveNote}`);
        return { from: Number(from), to: Number(to), kind: "range", note };
      }
      const match = ARCHIVE_LINE.exec(item);
      if (!match) {
        fail(`Archive line must be "- #N YYYY-MM-DD dimension: keyword" or a range "- #a..#b <first date>..<last date>: note" — "${item.slice(0, 60)}"`);
        return null;
      }
      if (item.length > CAPS.archiveLine) fail(`Archive line for #${match[1]} is ${item.length} chars, at most ${CAPS.archiveLine}`);
      if (!isDimension(match[3])) fail(`Archive #${match[1]}: dimension "${match[3]}" is not a seed name — ${SEED_HINT}`);
      return { from: Number(match[1]), to: Number(match[1]), kind: "row", dimension: match[3] };
    })
    .filter(Boolean);
}

function parseBacklog(section, isDimension, fail) {
  if (!section) return [];
  const items = bullets(section, fail);
  if (items.length === 1 && items[0] === "none") return [];
  return items
    .map((item) => {
      const match = BACKLOG_LINE.exec(item);
      if (!match) {
        fail(`Backlog line must be "- B-n (dimension) idea — S|M|L — since #k" — "${item.slice(0, 60)}"`);
        return null;
      }
      const [, id, dimension, idea, cost, since] = match;
      if (!isDimension(dimension)) fail(`${id}: dimension "${dimension}" is not a seed name — ${SEED_HINT}`);
      if (idea.length > CAPS.backlogText) fail(`${id}: idea is ${idea.length} chars, at most ${CAPS.backlogText}`);
      return { id, number: Number(id.slice(2)), dimension, idea, cost, since: Number(since) };
    })
    .filter(Boolean);
}

function parseDimensions(section, isDimension, fail) {
  if (!section) return [];
  const items = bullets(section, fail);
  if (items.length !== 1) {
    fail(`section "## Dimensions touched": exactly one "- " bullet, got ${items.length} ("- none" when nothing landed yet)`);
    return [];
  }
  if (items[0] === "none") return [];
  const names = items[0].split(", ").map((name) => name.trim());
  const seen = new Set();
  for (const name of names) {
    if (!isDimension(name)) fail(`Dimensions touched: "${name}" is not a seed name — ${SEED_HINT}`);
    const key = normalizeName(bareName(name));
    if (seen.has(key)) fail(`Dimensions touched: "${name}" is listed twice`);
    seen.add(key);
  }
  return names;
}

function parseNext(section, fail) {
  if (!section) return "";
  const items = bullets(section, fail);
  if (items.length !== 1) fail(`section "## Next round": exactly one "- " bullet, got ${items.length}`);
  const hint = items[0] ?? "";
  if (hint && hint.length > CAPS.nextRound) fail(`Next round is ${hint.length} chars, at most ${CAPS.nextRound}`);
  if (items.length === 1 && !hint) fail("Next round: the hint is empty");
  return hint;
}

function parseIcebox(section, isDimension, fail) {
  if (!section) return [];
  const items = bullets(section, fail);
  if (items.length === 1 && items[0] === "none") return [];
  return items
    .map((item) => {
      let match = ICEBOX_LINE.exec(item);
      let note = null;
      const misplaced = match === null || /— remainder after #\d+/.test(match[3]);
      if (misplaced) {
        const loose = /\s*— remainder after #(\d+)(?=\s|$)/.exec(item);
        if (loose) {
          note = `Icebox: the "— remainder after #${loose[1]}" marker must be the last thing on the line — "${item.slice(0, 60)}"`;
          match = ICEBOX_LINE.exec(`${item.replace(loose[0], "")} — remainder after #${loose[1]}`) ?? match;
        }
      }
      if (!match) {
        fail(`Icebox line must be "- IB-n (dimension) idea — S|M|L" (a partial landing adds " — remainder after #k") — "${item.slice(0, 60)}"`);
        return null;
      }
      if (note) fail(note);
      const [, id, dimension, idea, cost, remainder] = match;
      if (!isDimension(dimension)) fail(`${id}: dimension "${dimension}" is not a seed name — ${SEED_HINT}`);
      if (idea.length > CAPS.iceboxText) fail(`${id}: idea is ${idea.length} chars, at most ${CAPS.iceboxText}`);
      return { id, number: Number(id.slice(3)), dimension, idea, cost, remainderAfter: remainder ? Number(remainder) : null };
    })
    .filter(Boolean);
}

function parseLenses(section, lensSet, fail) {
  if (!section) return null;
  const items = bullets(section, fail);
  if (!items.length) {
    fail('section "## Lenses used": one "- #n: lens, lens, lens" bullet');
    return null;
  }
  if (items.length > 1) fail(`Lenses used: exactly one bullet (the latest brainstorm's lenses), got ${items.length}`);
  const match = LENSES_LINE.exec(items[0]);
  if (!match) {
    fail(`Lenses used must be "- #n: lens, lens, lens" — "${items[0].slice(0, 60)}"`);
    return null;
  }
  const lenses = match[2].split(", ").map((lens) => lens.trim()).filter(Boolean);
  const keyOf = (lens) => normalizeName(bareName(lens));
  lenses.filter((lens) => !lensSet.has(keyOf(lens))).forEach((lens) => fail(`Lenses used: "${lens}" is not in the lens pool (a pool name, its parenthetical optional)`));
  const known = lenses.filter((lens) => lensSet.has(keyOf(lens))).map(keyOf);
  if (known.length < CAPS.minLenses) fail(`Lenses used: at least ${CAPS.minLenses} lenses from the pool`);
  if (known.length > CAPS.maxLenses) fail(`Lenses used: at most ${CAPS.maxLenses} lenses`);
  if (new Set(known).size !== known.length) fail("Lenses used: a lens is listed twice");
  return { round: Number(match[1]), lenses: known };
}

function idsAscending(numbers, label, prefix, fail) {
  let previous = 0;
  for (const value of numbers) {
    if (value <= previous) fail(`${label}: ${prefix}${value} is out of order or repeated — ids ascend down the list and are never reused`);
    previous = value;
  }
}
