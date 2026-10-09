"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button/Button";
import type { EditRequest } from "@/engine/engine";
import { contentMessages } from "@/messages/content.pt-BR";
import styles from "./NanoDialog.module.scss";

export interface NanoDialogProps {
  request: EditRequest;
  onClose: (saved: string | null) => void;
}

/** Minimal nano replacement: edit the file text, then save or cancel (SPEC-014 P-03). */
export function NanoDialog({ request, onClose }: NanoDialogProps) {
  const m = contentMessages.nano;
  const [text, setText] = useState(request.content);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => area.current?.focus(), []);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") onClose(null);
    // Ctrl+O saves, as in nano.
    if (event.ctrlKey && event.key.toLowerCase() === "o" && !request.readOnly) {
      event.preventDefault();
      onClose(text);
    }
  }

  return (
    <div className={styles.backdrop}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="nano-title" onKeyDown={onKeyDown}>
        <header className={styles.header}>
          <h2 id="nano-title" className={styles.title}>
            {m.title(request.path)}
          </h2>
          {request.isNew && <span className={styles.badge}>{m.newFile}</span>}
          {request.readOnly && <span className={styles.badge}>{m.readOnly}</span>}
        </header>
        {request.warning && <p className={styles.warning}>{request.warning}</p>}
        <textarea
          ref={area}
          className={styles.editor}
          value={text}
          readOnly={request.readOnly}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          aria-label={m.contentLabel}
        />
        <footer className={styles.actions}>
          <Button variant="secondary" onClick={() => onClose(null)}>
            {m.cancel}
          </Button>
          <Button onClick={() => onClose(text)} disabled={request.readOnly}>
            {m.save}
          </Button>
        </footer>
      </div>
    </div>
  );
}
