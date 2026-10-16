"use client";

import { type ChangeEvent, type DragEvent, type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, buttonStyle } from "@/components/Button/Button";
import { ACCEPT, kindOf, MAX_IMAGE_BYTES, MAX_PAGES, MAX_PDF_BYTES, titleOf } from "@/components/Classroom/FilesPanel/FilesPanel";
import { readPdfInfo } from "@/components/Classroom/SlidePresenter/pdfRenderer";
import { messages } from "@/messages/pt-BR";
import { ApiProblemError } from "@/services/httpClient";
import { scheduleService, type MaterialKind, type MaterialVisibility, type ScheduleService, type SessionMaterial } from "@/services/scheduleService";
import { fromInputValue, formatSize, hiddenText, KINDS, PHASES, siteOf, START_KIND, toInputValue } from "./materialInfo";
import styles from "./SessionMaterials.module.scss";

const m = messages.schedule.materials;
const fileErrors = messages.classroom.files.errors;

const TITLE_MAX = 120;
/** The phases that include the time after the lesson: the release at a time is offered in them (SPEC-074 3.1). */
const RELEASABLE: MaterialVisibility[] = ["AFTER_CLASS", "DURING_AND_AFTER"];

type Service = Pick<ScheduleService, "materials" | "addFileMaterial" | "addLinkMaterial" | "updateMaterial" | "releaseMaterial" | "deleteMaterial">;

export interface SessionMaterialsProps {
  classId: string;
  sessionId: string;
  service?: Service;
  /** Reads the pages of a PDF before it is sent. */
  readPdf?: (file: File) => Promise<{ pageCount: number }>;
}

/** A file that is on its way, or that was refused, in the area where it was dropped. */
interface Pending {
  id: number;
  name: string;
  phase: MaterialVisibility;
  state: "sending" | "failed";
  error?: string;
}

const isFileDrag = (event: { dataTransfer?: { types?: ArrayLike<string> | null } | null }) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

/** What went wrong with a material, in words for the teacher. */
function problemText(error: unknown, fallback: string): string {
  if (error instanceof ApiProblemError) {
    switch (error.type) {
      case "material-limit-exceeded":
        return m.errors.limit;
      case "file-too-large":
        return m.errors.fileTooLarge;
      case "invalid-file":
        return fileErrors.format;
      case "invalid-material":
        return error.extensions.field === "url" ? m.errors.linkUrlHttps : m.errors.titleRequired;
      case "material-not-found":
        return m.errors.gone;
      case "forbidden":
        return m.errors.forbidden;
    }
  }
  return fallback;
}

function isHttps(address: string): boolean {
  try {
    const u = new URL(address);
    return u.protocol === "https:" && u.host !== "";
  } catch {
    return false;
  }
}

/**
 * The materials of a lesson, in the content dialog (SPEC-074 3.1): one area for each phase in which the class sees them, where the teacher drops
 * the files (or chooses them, or adds a link), and the list of what is already there. Each change is saved on the spot, apart from the Save of the
 * content, so a big file does not hold the rest.
 */
export function SessionMaterials({ classId, sessionId, service = scheduleService, readPdf = readPdfInfo }: SessionMaterialsProps) {
  const headingId = useId();
  const [items, setItems] = useState<SessionMaterial[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState<MaterialVisibility | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const counter = useRef(0);

  const load = useCallback(async () => {
    try {
      setItems(await service.materials(classId, sessionId));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [service, classId, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A file dropped outside the areas must not be opened by the browser, which would take the teacher away from the dialog (SPEC-074 CA-13).
  useEffect(() => {
    const keep = (event: globalThis.DragEvent) => {
      if (isFileDrag(event)) event.preventDefault();
    };
    window.addEventListener("dragover", keep);
    window.addEventListener("drop", keep);
    return () => {
      window.removeEventListener("dragover", keep);
      window.removeEventListener("drop", keep);
    };
  }, []);

  const failFile = (id: number, error: string) => setPending((list) => list.map((p) => (p.id === id ? { ...p, state: "failed", error } : p)));
  const dropPending = (id: number) => setPending((list) => list.filter((p) => p.id !== id));

  const sendFile = async (file: File, kind: "PDF" | "IMAGE", phase: MaterialVisibility, id: number) => {
    let pages: number | undefined;
    if (kind === "PDF") {
      try {
        pages = (await readPdf(file)).pageCount;
      } catch {
        return failFile(id, fileErrors.pdfRead);
      }
      if (pages > MAX_PAGES) return failFile(id, fileErrors.tooManyPages);
    }
    try {
      const created = await service.addFileMaterial(classId, sessionId, file, { title: titleOf(file), kind: START_KIND[phase], visibility: phase }, pages);
      setItems((list) => [...(list ?? []), created]);
      dropPending(id);
    } catch (error) {
      failFile(id, problemText(error, fileErrors.send));
    }
  };

  /** The files go one after the other, in the order they were chosen or dropped; one that is refused does not stop the others (SPEC-074 3.1). */
  const enqueue = (files: File[], phase: MaterialVisibility) => {
    for (const file of files) {
      const id = ++counter.current;
      const kind = kindOf(file);
      if (!kind || file.size > (kind === "PDF" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) {
        const error = !kind ? fileErrors.format : kind === "PDF" ? fileErrors.tooBigPdf : fileErrors.tooBigImage;
        setPending((list) => [...list, { id, name: file.name, phase, state: "failed", error }]);
        continue;
      }
      setPending((list) => [...list, { id, name: file.name, phase, state: "sending" }]);
      queue.current = queue.current.then(() => sendFile(file, kind, phase, id));
    }
  };

  const addLink = async (phase: MaterialVisibility, title: string, url: string) => {
    const created = await service.addLinkMaterial(classId, sessionId, { url, title, kind: START_KIND[phase], visibility: phase });
    setItems((list) => [...(list ?? []), created]);
  };

  /** Runs a change of a material; what goes wrong is told on that material. */
  const run = async (id: string, change: () => Promise<void>, fallback = m.errors.save) => {
    setErrors((prev) => {
      const rest = { ...prev };
      delete rest[id];
      return rest;
    });
    try {
      await change();
    } catch (error) {
      setErrors((prev) => ({ ...prev, [id]: problemText(error, fallback) }));
    }
  };

  const replace = (saved: SessionMaterial) => setItems((list) => (list ?? []).map((x) => (x.id === saved.id ? saved : x)));

  const update = (material: SessionMaterial, patch: Parameters<Service["updateMaterial"]>[3]) =>
    run(material.id, async () => replace(await service.updateMaterial(classId, sessionId, material.id, patch)));
  const release = (material: SessionMaterial) => run(material.id, async () => replace(await service.releaseMaterial(classId, sessionId, material.id)));
  const remove = (material: SessionMaterial) =>
    run(material.id, async () => {
      await service.deleteMaterial(classId, sessionId, material.id);
      setItems((list) => (list ?? []).filter((x) => x.id !== material.id));
    });
  /** The place of a material is its place in the whole list, so it takes the place of its neighbour of the same area; the server sorts the others. */
  const move = (material: SessionMaterial, neighbour: SessionMaterial) =>
    run(material.id, async () => {
      await service.updateMaterial(classId, sessionId, material.id, { position: (items ?? []).indexOf(neighbour) });
      await load();
    });

  return (
    <section className={styles.materials} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h3 id={headingId} className={styles.title}>
          {m.title}
        </h3>
        <p className={styles.help}>
          {m.help} {m.formats}
        </p>
      </div>

      {loadFailed && (
        <div className={styles.error} role="alert">
          <span>{m.loadError}</span>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {m.retry}
          </Button>
        </div>
      )}
      {!items && !loadFailed && <p className={styles.muted}>{m.loading}</p>}

      {items && (
        <div className={styles.zones}>
          {PHASES.map((phase) => (
            <Zone
              key={phase}
              phase={phase}
              items={items.filter((x) => x.visibility === phase)}
              pending={pending.filter((p) => p.phase === phase)}
              errors={errors}
              dragging={dragging === phase}
              onDragging={(on) => setDragging((current) => (on ? phase : current === phase ? null : current))}
              onFiles={(files) => enqueue(files, phase)}
              onDismiss={dropPending}
              onAddLink={(title, url) => addLink(phase, title, url)}
              onChange={update}
              onRelease={release}
              onRemove={remove}
              onMove={move}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface ZoneProps {
  phase: MaterialVisibility;
  items: SessionMaterial[];
  pending: Pending[];
  errors: Record<string, string>;
  dragging: boolean;
  onDragging: (on: boolean) => void;
  onFiles: (files: File[]) => void;
  onDismiss: (id: number) => void;
  onAddLink: (title: string, url: string) => Promise<void>;
  onChange: (material: SessionMaterial, patch: Parameters<Service["updateMaterial"]>[3]) => void;
  onRelease: (material: SessionMaterial) => void;
  onRemove: (material: SessionMaterial) => void;
  onMove: (material: SessionMaterial, neighbour: SessionMaterial) => void;
}

/** The area of a phase: its materials, the files on their way, and the place to drop files, choose them or add a link. */
function Zone({ phase, items, pending, errors, dragging, onDragging, onFiles, onDismiss, onAddLink, onChange, onRelease, onRemove, onMove }: ZoneProps) {
  const id = useId();
  // dragenter and dragleave come for every element the file crosses inside the area: the count tells when it really left
  const depth = useRef(0);

  const enter = (event: DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (event.type === "dragenter") depth.current += 1;
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    onDragging(true);
  };
  const leave = (event: DragEvent) => {
    if (!isFileDrag(event)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) onDragging(false);
  };
  const drop = (event: DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    depth.current = 0;
    onDragging(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) onFiles(files);
  };
  const chosen = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // the same file can be chosen again
    if (files.length > 0) onFiles(files);
  };

  return (
    <section className={styles.zone} aria-labelledby={`${id}-title`} data-dragging={dragging ? "true" : undefined} onDragEnter={enter} onDragOver={enter} onDragLeave={leave} onDrop={drop}>
      <div className={styles.zoneHead}>
        <h4 id={`${id}-title`} className={styles.zoneTitle}>
          {m.phases[phase].title}
        </h4>
        <p className={styles.hint}>{m.phases[phase].hint}</p>
      </div>

      {(items.length > 0 || pending.length > 0) && (
        <ul className={styles.list}>
          {items.map((material, i) => (
            <li key={material.id} className={styles.item}>
              <Row
                material={material}
                error={errors[material.id]}
                first={i === 0}
                last={i === items.length - 1}
                onChange={(patch) => onChange(material, patch)}
                onRelease={() => onRelease(material)}
                onRemove={() => onRemove(material)}
                onMove={(direction) => {
                  const neighbour = items[i + direction];
                  if (neighbour) onMove(material, neighbour);
                }}
              />
            </li>
          ))}
          {pending.map((file) => (
            <li key={`pending-${file.id}`} className={styles.pending}>
              <span className={styles.fileName}>{file.name}</span>
              {file.state === "sending" ? (
                <span className={styles.muted}>{m.sending}</span>
              ) : (
                <>
                  <span className={styles.fileError} role="alert">
                    {file.error}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => onDismiss(file.id)}>
                    {m.dismiss}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className={dragging ? `${styles.drop} ${styles.dropOn}` : styles.drop}>
        <p className={dragging ? `${styles.dropText} ${styles.dropTextOn}` : styles.dropText}>{dragging ? m.dropActive : m.drop}</p>
        <div className={styles.dropActions}>
          <input id={`${id}-file`} className={styles.fileInput} type="file" multiple accept={ACCEPT} onChange={chosen} />
          <label htmlFor={`${id}-file`} {...buttonStyle({ variant: "secondary" })}>
            {m.pick}
          </label>
          <AddLink onAdd={onAddLink} />
        </div>
      </div>
    </section>
  );
}

/** The button of a link of the area and, once opened, its small form. It is not a form of its own: the dialog already is one. */
function AddLink({ onAdd }: { onAdd: (title: string, url: string) => Promise<void> }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [errors, setErrors] = useState<{ title?: string; url?: string; send?: string }>({});
  const [busy, setBusy] = useState(false);

  const close = () => {
    setOpen(false);
    setTitle("");
    setUrl("");
    setErrors({});
  };

  const add = async () => {
    const found: typeof errors = {};
    if (!title.trim()) found.title = m.errors.titleRequired;
    if (!url.trim()) found.url = m.errors.linkUrlRequired;
    else if (!isHttps(url.trim())) found.url = m.errors.linkUrlHttps;
    setErrors(found);
    if (found.title || found.url) return;
    setBusy(true);
    try {
      await onAdd(title.trim(), url.trim());
      close();
    } catch (error) {
      setErrors({ send: problemText(error, m.errors.save) });
    } finally {
      setBusy(false);
    }
  };

  const onEnter = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault(); // it would send the form of the whole dialog
    void add();
  };

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {m.addLink}
      </Button>
    );
  }
  return (
    <div className={styles.linkForm}>
      <div className={styles.field}>
        <label htmlFor={`${id}-title`} className={styles.label}>
          {m.linkTitle}
        </label>
        <input id={`${id}-title`} className={styles.input} value={title} maxLength={TITLE_MAX} aria-invalid={errors.title ? true : undefined} onChange={(e) => setTitle(e.target.value)} onKeyDown={onEnter} />
        {errors.title && <span className={styles.fieldError}>{errors.title}</span>}
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-url`} className={styles.label}>
          {m.linkUrl}
        </label>
        <input id={`${id}-url`} className={styles.input} type="url" value={url} placeholder="https://" aria-invalid={errors.url ? true : undefined} onChange={(e) => setUrl(e.target.value)} onKeyDown={onEnter} />
        {errors.url && <span className={styles.fieldError}>{errors.url}</span>}
      </div>
      {errors.send && (
        <span className={styles.fieldError} role="alert">
          {errors.send}
        </span>
      )}
      <div className={styles.linkActions}>
        <Button variant="secondary" onClick={close} disabled={busy}>
          {m.linkCancel}
        </Button>
        <Button onClick={() => void add()} disabled={busy}>
          {m.linkAdd}
        </Button>
      </div>
    </div>
  );
}

interface RowProps {
  material: SessionMaterial;
  error?: string;
  first: boolean;
  last: boolean;
  onChange: (patch: { title?: string; kind?: MaterialKind; visibility?: MaterialVisibility; releaseAt?: string | null }) => void;
  onRelease: () => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}

/** One material: its name, kind, phase and release, each saved when it is changed, and what the teacher can do with it. */
function Row({ material, error, first, last, onChange, onRelease, onRemove, onMove }: RowProps) {
  const id = useId();
  const [title, setTitle] = useState(material.title);
  const [releaseAt, setReleaseAt] = useState(toInputValue(material.releaseAt));
  const [titleError, setTitleError] = useState<string | null>(null);
  const hidden = material.visibleNow === false;

  // what the server answers is what the fields show
  const [seenTitle, setSeenTitle] = useState(material.title);
  if (seenTitle !== material.title) {
    setSeenTitle(material.title);
    setTitle(material.title);
  }
  const [seenRelease, setSeenRelease] = useState(material.releaseAt);
  if (seenRelease !== material.releaseAt) {
    setSeenRelease(material.releaseAt);
    setReleaseAt(toInputValue(material.releaseAt));
  }

  const saveTitle = () => {
    const next = title.trim();
    if (next === material.title) return setTitle(next);
    if (next === "" || next.length > TITLE_MAX) return setTitleError(m.errors.titleRow);
    setTitleError(null);
    onChange({ title: next });
  };
  const saveRelease = () => {
    if (releaseAt === toInputValue(material.releaseAt)) return;
    onChange({ releaseAt: releaseAt ? fromInputValue(releaseAt) : null });
  };
  const onEnter = (save: () => void) => (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault(); // it would send the form of the whole dialog
    save();
  };

  const detail =
    material.source === "FILE"
      ? [material.fileName, material.sizeBytes !== undefined ? formatSize(material.sizeBytes) : null, material.pageCount && material.contentType === "application/pdf" ? m.pages(material.pageCount) : null]
      : [siteOf(material.url ?? "")];

  return (
    <div className={styles.row} role="group" aria-label={material.title}>
      <div className={styles.rowTop}>
        <div className={styles.field}>
          <label htmlFor={`${id}-title`} className={styles.label}>
            {m.fields.title}
          </label>
          <input
            id={`${id}-title`}
            className={styles.input}
            value={title}
            maxLength={TITLE_MAX + 20}
            aria-invalid={titleError ? true : undefined}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleError(null);
            }}
            onBlur={saveTitle}
            onKeyDown={onEnter(saveTitle)}
          />
        </div>
        <p className={styles.detail}>
          {detail.filter(Boolean).map((part, i) => (
            <span key={i}>{part}</span>
          ))}
          {hidden && material.hiddenUntil && <span className={styles.hiddenTag}>{hiddenText(material.hiddenUntil)}</span>}
        </p>
      </div>

      <div className={styles.rowFields}>
        <div className={styles.field}>
          <label htmlFor={`${id}-kind`} className={styles.label}>
            {m.fields.kind}
          </label>
          <select id={`${id}-kind`} className={styles.input} value={material.kind} onChange={(e) => onChange({ kind: e.target.value as MaterialKind })}>
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {m.kinds[kind]}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-phase`} className={styles.label}>
            {m.fields.phase}
          </label>
          <select id={`${id}-phase`} className={styles.input} value={material.visibility} onChange={(e) => onChange({ visibility: e.target.value as MaterialVisibility })}>
            {PHASES.map((phase) => (
              <option key={phase} value={phase}>
                {m.phases[phase].title}
              </option>
            ))}
          </select>
        </div>
        {RELEASABLE.includes(material.visibility) && (
          <div className={styles.field}>
            <label htmlFor={`${id}-release`} className={styles.label}>
              {m.fields.release}
            </label>
            <input
              id={`${id}-release`}
              className={styles.input}
              type="datetime-local"
              value={releaseAt}
              aria-describedby={`${id}-release-hint`}
              onChange={(e) => setReleaseAt(e.target.value)}
              onBlur={saveRelease}
              onKeyDown={onEnter(saveRelease)}
            />
            <span id={`${id}-release-hint`} className={styles.hint}>
              {m.releaseHint}
            </span>
          </div>
        )}
      </div>

      {(titleError || error) && (
        <span className={styles.fieldError} role="alert">
          {titleError ?? error}
        </span>
      )}

      <div className={styles.rowActions}>
        {hidden && (
          <Button variant="secondary" size="sm" onClick={onRelease}>
            {m.releaseNow}
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={first} onClick={() => onMove(-1)}>
          {m.up}
        </Button>
        <Button variant="ghost" size="sm" disabled={last} onClick={() => onMove(1)}>
          {m.down}
        </Button>
        <Button variant="danger" size="sm" onClick={onRemove}>
          {m.remove}
        </Button>
      </div>
    </div>
  );
}
