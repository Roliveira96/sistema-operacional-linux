"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { ContentRenderer } from "@/components/ContentRenderer/ContentRenderer";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import type { AuthoredBlock } from "@/services/contentAuthoringService";
import styles from "./CardModal.module.scss";

const m = authoringMessages.cards;

interface CardModalProps {
  /** The title of the card, shown under "Como o aluno vê". */
  title: string;
  blocks: AuthoredBlock[];
  editHref: string;
  onClose: () => void;
}

/** The content of a card as the student sees it, in a window over the list. Closes with Escape, the button or a click outside. */
export function CardModal({ title, blocks, editHref, onClose }: CardModalProps) {
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // The page behind does not scroll while the window is open.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return createPortal(
    <div className={styles.overlay} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.head}>
          <h3 id={titleId} className={styles.kicker}>
            {m.viewTitle}
          </h3>
          <strong className={styles.title}>{title}</strong>
          <button ref={closeButton} type="button" className={styles.close} onClick={onClose}>
            {m.close}
          </button>
        </div>
        <div className={styles.body}>
          <ContentRenderer blocks={blocks} />
        </div>
        <div className={styles.foot}>
          <Link href={editHref} className={styles.edit}>
            <span aria-hidden="true">✏️</span> {m.edit}
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  );
}
