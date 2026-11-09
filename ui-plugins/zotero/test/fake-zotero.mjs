// 模拟 Zotero 8+ 本地 API（localhost:23119/api/...）的测试服务器，只实现本插件用到的部分。
// 行为依据 Zotero 的 server_localAPI.js：GET 无需认证；写入需要 Zotero-Server-ID（428/412）
// 与 /api/local/authorize 发放的 key（401）；一次性 key 首次校验即作废；文件上传三步走。
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { samplePaper } from "./pdf-fixture.mjs";

const KEY_CHARS = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
const FIELDS = {
  journalArticle: ["title", "abstractNote", "publicationTitle", "volume", "issue", "pages", "date", "series", "language", "DOI", "ISSN", "url", "accessDate", "extra", "journalAbbreviation"],
  conferencePaper: ["title", "abstractNote", "date", "proceedingsTitle", "conferenceName", "place", "publisher", "volume", "pages", "series", "language", "DOI", "ISBN", "url", "accessDate", "extra"],
  preprint: ["title", "abstractNote", "genre", "repository", "archiveID", "place", "date", "series", "DOI", "url", "accessDate", "language", "extra"],
  book: ["title", "abstractNote", "series", "volume", "place", "publisher", "date", "language", "ISBN", "url", "accessDate", "extra"],
  report: ["title", "abstractNote", "reportNumber", "institution", "place", "date", "language", "url", "accessDate", "extra"],
};
const CHILD_FIELDS = {
  attachment: ["title", "accessDate", "url", "linkMode", "contentType", "charset", "filename", "path", "parentItem"],
  note: ["note", "parentItem"],
  annotation: ["parentItem", "annotationType", "annotationText", "annotationComment", "annotationColor", "annotationPageLabel", "annotationSortIndex", "annotationPosition", "annotationAuthorName"],
};

/**
 * @param {{ writes?: boolean, authorize?: "always" | "once" | "deny" | "hang", apiEnabled?: boolean, version?: string }} [options]
 */
export async function startFakeZotero(options = {}) {
  const storage = await mkdtemp(join(tmpdir(), "fake-zotero-"));
  const state = {
    serverId: "FAKESERVER01",
    version: 10,
    writes: options.writes ?? true,
    authorizeMode: options.authorize ?? "always",
    apiEnabled: options.apiEnabled ?? true,
    zoteroVersion: options.version ?? "11.0-test",
    /** @type {Map<string, { key: string, version: number, data: any, deleted?: boolean }>} */
    items: new Map(),
    collections: new Map(),
    searches: new Map(),
    files: new Map(),
    fulltext: new Map(),
    keys: new Map(),
    uploads: new Map(),
    authorizeRequests: 0,
    requests: [],
    keySeq: 0,
  };
  const newKey = () => {
    let key = "";
    let seq = ++state.keySeq;
    for (let index = 0; index < 8; index++) {
      key = KEY_CHARS[seq % KEY_CHARS.length] + key;
      seq = Math.floor(seq / KEY_CHARS.length);
    }
    return key;
  };
  const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

  // ---------------------------------------------------------------- 种子数据
  const addCollection = (name, parent = false, key = newKey()) => {
    state.collections.set(key, { key, version: state.version, data: { key, name, parentCollection: parent } });
    return key;
  };
  const addItem = (data, key = newKey()) => {
    state.version += 1;
    const item = { key, version: state.version, data: { key, version: state.version, tags: [], collections: [], relations: {}, dateAdded: now(), dateModified: now(), ...data } };
    // 子条目不属于分类；独立笔记与附件可以在分类里。
    if (item.data.parentItem || item.data.itemType === "annotation") delete item.data.collections;
    state.items.set(key, item);
    return key;
  };
  const pl = addCollection("PL", false, "CLPLAAAA");
  const types = addCollection("Type Systems", pl, "CLTYAAAA");
  addCollection("Empty", false, "CLEMAAAA");
  state.searches.set("SRCHAAAA", { key: "SRCHAAAA", data: { key: "SRCHAAAA", name: "Stack papers" } });
  const paper = addItem(
    {
      itemType: "journalArticle",
      title: "Second-Class Values Revisited",
      creators: [
        { creatorType: "author", firstName: "Ada", lastName: "Lovelace" },
        { creatorType: "author", firstName: "Alan", lastName: "Turing" },
        { creatorType: "author", firstName: "Grace", lastName: "Hopper" },
      ],
      abstractNote: "We design a type system that tracks storage modes and delays popping the stack.",
      publicationTitle: "Journal of Stack Studies",
      date: "2022-06-01",
      DOI: "10.1234/stack.2022.15",
      collections: [types],
      tags: [{ tag: "stack" }, { tag: "types" }],
    },
    "PAPERAAA",
  );
  const pdfBytes = samplePaper();
  const pdfPath = join(storage, "PDFATTAA", "paper.pdf");
  await mkdir(join(storage, "PDFATTAA"), { recursive: true });
  await writeFile(pdfPath, pdfBytes);
  addItem({ itemType: "attachment", parentItem: paper, linkMode: "imported_file", title: "Full Text PDF", contentType: "application/pdf", filename: "paper.pdf" }, "PDFATTAA");
  state.files.set("PDFATTAA", pdfPath);
  state.fulltext.set("PDFATTAA", "Second-Class Values Revisited ...");
  addItem({ itemType: "note", parentItem: paper, note: "<p><strong>Reading note</strong>: compare with <em>region</em> inference.</p>" }, "NTEAAAAA");
  addItem(
    {
      itemType: "annotation",
      parentItem: "PDFATTAA",
      annotationType: "highlight",
      annotationText: "We design a type system that tracks storage modes.",
      annotationComment: "Key contribution",
      annotationColor: "#ffd400",
      annotationPageLabel: "1",
      annotationSortIndex: "00001|000010|00072",
      annotationPosition: JSON.stringify({ pageIndex: 1, rects: [[72, 692, 380, 703]] }),
      tags: [{ tag: "important" }],
    },
    "ANNTAAAA",
  );
  addItem(
    {
      itemType: "preprint",
      title: "Capturing Types in Practice",
      creators: [{ creatorType: "author", firstName: "Martin", lastName: "Odersky" }],
      repository: "arXiv",
      archiveID: "arXiv:2207.03402",
      date: "2022",
      collections: [pl],
      tags: [{ tag: "capture checking" }],
    },
    "PREPRAAA",
  );
  addItem({ itemType: "book", title: "Types and Programming Languages", creators: [{ creatorType: "author", firstName: "Benjamin", lastName: "Pierce" }], publisher: "MIT Press", date: "2002" }, "TAPLBKAA");

  // ---------------------------------------------------------------- 工具
  const live = () => [...state.items.values()].filter((item) => !item.deleted);
  const childrenOf = (key) => live().filter((item) => item.data.parentItem === key);
  const isTop = (item) => !item.data.parentItem;
  const summary = (item) => {
    const creators = item.data.creators ?? [];
    const last = (creator) => creator.lastName ?? creator.name ?? "";
    const creatorSummary = creators.length === 0 ? "" : creators.length === 1 ? last(creators[0]) : creators.length === 2 ? `${last(creators[0])} and ${last(creators[1])}` : `${last(creators[0])} et al.`;
    const pdf = childrenOf(item.key).find((child) => child.data.itemType === "attachment" && child.data.contentType === "application/pdf");
    return {
      key: item.key,
      version: item.version,
      library: { type: "user", id: 1, name: "My Library" },
      links: {
        self: { href: `http://localhost:23119/api/users/1/items/${item.key}`, type: "application/json" },
        ...(pdf ? { attachment: { href: `http://localhost:23119/api/users/1/items/${pdf.key}`, type: "application/json", attachmentType: "application/pdf", attachmentSize: 1000 } } : {}),
      },
      meta: { creatorSummary, parsedDate: item.data.date ?? "", numChildren: childrenOf(item.key).filter((child) => child.data.itemType !== "annotation").length },
      data: item.data,
    };
  };
  const matches = (item, q, mode) => {
    const needle = q.toLowerCase();
    const creators = (item.data.creators ?? []).map((creator) => `${creator.firstName ?? ""} ${creator.lastName ?? ""} ${creator.name ?? ""}`).join(" ");
    const base = `${item.data.title ?? ""} ${creators} ${item.data.date ?? ""}`.toLowerCase();
    if (base.includes(needle)) return true;
    if (mode !== "everything") return false;
    const text = (data) => JSON.stringify(data).replace(/<[^>]+>/g, "").toLowerCase();
    if (text(item.data).includes(needle)) return true;
    return childrenOf(item.key).some((child) => text(child.data).includes(needle) || (state.fulltext.get(child.key) ?? "").toLowerCase().includes(needle));
  };
  const bibtex = (item) => {
    const first = (item.data.creators ?? [])[0];
    const word = (item.data.title ?? "").toLowerCase().split(/\W+/).find((part) => part.length > 3) ?? "item";
    const year = /\d{4}/.exec(item.data.date ?? "")?.[0] ?? "";
    const id = [first?.lastName?.toLowerCase(), word, year].filter(Boolean).join("_");
    const type = { journalArticle: "article", book: "book", preprint: "misc", conferencePaper: "inproceedings" }[item.data.itemType] ?? "misc";
    const pdf = childrenOf(item.key).find((child) => state.files.has(child.key));
    return `@${type}{${id},\n\ttitle = {${item.data.title}},\n\tauthor = {${(item.data.creators ?? []).map((creator) => `${creator.lastName}, ${creator.firstName}`).join(" and ")}},\n\tyear = {${year}},${pdf ? `\n\tfile = {PDF:${state.files.get(pdf.key)}:application/pdf},` : ""}\n}`;
  };
  const send = (response, status, body, headers = {}) => {
    const isJson = body !== null && typeof body === "object" && !Buffer.isBuffer(body);
    response.writeHead(status, {
      "X-Zotero-Version": state.zoteroVersion,
      "Zotero-API-Version": "3",
      "Zotero-Server-ID": state.serverId,
      "Content-Type": isJson ? "application/json" : "text/plain",
      ...headers,
    });
    response.end(isJson ? JSON.stringify(body) : (body ?? ""));
  };
  const list = (response, items, url, extraHeaders = {}) => {
    const params = url.searchParams;
    let result = items;
    const q = params.get("q");
    if (q) result = result.filter((item) => matches(item, q, params.get("qmode")));
    const tag = params.get("tag");
    if (tag) result = result.filter((item) => (item.data.tags ?? []).some((entry) => entry.tag === tag));
    const sort = params.get("sort") ?? "dateModified";
    const direction = params.get("direction") ?? "desc";
    result = [...result].sort((a, b) => {
      const value = (item) => (sort === "title" ? (item.data.title ?? "") : sort === "dateAdded" ? item.data.dateAdded : sort === "date" ? (item.data.date ?? "") : String(item.version).padStart(8, "0"));
      return value(a).localeCompare(value(b)) * (direction === "asc" ? 1 : -1);
    });
    const total = result.length;
    const start = Number(params.get("start") ?? 0);
    const limit = params.has("limit") ? Number(params.get("limit")) : total;
    result = result.slice(start, start + limit);
    const headers = { "Total-Results": String(total), "Last-Modified-Version": String(state.version), ...extraHeaders };
    const format = params.get("format");
    if (format === "keys") return send(response, 200, result.map((item) => item.key).join("\n") + "\n", headers);
    if (format === "bibtex" || format === "biblatex") return send(response, 200, result.map(bibtex).join("\n\n") + "\n", headers);
    if (format === "csljson") return send(response, 200, { items: result.map((item) => ({ id: item.key, title: item.data.title })) }, headers);
    if (params.get("include")?.includes("citation"))
      return send(
        response,
        200,
        result.map((item) => ({ key: item.key, citation: `<span>(${summary(item).meta.creatorSummary}, ${/\d{4}/.exec(item.data.date ?? "")?.[0] ?? "n.d."})</span>`, bib: `<div class="csl-bib-body"><div class="csl-entry">${summary(item).meta.creatorSummary}. ${item.data.title}.</div></div>` })),
        headers,
      );
    return send(response, 200, result.map(summary), headers);
  };

  // ---------------------------------------------------------------- 写入
  const checkWrite = (request, response) => {
    const serverId = request.headers["zotero-server-id"];
    if (!serverId) return send(response, 428, "Zotero-Server-ID not provided"), false;
    if (serverId !== state.serverId) return send(response, 412, "Zotero-Server-ID does not match this server"), false;
    const key = request.headers["zotero-api-key"];
    if (!key) return send(response, 401, "API key required -- POST /api/local/authorize to obtain one", { "WWW-Authenticate": 'Zotero-API-Key realm="Zotero Local API"' }), false;
    const entry = state.keys.get(key);
    if (!entry) return send(response, 401, "Invalid or expired API key"), false;
    if (!entry.remember) state.keys.delete(key);
    return true;
  };
  const validate = (data) => {
    const type = data.itemType;
    const allowed = FIELDS[type] ?? CHILD_FIELDS[type];
    if (!allowed) return `'${type}' is not a valid itemType`;
    for (const field of Object.keys(data))
      if (!["itemType", "creators", "tags", "collections", "relations", "key", "version", "dateAdded", "dateModified"].includes(field) && !allowed.includes(field)) return `'${field}' is not a valid field for type '${type}'`;
    if (type === "annotation") {
      const parent = state.items.get(data.parentItem);
      if (!parent || parent.data.contentType !== "application/pdf") return "Parent item of annotation must be a PDF attachment";
      if (!data.annotationPosition || !data.annotationSortIndex) return "annotationPosition and annotationSortIndex are required";
    }
    if (data.parentItem && !state.items.get(data.parentItem)) return `Parent item ${data.parentItem} not found`;
    return null;
  };

  async function body(request) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const path = url.pathname.replace(/^\/api\/users\/(0|1)\//, "/api/user/");
    state.requests.push(`${request.method} ${url.pathname}${url.search}`);
    try {
      if (!state.apiEnabled && url.pathname.startsWith("/api/")) return send(response, 403, "Local API is not enabled");
      if (request.method === "GET" && url.pathname === "/api/") return send(response, 200, "Nothing to see here.");
      if (request.method === "POST" && url.pathname === "/api/local/authorize") {
        // 与真实 Zotero 一致：授权请求也要带 Zotero-Server-ID。
        const serverId = request.headers["zotero-server-id"];
        if (!serverId) return send(response, 428, "Zotero-Server-ID not provided");
        if (serverId !== state.serverId) return send(response, 412, "Zotero-Server-ID does not match this server");
        state.authorizeRequests += 1;
        const data = JSON.parse(String(await body(request)) || "{}");
        if (!data.appName) return send(response, 400, "appName is required");
        if (state.authorizeMode === "hang") return; // 用户一直不回应。
        if (state.authorizeMode === "deny") return send(response, 403, { denied: true });
        const key = createHash("sha1").update(String(Math.random())).digest("hex").slice(0, 32);
        const remember = state.authorizeMode === "always";
        state.keys.set(key, { remember, appName: data.appName });
        return send(response, 200, { key, remember });
      }
      if (request.method === "POST" && url.pathname.startsWith("/api/local/uploads/")) {
        const upload = state.uploads.get(url.pathname.split("/").pop());
        if (!upload) return send(response, 404, "Unknown or expired upload key");
        const bytes = await body(request);
        const md5 = createHash("md5").update(bytes).digest("hex");
        if (md5 !== upload.md5) return send(response, 400, `File MD5 does not match expected (got ${md5}, expected ${upload.md5})`);
        upload.bytes = bytes;
        return send(response, 201, "");
      }
      // 只读版本（Zotero 7）：写入方法不受支持。
      if (request.method !== "GET" && !state.writes) return send(response, 400, "Endpoint does not support method");
      if (request.method === "GET" && path === "/api/user/groups") return send(response, 200, []);
      if (request.method === "GET" && url.pathname === "/api/itemTypeFields") {
        const type = url.searchParams.get("itemType");
        const fields = FIELDS[type];
        if (!fields) return send(response, 400, `Invalid item type '${type}'`);
        return send(response, 200, fields.map((field) => ({ field, localized: field })));
      }
      const since = request.headers["if-modified-since-version"];
      if (request.method === "GET" && since && Number(since) >= state.version && /\/items/.test(path)) return send(response, 304, "", { "Last-Modified-Version": String(state.version) });

      let match;
      if (request.method === "GET" && path === "/api/user/collections") {
        const collections = [...state.collections.values()].filter((collection) => !collection.deleted);
        return send(
          response,
          200,
          collections.map((collection) => ({
            ...collection,
            meta: {
              numItems: live().filter((item) => (item.data.collections ?? []).includes(collection.key)).length,
              numCollections: collections.filter((other) => other.data.parentCollection === collection.key).length,
            },
          })),
          { "Last-Modified-Version": String(state.version) },
        );
      }
      if (request.method === "GET" && path === "/api/user/searches") return send(response, 200, [...state.searches.values()]);
      if (request.method === "GET" && (match = /^\/api\/user\/searches\/([A-Z0-9]+)\/items$/.exec(path)))
        return list(response, live().filter((item) => (item.data.tags ?? []).some((entry) => entry.tag === "stack")), url);
      if (request.method === "GET" && (match = /^\/api\/user\/collections\/([A-Z0-9]+)\/items\/top$/.exec(path))) {
        if (!state.collections.has(match[1])) return send(response, 404, "Collection not found");
        return list(response, live().filter((item) => isTop(item) && (item.data.collections ?? []).includes(match[1])), url);
      }
      if (request.method === "GET" && path === "/api/user/items/top") return list(response, live().filter(isTop), url);
      if (request.method === "GET" && path === "/api/user/items") {
        let items = live();
        const keys = url.searchParams.get("itemKey");
        if (keys) items = keys.split(",").map((key) => state.items.get(key)).filter((item) => item && !item.deleted);
        const type = url.searchParams.get("itemType");
        if (type) items = items.filter((item) => item.data.itemType === type);
        else if (!keys) items = items.filter((item) => item.data.itemType !== "annotation");
        return list(response, items, url);
      }
      if (request.method === "GET" && (match = /^\/api\/user\/items\/([A-Z0-9]+)\/children$/.exec(path))) {
        const type = url.searchParams.get("itemType");
        // 与真实 Zotero 一致：不带 itemType=annotation 时不返回注释。
        const children = childrenOf(match[1]).filter((item) => (type ? item.data.itemType === type : item.data.itemType !== "annotation"));
        return list(response, children, url);
      }
      if (request.method === "GET" && (match = /^\/api\/user\/items\/([A-Z0-9]+)\/file\/view\/url$/.exec(path))) {
        const item = state.items.get(match[1]);
        if (!item) return send(response, 404, "Not found");
        if (item.data.itemType !== "attachment") return send(response, 400, `Not a file attachment: ${match[1]}`);
        const file = state.files.get(match[1]);
        return send(response, 200, file ? pathToFileURL(file).href : "");
      }
      if (request.method === "GET" && (match = /^\/api\/user\/items\/([A-Z0-9]+)\/fulltext$/.exec(path))) {
        const text = state.fulltext.get(match[1]);
        return text ? send(response, 200, { content: text, indexedPages: 3, totalPages: 3 }) : send(response, 404, "Not found");
      }
      if (request.method === "GET" && (match = /^\/api\/user\/items\/([A-Z0-9]+)$/.exec(path))) {
        const item = state.items.get(match[1]);
        if (!item || item.deleted) return send(response, 404, "Not found");
        return send(response, 200, summary(item), { "Last-Modified-Version": String(item.version) });
      }

      // ------------------------------------------------------------ 写入端点
      if (request.method === "POST" && (path === "/api/user/items" || path === "/api/user/collections")) {
        if (!checkWrite(request, response)) return;
        const objects = JSON.parse(String(await body(request)));
        const result = { successful: {}, success: {}, unchanged: {}, failed: {} };
        objects.forEach((data, index) => {
          if (path.endsWith("collections")) {
            state.version += 1;
            const key = newKey();
            state.collections.set(key, { key, version: state.version, data: { key, name: data.name, parentCollection: data.parentCollection ?? false } });
            result.successful[index] = { key, version: state.version, data: state.collections.get(key).data };
            result.success[index] = key;
            return;
          }
          const error = validate(data);
          if (error) {
            result.failed[index] = { key: null, code: 400, message: error };
            return;
          }
          const key = addItem(data);
          result.successful[index] = { key, version: state.version, data: state.items.get(key).data };
          result.success[index] = key;
        });
        return send(response, 200, result, { "Last-Modified-Version": String(state.version) });
      }
      if (request.method === "PATCH" && (match = /^\/api\/user\/items\/([A-Z0-9]+)$/.exec(path))) {
        if (!checkWrite(request, response)) return;
        const item = state.items.get(match[1]);
        if (!item || item.deleted) return send(response, 404, "Not found");
        const expected = request.headers["if-unmodified-since-version"];
        if (expected && Number(expected) !== item.version) return send(response, 412, `Item has been modified since specified version (expected ${expected}, found ${item.version})`);
        const patch = JSON.parse(String(await body(request)));
        const error = validate({ ...item.data, ...patch });
        if (error) return send(response, 400, error);
        state.version += 1;
        Object.assign(item.data, patch, { version: state.version, dateModified: now() });
        item.version = state.version;
        return send(response, 204, "", { "Last-Modified-Version": String(state.version) });
      }
      if (request.method === "DELETE" && (path === "/api/user/items" || path === "/api/user/collections")) {
        if (!checkWrite(request, response)) return;
        const param = path.endsWith("items") ? "itemKey" : "collectionKey";
        for (const key of (url.searchParams.get(param) ?? "").split(",")) {
          const target = (path.endsWith("items") ? state.items : state.collections).get(key);
          if (target) target.deleted = true;
          for (const child of childrenOf(key)) child.deleted = true;
        }
        state.version += 1;
        return send(response, 204, "", { "Last-Modified-Version": String(state.version) });
      }
      if (request.method === "POST" && (match = /^\/api\/user\/items\/([A-Z0-9]+)\/file$/.exec(path))) {
        if (!checkWrite(request, response)) return;
        const item = state.items.get(match[1]);
        if (!item) return send(response, 404, "Not found");
        if (!request.headers["if-match"] && !request.headers["if-none-match"]) return send(response, 428, "If-Match/If-None-Match header not provided");
        const form = new URLSearchParams(String(await body(request)));
        if (form.has("upload")) {
          const upload = state.uploads.get(form.get("upload"));
          if (!upload || upload.itemKey !== match[1]) return send(response, 400, "Invalid or expired upload key");
          if (!upload.bytes) return send(response, 400, "File contents were not uploaded");
          const file = join(storage, match[1], upload.filename);
          await mkdir(join(storage, match[1]), { recursive: true });
          await writeFile(file, upload.bytes);
          state.files.set(match[1], file);
          item.data.filename = upload.filename;
          state.uploads.delete(form.get("upload"));
          state.version += 1;
          return send(response, 204, "", { "Last-Modified-Version": String(state.version) });
        }
        const mtime = Number(form.get("mtime"));
        if (!form.get("md5") || !form.get("filename") || !form.get("filesize")) return send(response, 400, "MD5 hash not provided");
        if (mtime > 0 && mtime < 10000000000) return send(response, 400, "mtime must be provided in milliseconds, not seconds");
        const uploadKey = createHash("sha1").update(String(Math.random())).digest("hex").slice(0, 32);
        state.uploads.set(uploadKey, { itemKey: match[1], md5: form.get("md5"), filename: form.get("filename") });
        return send(response, 200, { url: `http://${request.headers.host}/api/local/uploads/${uploadKey}`, uploadKey, contentType: form.get("contentType"), prefix: "", suffix: "" });
      }
      return send(response, 404, "No endpoint found");
    } catch (error) {
      return send(response, 500, String(error?.stack ?? error));
    }
  });
  await new Promise((done) => server.listen(options.port ?? 0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    state,
    storage,
    /** 改动库（模拟用户在 Zotero 里编辑），用于变化通知测试。 */
    touch(key, patch) {
      const item = state.items.get(key);
      state.version += 1;
      Object.assign(item.data, patch);
      item.version = state.version;
    },
    close: () => new Promise((done) => server.close(() => done(undefined))),
  };
}
