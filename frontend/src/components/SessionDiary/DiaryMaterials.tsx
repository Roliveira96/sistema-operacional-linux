"use client";

import { useState } from "react";
import { Button, buttonStyle } from "@/components/Button/Button";
import { formatSize, hiddenText, PHASES, siteOf } from "@/components/SessionMaterials/materialInfo";
import { MaterialIcon } from "@/components/SessionMaterials/MaterialIcon";
import { messages } from "@/messages/pt-BR";
import type { ScheduleService, SessionMaterial } from "@/services/scheduleService";
import styles from "./DiaryMaterials.module.scss";

const m = messages.schedule.diary;
const kinds = messages.schedule.materials.kinds;

export type MaterialsService = Pick<ScheduleService, "materialDownload" | "releaseMaterial">;

export interface DiaryMaterialsProps {
  classId: string;
  sessionId: string;
  /** The teacher also sees the hidden ones, with the reason, and releases them (SPEC-074 CA-11); a student gets only what is visible. */
  teacher: boolean;
  materials: SessionMaterial[];
  service: MaterialsService;
  onReleased: (material: SessionMaterial) => void;
}

/** The materials of a lesson in its diary, by the phase in which the class sees them, each with its way to open it (SPEC-074 3.1). */
export function DiaryMaterials({ classId, sessionId, teacher, materials, service, onReleased }: DiaryMaterialsProps) {
  const groups = PHASES.map((phase) => ({ phase, list: materials.filter((x) => x.visibility === phase) })).filter((g) => g.list.length > 0);
  if (groups.length === 0) return null;
  return (
    <section className={styles.section}>
      <h4 className={styles.heading}>{m.materials}</h4>
      {groups.map(({ phase, list }) => (
        <div key={phase} className={styles.group} role="group" aria-label={m.materialPhases[phase]}>
          <p className={styles.phase}>{m.materialPhases[phase]}</p>
          <ul className={styles.list}>
            {list.map((material) => (
              <MaterialItem key={material.id} material={material} classId={classId} sessionId={sessionId} teacher={teacher} service={service} onReleased={onReleased} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function MaterialItem({ material, classId, sessionId, teacher, service, onReleased }: Omit<DiaryMaterialsProps, "materials"> & { material: SessionMaterial }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hidden = teacher && material.visibleNow === false;

  const download = async () => {
    setError(null);
    setBusy(true);
    try {
      // the address lives 15 minutes: it is asked for when the file is clicked, not when the diary is read (SPEC-074 CA-07)
      const { downloadUrl } = await service.materialDownload(classId, sessionId, material.id);
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    } catch {
      setError(m.downloadError);
    } finally {
      setBusy(false);
    }
  };
  const release = async () => {
    setError(null);
    setBusy(true);
    try {
      onReleased(await service.releaseMaterial(classId, sessionId, material.id));
    } catch {
      setError(m.releaseError);
    } finally {
      setBusy(false);
    }
  };

  const detail = material.source === "FILE" ? (material.sizeBytes !== undefined ? formatSize(material.sizeBytes) : "") : siteOf(material.url ?? "");
  return (
    <li className={styles.item}>
      <MaterialIcon kind={material.kind} className={styles.icon} />
      <div className={styles.text}>
        <span className={styles.name}>{material.title}</span>
        <span className={styles.meta}>
          <span>{kinds[material.kind]}</span>
          {detail && <span>{detail}</span>}
          {hidden && material.hiddenUntil && <span className={styles.hiddenTag}>{hiddenText(material.hiddenUntil)}</span>}
        </span>
        {error && (
          <span className={styles.error} role="alert">
            {error}
          </span>
        )}
      </div>
      <div className={styles.actions}>
        {hidden && (
          <Button variant="secondary" size="sm" aria-label={m.releaseNowLabel(material.title)} disabled={busy} onClick={() => void release()}>
            {messages.schedule.materials.releaseNow}
          </Button>
        )}
        {material.source === "LINK" ? (
          <a {...buttonStyle({ variant: "secondary", size: "sm" })} href={material.url} target="_blank" rel="noopener noreferrer" aria-label={m.openLabel(material.title)}>
            {m.open}
          </a>
        ) : (
          <Button variant="secondary" size="sm" aria-label={m.downloadLabel(material.title)} disabled={busy} onClick={() => void download()}>
            {m.download}
          </Button>
        )}
      </div>
    </li>
  );
}
