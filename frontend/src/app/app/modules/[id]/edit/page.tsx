"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ExerciseOrderList } from "@/components/ExerciseOrderList/ExerciseOrderList";
import { ModuleForm } from "@/components/ModuleForm/ModuleForm";
import { ptBR } from "@/messages/pt-BR";
import { classService } from "@/services/classService";
import { contentService, type ContentBlock } from "@/services/contentService";
import { moduleService, type CourseModuleDetails, type UpdateModulePayload } from "@/services/moduleService";
import styles from "./page.module.scss";

/** A block has no single title field: use the title, else the command, else the start of its text. */
function blockLabel(block: ContentBlock): string {
  for (const key of ["title", "command", "text", "body", "html"]) {
    const value = block.payload[key];
    if (typeof value === "string" && value.trim()) {
      const plain = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      return plain.length > 90 ? `${plain.slice(0, 90)}…` : plain;
    }
  }
  return "—";
}

export default function EditModulePage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  const m = ptBR.modules;

  const [id, setId] = useState<string | null>(null);
  const [moduleData, setModuleData] = useState<CourseModuleDetails | null>(null);
  const [availableClasses, setAvailableClasses] = useState<{ id: string; name: string }[]>([]);
  const [blocks, setBlocks] = useState<ContentBlock[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
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

  useEffect(() => {
    if (!id) return;
    let active = true;
    contentService
      .blocks(id)
      .then((list) => active && setBlocks(list))
      .catch(() => active && setBlocks([]));
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

      <ModuleForm key={formVersion} initialData={moduleData} availableClasses={availableClasses} onSubmit={handleSubmit} isEditing />

      <section className={styles.section} aria-labelledby="module-blocks-title">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="module-blocks-title" className={styles.sectionTitle}>
              {m.blocks.title}
            </h2>
            <p className={styles.sectionHint}>{m.blocks.hint}</p>
          </div>
          <Link href={`/app/modules/${id}`} className={styles.back}>
            {m.blocks.preview}
          </Link>
        </div>
        {blocks === null ? (
          <p className={styles.sectionHint}>{m.blocks.loading}</p>
        ) : blocks.length === 0 ? (
          <p className={styles.sectionHint}>{m.blocks.empty}</p>
        ) : (
          <ol className={styles.blockList}>
            {blocks.map((block) => {
              const label = blockLabel(block);
              return (
                <li key={block.id} className={styles.blockItem}>
                  <span className={styles.blockType}>{m.blocks.types[block.type as keyof typeof m.blocks.types] ?? block.type}</span>
                  <span className={styles.blockTitle}>{label}</span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className={styles.section}>
        <ExerciseOrderList exercises={moduleData.exerciseItems || []} onSaveOrder={handleReorder} />
      </section>
    </main>
  );
}
