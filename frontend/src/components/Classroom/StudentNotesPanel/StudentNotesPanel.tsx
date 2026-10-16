"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { messages } from "@/messages/pt-BR";
import { classroomService, type LiveNoteBlock } from "@/services/classroomService";
import { NoteMarkdown } from "./NoteMarkdown";
import { optimizeNoteImage } from "./noteImageOptimizer";
import styles from "./StudentNotesPanel.module.scss";

const m = messages.classroom.notes;

/** Maximum length of a single note block, as enforced by the backend (SPEC-071). */
export const NOTES_MAX_LENGTH = 20_000;

/** Key used in localStorage to persist position and minimized state of the floating notebook dock (SPEC-071 CA-01). */
export const STUDENT_NOTES_DOCK_STORAGE_KEY = "linux-lab:student-notes-dock:v1";

export interface StudentNotesPanelProps {
  classId: string;
  sessionId: string;
}

interface DockState {
  x: number;
  y: number;
  minimized: boolean;
}

function readDockState(): DockState {
  if (typeof window === "undefined") {
    return { x: 0, y: 0, minimized: false };
  }
  try {
    const raw = window.localStorage.getItem(STUDENT_NOTES_DOCK_STORAGE_KEY);
    if (!raw) return { x: 0, y: 0, minimized: false };
    const parsed = JSON.parse(raw) as Partial<DockState>;
    return {
      x: typeof parsed.x === "number" && Number.isFinite(parsed.x) ? parsed.x : 0,
      y: typeof parsed.y === "number" && Number.isFinite(parsed.y) ? parsed.y : 0,
      minimized: Boolean(parsed.minimized),
    };
  } catch {
    return { x: 0, y: 0, minimized: false };
  }
}

function writeDockState(state: DockState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STUDENT_NOTES_DOCK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore storage quota errors */
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function wrapSelection(
  textarea: HTMLTextAreaElement | null,
  currentValue: string,
  prefix: string,
  suffix: string,
): { nextValue: string; selectionStart: number; selectionEnd: number } {
  const start = textarea?.selectionStart ?? currentValue.length;
  const end = textarea?.selectionEnd ?? currentValue.length;
  const selected = currentValue.slice(start, end);
  const replacement = `${prefix}${selected}${suffix}`;
  const nextValue = currentValue.slice(0, start) + replacement + currentValue.slice(end);
  return {
    nextValue,
    selectionStart: start + prefix.length,
    selectionEnd: start + prefix.length + selected.length,
  };
}

function prefixLines(
  textarea: HTMLTextAreaElement | null,
  currentValue: string,
  linePrefix: string,
): { nextValue: string; selectionStart: number; selectionEnd: number } {
  const start = textarea?.selectionStart ?? currentValue.length;
  const end = textarea?.selectionEnd ?? currentValue.length;
  const selected = currentValue.slice(start, end);
  const lines = (selected || "").split("\n").map((l) => `${linePrefix}${l}`);
  const replacement = lines.join("\n");
  const nextValue = currentValue.slice(0, start) + replacement + currentValue.slice(end);
  return {
    nextValue,
    selectionStart: start,
    selectionEnd: start + replacement.length,
  };
}

/**
 * Floating, draggable and minimizable dynamic notebook of atomic Markdown blocks with client-side AVIF screenshot optimization
 * and authenticated media proxy rendering (SPEC-071).
 */
export function StudentNotesPanel({ classId, sessionId }: StudentNotesPanelProps) {
  const [dock, setDock] = useState<DockState>(() => readDockState());
  const [blocks, setBlocks] = useState<LiveNoteBlock[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "uploading" | "saved" | "error" | "uploadError">("idle");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const composerId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    let active = true;
    classroomService
      .listNoteBlocks(classId, sessionId)
      .then((items) => {
        if (active) setBlocks(items ?? []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [classId, sessionId]);

  const updateDock = (updater: (prev: DockState) => DockState) => {
    setDock((prev) => {
      const next = updater(prev);
      writeDockState(next);
      return next;
    });
  };

  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button")) return;

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: dock.x,
      origY: dock.y,
    };

    const onMove = (moveEvent: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = moveEvent.clientX - dragRef.current.startX;
      const dy = moveEvent.clientY - dragRef.current.startY;
      const nextX = Math.round(dragRef.current.origX + dx);
      const nextY = Math.round(dragRef.current.origY + dy);
      updateDock((prev) => ({ ...prev, x: nextX, y: nextY }));
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const applyFormat = (kind: "bold" | "italic" | "code" | "list") => {
    const el = textareaRef.current;
    const currentValue = el ? el.value : draft;
    const res =
      kind === "bold"
        ? wrapSelection(el, currentValue, "**", "**")
        : kind === "italic"
          ? wrapSelection(el, currentValue, "*", "*")
          : kind === "code"
            ? wrapSelection(el, currentValue, "`", "`")
            : prefixLines(el, currentValue, "- ");
    setDraft(res.nextValue);
    if (el) {
      el.value = res.nextValue;
      el.setSelectionRange(res.selectionStart, res.selectionEnd);
    }
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === "b") {
      e.preventDefault();
      applyFormat("bold");
    } else if (key === "i") {
      e.preventDefault();
      applyFormat("italic");
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    let imageFile: File | null = null;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && item.type.startsWith("image/")) {
        imageFile = item.getAsFile();
        if (imageFile) break;
      }
    }
    if (!imageFile) return;

    e.preventDefault();
    setStatus("uploading");
    try {
      const optimized = await optimizeNoteImage(imageFile);
      const uploaded = await classroomService.uploadNoteImage(classId, sessionId, optimized.blob, {
        fileName: optimized.fileName,
        width: optimized.width,
        height: optimized.height,
      });
      const mdImage = `![${m.pastedImageAlt}](${uploaded.accessUrl})`;
      setDraft((prev) => (prev.trim() ? `${prev}\n\n${mdImage}` : mdImage));
      setStatus("saved");
    } catch {
      setStatus("uploadError");
    }
  };

  const handleCreateBlock = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setStatus("saving");
    try {
      const created = await classroomService.createNoteBlock(classId, sessionId, trimmed);
      setBlocks((prev) => [...prev, created]);
      setDraft("");
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  const startEditing = (block: LiveNoteBlock) => {
    setEditingId(block.id);
    setEditingText(block.contentMarkdown);
    setConfirmDeleteId(null);
  };

  const handleSaveEdit = async (blockId: string) => {
    const trimmed = editingText.trim();
    if (!trimmed) return;
    setStatus("saving");
    try {
      const updated = await classroomService.updateNoteBlock(classId, sessionId, blockId, trimmed);
      setBlocks((prev) => prev.map((b) => (b.id === blockId ? updated : b)));
      setEditingId(null);
      setEditingText("");
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  const handleConfirmDelete = async (blockId: string) => {
    setStatus("saving");
    try {
      await classroomService.deleteNoteBlock(classId, sessionId, blockId);
      setBlocks((prev) => prev.filter((b) => b.id !== blockId));
      setConfirmDeleteId(null);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  };

  if (!loaded) {
    return <p className={styles.muted}>{m.loading}</p>;
  }

  return (
    <div
      data-testid="student-notes-dock"
      className={`${styles.dock} ${dock.minimized ? styles.dockMinimized : ""}`}
      style={{ transform: `translate3d(${dock.x}px, ${dock.y}px, 0)` }}
    >
      {dock.minimized ? (
        <button
          type="button"
          className={styles.pill}
          onClick={() => updateDock((prev) => ({ ...prev, minimized: false }))}
        >
          <span>{m.pillLabel(blocks.length)}</span>
        </button>
      ) : (
        <>
          <div
            data-testid="student-notes-drag-handle"
            className={styles.header}
            onPointerDown={handleDragStart}
          >
            <div className={styles.titleGroup}>
              <h3 className={styles.title}>{m.title}</h3>
              <span className={styles.badge}>{blocks.length}</span>
            </div>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label={m.minimize}
              onClick={() => updateDock((prev) => ({ ...prev, minimized: true }))}
            >
              —
            </button>
          </div>

          <div className={styles.blocksList}>
            {blocks.length === 0 ? (
              <p className={styles.muted}>{m.empty}</p>
            ) : (
              blocks.map((block) => {
                const isEdited = block.updatedAt !== block.createdAt;
                const isEditing = editingId === block.id;
                const isConfirmingDelete = confirmDeleteId === block.id;

                return (
                  <article key={block.id} data-testid="note-block-card" className={styles.card}>
                    <div className={styles.cardHeader}>
                      <div className={styles.timestamps}>
                        <time dateTime={block.createdAt}>{formatTime(block.createdAt)}</time>
                        {isEdited && <span>({m.editedAt(formatTime(block.updatedAt))})</span>}
                      </div>
                      <div className={styles.cardActions}>
                        {!isEditing && !isConfirmingDelete && (
                          <>
                            <button
                              type="button"
                              className={styles.actionBtn}
                              aria-label={m.editBlock}
                              onClick={() => startEditing(block)}
                            >
                              {m.editBlock}
                            </button>
                            <button
                              type="button"
                              className={styles.actionBtn}
                              aria-label={m.deleteBlock}
                              onClick={() => setConfirmDeleteId(block.id)}
                            >
                              {m.deleteBlock}
                            </button>
                          </>
                        )}
                        {isConfirmingDelete && (
                          <>
                            <button
                              type="button"
                              className={`${styles.actionBtn} ${styles.dangerBtn}`}
                              onClick={() => void handleConfirmDelete(block.id)}
                            >
                              {m.confirmDelete}
                            </button>
                            <button
                              type="button"
                              className={styles.actionBtn}
                              onClick={() => setConfirmDeleteId(null)}
                            >
                              {m.cancelEdit}
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {isEditing ? (
                      <div className={styles.composer}>
                        <textarea
                          aria-label={m.editBlock}
                          className={styles.box}
                          value={editingText}
                          maxLength={NOTES_MAX_LENGTH}
                          onChange={(e) => setEditingText(e.target.value)}
                        />
                        <div className={styles.cardActions}>
                          <button
                            type="button"
                            className={styles.primaryBtn}
                            onClick={() => void handleSaveEdit(block.id)}
                          >
                            {m.saveEdit}
                          </button>
                          <button
                            type="button"
                            className={styles.actionBtn}
                            onClick={() => {
                              setEditingId(null);
                              setEditingText("");
                            }}
                          >
                            {m.cancelEdit}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <NoteMarkdown
                        markdown={block.contentMarkdown}
                        className={styles.markdownBody}
                        imageClassName={styles.noteImage}
                        codeClassName={styles.inlineCode}
                        listClassName={styles.bulletList}
                      />
                    )}
                  </article>
                );
              })
            )}
          </div>

          <div className={styles.composer}>
            <div className={styles.toolbar} role="toolbar" aria-label={m.title}>
              <button type="button" className={styles.toolBtn} aria-label={m.toolbar.bold} onClick={() => applyFormat("bold")}>
                <strong>B</strong>
              </button>
              <button type="button" className={styles.toolBtn} aria-label={m.toolbar.italic} onClick={() => applyFormat("italic")}>
                <em>I</em>
              </button>
              <button type="button" className={styles.toolBtn} aria-label={m.toolbar.inlineCode} onClick={() => applyFormat("code")}>
                <code>{"<>"}</code>
              </button>
              <button type="button" className={styles.toolBtn} aria-label={m.toolbar.bulletList} onClick={() => applyFormat("list")}>
                •
              </button>
            </div>

            <label htmlFor={composerId} className={styles.muted}>
              {m.newNoteLabel}
            </label>
            <textarea
              id={composerId}
              ref={textareaRef}
              className={styles.box}
              value={draft}
              maxLength={NOTES_MAX_LENGTH}
              placeholder={m.placeholder}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleEditorKeyDown}
              onPaste={(e) => void handlePaste(e)}
            />

            <div className={styles.footer}>
              <span className={styles.muted}>{m.limit}</span>
              {status === "saving" && <span className={styles.muted}>{m.saving}</span>}
              {status === "uploading" && <span className={styles.muted}>{m.uploadingImage}</span>}
              {status === "saved" && (
                <span className={styles.saved} role="status">
                  {m.saved}
                </span>
              )}
              {status === "error" && (
                <span className={styles.error} role="alert">
                  {m.error}
                </span>
              )}
              {status === "uploadError" && (
                <span className={styles.error} role="alert">
                  {m.uploadError}
                </span>
              )}
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={!draft.trim() || status === "saving" || status === "uploading"}
                onClick={() => void handleCreateBlock()}
              >
                {m.addBlock}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
