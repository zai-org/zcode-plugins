export type Category = "permissive" | "weak-copyleft" | "strong-copyleft" | "public-domain" | "unknown" | "proprietary";

const ALIASES: Record<string, string> = {
  "mit": "MIT", "mit license": "MIT", "the mit license": "MIT", "expat": "MIT", "isc": "ISC", "isc license": "ISC",
  "apache 2.0": "Apache-2.0", "apache-2": "Apache-2.0", "apache2": "Apache-2.0", "apache 2": "Apache-2.0", "apache license 2.0": "Apache-2.0", "apache license, version 2.0": "Apache-2.0", "apache-2.0": "Apache-2.0",
  "bsd": "BSD-3-Clause", "bsd-3": "BSD-3-Clause", "bsd 3-clause": "BSD-3-Clause", "new bsd": "BSD-3-Clause", "bsd-2": "BSD-2-Clause", "bsd 2-clause": "BSD-2-Clause", "simplified bsd": "BSD-2-Clause",
  "gpl": "GPL-3.0", "gplv3": "GPL-3.0", "gpl-3": "GPL-3.0", "gplv2": "GPL-2.0", "gpl-2": "GPL-2.0", "lgpl": "LGPL-3.0", "lgplv3": "LGPL-3.0", "lgplv2.1": "LGPL-2.1", "agpl": "AGPL-3.0", "agplv3": "AGPL-3.0",
  "mpl": "MPL-2.0", "mpl 2.0": "MPL-2.0", "mpl-2": "MPL-2.0", "unlicense": "Unlicense", "public domain": "Unlicense", "cc0": "CC0-1.0", "wtfpl": "WTFPL", "zlib": "Zlib", "python-2.0": "Python-2.0", "blueoak-1.0.0": "BlueOak-1.0.0",
};
export function normalize(raw: string): string {
  const s = raw.trim().replace(/^\((.*)\)$/, "$1").trim();
  if (!s) return "";
  if (/ (OR|AND) /i.test(s)) return `(${s.split(/\s+(OR|AND)\s+/i).map((p, i) => (i % 2 ? p.toUpperCase() : normalize(p))).join(" ")})`.replace(/^\(\((.*)\)\)$/, "($1)");
  return ALIASES[s.toLowerCase()] ?? s.replace(/\s+/g, "-");
}

export function category(id: string): Category {
  const s = id.replace(/[()]/g, "").trim();
  if (!s) return "unknown";
  if (/ OR /.test(s)) { const cs = s.split(/ OR /).map(category); for (const c of ["public-domain", "permissive", "weak-copyleft", "strong-copyleft", "proprietary", "unknown"] as Category[]) if (cs.includes(c)) return c; }
  if (/ AND /.test(s)) { const cs = s.split(/ AND /).map(category); for (const c of ["unknown", "proprietary", "strong-copyleft", "weak-copyleft", "permissive", "public-domain"] as Category[]) if (cs.includes(c)) return c; }
  if (/^(Unlicense|CC0-1\.0|0BSD|WTFPL)$/i.test(s)) return "public-domain";
  if (/^(MIT|ISC|BSD-\d-Clause.*|Apache-2\.0|Apache-1\.1|Zlib|Python-2\.0|BlueOak-1\.0\.0|CC-BY-\d\.\d|Artistic-2\.0|PSF-2\.0|X11|MIT-0|BSL-1\.0)$/i.test(s)) return "permissive";
  if (/^(LGPL|MPL|EPL|CDDL|CPL|EUPL-1\.1|MS-RL|OSL)/i.test(s)) return "weak-copyleft";
  if (/^(GPL|AGPL|SSPL|EUPL|CC-BY-SA|CC-BY-NC|OSL-3)/i.test(s)) return "strong-copyleft";
  if (/^(UNLICENSED|SEE LICENSE|proprietary|commercial)/i.test(s)) return "proprietary";
  return "unknown";
}

export function guessFromText(text: string): string {
  const t = text.slice(0, 4000);
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(t)) return "AGPL-3.0";
  if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(t)) return /Version 2\.1/i.test(t) ? "LGPL-2.1" : "LGPL-3.0";
  if (/GNU GENERAL PUBLIC LICENSE/i.test(t)) return /Version 2/i.test(t) ? "GPL-2.0" : "GPL-3.0";
  if (/Mozilla Public License,? Version 2\.0/i.test(t)) return "MPL-2.0";
  if (/Apache License[\s,]+Version 2\.0/i.test(t)) return "Apache-2.0";
  if (/This is free and unencumbered software/i.test(t)) return "Unlicense";
  if (/Permission is hereby granted, free of charge/i.test(t)) return "MIT";
  if (/Permission to use, copy, modify, and\/?or distribute/i.test(t)) return "ISC";
  if (/Redistribution and use in source and binary forms/i.test(t)) return /Neither the name/i.test(t) ? "BSD-3-Clause" : "BSD-2-Clause";
  return "";
}

export const copyright = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).find((l) => /^(copyright|\(c\)|©)/i.test(l) && /\d{4}|\w{3,}/.test(l)) ?? "";

export function licenseField(pj: Record<string, unknown>): string {
  const l = pj.license;
  if (typeof l === "string") return l;
  if (l && typeof l === "object" && typeof (l as { type?: unknown }).type === "string") return (l as { type: string }).type;
  const ls = pj.licenses;
  if (Array.isArray(ls)) return ls.map((x) => (typeof x === "string" ? x : x?.type)).filter(Boolean).join(" OR ");
  return "";
}
