"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ContentTab } from "@/components/ContentTab/ContentTab";
import { VersionsTab } from "@/components/VersionsTab/VersionsTab";
import { ExerciseOrderList } from "@/components/ExerciseOrderList/ExerciseOrderList";
import { ModuleForm } from "@/components/ModuleForm/ModuleForm";
import { ptBR } from "@/messages/pt-BR";
import { classService } from "@/services/classService";
import { moduleService, type CourseModuleDetails, type UpdateModulePayload } from "@/services/moduleService";
import styles from "./page.module.scss";

type Tab = "details" | "content" | "versions" | "exercises";
const TABS: Tab[] = ["details", "content", "versions", "exercises"];

export default function EditModulePage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  const m = ptBR.modules;

  const [id, setId] = useState<string | null>(null);
  const [moduleData, setModuleData] = useState<CourseModuleDetails | null>(null);
  const [availableClasses, setAvailableClasses] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  // "Voltar" from a card comes back with ?tab=content, to the list the author left.
  const [tab, setTab] = useState<Tab>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "content" ? "content" : "details",
  );
  /** Changes every time the module is saved, so the form starts again from what is stored. */
  const [formVersion, setFormVersion] = useState(0);

  useEffect(() => {
    let active = true;
    void Promise.resolve(params).then((p) => {
      if (active) setId(p.id);
    });
    return () => {
      active = false;
    };
  }, [params]);

  useEffect(() => {
    if (!id) return;
    let active = true;

    Promise.all([moduleService.getModuleById(id), classService.listClasses({ status: "ACTIVE", limit: 50 }).catch(() => ({ items: [] }))])
      .then(([mod, cls]) => {
        if (active) {
          setModuleData(mod);
          setAvailableClasses(cls.items.map((c) => ({ id: c.id, name: `${c.name} (${c.semester})` })));
        }
      })
      .catch(() => {
        if (active) setModuleData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [id]);

  // Saves and stays on the page, so the next change (or the content, soon) is one click away.
  const handleSubmit = useCallback(
    async (payload: UpdateModulePayload) => {
      if (!id) return;
      setSaved(false);
      await moduleService.updateModule(id, payload);
      setModuleData(await moduleService.getModuleById(id));
      setFormVersion((v) => v + 1);
      setSaved(true);
    },
    [id],
  );

  const handleReorder = async (orderedIds: string[]) => {
    if (!id) return;
    await moduleService.reorderExercises(id, orderedIds);
  };

  if (loading) {
    return (
      <main className={styles.container}>
        <div className={styles.loading}>Carregando módulo…</div>
      </main>
    );
  }

  if (!moduleData) {
    return (
      <main className={styles.container}>
        <div className={styles.notFound}>Módulo não encontrado.</div>
      </main>
    );
  }

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <Link href="/app/modules" className={styles.back}>
          {m.form.back}
        </Link>
        <div className={styles.titleRow}>
          <div className={styles.titleArea}>
            <h1 className={styles.title}>{m.form.editTitle}</h1>
            <p className={styles.subtitle}>{moduleData.title}</p>
          </div>
          <div className={styles.badges}>
            <span className={styles.badge} data-status={moduleData.status}>
              {m.statusBadge[moduleData.status]}
            </span>
            <span className={styles.badge}>{m.visibilityBadge[moduleData.visibility]}</span>
          </div>
        </div>
      </header>

      {saved && (
        <div className={styles.success} role="status">
          {m.form.successUpdate}
        </div>
      )}

      <div role="tablist" aria-label={m.tabs.label} className={styles.tabs}>
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            className={styles.tab}
            onClick={() => setTab(key)}
          >
            {m.tabs[key]}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="panel-details" aria-labelledby="tab-details" hidden={tab !== "details"}>
        <ModuleForm key={formVersion} initialData={moduleData} availableClasses={availableClasses} onSubmit={handleSubmit} isEditing />
      </div>

      <section className={styles.section} role="tabpanel" id="panel-content" aria-labelledby="tab-content" hidden={tab !== "content"}>
        {id && <ContentTab moduleId={id} />}
      </section>

      <section className={styles.section} role="tabpanel" id="panel-versions" aria-labelledby="tab-versions" hidden={tab !== "versions"}>
        {id && tab === "versions" && <VersionsTab moduleId={id} />}
      </section>

      <section className={styles.section} role="tabpanel" id="panel-exercises" aria-labelledby="tab-exercises" hidden={tab !== "exercises"}>
        <ExerciseOrderList exercises={moduleData.exerciseItems || []} onSaveOrder={handleReorder} />
      </section>
    </main>
  );
}
