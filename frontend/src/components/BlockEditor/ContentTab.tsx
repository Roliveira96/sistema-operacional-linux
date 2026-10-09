"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ContentRenderer } from "@/components/ContentRenderer/ContentRenderer";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import { contentAuthoringService, type AuthoredBlock, type ContentAuthoringService } from "@/services/contentAuthoringService";
import { ActionMenu } from "./ActionMenu";
import { BlockPanel } from "./BlockPanel";
import { KINDS, blockSummary, kindOf, type Kind } from "./blockModel";
import styles from "./BlockEditor.module.scss";

const m = authoringMessages.blocks;

interface ContentTabProps {
  moduleId: string;
  service?: ContentAuthoringService;
}

interface Draft {
  kind: Kind;
  afterId?: string;
}

/** How a block is open in the list: read-only as the student sees it, or in the editor. */
interface Opened {
  mode: "view" | "edit";
  /** Raised to start the editor again from what is stored, after a conflict. */
  n: number;
}

/**
 * The "Conteúdo" tab of the module edit page: every block the student sees, in order, with
 * an action menu (see, edit, inactivate, remove) and buttons to move it (SPEC-019).
 */
export function ContentTab({ moduleId, service = contentAuthoringService }: ContentTabProps) {
  const [blocks, setBlocks] = useState<AuthoredBlock[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<Record<string, Opened>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newKind, setNewKind] = useState<Kind>("HTML");
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
      setOpen((prev) => ({ ...prev, [id]: { mode: "edit", n: (prev[id]?.n ?? 0) + 1 } }));
    } catch {
      setNote(m.genericError);
    }
  };

  const show = (id: string, mode: Opened["mode"]) => setOpen((prev) => ({ ...prev, [id]: { mode, n: prev[id]?.n ?? 0 } }));
  const hide = (id: string) => setOpen((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id)));

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

  const toggleActive = async (block: AuthoredBlock) => {
    try {
      const updated = await service.setActive(block.id, !block.active);
      setBlocks((prev) => prev && prev.map((b) => (b.id === updated.id ? updated : b)));
      setNote(updated.active ? m.activated : m.inactivated);
    } catch {
      setNote(m.genericError);
    }
  };

  const remove = async (id: string) => {
    try {
      await service.remove(id);
      setRemoving(null);
      hide(id);
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
    <div className={styles.draft}>
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
    </div>
  );

  return (
    <div className={styles.tab}>
      <div className={styles.toolbar}>
        <div>
          <h2 className={styles.title}>{m.title}</h2>
          <p className={styles.hint}>{m.hint}</p>
        </div>
        <div className={styles.add}>
          <select className={styles.select} value={newKind} onChange={(e) => setNewKind(e.target.value as Kind)} aria-label={m.addMenu}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {m.kinds[k]}
              </option>
            ))}
          </select>
          <button type="button" className={styles.primary} onClick={() => setDraft({ kind: newKind })}>
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
          {blocks.map((block, index) => {
            const opened = open[block.id];
            return (
              <li key={block.id} className={`${styles.block} ${block.active ? "" : styles.inactiveBlock}`}>
                <div className={styles.row}>
                  <span className={styles.number} aria-label={m.position(index + 1, blocks.length)}>
                    {index + 1}
                  </span>
                  <span className={styles.type}>{m.kinds[kindOf(block.type, block.payload)]}</span>
                  <span className={styles.summary}>{blockSummary(block.type, block.payload)}</span>
                  {block.edited && <span className={styles.badge}>{m.edited}</span>}
                  {!block.active && <span className={`${styles.badge} ${styles.badgeOff}`}>{m.inactive}</span>}
                  <div className={styles.rowActions}>
                    <button type="button" className={styles.smallButton} onClick={() => void move(index, index - 1)} disabled={index === 0} aria-label={`${m.moveUp} ${index + 1}`}>
                      ↑
                    </button>
                    <button type="button" className={styles.smallButton} onClick={() => void move(index, index + 1)} disabled={index === blocks.length - 1} aria-label={`${m.moveDown} ${index + 1}`}>
                      ↓
                    </button>
                    <button type="button" className={styles.smallButton} onClick={() => setDraft({ kind: newKind, afterId: block.id })} aria-label={`${m.addAfter} ${index + 1}`}>
                      +
                    </button>
                    <ActionMenu
                      label={m.actionsOf(index + 1)}
                      text={m.actions}
                      actions={[
                        { key: "view", label: m.view, onSelect: () => show(block.id, "view") },
                        { key: "edit", label: m.edit, onSelect: () => show(block.id, "edit") },
                        { key: "active", label: block.active ? m.inactivate : m.activate, onSelect: () => void toggleActive(block) },
                        { key: "remove", label: m.remove, danger: true, onSelect: () => setRemoving(block.id) },
                      ]}
                    />
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

                {opened?.mode === "view" && (
                  <div className={styles.viewer}>
                    <div className={styles.viewerHead}>
                      <h4 className={styles.previewTitle}>{m.viewTitle}</h4>
                      <button type="button" className={styles.secondary} onClick={() => hide(block.id)}>
                        {m.close}
                      </button>
                    </div>
                    <ContentRenderer blocks={[block]} />
                  </div>
                )}

                {opened?.mode === "edit" && (
                  <BlockPanel
                    key={`${block.id}-${opened.n}`}
                    service={service}
                    moduleId={moduleId}
                    block={block}
                    dirtyKey={block.id}
                    onDirtyChange={setDirtyFor}
                    onCancel={() => hide(block.id)}
                    onReload={() => void reloadBlock(block.id)}
                    onSaved={(saved) => {
                      setBlocks((prev) => prev && prev.map((b) => (b.id === saved.id ? saved : b)));
                      setNote(null);
                    }}
                  />
                )}

                {draft?.afterId === block.id && draftPanel}
              </li>
            );
          })}
          {draft && !draft.afterId && <li className={styles.block}>{draftPanel}</li>}
        </ol>
      )}
    </div>
  );
}
