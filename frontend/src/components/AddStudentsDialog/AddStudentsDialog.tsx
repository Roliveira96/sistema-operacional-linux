"use client";

import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { messages } from "@/messages/pt-BR";
import type { EnrollStudentsResult } from "@/services/classService";
import { listStudents, type ListStudentsResult, type StudentSummary } from "@/services/studentService";
import styles from "./AddStudentsDialog.module.scss";

const m = messages.classes.addStudents;
const SEARCH_DELAY_MS = 300;

export interface AddStudentsDialogProps {
  isOpen: boolean;
  className: string;
  /** Users with an ACTIVE or PENDING_MODERATION enrollment in the class: shown as already in it. */
  memberIds: string[];
  onClose: () => void;
  /** Called after a batch is enrolled, so the page reloads its members. */
  onEnrolled: (result: EnrollStudentsResult) => void;
  onChooseNewStudent: () => void;
  onChooseCsv: () => void;
  enroll: (studentIds: string[]) => Promise<EnrollStudentsResult>;
  searchStudents?: (search: string) => Promise<ListStudentsResult>;
}

function studentLabel(s: StudentSummary): string {
  return s.name || s.email;
}

/**
 * Dialog of the class page to add students (SPEC-041, section 3.1.2): search and select students who already have
 * an account, or go to the new student form or the CSV import, both with the class fixed.
 */
export function AddStudentsDialog({
  isOpen,
  className,
  memberIds,
  onClose,
  onEnrolled,
  onChooseNewStudent,
  onChooseCsv,
  enroll,
  searchStudents = (search) => listStudents({ search, perPage: 20 }),
}: AddStudentsDialogProps) {
  const titleId = useId();
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<StudentSummary[]>([]);
  const [isSearching, setIsSearching] = useState(true);
  const [selected, setSelected] = useState<Map<string, StudentSummary>>(new Map());
  const [known, setKnown] = useState<Map<string, StudentSummary>>(new Map());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<EnrollStudentsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);

  useEffect(() => {
    if (isOpen) searchRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const timer = setTimeout(() => {
      setIsSearching(true);
      searchStudents(search.trim())
        .then((res) => {
          if (!active) return;
          setResults(res.items);
          setKnown((prev) => {
            const next = new Map(prev);
            for (const s of res.items) next.set(s.id, s);
            return next;
          });
        })
        .catch(() => {
          if (active) setResults([]);
        })
        .finally(() => {
          if (active) setIsSearching(false);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // searchStudents is a stable service call; only the term triggers a new search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, isOpen]);

  if (!isOpen) return null;

  const members = new Set(memberIds);

  const toggle = (s: StudentSummary) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(s.id)) next.delete(s.id);
      else next.set(s.id, s);
      return next;
    });
  };

  const requestClose = () => {
    if (selected.size > 0 && !result) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      requestClose();
    }
  };

  const handleEnroll = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await enroll([...selected.keys()]);
      setResult(res);
      setSelected(new Map());
      onEnrolled(res);
    } catch {
      setError(m.error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const nameOf = (id: string) => {
    const s = known.get(id);
    return s ? studentLabel(s) : id;
  };

  return (
    <div className={styles.overlay}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {m.title(className)}
          </h2>
          <button type="button" className={styles.close} onClick={requestClose}>
            {m.close}
          </button>
        </header>

        <div className={styles.tabs} role="tablist">
          <button type="button" role="tab" aria-selected="true" className={`${styles.tab} ${styles.tabActive}`}>
            {m.existingTab}
          </button>
          <button type="button" role="tab" aria-selected="false" className={styles.tab} onClick={onChooseNewStudent}>
            {m.newTab}
          </button>
          <button type="button" role="tab" aria-selected="false" className={styles.tab} onClick={onChooseCsv}>
            {m.csvTab}
          </button>
        </div>

        {result ? (
          <div className={styles.result} role="status">
            <p className={styles.resultLine}>{m.resultEnrolled(result.enrolled.length)}</p>
            {result.alreadyEnrolled.length > 0 && (
              <p className={styles.resultLine}>{m.resultAlready(result.alreadyEnrolled.length)}</p>
            )}
            {result.rejected.length > 0 && (
              <>
                <p className={styles.resultLine}>{m.resultRejected(result.rejected.length)}</p>
                <ul className={styles.rejectedList}>
                  {result.rejected.map((r) => (
                    <li key={r.studentId}>
                      {nameOf(r.studentId)}: {m.rejectReason[r.reason] ?? r.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : (
          <div className={styles.body}>
            <label htmlFor={searchId} className={styles.searchLabel}>
              {m.searchLabel}
            </label>
            <input
              ref={searchRef}
              id={searchId}
              type="search"
              className={styles.search}
              placeholder={m.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <div className={styles.list} aria-busy={isSearching}>
              {isSearching && results.length === 0 ? (
                <p className={styles.muted}>{m.loading}</p>
              ) : results.length === 0 ? (
                <p className={styles.muted}>{m.empty}</p>
              ) : (
                <ul className={styles.items}>
                  {results.map((s) => {
                    const inClass = members.has(s.id);
                    const inputId = `${searchId}-${s.id}`;
                    return (
                      <li key={s.id} className={`${styles.item} ${inClass ? styles.itemDisabled : ""}`}>
                        <input
                          id={inputId}
                          type="checkbox"
                          className={styles.checkbox}
                          checked={inClass || selected.has(s.id)}
                          disabled={inClass}
                          onChange={() => toggle(s)}
                        />
                        <label htmlFor={inputId} className={styles.itemLabel}>
                          <span className={styles.itemName}>{studentLabel(s)}</span>
                          <span className={styles.itemMeta}>
                            {s.email} · RA {s.academicId}
                          </span>
                        </label>
                        {inClass && <span className={styles.badge}>{m.alreadyInClass}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {confirmingClose ? (
          <footer className={styles.footer}>
            <p className={styles.confirmText}>{m.discardQuestion}</p>
            <button type="button" className={styles.secondary} onClick={() => setConfirmingClose(false)}>
              {m.keepSelecting}
            </button>
            <button type="button" className={styles.danger} onClick={onClose}>
              {m.discard}
            </button>
          </footer>
        ) : result ? (
          <footer className={styles.footer}>
            <button type="button" className={styles.primary} onClick={onClose}>
              {m.done}
            </button>
          </footer>
        ) : (
          <footer className={styles.footer}>
            <span className={styles.counter}>{m.selected(selected.size)}</span>
            <button
              type="button"
              className={styles.primary}
              disabled={selected.size === 0 || isSubmitting}
              onClick={() => void handleEnroll()}
            >
              {isSubmitting ? m.submitting : m.submit(selected.size)}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
