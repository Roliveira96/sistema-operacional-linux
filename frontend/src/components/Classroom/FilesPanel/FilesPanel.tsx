"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import { classroomService, type ClassroomService, type DeckKind, type DeckSummary } from "@/services/classroomService";
import { ApiProblemError } from "@/services/httpClient";
import { readPdfInfo } from "../SlidePresenter/pdfRenderer";
import styles from "./FilesPanel.module.scss";

const m = messages.classroom.files;

export const MAX_PDF_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PAGES = 100;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const ACCEPT = ["application/pdf", ...IMAGE_TYPES].join(",");

/** What the file is by its type, or by its name when the browser does not say; null for what is not a presentation (the server reads the content). */
export function kindOf(file: File): DeckKind | null {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "PDF";
  if (IMAGE_TYPES.includes(file.type) || /\.(png|jpe?g|webp)$/.test(name)) return "IMAGE";
  return null;
}

/** The name of the presentation: the name of the file, with no extension. */
export function titleOf(file: File): string {
  const bare = file.name.replace(/\.[^.]+$/, "").trim();
  return (bare || file.name.trim() || "Arquivo").slice(0, 120);
}

function problemMessage(error: unknown, kind: DeckKind): string {
  if (error instanceof ApiProblemError) {
    if (error.type === "deck-limit-exceeded") return m.errors.deckLimit;
    if (error.type === "file-too-large") return kind === "PDF" ? m.errors.tooBigPdf : m.errors.tooBigImage;
    if (error.type === "invalid-file") return m.errors.format;
    if (error.type === "invalid-pdf") return m.errors.pdfRead;
  }
  return m.errors.send;
}

interface Upload {
  id: number;
  file: File;
  state: "sending" | "failed";
  error?: string;
  /** A file that was refused before it was sent has nothing to send again. */
  retryable?: boolean;
}

export interface FilesPanelProps {
  classId: string;
  /** Puts the presentation on the stage of the room (the panel of the teacher asks the server, which tells everybody). */
  onProject(deckId: string): void;
  service?: Pick<ClassroomService, "listDecks" | "uploadDeck">;
  readPdf?: (file: File) => Promise<{ pageCount: number }>;
}

/**
 * The files of the class that the teacher sends with the class going on, and puts on the stage (SPEC-068): a PDF or an image, by the button or by
 * dropping it here, and the list of what the class already has, each with its Project button.
 */
export function FilesPanel({ classId, onProject, service = classroomService, readPdf = readPdfInfo }: FilesPanelProps) {
  const id = useId();
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [projectWhenDone, setProjectWhenDone] = useState(true);
  const counter = useRef(0);

  useEffect(() => {
    let active = true;
    service.listDecks(classId).then(
      (list) => active && setDecks(list),
      () => active && setLoadFailed(true),
    );
    return () => {
      active = false;
    };
  }, [classId, service]);

  const send = async (file: File, again?: number) => {
    const key = again ?? ++counter.current;
    const project = projectWhenDone;
    const show = (upload: Upload) => setUploads((list) => (again ? list.map((u) => (u.id === key ? upload : u)) : [...list, upload]));
    const refuse = (error: string, retryable = false) => show({ id: key, file, state: "failed", error, retryable });

    const kind = kindOf(file);
    if (!kind) return refuse(m.errors.format);
    if (file.size > (kind === "PDF" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) return refuse(kind === "PDF" ? m.errors.tooBigPdf : m.errors.tooBigImage);

    show({ id: key, file, state: "sending" });
    let pages: number | undefined;
    if (kind === "PDF") {
      try {
        pages = (await readPdf(file)).pageCount;
      } catch {
        return refuse(m.errors.pdfRead);
      }
      if (pages > MAX_PAGES) return refuse(m.errors.tooManyPages);
    }
    try {
      const deck = pages === undefined ? await service.uploadDeck(classId, file, titleOf(file)) : await service.uploadDeck(classId, file, titleOf(file), pages);
      setUploads((list) => list.filter((u) => u.id !== key));
      setDecks((list) => [{ id: deck.id, title: deck.title, pageCount: deck.pageCount, kind: deck.kind ?? kind, createdAt: new Date().toISOString() }, ...(list ?? [])]);
      if (project) onProject(deck.id);
    } catch (error) {
      refuse(problemMessage(error, kind), true);
    }
  };

  const chosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // the same file can be chosen again
    if (file) void send(file);
  };
  const dropped = (event: DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) void send(file);
  };

  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`} onDragOver={(event) => event.preventDefault()} onDrop={dropped}>
      <h3 id={`${id}-title`} className={styles.title}>
        {m.title}
      </h3>
      <p className={styles.help}>{m.help}</p>

      <div className={styles.actions}>
        <input id={`${id}-file`} className={styles.fileInput} type="file" accept={ACCEPT} onChange={chosen} />
        <label htmlFor={`${id}-file`} className={styles.pick}>
          {m.send}
        </label>
        <label className={styles.option}>
          <input type="checkbox" checked={projectWhenDone} onChange={(event) => setProjectWhenDone(event.target.checked)} />
          {m.projectWhenDone}
        </label>
        <span className={styles.hint}>{m.dropHint}</span>
      </div>

      {uploads.map((upload) =>
        upload.state === "sending" ? (
          <p key={upload.id} className={styles.row} role="status">
            <span className={styles.name}>{upload.file.name}</span>
            <span>{m.sending}</span>
          </p>
        ) : (
          <div key={upload.id} className={`${styles.row} ${styles.failed}`} role="alert">
            <span className={styles.name}>{upload.file.name}</span>
            <span>{upload.error}</span>
            {upload.retryable && (
              <Button variant="secondary" size="sm" onClick={() => void send(upload.file, upload.id)}>
                {m.retry}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setUploads((list) => list.filter((u) => u.id !== upload.id))}>
              {m.dismiss}
            </Button>
          </div>
        ),
      )}

      {loadFailed && (
        <p className={`${styles.row} ${styles.failed}`} role="alert">
          {m.loadError}
        </p>
      )}
      {decks && decks.length === 0 && uploads.length === 0 && <p className={styles.hint}>{m.empty}</p>}
      {decks && decks.length > 0 && (
        <ul className={styles.list} aria-label={m.listLabel}>
          {decks.map((deck) => (
            <li key={deck.id} className={styles.item}>
              <span className={styles.name}>{deck.title}</span>
              <span className={styles.meta}>{m.kind[deck.kind ?? "PDF"]}</span>
              <span className={styles.meta}>{m.slides(deck.pageCount)}</span>
              <Button variant="secondary" size="sm" aria-label={m.projectLabel(deck.title)} onClick={() => onProject(deck.id)}>
                {m.project}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
