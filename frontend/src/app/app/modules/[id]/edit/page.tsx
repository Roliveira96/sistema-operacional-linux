"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ExerciseOrderList } from "@/components/ExerciseOrderList/ExerciseOrderList";
import { ModuleForm } from "@/components/ModuleForm/ModuleForm";
import { ptBR } from "@/messages/pt-BR";
import { classService } from "@/services/classService";
import {
  moduleService,
  type CourseModuleDetails,
  type UpdateModulePayload,
} from "@/services/moduleService";
import styles from "./page.module.scss";

export default function EditModulePage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const router = useRouter();
  const m = ptBR.modules;

  const [id, setId] = useState<string | null>(null);
  const [moduleData, setModuleData] = useState<CourseModuleDetails | null>(null);
  const [availableClasses, setAvailableClasses] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

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

    Promise.all([
      moduleService.getModuleById(id),
      classService.listClasses({ status: "ACTIVE", limit: 50 }).catch(() => ({ items: [] })),
    ])
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

  const handleSubmit = async (payload: UpdateModulePayload) => {
    if (!id) return;
    await moduleService.updateModule(id, payload);
    router.push("/app/modules");
  };

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
        <h1 className={styles.title}>{m.form.editTitle}</h1>
        <p className={styles.subtitle}>{m.subtitle}</p>
      </header>

      <section className={styles.section}>
        <ModuleForm
          initialData={moduleData}
          availableClasses={availableClasses}
          onSubmit={handleSubmit}
          isEditing
        />
      </section>

      <section className={styles.section}>
        <ExerciseOrderList
          exercises={moduleData.exerciseItems || []}
          onSaveOrder={handleReorder}
        />
      </section>
    </main>
  );
}
