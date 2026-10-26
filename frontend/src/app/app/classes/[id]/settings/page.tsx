"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button/Button";
import { ClassForm } from "@/components/ClassForm/ClassForm";
import type { ModulesQuery } from "@/components/ClassModulesPicker/ClassModulesPicker";
import { messages } from "@/messages/pt-BR";
import { classService, type ClassGroup, type CreateClassPayload } from "@/services/classService";
import { ApiProblemError } from "@/services/httpClient";
import { moduleService } from "@/services/moduleService";
import { scheduleService, type Meeting } from "@/services/scheduleService";
import styles from "./page.module.scss";

const m = messages.classes.settingsPage;

/** The modules come 50 at a time (SPEC-010). */
const MODULES_PAGE_SIZE = 50;

/** The ids of every module assigned to the class, page by page. */
async function assignedModuleIds(classId: string): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 1; ; page++) {
    const result = await moduleService.listModules({ classId, limit: MODULES_PAGE_SIZE, page });
    ids.push(...result.items.map((mod) => mod.id));
    if (result.items.length === 0 || page * MODULES_PAGE_SIZE >= result.total) return ids;
  }
}

/** The settings of a class: its form in tabs, with the modules of the class chosen in the Conteúdo tab (SPEC-044, SPEC-078). */
export default function ClassSettingsPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const router = useRouter();

  const [id, setId] = useState<string | null>(null);
  const [classData, setClassData] = useState<ClassGroup | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [moduleIds, setModuleIds] = useState<string[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "notFound" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadModules = useCallback((query: ModulesQuery) => moduleService.listModules(query), []);

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
    void Promise.all([classService.getClass(id), scheduleService.getMeetings(id).catch(() => [] as Meeting[]), assignedModuleIds(id)]).then(
      ([data, saved, assigned]) => {
        if (!active) return;
        setClassData(data);
        setMeetings(saved);
        setModuleIds(assigned);
        setState("ready");
      },
      (error: unknown) => {
        if (!active) return;
        setState(error instanceof ApiProblemError && error.type === "class-not-found" ? "notFound" : "failed");
      },
    );
    return () => {
      active = false;
    };
  }, [id, attempt]);

  const handleSubmit = async (payload: CreateClassPayload, edited?: Meeting[], chosenModules?: string[]) => {
    if (!id) return;
    setIsSubmitting(true);
    try {
      await classService.updateClass(id, payload);
      // The editor sends nothing when every meeting was removed, which clears the saved ones (SPEC-042 RN-01).
      if (edited?.length || meetings.length) await scheduleService.replaceMeetings(id, edited ?? []);
      // The set of modules is sent only when the teacher changed it (SPEC-078).
      if (chosenModules) await moduleService.setClassModules(id, chosenModules);
      router.push(`/app/classes/${id}?saved=1`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (state === "loading") {
    return (
      <main className={styles.container}>
        <div role="status" aria-label={m.loading} aria-busy="true" className={styles.skeleton}>
          <span className={styles.skeletonTitle} aria-hidden="true" />
          <span className={styles.skeletonTabs} aria-hidden="true" />
          <span className={styles.skeletonField} aria-hidden="true" />
          <span className={styles.skeletonField} aria-hidden="true" />
          <span className={styles.skeletonField} aria-hidden="true" />
        </div>
      </main>
    );
  }

  if (state === "notFound") {
    return (
      <main className={styles.state}>
        <p>{m.notFound}</p>
        <Link href="/app/classes" className={styles.back}>
          {m.backToClasses}
        </Link>
      </main>
    );
  }

  if (state === "failed" || !classData) {
    return (
      <main className={styles.state}>
        <p role="alert">{m.loadError}</p>
        <div className={styles.stateActions}>
          <Button
            variant="secondary"
            onClick={() => {
              setState("loading");
              setAttempt((n) => n + 1);
            }}
          >
            {m.retry}
          </Button>
          <Link href="/app/classes" className={styles.back}>
            {m.backToClasses}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.container}>
      <Link href={`/app/classes/${classData.id}`} className={styles.back}>
        {m.back}
      </Link>
      <header className={styles.header}>
        <h1 className={styles.title}>{messages.classes.form.editTitle}</h1>
        <p className={styles.subtitle}>{classData.name}</p>
      </header>

      <ClassForm
        initialData={classData}
        initialMeetings={meetings}
        classId={classData.id}
        loadHolidays={scheduleService.holidays}
        loadModules={loadModules}
        initialModuleIds={moduleIds}
        onApplyMeetings={async (list) => {
          await scheduleService.replaceMeetings(classData.id, list);
        }}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        submitLabel={messages.classes.form.submitSave}
        submittingLabel={messages.classes.form.submittingSave}
        cancelHref={`/app/classes/${classData.id}`}
      />
    </main>
  );
}
