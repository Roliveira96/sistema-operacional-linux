"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "@/components/CardBuilder/CardBuilder.module.scss";
import { InfoTip } from "@/components/InfoTip/InfoTip";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import { contentAuthoringService, type ContentAuthoringService, type ModuleVersion } from "@/services/contentAuthoringService";
import { ApiProblemError } from "@/services/httpClient";

const m = authoringMessages.versions;

interface VersionsTabProps {
  moduleId: string;
  service?: Pick<ContentAuthoringService, "versions" | "publish" | "restore">;
  /** Asks the author to confirm replacing the draft (the browser's own dialog by default). */
  confirm?: (message: string) => boolean;
}

/**
 * The "Versões" tab: the published versions of the module, the publication of the draft and the
 * restoring of an old version into the draft (SPEC-021). Students always read the latest version.
 */
export function VersionsTab({ moduleId, service = contentAuthoringService, confirm = (text) => window.confirm(text) }: VersionsTabProps) {
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [versions, setVersions] = useState<ModuleVersion[]>([]);
  const [changed, setChanged] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await service.versions(moduleId);
    setVersions(r.versions);
    setChanged(r.hasUnpublishedChanges);
  }, [service, moduleId]);

  useEffect(() => {
    let active = true;
    service
      .versions(moduleId)
      .then((r) => {
        if (!active) return;
        setVersions(r.versions);
        setChanged(r.hasUnpublishedChanges);
        setState("ready");
      })
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [service, moduleId]);

  const run = async (action: () => Promise<string>, failed: string) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ kind: "ok", text: await action() });
      await load();
    } catch (error: unknown) {
      const text = error instanceof ApiProblemError ? (error.type === "no-changes" ? m.noChanges : error.invalidParams.some((p) => p.name === "note") ? m.noteTooLong : failed) : failed;
      setMessage({ kind: "error", text });
    } finally {
      setBusy(false);
    }
  };

  const publish = () =>
    run(async () => {
      const { number } = await service.publish(moduleId, note);
      setNote("");
      return m.published(number);
    }, m.publishFailed);

  const restore = (version: ModuleVersion) => {
    if (!confirm(m.restoreConfirm(version.number))) return;
    void run(async () => {
      await service.restore(moduleId, version.number);
      return m.restored(version.number);
    }, m.restoreFailed);
  };

  if (state === "loading") return <p className={styles.hint}>{m.loading}</p>;
  if (state === "error")
    return (
      <p className={styles.error} role="alert">
        {m.loadFailed}
      </p>
    );

  return (
    <div className={styles.environment}>
      <div className={styles.titleRow}>
        <h2 className={styles.sectionTitle}>{m.title}</h2>
        <InfoTip topic={m.title}>{authoringMessages.info.versions}</InfoTip>
      </div>
      <p className={styles.hint}>{m.help}</p>
      <p className={changed ? styles.error : styles.saved} role="status">
        {changed ? m.unpublished : m.upToDate}
      </p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="version-note">
          {m.noteLabel}
        </label>
        <input id="version-note" className={styles.input} value={note} maxLength={200} placeholder={m.notePlaceholder} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className={styles.rowButtons}>
        <button type="button" className={styles.primary} onClick={() => void publish()} disabled={busy || !changed}>
          {busy ? m.publishing : m.publish}
        </button>
      </div>
      {message && (
        <p className={message.kind === "ok" ? styles.saved : styles.error} role={message.kind === "ok" ? "status" : "alert"}>
          {message.text}
        </p>
      )}

      <ol className={styles.results}>
        {versions.map((v) => (
          <li key={v.number} className={`${styles.result} ${v.current ? styles.resultGood : ""}`}>
            <code>{m.version(v.number)}</code>
            <span className={styles.resultText}>
              {new Date(v.createdAt).toLocaleString("pt-BR")}
              {v.createdBy ? ` · ${m.by(v.createdBy)}` : ""} · {m.blocks(v.blockCount)}
              {v.current ? ` · ${m.current}` : ""}
            </span>
            {v.note && <span className={styles.outputLabel}>{v.note}</span>}
            <div className={styles.rowButtons}>
              <button type="button" className={styles.secondary} onClick={() => restore(v)} disabled={busy} aria-label={m.restoreLabel(v.number)}>
                {m.restore}
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
