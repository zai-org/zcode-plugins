import { useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { URIS, type AnnotationsDoc, type ItemDetail, type SessionState } from "#z/contract.ts";
import { host } from "#ui/bridge.ts";
import { addItemsToContext, askAboutItems } from "#ui/chat.ts";
import { AskBox, Empty, IconButton, errorText, zoteroSelectUrl } from "#ui/common.tsx";
import type { Strings } from "#ui/i18n.ts";
import { Icon } from "#ui/icons.tsx";
import { push, useResource, type Route } from "#ui/store.ts";

type Notify = (message: string, tone?: "info" | "error") => void;

const FIELD_ORDER = [
  "publicationTitle",
  "proceedingsTitle",
  "conferenceName",
  "bookTitle",
  "repository",
  "archiveID",
  "publisher",
  "university",
  "institution",
  "date",
  "volume",
  "issue",
  "pages",
  "DOI",
  "ISBN",
  "ISSN",
  "url",
  "language",
  "extra",
];

function creatorList(item: ItemDetail) {
  return item.creators
    .map((creator) => creator.name ?? [creator.firstName, creator.lastName].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(", ");
}

function Note({ html }: { html: string }) {
  const [open, setOpen] = useState(false);
  const clean = useMemo(() => DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "img"] }), [html]);
  return (
    <div className={`note${open ? " open" : ""}`}>
      <div className="note-body" dangerouslySetInnerHTML={{ __html: clean }} />
      <button type="button" className="link" onClick={() => setOpen(!open)}>
        {open ? "−" : "+"}
      </button>
    </div>
  );
}

function AnnotationList({
  route,
  attachmentKey,
  s,
}: {
  route: Extract<Route, { kind: "item" }>;
  attachmentKey: string;
  s: Strings;
}) {
  const doc = useResource<AnnotationsDoc>(URIS.annotations(route.library, attachmentKey));
  if (!doc.data) return null;
  const { annotations, highlights } = doc.data;
  if (!annotations.length && !highlights.length) return null;
  const open = (pageIndex: number, highlightId?: string) =>
    push({ kind: "reader", library: route.library, itemKey: route.key, attachmentKey, pageIndex, highlightId, nonce: Date.now() });
  return (
    <section className="section">
      <h3>{s.annotations}</h3>
      <ul className="annotation-list">
        {annotations.map((annotation) => (
          <li key={annotation.key}>
            <button type="button" className="annotation" onClick={() => open(annotation.pageIndex)}>
              <span className="swatch" style={{ background: annotation.color }} />
              <span className="annotation-body">
                {annotation.text && <span className="quote">{annotation.text}</span>}
                {annotation.comment && <span className="comment">{annotation.comment}</span>}
                <span className="muted small">
                  {s.page} {annotation.pageLabel}
                </span>
              </span>
            </button>
          </li>
        ))}
        {highlights.map((highlight) => (
          <li key={highlight.id}>
            <button type="button" className="annotation agent" onClick={() => open(highlight.pageIndex, highlight.id)}>
              <span className="swatch" style={{ background: highlight.color }} />
              <span className="annotation-body">
                <span className="quote">{highlight.quote}</span>
                {highlight.comment && <span className="comment">{highlight.comment}</span>}
                <span className="muted small">
                  <Icon name="sparkles" size={11} /> {s.agent} · {s.page} {highlight.pageLabel}
                  {highlight.savedAs ? ` · ${s.saved}` : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ItemView({
  route,
  s,
  notify,
  onBack,
}: {
  route: Extract<Route, { kind: "item" }>;
  state: SessionState;
  s: Strings;
  notify: Notify;
  onBack: () => void;
}) {
  const detail = useResource<ItemDetail>(URIS.item(route.library, route.key));
  const [asking, setAsking] = useState(false);
  const [abstractOpen, setAbstractOpen] = useState(false);
  const item = detail.data;

  if (!item)
    return (
      <div className="view">
        <header className="bar">
          <IconButton icon="chevronLeft" label={s.back} onClick={onBack} />
        </header>
        <Empty>{detail.error ? <p className="error-text">{detail.error}</p> : s.loading}</Empty>
      </div>
    );

  const pdfs = item.attachments.filter((attachment) => attachment.isPdf);
  const fields = FIELD_ORDER.filter((field) => item.fields[field]).map((field) => [field, item.fields[field]!] as const);
  const openPdf = (attachmentKey: string) => push({ kind: "reader", library: route.library, itemKey: item.key, attachmentKey });

  return (
    <div className="view">
      <header className="bar">
        <IconButton icon="chevronLeft" label={s.back} onClick={onBack} />
        <span className="muted small ellipsis grow">{s.itemTypes[item.itemType] ?? item.itemType}</span>
        <IconButton icon="external" label={s.showInZotero} onClick={() => void host.openLink(zoteroSelectUrl(route.library, item.key))} />
      </header>
      <div className="scroll detail">
        <h2 className="detail-title">{item.title}</h2>
        {item.creators.length > 0 && <p className="creators">{creatorList(item)}</p>}
        <p className="muted">{[item.venue, item.year].filter(Boolean).join(" · ")}</p>
        <div className="actions">
          {pdfs[0] && (
            <button type="button" className="btn primary sm" onClick={() => openPdf(pdfs[0]!.key)}>
              <Icon name="file" size={14} />
              {s.openPdf}
            </button>
          )}
          <button type="button" className="btn outline sm" onClick={() => setAsking(true)}>
            <Icon name="message" size={14} />
            {s.ask}
          </button>
          <button
            type="button"
            className="btn outline sm"
            onClick={() =>
              void addItemsToContext([item], route.library)
                .then(() => notify(s.addedToContext(1)))
                .catch((error) => notify(errorText(error), "error"))
            }
          >
            <Icon name="plus" size={14} />
            {s.addToContext}
          </button>
        </div>
        {asking && (
          <AskBox
            placeholder={s.askItemsPlaceholder(1)}
            sendLabel={s.send}
            onClose={() => setAsking(false)}
            onSend={(question) =>
              askAboutItems(question, [item], route.library).catch((error) => {
                notify(errorText(error), "error");
                throw error;
              })
            }
          />
        )}
        {item.abstract && (
          <section className="section">
            <h3>{s.abstract}</h3>
            <p className={`abstract${abstractOpen ? " open" : ""}`}>{item.abstract}</p>
            {item.abstract.length > 360 && (
              <button type="button" className="link" onClick={() => setAbstractOpen(!abstractOpen)}>
                {abstractOpen ? s.showLess : s.showMore}
              </button>
            )}
          </section>
        )}
        {pdfs.map((attachment) => (
          <AnnotationList key={attachment.key} route={route} attachmentKey={attachment.key} s={s} />
        ))}
        {item.notes.length > 0 && (
          <section className="section">
            <h3>
              {s.notes} <span className="muted">{item.notes.length}</span>
            </h3>
            {item.notes.map((note) => (
              <Note key={note.key} html={note.html} />
            ))}
          </section>
        )}
        {fields.length > 0 && (
          <section className="section">
            <h3>{s.info}</h3>
            <dl className="fields">
              {fields.map(([field, value]) => (
                <div key={field}>
                  <dt>{field}</dt>
                  <dd>
                    {field === "url" || field === "DOI" ? (
                      <a
                        href="#"
                        onClick={(event) => {
                          event.preventDefault();
                          void host.openLink(field === "DOI" ? `https://doi.org/${value}` : value);
                        }}
                      >
                        {value}
                      </a>
                    ) : (
                      value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {item.collections.length > 0 && (
          <section className="section">
            <h3>{s.collections}</h3>
            <div className="chips">
              {item.collections.map((collection) => (
                <button
                  type="button"
                  key={collection.key}
                  className="chip"
                  onClick={() => push({ kind: "library", library: route.library, query: { collection: collection.key } })}
                >
                  <Icon name="folder" size={12} />
                  {collection.name}
                </button>
              ))}
            </div>
          </section>
        )}
        {item.tags.length > 0 && (
          <section className="section">
            <h3>{s.tags}</h3>
            <div className="chips">
              {item.tags.map((tag) => (
                <span key={tag} className="chip">
                  <Icon name="tag" size={12} />
                  {tag}
                </span>
              ))}
            </div>
          </section>
        )}
        {item.attachments.length > 0 && (
          <section className="section">
            <h3>{s.attachments}</h3>
            <ul className="attachments">
              {item.attachments.map((attachment) => (
                <li key={attachment.key}>
                  <button
                    type="button"
                    className="attachment"
                    disabled={!attachment.isPdf}
                    onClick={() => attachment.isPdf && openPdf(attachment.key)}
                  >
                    <Icon name="file" size={14} />
                    <span className="ellipsis">{attachment.title}</span>
                    <span className="muted small">{attachment.isPdf ? s.pdf : attachment.contentType || attachment.linkMode}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
