/* Shared by the build (Node) and the site search (browser): Latin words + CJK single characters and bigrams. */
function hcTokenize(text) {
  const out = [];
  const s = String(text || "").normalize("NFKC").toLowerCase();
  const re = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{N}_]+(?:['’.-][\p{L}\p{N}_]+)*/gu;
  let m;
  while ((m = re.exec(s))) {
    const w = m[0];
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(w)) {
      const chars = Array.from(w);
      for (let i = 0; i < chars.length; i++) { out.push(chars[i]); if (i + 1 < chars.length) out.push(chars[i] + chars[i + 1]); }
    } else {
      out.push(w);
      if (/[.'’-]/.test(w)) for (const p of w.split(/['’.-]/)) if (p) out.push(p);
    }
  }
  return out;
}
if (typeof module !== "undefined") module.exports = { hcTokenize };
