/* global MiniSearch, hcTokenize, HC_SEARCH */
(function () {
  const root = document.documentElement.dataset.root || "";
  const L = JSON.parse(document.documentElement.dataset.strings || "{}");
  const data = window.HC_SEARCH;
  if (!data || typeof MiniSearch === "undefined") return;
  const ms = MiniSearch.loadJSON(JSON.stringify(data.index), { fields: data.fields, storeFields: [], tokenize: hcTokenize, processTerm: (t) => t });
  const opts = { boost: { title: 4, tags: 3, headings: 2 }, prefix: (t) => t.length > 2, fuzzy: (t) => (t.length > 4 ? 0.2 : false), combineWith: "AND" };
  const run = (q) => { let r = ms.search(q, opts); if (!r.length) r = ms.search(q, { ...opts, combineWith: "OR" }); return r.map((x) => ({ ...data.docs[x.id], score: x.score, terms: x.terms })); };
  const escH = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const mark = (s, terms) => {
    const t = [...new Set(terms)].filter(Boolean).sort((a, b) => b.length - a.length).map((x) => escH(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return t.length ? escH(s).replace(new RegExp(t.join("|"), "gi"), (m) => `<mark>${m}</mark>`).replace(/<\/mark><mark>/g, "") : escH(s);
  };
  const item = (d, active) => `<a class="hit${active ? " active" : ""}" href="${root}${d.u}"><span class="hit-t">${mark(d.t, d.terms)}</span><span class="hit-c">${escH(d.c)}</span><span class="hit-d">${mark(d.d, d.terms)}</span></a>`;

  for (const form of document.querySelectorAll("form.search")) {
    const input = form.querySelector("input");
    const box = form.querySelector(".results");
    let hits = [], sel = -1;
    const draw = () => {
      const q = input.value.trim();
      if (!q) { box.hidden = true; return; }
      hits = run(q).slice(0, 8);
      box.innerHTML = hits.length ? hits.map((d, i) => item(d, i === sel)).join("") + `<a class="all" href="${root}search.html?q=${encodeURIComponent(q)}">${escH(L.all || "All results")} →</a>` : `<div class="none">${escH((L.none || "No results for “%s”").replace("%s", q))}</div>`;
      box.hidden = false;
    };
    input.addEventListener("input", () => { sel = -1; draw(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!hits.length) return; sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length; draw(); }
      else if (e.key === "Escape") { box.hidden = true; input.blur(); }
      else if (e.key === "Enter" && sel >= 0 && hits[sel]) { e.preventDefault(); location.href = root + hits[sel].u; }
    });
    document.addEventListener("click", (e) => { if (!form.contains(e.target)) box.hidden = true; });
    input.addEventListener("focus", () => { if (input.value.trim()) draw(); });
  }
  document.addEventListener("keydown", (e) => { if (e.key === "/" && !/input|textarea/i.test(document.activeElement.tagName)) { const i = document.querySelector("form.search input"); if (i) { e.preventDefault(); i.focus(); } } });

  const page = document.getElementById("search-page");
  if (page) {
    const q = new URLSearchParams(location.search).get("q") || "";
    const input = document.querySelector("form.search input");
    if (input) input.value = q;
    const hits = q ? run(q) : [];
    document.getElementById("search-count").textContent = q ? (L.count || "%n results for “%s”").replace("%n", hits.length).replace("%s", q) : "";
    page.innerHTML = hits.map((d) => item(d, false)).join("") || (q ? `<div class="none">${escH((L.none || "No results for “%s”").replace("%s", q))}</div>` : "");
  }
})();
