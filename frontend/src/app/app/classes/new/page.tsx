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
      const created = await classService.createClass(payload);
      // SPEC-041 CA-01: the next step after creating is adding the students.
      router.push(`/app/classes/${created.id}?tab=students&created=1`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{messages.classes.form.newTitle}</h1>
        <p className={styles.subtitle}>{messages.classes.form.newSubtitle}</p>
      </header>

      <ClassForm
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        submitLabel={messages.classes.form.submitCreate}
        submittingLabel={messages.classes.form.submittingCreate}
        cancelHref="/app/classes"
      />
    </main>
  );
}
