"use client";

import { useId, useRef, useState } from "react";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import { ApiProblemError } from "@/services/httpClient";
import type { UploadedImage } from "@/services/contentAuthoringService";
import { Field } from "./parts";
import type { CardErrors } from "@/lib/cardModel";
import styles from "./CardBuilder.module.scss";

const m = authoringMessages.builder.description;
const t = m.image;

/** The same limits the server applies (SPEC-025 RN-02): the browser says no at once instead of sending what will be refused. */
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const MAX_BYTES = 10 << 20;

interface ImageElementProps {
  /** The number of the element in the card, for the labels. */
  n: number;
  id: string;
  url: string;
  caption: string;
  errors: CardErrors;
  onChange: (patch: { url?: string; caption?: string }) => void;
  upload: (file: File) => Promise<UploadedImage>;
}

/**
 * The element Imagem of a card (SPEC-025): the teacher sends the file, the server converts it and keeps it, and the element holds the
 * address that comes back. An address of an image published elsewhere is still accepted.
 */
export function ImageElement({ n, id, url, caption, errors, onChange, upload }: ImageElementProps) {
  const inputId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "sending" } | { kind: "done"; text: string } | { kind: "error"; text: string }>({ kind: "idle" });
  const label = (text: string) => `${text} ${n}`;

  const send = async (file: File) => {
    if (!ACCEPTED.includes(file.type)) return setState({ kind: "error", text: t.badType });
    if (file.size > MAX_BYTES) return setState({ kind: "error", text: t.tooBig });
    setState({ kind: "sending" });
    try {
      const saved = await upload(file);
      onChange({ url: saved.url });
      setState({ kind: "done", text: t.done(saved.width, saved.height, Math.max(1, Math.round(saved.bytes / 1024))) });
    } catch (error: unknown) {
      setState({ kind: "error", text: error instanceof ApiProblemError && error.detail ? error.detail : t.failed });
    }
  };

  const sending = state.kind === "sending";
  return (
    <>
      <Field label={label(m.kinds.image)} htmlFor={inputId}>
        <div className={styles.imageRow}>
          <button type="button" className={styles.secondary} disabled={sending} onClick={() => picker.current?.click()}>
            <span aria-hidden="true">📤</span> {url.trim() ? t.replace : t.upload}
          </button>
          <input
            ref={picker}
            id={inputId}
            type="file"
            accept={ACCEPTED.join(",")}
            className={styles.fileInput}
            aria-label={label(t.upload)}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void send(file);
            }}
          />
        </div>
        <p className={styles.hint}>{t.help}</p>
        {sending && <p role="status">{t.uploading}</p>}
        {state.kind === "done" && <p role="status">{state.text}</p>}
        {state.kind === "error" && (
          <div className={styles.error} role="alert">
            <p>{state.text}</p>
          </div>
        )}
        {url.trim() && /^https?:\/\//i.test(url.trim()) && (
          // eslint-disable-next-line @next/next/no-img-element -- the address is the teacher's, from the bucket or from elsewhere.
          <img className={styles.imagePreview} src={url.trim()} alt={t.preview(n)} />
        )}
      </Field>
      <Field label={label(`${authoringMessages.builder.description.imageUrl}`)}>
        <input
          className={styles.input}
          aria-label={label(authoringMessages.builder.description.imageUrl)}
          placeholder={t.orUrl}
          value={url}
          onChange={(e) => onChange({ url: e.target.value })}
          aria-invalid={Boolean(errors[id])}
        />
      </Field>
      <Field label={label(m.imageCaption)}>
        <input className={styles.input} aria-label={label(m.imageCaption)} value={caption} onChange={(e) => onChange({ caption: e.target.value })} aria-invalid={Boolean(errors[id])} />
      </Field>
    </>
  );
}
