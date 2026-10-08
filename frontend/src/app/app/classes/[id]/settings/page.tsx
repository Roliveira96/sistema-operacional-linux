"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ClassForm } from "@/components/ClassForm/ClassForm";
import { messages } from "@/messages/pt-BR";
import { classService, type ClassGroup, type CreateClassPayload } from "@/services/classService";
import styles from "./page.module.scss";

export default function ClassSettingsPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const router = useRouter();

  const [id, setId] = useState<string | null>(null);
  const [classData, setClassData] = useState<ClassGroup | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    if ("then" in params) {
      void params.then((p) => {
        if (active) setId(p.id);
      });
    } else {
      setId(params.id);
    }
    return () => {
      active = false;
    };
  }, [params]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    void classService
      .getClass(id)
      .then((data) => {
        if (active) setClassData(data);
      })
      .catch(() => {
        if (active) setClassData(null);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  const handleSubmit = async (payload: CreateClassPayload) => {
    if (!id) return;
    setIsSubmitting(true);
    try {
      await classService.updateClass(id, payload);
      router.push("/app/classes");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <main className={styles.loading}>Carregando configurações...</main>;
  }

  if (!classData) {
    return <main className={styles.loading}>Turma não encontrada.</main>;
  }

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{messages.classes.form.editTitle}</h1>
        <p className={styles.subtitle}>{classData.name}</p>
      </header>

      <ClassForm
        initialData={classData}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        submitLabel={messages.classes.form.submitSave}
        cancelHref="/app/classes"
      />
    </main>
  );
}
