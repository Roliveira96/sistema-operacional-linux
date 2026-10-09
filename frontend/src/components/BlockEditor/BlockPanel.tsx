"use client";

import { useEffect, useState } from "react";
import { ContentRenderer } from "@/components/ContentRenderer/ContentRenderer";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import { ApiProblemError } from "@/services/httpClient";
import type { AuthoredBlock, ContentAuthoringService } from "@/services/contentAuthoringService";
import { BlockForm, type FieldErrors } from "./BlockForm";
import { kindOf, newBlockOf, type Kind, type Payload } from "./blockModel";
import styles from "./BlockEditor.module.scss";

const m = authoringMessages.blocks;

interface BlockPanelProps {
  service: Pick<ContentAuthoringService, "create" | "update">;
  moduleId: string;
  /** The block being edited; a new block has none. */
  block?: AuthoredBlock;
  /** The kind and place of a block that does not exist yet. */
  draft?: { kind: Kind; afterId?: string };
  onSaved: (block: AuthoredBlock, created: boolean) => void;
  onCancel: () => void;
  /** Asks the list to fetch the stored block again, after a conflict. */
  onReload: () => void;
  /** Identifies this panel in the parent's list of unsaved ones. */
  dirtyKey: string;
  /** Must keep the same identity between renders. */
  onDirtyChange: (key: string, dirty: boolean) => void;
}

function toFieldErrors(error: ApiProblemError): FieldErrors {
  const out: FieldErrors = {};
  for (const p of error.invalidParams) out[p.name] = p.reason === "required" ? m.errors.required : p.reason;
  return out;
}

/** Editor and preview of one block, with its own save (SPEC-019 section 3.1). */
export function BlockPanel({ service, moduleId, block, draft, onSaved, onCancel, onReload, dirtyKey, onDirtyChange }: BlockPanelProps) {
  // The kind is fixed when the editor opens: clearing a title must not turn a card into plain text.
  const [kind] = useState<Kind>(() => (block ? kindOf(block.type, block.payload) : (draft?.kind ?? "HTML")));
  const [start] = useState(() => (block ? { type: block.type, payload: block.payload } : newBlockOf(kind)));
  const type = start.type;
  const [payload, setPayload] = useState<Payload>(start.payload);
  const [saved, setSaved] = useState(JSON.stringify(start.payload));
  const [updatedAt, setUpdatedAt] = useState(block?.updatedAt ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const dirty = JSON.stringify(payload) !== saved;
  useEffect(() => onDirtyChange(dirtyKey, dirty), [dirty, dirtyKey, onDirtyChange]);
  useEffect(() => () => onDirtyChange(dirtyKey, false), [dirtyKey, onDirtyChange]);

  const save = async (force = false) => {
    setSaving(true);
    setErrors({});
    setGeneral(null);
    setConflict(false);
    setDone(false);
    try {
      const result = block
        ? await service.update(block.id, payload, updatedAt, force)
        : await service.create(moduleId, type, payload, draft?.afterId);
      // The server filters the markup; what it stored is what the editor shows from now on.
      setPayload(result.payload);
      setSaved(JSON.stringify(result.payload));
      setUpdatedAt(result.updatedAt);
      setDone(true);
      onSaved(result, !block);
    } catch (error: unknown) {
      if (error instanceof ApiProblemError && error.type === "block-conflict") setConflict(true);
      else if (error instanceof ApiProblemError && error.invalidParams.length > 0) setErrors(toFieldErrors(error));
      else setGeneral(error instanceof ApiProblemError && error.detail ? error.detail : m.genericError);
    } finally {
      setSaving(false);
    }
  };

  // Raw HTML is only previewed once the server has filtered it.
  const previewPayload = type === "LEGACY_HTML" ? (block ? (JSON.parse(saved) as Payload) : null) : payload;

  return (
    <div className={styles.panel}>
      <div className={styles.editorColumn}>
        <BlockForm
          kind={kind}
          payload={payload}
          onChange={(next) => {
            setPayload(next);
            setDone(false);
          }}
          errors={errors}
        />

        {general && (
          <p className={styles.error} role="alert">
            {general}
          </p>
        )}
        {conflict && (
          <div className={styles.conflict} role="alert">
            <p>{m.conflict}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={onReload}>
                {m.conflictReload}
              </button>
              <button type="button" className={styles.danger} onClick={() => void save(true)}>
                {m.conflictForce}
              </button>
            </div>
          </div>
        )}

        <div className={styles.actions}>
          {dirty && <span className={styles.unsaved}>{m.unsaved}</span>}
          {done && !dirty && (
            <span className={styles.savedNote} role="status">
              {block ? m.saved : m.created}
            </span>
          )}
          <button type="button" className={styles.secondary} onClick={onCancel}>
            {block ? m.close : m.cancel}
          </button>
          <button type="button" className={styles.primary} onClick={() => void save()} disabled={saving || (Boolean(block) && !dirty)}>
            {saving ? m.saving : m.save}
          </button>
        </div>
      </div>

      <aside className={styles.previewColumn} aria-label={m.previewTitle}>
        <h4 className={styles.previewTitle}>{m.previewTitle}</h4>
        {previewPayload && <ContentRenderer blocks={[{ id: block?.id ?? "draft", type, position: 1, payload: previewPayload }]} />}
      </aside>
    </div>
  );
}
