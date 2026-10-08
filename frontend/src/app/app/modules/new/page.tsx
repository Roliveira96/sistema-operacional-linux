"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ModuleForm } from "@/components/ModuleForm/ModuleForm";
import { ptBR } from "@/messages/pt-BR";
import { classService } from "@/services/classService";
import {
  moduleService,
  type CreateModulePayload,
  type UpdateModulePayload,
} from "@/services/moduleService";
import styles from "./page.module.scss";

export default function NewModulePage() {
  const router = useRouter();
  const m = ptBR.modules;
  const [availableClasses, setAvailableClasses] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let active = true;
    void classService
      .listClasses({ status: "ACTIVE", limit: 50 })
      .then((res) => {
        if (active) {
          setAvailableClasses(res.items.map((c) => ({ id: c.id, name: `${c.name} (${c.semester})` })));
        }
      })
      .catch(() => {
        if (active) setAvailableClasses([]);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (payload: CreateModulePayload | UpdateModulePayload) => {
    await moduleService.createModule(payload as CreateModulePayload);
    router.push("/app/modules");
  };

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{m.form.newTitle}</h1>
        <p className={styles.subtitle}>{m.subtitle}</p>
      </header>

      <ModuleForm
        availableClasses={availableClasses}
        onSubmit={handleSubmit}
      />
    </main>
  );
}
