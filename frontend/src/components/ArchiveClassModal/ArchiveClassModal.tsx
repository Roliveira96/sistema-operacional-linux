"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import styles from "./ArchiveClassModal.module.scss";

export interface ArchiveClassModalProps {
  isOpen: boolean;
  className: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
  isSubmitting?: boolean;
}

export function ArchiveClassModal({
  isOpen,
  className,
  onClose,
  onConfirm,
  isSubmitting = false,
}: ArchiveClassModalProps) {
  const [reason, setReason] = useState("");

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    await onConfirm(reason.trim());
    setReason("");
  };

  const isConfirmDisabled = !reason.trim() || isSubmitting;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="archiveModalTitle">
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 id="archiveModalTitle" className={styles.title}>
            {messages.classes.archiveModal.title}: {className}
          </h2>
        </div>

        <div className={styles.warning}>
          {messages.classes.archiveModal.warning}
        </div>

        <form onSubmit={handleSubmit} className={styles.field}>
          <label htmlFor="archiveReason" className={styles.label}>
            {messages.classes.archiveModal.reasonLabel} *
          </label>
          <textarea
            id="archiveReason"
            className={styles.textarea}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={messages.classes.archiveModal.reasonPlaceholder}
            required
            autoFocus
          />

          <div className={styles.actions}>
            <Button variant="secondary" type="button" onClick={onClose} disabled={isSubmitting}>
              {messages.classes.archiveModal.cancelButton}
            </Button>
            <Button variant="primary" type="submit" disabled={isConfirmDisabled}>
              {messages.classes.archiveModal.confirmButton}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
