"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { ContentRenderer } from "@/components/ContentRenderer/ContentRenderer";
import { contentMessages as m } from "@/messages/content.pt-BR";
import { contentService, type ContentBlock, type ContentService, type PublicQuestion } from "@/services/contentService";
import { ApiProblemError } from "@/services/httpClient";
import { moduleService, type CourseModuleDetails } from "@/services/moduleService";
import styles from "./ModuleContentView.module.scss";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string; login: boolean }
  | { kind: "loaded"; module: CourseModuleDetails; blocks: ContentBlock[]; exercises: PublicQuestion[] };

export interface ModuleContentViewProps {
  moduleId: string;
  backHref: string;
  content?: Pick<ContentService, "blocks" | "questions">;
  modules?: Pick<typeof moduleService, "getModuleById">;
}

function describe(error: unknown): { message: string; login: boolean } {
  if (error instanceof ApiProblemError) {
    if (error.status === 404) return { message: m.notFound, login: false };
    if (error.status === 401) return { message: m.needsLogin, login: true };
    if (error.status === 403) return { message: m.forbidden, login: false };
  }
  return { message: m.unexpected, login: false };
}

/** Maps the legacy color variable (e.g. "--cor-dir") to the module accent token. */
function accent(color?: string): CSSProperties | undefined {
  const key = color?.match(/^--cor-([a-z]+)$/)?.[1];
  return key ? ({ "--module-accent": `var(--color-module-${key})` } as CSSProperties) : undefined;
}

/** Reading view of a module: blocks in order and its exercises (SPEC-012). */
export function ModuleContentView({ moduleId, backHref, content = contentService, modules = moduleService }: ModuleContentViewProps) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // The blocks endpoint applies the visibility rules and gives the clearest error.
        const blocks = await content.blocks(moduleId);
        const [module, exercises] = await Promise.all([modules.getModuleById(moduleId), content.questions(moduleId, "EXERCISE")]);
        if (active) setState({ kind: "loaded", module, blocks, exercises });
      } catch (error) {
        if (active) setState({ kind: "error", ...describe(error) });
      }
    })();
    return () => {
      active = false;
    };
  }, [moduleId, content, modules]);

  if (state.kind === "loading") {
    return (
      <p className={styles.status} role="status">
        {m.loading}
      </p>
    );
  }

  if (state.kind === "error") {
    return (
      <div className={styles.status}>
        <p role="alert">{state.message}</p>
        <div className={styles.actions}>
          {state.login && <Link href="/login">{m.goToLogin}</Link>}
          <Link href={backHref}>{m.backToMaterials}</Link>
        </div>
      </div>
    );
  }

  const { module, blocks, exercises } = state;
  return (
    <article className={styles.view} style={accent(module.color)}>
      <header className={styles.header}>
        <Link href={backHref} className={styles.back}>
          ← {m.backToMaterials}
        </Link>
        <h1 className={styles.title}>
          {module.icon && (
            <span className={styles.icon} aria-hidden="true">
              {module.icon}
            </span>
          )}
          {module.title}
        </h1>
        <p className={styles.description}>{module.description}</p>
      </header>

      <ContentRenderer blocks={blocks} />

      <section className={styles.exercises} aria-labelledby="exercises-title">
        <h2 id="exercises-title" className={styles.sectionTitle}>
          {m.exercisesTitle}
        </h2>
        {exercises.length === 0 ? (
          <p className={styles.muted}>{m.noExercises}</p>
        ) : (
          <>
            <p className={styles.muted}>{m.exercisesIntro}</p>
            <ol className={styles.exerciseList}>
              {exercises.map((q) => (
                <li key={q.id} className={styles.exercise}>
                  <span className={styles.difficulty}>{m.difficulty[q.difficulty] ?? q.difficulty}</span>
                  <div className={styles.statement} dangerouslySetInnerHTML={{ __html: q.statement }} />
                  {q.hint && (
                    <details>
                      <summary>{m.hint}</summary>
                      <div dangerouslySetInnerHTML={{ __html: q.hint }} />
                    </details>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </article>
  );
}
