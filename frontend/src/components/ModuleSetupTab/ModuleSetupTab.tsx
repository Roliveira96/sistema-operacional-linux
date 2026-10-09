"use client";

import { useEffect, useState } from "react";
import { SetupEditor } from "@/components/CardBuilder/SetupEditor";
import styles from "@/components/CardBuilder/CardBuilder.module.scss";
import { setupPayload, type Setup } from "@/lib/setup";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import { contentAuthoringService, type ContentAuthoringService } from "@/services/contentAuthoringService";
import { practiceService, type PracticeService } from "@/services/practiceService";

const m = authoringMessages.moduleSetup;

interface ModuleSetupTabProps {
  moduleId: string;
  service?: Pick<ContentAuthoringService, "content" | "setModuleSetup">;
  practice?: Pick<PracticeService, "topicScenario">;
  /** Called with the snapshot the server kept, after it is saved. */
  onSaved?: (setup: Setup | undefined) => void;
}

/** The snapshot shared by every card of the module, which runs first, edited inside the content tab (SPEC-021). */
export function ModuleSetupTab({ moduleId, service = contentAuthoringService, practice = practiceService, onSaved }: ModuleSetupTabProps) {
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [setup, setSetup] = useState<Setup | undefined>();
  const [saved, setSaved] = useState<string>("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.resolve(service.content(moduleId))
      .then((c) => {
        if (!active) return;
        setSetup(c?.setup);
        setSaved(JSON.stringify(c?.setup ? setupPayload(c.setup) : null));
        setState("ready");
      })
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [service, moduleId]);

  const dirty = JSON.stringify(setup ? setupPayload(setup) : null) !== saved;

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const stored = await service.setModuleSetup(moduleId, setup ?? { summary: "", steps: [] });
      setSetup(stored);
      setSaved(JSON.stringify(stored ? setupPayload(stored) : null));
      onSaved?.(stored);
      setMessage({ kind: "ok", text: m.saved });
    } catch {
      setMessage({ kind: "error", text: m.failed });
    } finally {
      setSaving(false);
    }
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
      <SetupEditor setup={setup} help={m.help} before={[]} loadBase={() => practice.topicScenario(moduleId)} onChange={setSetup} />
      <div className={styles.rowButtons}>
        {message && (
          <p className={message.kind === "ok" ? styles.saved : styles.error} role={message.kind === "ok" ? "status" : "alert"}>
            {message.text}
          </p>
        )}
        <button type="button" className={styles.primary} onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? m.saving : m.save}
        </button>
      </div>
    </div>
  );
}
