"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MAX_GALLERY_IMAGES, type GalleryImage } from "@/lib/cardModel";
import { newId } from "@/lib/newId";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import { ApiProblemError } from "@/services/httpClient";
import type { UploadedImage } from "@/services/contentAuthoringService";
import { Field } from "./parts";
import styles from "./CardBuilder.module.scss";

const t = authoringMessages.builder.description.image;
const label = authoringMessages.builder.description.kinds.image;

/** The same limits the server applies (SPEC-025 RN-02): the browser says no at once instead of sending what will be refused. */
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const MAX_BYTES = 10 << 20;

type Status = { kind: "sending" } | { kind: "ready"; text: string } | { kind: "error"; text: string };

interface ImageElementProps {
  /** The number of the element in the card, for the labels. */
  n: number;
  images: GalleryImage[];
  onChange: (patch: { images: GalleryImage[] }) => void;
  upload: (file: File) => Promise<UploadedImage>;
}

/** Why the browser refuses a file before sending it, or null when it is fine. */
const refusal = (file: File) => (!ACCEPTED.includes(file.type) ? t.badType(file.name) : file.size > MAX_BYTES ? t.tooBig(file.name) : null);

/**
 * The element Imagens of a card (SPEC-025 rev. 2): the teacher sends one or more files, one at a time, and each picture gets its caption.
 * The server converts and keeps them; the element holds the addresses that come back. There is no field to type an address.
 */
export function ImageElement({ n, images, onChange, upload }: ImageElementProps) {
  const inputId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const swapper = useRef<HTMLInputElement>(null);
  const swapping = useRef<string | null>(null);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [notes, setNotes] = useState<string[]>([]);
  // The pictures as they are now, for the uploads that finish later: each one changes what is there, not what was there when it started.
  const latest = useRef(images);
  useEffect(() => {
    latest.current = images;
  });
  // One at a time: the next upload starts when the one before ends.
  const queue = useRef<Promise<void>>(Promise.resolve());

  const commit = (next: GalleryImage[]) => {
    latest.current = next;
    onChange({ images: next });
  };
  const setOne = (id: string, value: Status) => setStatus((s) => ({ ...s, [id]: value }));

  const send = (id: string, file: File) => {
    setOne(id, { kind: "sending" });
    queue.current = queue.current.then(async () => {
      // Removed while it waited in the queue: nothing to send.
      if (!latest.current.some((img) => img.id === id)) return;
      try {
        const saved = await upload(file);
        if (!latest.current.some((img) => img.id === id)) return;
        commit(latest.current.map((img) => (img.id === id ? { ...img, url: saved.url } : img)));
        setOne(id, { kind: "ready", text: t.ready(saved.width, saved.height, Math.max(1, Math.round(saved.bytes / 1024))) });
      } catch (error: unknown) {
        setOne(id, { kind: "error", text: error instanceof ApiProblemError && error.detail ? `${file.name}: ${error.detail}` : t.failed(file.name) });
      }
    });
  };

  const add = (files: File[]) => {
    const problems: string[] = [];
    const room = MAX_GALLERY_IMAGES - latest.current.length;
    const good = files.filter((file) => {
      const why = refusal(file);
      if (why) problems.push(why);
      return !why;
    });
    if (good.length > room) problems.push(t.limitReached(MAX_GALLERY_IMAGES));
    const taken = good.slice(0, Math.max(0, room));
    setNotes(problems);
    if (taken.length === 0) return;
    const fresh = taken.map((file) => ({ file, image: { id: newId(), url: "", caption: "" } }));
    commit([...latest.current, ...fresh.map((f) => f.image)]);
    for (const { file, image } of fresh) send(image.id, file);
  };

  const replace = (id: string, file: File) => {
    const why = refusal(file);
    setNotes(why ? [why] : []);
    if (!why) send(id, file);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= latest.current.length) return;
    const next = [...latest.current];
    next.splice(to, 0, next.splice(from, 1)[0]!);
    commit(next);
  };

  const full = images.length >= MAX_GALLERY_IMAGES;
  return (
    <Field label={`${label} ${n}`} htmlFor={inputId}>
      <div className={styles.imageRow}>
        <button type="button" className={styles.secondary} disabled={full} onClick={() => picker.current?.click()}>
          <span aria-hidden="true">📤</span> {t.add}
        </button>
        <span className={styles.hint}>{t.count(images.length, MAX_GALLERY_IMAGES)}</span>
        <input
          ref={picker}
          id={inputId}
          type="file"
          multiple
          accept={ACCEPTED.join(",")}
          className={styles.fileInput}
          aria-label={`${t.add} ${n}`}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length > 0) add(files);
          }}
        />
        <input
          ref={swapper}
          type="file"
          accept={ACCEPTED.join(",")}
          className={styles.fileInput}
          aria-label={`${t.replace} ${n}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file && swapping.current) replace(swapping.current, file);
          }}
        />
      </div>
      <p className={styles.hint}>{t.help}</p>
      {notes.length > 0 && (
        <div className={styles.error} role="alert">
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      )}
      {images.length === 0 ? (
        <p className={styles.hint}>{t.empty}</p>
      ) : (
        <ol className={styles.galleryList}>
          {images.map((img, i) => {
            const k = i + 1;
            const state = status[img.id];
            return (
              <li key={img.id} className={styles.galleryItem}>
                <div className={styles.galleryThumb}>
                  {img.url.trim() && /^https?:\/\//i.test(img.url.trim()) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the address comes from the bucket (or from a card of before).
                    <img src={img.url.trim()} alt={t.preview(k)} />
                  ) : (
                    <span aria-hidden="true">🖼️</span>
                  )}
                </div>
                <div className={styles.galleryBody}>
                  <input
                    className={styles.input}
                    aria-label={t.caption(k)}
                    placeholder={t.captionPlaceholder}
                    value={img.caption}
                    onChange={(e) => commit(latest.current.map((x) => (x.id === img.id ? { ...x, caption: e.target.value } : x)))}
                  />
                  {state?.kind === "sending" && <p role="status">{t.sending}</p>}
                  {state?.kind === "ready" && <p className={styles.hint}>{state.text}</p>}
                  {state?.kind === "error" && (
                    <div className={styles.error} role="alert">
                      <p>{state.text}</p>
                    </div>
                  )}
                </div>
                <div className={styles.galleryTools}>
                  <button type="button" className={styles.small} aria-label={t.up(k)} disabled={i === 0} onClick={() => move(i, i - 1)}>
                    ↑
                  </button>
                  <button type="button" className={styles.small} aria-label={t.down(k)} disabled={i === images.length - 1} onClick={() => move(i, i + 1)}>
                    ↓
                  </button>
                  <button
                    type="button"
                    className={styles.small}
                    aria-label={t.replaceLabel(k)}
                    disabled={state?.kind === "sending"}
                    onClick={() => {
                      swapping.current = img.id;
                      swapper.current?.click();
                    }}
                  >
                    🔄
                  </button>
                  <button
                    type="button"
                    className={styles.small}
                    aria-label={t.remove(k)}
                    onClick={() => {
                      commit(latest.current.filter((x) => x.id !== img.id));
                      setStatus((s) => Object.fromEntries(Object.entries(s).filter(([key]) => key !== img.id)));
                    }}
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Field>
  );
}
