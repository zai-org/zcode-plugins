import { useEffect, useMemo, useRef, useState } from "react";
import {
  LIMITS,
  URIS,
  type CollectionNode,
  type CollectionsDoc,
  type ItemList,
  type ItemQuery,
  type ItemSummary,
  type LibraryId,
  type SessionState,
} from "#z/contract.ts";
import { addItemsToContext, askAboutItems } from "#ui/chat.ts";
import { AskBox, Empty, IconButton, errorText } from "#ui/common.tsx";
import type { Strings } from "#ui/i18n.ts";
import { Icon } from "#ui/icons.tsx";
import { push, replace, useResource, type Route } from "#ui/store.ts";

type Notify = (message: string, tone?: "info" | "error") => void;

// ---------------------------------------------------------------------------
// 条目列表（库视图与 Agent 列表共用）
// ---------------------------------------------------------------------------

function ItemRow({
  item,
  selected,
  onToggle,
  onOpen,
  onOpenPdf,
  s,
}: {
  item: ItemSummary;
  selected: boolean;
  onToggle: (event: React.MouseEvent | React.KeyboardEvent) => void;
  onOpen: () => void;
  onOpenPdf: () => void;
  s: Strings;
}) {
  const meta = [item.creatorSummary, item.year, item.venue].filter(Boolean).join(" · ");
  return (
    <li className={`item-row${selected ? " selected" : ""}`} data-key={item.key}>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={item.title}
        className="check"
        onClick={(event) => onToggle(event)}
      >
        {selected && <Icon name="check" size={12} />}
      </button>
      <button
        type="button"
        className="item-main"
        onClick={(event) => (event.metaKey || event.ctrlKey || event.shiftKey ? onToggle(event) : onOpen())}
      >
        <span className="item-title">{item.title}</span>
        <span className="item-meta">
          <span className="type">{s.itemTypes[item.itemType] ?? item.itemType}</span>
          {meta && <span className="ellipsis">{meta}</span>}
        </span>
      </button>
      {item.pdf && (
        <button type="button" className="pdf-chip" title={s.openPdf} aria-label={s.openPdf} onClick={onOpenPdf}>
          {s.pdf}
        </button>
      )}
    </li>
  );
}

function ItemListView({
  library,
  list,
  s,
  notify,
  footer,
}: {
  library: LibraryId;
  list: ItemSummary[];
  s: Strings;
  notify: Notify;
  footer?: React.ReactNode;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);
  const anchor = useRef<number | null>(null);
  const items = useMemo(() => new Map(list.map((item) => [item.key, item])), [list]);
  const chosen = selected.map((key) => items.get(key)).filter((item): item is ItemSummary => !!item);

  const toggle = (index: number, event: React.MouseEvent | React.KeyboardEvent) => {
    const key = list[index]!.key;
    if (event.shiftKey && anchor.current !== null) {
      const [from, to] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
      const range = list.slice(from, to + 1).map((item) => item.key);
      setSelected((current) => [...new Set([...current, ...range])]);
    } else setSelected((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]));
    anchor.current = index;
  };

  const openItem = (item: ItemSummary) => push({ kind: "item", library, key: item.key });
  const openPdf = (item: ItemSummary) =>
    push({ kind: "reader", library, itemKey: item.key, attachmentKey: item.pdf!.key });

  return (
    <>
      <ul className="item-list" aria-multiselectable="true">
        {list.map((item, index) => (
          <ItemRow
            key={item.key}
            item={item}
            s={s}
            selected={selected.includes(item.key)}
            onToggle={(event) => toggle(index, event)}
            onOpen={() => openItem(item)}
            onOpenPdf={() => openPdf(item)}
          />
        ))}
      </ul>
      {footer}
      {chosen.length > 0 && (
        <div className="selection-bar">
          {asking ? (
            <AskBox
              placeholder={s.askItemsPlaceholder(chosen.length)}
              sendLabel={s.send}
              onClose={() => setAsking(false)}
              onSend={async (question) => {
                try {
                  await askAboutItems(question, chosen, library);
                  setSelected([]);
                } catch (error) {
                  notify(errorText(error), "error");
                  throw error;
                }
              }}
            />
          ) : (
            <div className="selection-row">
              <span className="count">{s.selected(chosen.length)}</span>
              <div className="grow" />
              <button
                type="button"
                className="btn outline sm"
                onClick={() =>
                  void addItemsToContext(chosen, library)
                    .then(() => notify(s.addedToContext(chosen.length)))
                    .catch((error) => notify(errorText(error), "error"))
                }
              >
                <Icon name="plus" size={14} />
                {s.addToContext}
              </button>
              <button type="button" className="btn primary sm" onClick={() => setAsking(true)}>
                <Icon name="message" size={14} />
                {s.ask}
              </button>
              <IconButton icon="x" label={s.clearSelection} onClick={() => setSelected([])} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 分类选择
// ---------------------------------------------------------------------------

function CollectionMenu({
  library,
  libraries,
  doc,
  query,
  s,
  onPick,
  onClose,
}: {
  library: LibraryId;
  libraries: SessionState["libraries"];
  doc: CollectionsDoc | undefined;
  query: ItemQuery;
  s: Strings;
  onPick: (library: LibraryId, patch: Partial<ItemQuery>) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Set<string>>(() => {
    // 默认展开当前分类的所有上级。
    const expanded = new Set<string>();
    let current = doc?.collections.find((node) => node.key === query.collection);
    while (current?.parent) {
      expanded.add(current.parent);
      current = doc?.collections.find((node) => node.key === current!.parent);
    }
    return expanded;
  });
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [onClose]);

  const children = (parent: string | null) => doc?.collections.filter((node) => node.parent === parent) ?? [];
  const row = (node: CollectionNode, depth: number): React.ReactNode => {
    const kids = children(node.key);
    const expanded = open.has(node.key);
    return (
      <div key={node.key}>
        <div className={`menu-row${query.collection === node.key ? " current" : ""}`} style={{ paddingLeft: 8 + depth * 14 }}>
          {kids.length ? (
            <button
              type="button"
              className="twisty"
              aria-label={node.name}
              aria-expanded={expanded}
              onClick={() =>
                setOpen((current) => {
                  const next = new Set(current);
                  if (next.has(node.key)) next.delete(node.key);
                  else next.add(node.key);
                  return next;
                })
              }
            >
              <Icon name={expanded ? "chevronDown" : "chevronRight"} size={12} />
            </button>
          ) : (
            <span className="twisty" />
          )}
          <button type="button" className="menu-pick" onClick={() => onPick(library, { collection: node.key, search: undefined })}>
            <Icon name="folder" size={14} />
            <span className="ellipsis">{node.name}</span>
            <span className="muted count">{node.numItems || ""}</span>
          </button>
        </div>
        {expanded && kids.map((kid) => row(kid, depth + 1))}
      </div>
    );
  };

  return (
    <div className="menu collection-menu" ref={ref} role="menu">
      {libraries.length > 1 && (
        <>
          <div className="menu-label">{s.libraries}</div>
          {libraries.map((entry) => (
            <div key={entry.id} className={`menu-row${entry.id === library && !query.collection && !query.search ? " current" : ""}`}>
              <span className="twisty" />
              <button type="button" className="menu-pick" onClick={() => onPick(entry.id, { collection: undefined, search: undefined })}>
                <Icon name="library" size={14} />
                <span className="ellipsis">{entry.type === "user" ? s.myLibrary : entry.name}</span>
              </button>
            </div>
          ))}
          <div className="menu-sep" />
        </>
      )}
      {libraries.length <= 1 && (
        <div className={`menu-row${!query.collection && !query.search ? " current" : ""}`}>
          <span className="twisty" />
          <button type="button" className="menu-pick" onClick={() => onPick(library, { collection: undefined, search: undefined })}>
            <Icon name="library" size={14} />
            <span className="ellipsis">{s.allItems}</span>
          </button>
        </div>
      )}
      {doc && doc.collections.length > 0 && <div className="menu-label">{s.collections}</div>}
      {children(null).map((node) => row(node, 0))}
      {doc && doc.searches.length > 0 && (
        <>
          <div className="menu-label">{s.savedSearches}</div>
          {doc.searches.map((search) => (
            <div key={search.key} className={`menu-row${query.search === search.key ? " current" : ""}`}>
              <span className="twisty" />
              <button type="button" className="menu-pick" onClick={() => onPick(library, { search: search.key, collection: undefined })}>
                <Icon name="savedSearch" size={14} />
                <span className="ellipsis">{search.name}</span>
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const SORTS = ["dateModified", "dateAdded", "title", "creator", "date"] as const;

function SortMenu({ query, s, onPick, onClose }: { query: ItemQuery; s: Strings; onPick: (sort: ItemQuery["sort"]) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => !ref.current?.contains(event.target as Node) && onClose();
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);
  return (
    <div className="menu right" ref={ref} role="menu">
      {SORTS.map((sort) => (
        <button
          key={sort}
          type="button"
          role="menuitemradio"
          aria-checked={(query.sort ?? "dateModified") === sort}
          className="menu-item"
          onClick={() => onPick(sort)}
        >
          <span className="tick">{(query.sort ?? "dateModified") === sort && <Icon name="check" size={13} />}</span>
          {s.sortNames[sort]}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 视图
// ---------------------------------------------------------------------------

export function LibraryView({
  route,
  state,
  s,
  notify,
}: {
  route: Extract<Route, { kind: "library" }>;
  state: SessionState;
  s: Strings;
  notify: Notify;
}) {
  const { library, query } = route;
  const [text, setText] = useState(query.q ?? "");
  const [pages, setPages] = useState(1);
  const [menu, setMenu] = useState<null | "collections" | "sort">(null);
  const collections = useResource<CollectionsDoc>(URIS.collections(library));
  const listQuery: ItemQuery = { ...query, start: 0, limit: Math.min(LIMITS.pageSize * pages, 500) };
  const list = useResource<ItemList>(URIS.items(library, listQuery));

  // 输入停顿后再搜索；route 就地替换，返回时不逐字回退。
  useEffect(() => {
    if ((query.q ?? "") === text.trim()) return;
    const timer = setTimeout(() => {
      setPages(1);
      replace({ ...route, query: { ...query, q: text.trim() || undefined } });
    }, 300);
    return () => clearTimeout(timer);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (nextLibrary: LibraryId, patch: Partial<ItemQuery>) => {
    setPages(1);
    setMenu(null);
    replace({ kind: "library", library: nextLibrary, query: { ...(nextLibrary === library ? query : {}), ...patch } });
  };

  const scopeName = (() => {
    if (query.collection) return collections.data?.collections.find((node) => node.key === query.collection)?.name ?? "…";
    if (query.search) return collections.data?.searches.find((search) => search.key === query.search)?.name ?? "…";
    const lib = state.libraries.find((entry) => entry.id === library);
    return !lib || lib.type === "user" ? s.myLibrary : lib.name;
  })();

  const data = list.data;
  const everything = query.mode === "everything";
  return (
    <div className="view">
      <header className="bar">
        <div className="scope">
          <button type="button" className="btn ghost scope-btn" aria-haspopup="menu" aria-expanded={menu === "collections"} onClick={() => setMenu(menu === "collections" ? null : "collections")}>
            <Icon name={query.collection ? "folder" : query.search ? "savedSearch" : "library"} />
            <span className="ellipsis">{scopeName}</span>
            <Icon name="chevronDown" size={14} />
          </button>
          {menu === "collections" && (
            <CollectionMenu
              library={library}
              libraries={state.libraries}
              doc={collections.data}
              query={query}
              s={s}
              onPick={update}
              onClose={() => setMenu(null)}
            />
          )}
        </div>
        <div className="grow" />
        {data && <span className="muted small">{s.items(data.total)}</span>}
        <div className="menu-anchor">
          <IconButton icon="sort" label={s.sort} onClick={() => setMenu(menu === "sort" ? null : "sort")} />
          {menu === "sort" && <SortMenu query={query} s={s} onClose={() => setMenu(null)} onPick={(sort) => update(library, { sort })} />}
        </div>
      </header>
      <div className="search">
        <Icon name="search" size={15} />
        <input
          type="search"
          value={text}
          placeholder={everything ? s.everythingPlaceholder : s.searchPlaceholder}
          aria-label={s.search}
          onChange={(event) => setText(event.target.value)}
        />
        <label className="toggle" title={s.searchEverything}>
          <input type="checkbox" checked={everything} onChange={(event) => update(library, { mode: event.target.checked ? "everything" : undefined })} />
          <span>{s.searchEverything}</span>
        </label>
      </div>
      <div className="scroll list-scroll">
        {list.error && !data ? (
          <Empty>
            <p className="error-text">{list.error}</p>
            <button type="button" className="btn outline sm" onClick={list.reload}>
              {s.retry}
            </button>
          </Empty>
        ) : !data ? (
          <Empty>{s.loading}</Empty>
        ) : data.items.length === 0 ? (
          <Empty>{query.q || query.tag ? s.noResults : s.noItems}</Empty>
        ) : (
          <ItemListView
            library={library}
            list={data.items}
            s={s}
            notify={notify}
            footer={
              data.total > data.items.length && pages * LIMITS.pageSize < 500 ? (
                <div className="more">
                  <button type="button" className="btn outline sm" onClick={() => setPages(pages + 1)}>
                    {s.loadMore}
                  </button>
                </div>
              ) : null
            }
          />
        )}
      </div>
    </div>
  );
}

export function ItemsView({ route, s, notify, onBack }: { route: Extract<Route, { kind: "items" }>; s: Strings; notify: Notify; onBack: () => void }) {
  const list = useResource<ItemList>(URIS.items(route.library, { keys: route.keys }));
  return (
    <div className="view">
      <header className="bar">
        <IconButton icon="chevronLeft" label={s.back} onClick={onBack} />
        <div className="bar-title">
          <span className="eyebrow">
            <Icon name="sparkles" size={12} />
            {s.fromAgent}
          </span>
          <span className="ellipsis strong">{route.title}</span>
        </div>
        <span className="muted small">{s.items(route.keys.length)}</span>
      </header>
      <div className="scroll list-scroll">
        {list.error && !list.data ? (
          <Empty>
            <p className="error-text">{list.error}</p>
          </Empty>
        ) : !list.data ? (
          <Empty>{s.loading}</Empty>
        ) : (
          <ItemListView library={route.library} list={list.data.items} s={s} notify={notify} />
        )}
      </div>
    </div>
  );
}
