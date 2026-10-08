"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClassForm } from "@/components/ClassForm/ClassForm";
import { messages } from "@/messages/pt-BR";
import { classService, type CreateClassPayload } from "@/services/classService";
import styles from "./page.module.scss";

export default function NewClassPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (payload: CreateClassPayload) => {
    setIsSubmitting(true);
    try {
      await classService.createClass(payload);
      router.push("/app/classes");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{messages.classes.form.newTitle}</h1>
        <p className={styles.subtitle}>{messages.classes.subtitle}</p>
      </header>

      <ClassForm
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        submitLabel={messages.classes.form.submitCreate}
        cancelHref="/app/classes"
      />
    </main>
  );
}
