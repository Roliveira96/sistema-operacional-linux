"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import modal from "@/components/ContentTab/CardModal.module.scss";
import { QUESTION_KINDS, type QuestionKind } from "@/lib/questionKinds";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import styles from "./KindChooser.module.scss";

const m = authoringMessages.questionKinds;

interface KindChooserProps {
  /** Called with the kind chosen; or, with `hrefFor`, the choice is a link to the page of the new question. */
  onChoose?: (kind: QuestionKind) => void;
  hrefFor?: (kind: QuestionKind) => string;
  onClose: () => void;
}

/** Asks the kind of a new question before its page opens (SPEC-035 CA-01, CA-18): the kind never changes after. */
export function KindChooser({ onChoose, hrefFor, onClose }: KindChooserProps) {
  const titleId = useId();
  const [kind, setKind] = useState<QuestionKind>("PRACTICAL");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className={modal.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={modal.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={modal.head}>
          <h3 id={titleId} className={modal.kicker}>
            {m.chooseTitle}
          </h3>
          <button type="button" className={modal.close} onClick={onClose}>
            {m.cancel}
          </button>
        </div>
        <div className={modal.body}>
          <p className={styles.help}>{m.chooseHelp}</p>
          <div role="radiogroup" aria-labelledby={titleId} className={styles.kinds}>
            {QUESTION_KINDS.map((k) => (
              <label key={k} className={`${styles.kind} ${kind === k ? styles.on : ""}`}>
                <input type="radio" name={`${titleId}-kind`} checked={kind === k} onChange={() => setKind(k)} />
                <span className={styles.name}>{m.label[k]}</span>
                <span className={styles.text}>{m.help[k]}</span>
              </label>
            ))}
          </div>
          <div className={styles.actions}>
            {hrefFor ? (
              <Link href={hrefFor(kind)} className={styles.primary}>
                {m.choose}
              </Link>
            ) : (
              <button type="button" className={styles.primary} onClick={() => onChoose?.(kind)}>
                {m.choose}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
