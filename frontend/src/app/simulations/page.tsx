"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FooterPublic } from "@/components/FooterPublic/FooterPublic";
import { NavbarPublic } from "@/components/NavbarPublic/NavbarPublic";
import { SimulationCard } from "@/components/SimulationCard/SimulationCard";
import type { SimulationMode } from "@/data/mockContent";
import { contentMessages } from "@/messages/content.pt-BR";
import { messages } from "@/messages/pt-BR";
import { contentService, type AssessmentTemplateSummary } from "@/services/contentService";
import styles from "./page.module.scss";

function toMode(t: AssessmentTemplateSummary): SimulationMode {
  return {
    id: t.id,
    slug: t.id,
    title: t.title,
    description: t.description,
    durationMinutes: t.durationMinutes,
    questionCount: t.questionCount,
    topicsCovered: [],
  };
}

/** Assessment templates loaded from the database (SPEC-012). */
export default function SimulationsPage() {
  const router = useRouter();
  const [modes, setModes] = useState<SimulationMode[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    contentService
      .templates()
      .then((items) => active && setModes(items.map(toMode)))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className={styles.page}>
      <NavbarPublic />

      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.header}>
            <h1>{messages.public.simulations.title}</h1>
            <p>{messages.public.simulations.subtitle}</p>
          </header>

          {failed && <p role="alert">{contentMessages.unexpected}</p>}
          {!failed && modes === null && <p role="status">{contentMessages.loading}</p>}
          {modes?.length === 0 && <p>{contentMessages.simulations.empty}</p>}

          <div className={styles.grid}>
            {modes?.map((sim) => (
              // Starting an exam needs a session; the application of exams is a future spec.
              <SimulationCard key={sim.id} simulation={sim} onStart={() => router.push("/login")} />
            ))}
          </div>
        </div>
      </main>

      <FooterPublic />
    </div>
  );
}
