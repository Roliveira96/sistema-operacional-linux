"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import { contentAuthoringService, type AuthoredBlock, type ContentAuthoringService } from "@/services/contentAuthoringService";
import { BlockPanel } from "./BlockPanel";
import { BLOCK_TYPES, blockSummary } from "./blockModel";
import styles from "./BlockEditor.module.scss";

const m = authoringMessages.blocks;

interface ContentTabProps {
  moduleId: string;
  service?: ContentAuthoringService;
}

interface Draft {
  type: string;
  afterId?: string;
}

const typeLabel = (type: string) => m.types[type as keyof typeof m.types] ?? type;

/**
 * The "Conteúdo" tab of the module edit page: every block the student sees, in order, with
 * add, edit, move and remove (SPEC-019).
 */
export function ContentTab({ moduleId, service = contentAuthoringService }: ContentTabProps) {
  const [blocks, setBlocks] = useState<AuthoredBlock[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newType, setNewType] = useState<string>("TEXT");
  const [removing, setRemoving] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    service
      .list(moduleId)
      .then((list) => {
        if (!active) return;
        setBlocks(list);
        setFailed(false);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [service, moduleId, attempt]);

  // Leaving the page with an unsaved block loses the work (SPEC-019 CA-13).
  const hasUnsaved = Object.values(dirty).some(Boolean);
  useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = m.unsavedLeave;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsaved]);

  const setDirtyFor = useCallback((key: string, value: boolean) => setDirty((prev) => (prev[key] === value ? prev : { ...prev, [key]: value })), []);

  const reload = () => setAttempt((n) => n + 1);

  // After a conflict: fetch what is stored and start that editor again from it.
  const reloadBlock = async (id: string) => {
    try {
      setBlocks(await service.list(moduleId));
      setOpen((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    } catch {
      setNote(m.genericError);
    }
  };

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = 0;
      return next;
    });

  const move = async (index: number, to: number) => {
    if (!blocks || to < 0 || to >= blocks.length) return;
    const ids = blocks.map((b) => b.id);
    [ids[index], ids[to]] = [ids[to] as string, ids[index] as string];
    try {
      setBlocks(await service.reorder(moduleId, ids));
      setNote(null);
    } catch {
      setNote(m.genericError);
    }
  };

  const remove = async (id: string) => {
    try {
      await service.remove(id);
      setRemoving(null);
      setOpen((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id)));
      setNote(m.removed);
      reload();
    } catch {
      setNote(m.genericError);
    }
  };

  if (failed && !blocks) {
    return (
      <div className={styles.notice} role="alert">
        <p>{m.loadError}</p>
        <button type="button" className={styles.secondary} onClick={reload}>
          {m.retry}
        </button>
      </div>
    );
  }
  if (!blocks) return <p className={styles.hint}>{m.loading}</p>;

  const draftPanel = draft && (
    <li className={styles.draft}>
      <BlockPanel
        service={service}
        moduleId={moduleId}
        draft={draft}
        dirtyKey="draft"
        onDirtyChange={setDirtyFor}
        onCancel={() => setDraft(null)}
        onReload={reload}
        onSaved={() => {
          setDraft(null);
          setNote(m.created);
          reload();
        }}
      />
    </li>
  );

  return (
    <div className={styles.tab}>
      <div className={styles.toolbar}>
        <div>
          <h2 className={styles.title}>{m.title}</h2>
          <p className={styles.hint}>{m.hint}</p>
        </div>
        <div className={styles.add}>
          <select className={styles.select} value={newType} onChange={(e) => setNewType(e.target.value)} aria-label={m.addMenu}>
            {BLOCK_TYPES.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </select>
          <button type="button" className={styles.primary} onClick={() => setDraft({ type: newType })}>
            {m.add}
          </button>
          <Link href={`/app/modules/${moduleId}`} className={styles.link}>
            {m.preview}
          </Link>
        </div>
      </div>

      {note && (
        <p className={styles.flash} role="status">
          {note}
        </p>
      )}

      {blocks.length === 0 && !draft ? (
        <p className={styles.hint}>{m.empty}</p>
      ) : (
        <ol className={styles.blocks}>
          {blocks.map((block, index) => (
            <li key={block.id} className={styles.block}>
              <div className={styles.row}>
                <span className={styles.number} aria-label={m.position(index + 1, blocks.length)}>
                  {index + 1}
                </span>
                <span className={styles.type}>{typeLabel(block.type)}</span>
                <span className={styles.summary}>{blockSummary(block.type, block.payload)}</span>
                {block.edited && <span className={styles.badge}>{m.edited}</span>}
                <div className={styles.rowActions}>
                  <button type="button" className={styles.smallButton} onClick={() => toggle(block.id)} aria-expanded={block.id in open} aria-label={`${block.id in open ? m.close : m.edit} ${index + 1}`}>
                    {block.id in open ? m.close : m.edit}
                  </button>
                  <button type="button" className={styles.smallButton} onClick={() => void move(index, index - 1)} disabled={index === 0} aria-label={`${m.moveUp} ${index + 1}`}>
                    ↑
                  </button>
                  <button type="button" className={styles.smallButton} onClick={() => void move(index, index + 1)} disabled={index === blocks.length - 1} aria-label={`${m.moveDown} ${index + 1}`}>
                    ↓
                  </button>
                  <button type="button" className={styles.smallButton} onClick={() => setDraft({ type: newType, afterId: block.id })} aria-label={`${m.addAfter} ${index + 1}`}>
                    +
                  </button>
                  <button type="button" className={styles.smallButton} onClick={() => setRemoving(block.id)} aria-label={`${m.remove} ${index + 1}`}>
                    ✕
                  </button>
                </div>
              </div>

              {removing === block.id && (
                <div className={styles.conflict} role="alertdialog" aria-label={m.remove}>
                  <p>{m.removeConfirm}</p>
                  <div className={styles.actions}>
                    <button type="button" className={styles.secondary} onClick={() => setRemoving(null)}>
                      {m.cancel}
                    </button>
                    <button type="button" className={styles.danger} onClick={() => void remove(block.id)}>
                      {m.removeYes}
                    </button>
                  </div>
                </div>
              )}

              {block.id in open && (
                <BlockPanel
                  key={`${block.id}-${open[block.id]}`}
                  service={service}
                  moduleId={moduleId}
                  block={block}
                  dirtyKey={block.id}
                  onDirtyChange={setDirtyFor}
                  onCancel={() => toggle(block.id)}
                  onReload={() => void reloadBlock(block.id)}
                  onSaved={(saved) => {
                    setBlocks((prev) => prev && prev.map((b) => (b.id === saved.id ? saved : b)));
                    setNote(null);
                  }}
                />
              )}

              {draft?.afterId === block.id && <ul className={styles.draftList}>{draftPanel}</ul>}
            </li>
          ))}
          {draft && !draft.afterId && <li className={styles.block}>{draftPanel}</li>}
        </ol>
      )}
    </div>
  );
}
