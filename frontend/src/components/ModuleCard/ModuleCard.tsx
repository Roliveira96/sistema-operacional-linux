"use client";

import Link from "next/link";
import { ptBR } from "@/messages/pt-BR";
import type { CourseModuleSummary } from "@/services/moduleService";
import styles from "./ModuleCard.module.scss";

interface ModuleCardProps {
  module: CourseModuleSummary;
  canManage?: boolean;
  onToggleStatus?: (module: CourseModuleSummary) => void;
}

const visibilityClassMap: Record<string, string | undefined> = {
  PUBLIC: styles.visibilityPublic,
  AUTHENTICATED: styles.visibilityAuthenticated,
  PRIVATE: styles.visibilityPrivate,
};

const statusClassMap: Record<string, string | undefined> = {
  ACTIVE: styles.statusActive,
  INACTIVE: styles.statusInactive,
  ARCHIVED: styles.statusArchived,
};

export function ModuleCard({ module, canManage, onToggleStatus }: ModuleCardProps) {
  const m = ptBR.modules;

  const isExpired = module.status === "ACTIVE" && !module.isActiveNow;

  return (
    <article className={styles.card} data-testid={`module-card-${module.id}`}>
      <header className={styles.header}>
        <div className={styles.badges}>
          <span className={`${styles.badge} ${visibilityClassMap[module.visibility] || ""}`}>
            {m.visibilityBadge[module.visibility]}
          </span>
          <span className={`${styles.badge} ${statusClassMap[module.status] || ""}`}>
            {m.statusBadge[module.status]}
          </span>
          {isExpired && (
            <span className={`${styles.badge} ${styles.expired}`}>
              {m.validity.expired}
            </span>
          )}
        </div>
        <h3 className={styles.title}>{module.title}</h3>
      </header>

      <p className={styles.description}>{module.description}</p>

      {isExpired && (
        <div className={styles.expiredAlert} role="alert">
          {m.card.expiredAlert}
        </div>
      )}

      <div className={styles.counters}>
        <span className={styles.counterItem}>
          <span className={styles.counterIcon}>📚</span>
          {m.card.materialsCount(module.totalMaterials)}
        </span>
        <span className={styles.counterItem}>
          <span className={styles.counterIcon}>💻</span>
          {m.card.exercisesCount(module.totalExercises)}
        </span>
      </div>

      <footer className={styles.footer}>
        {canManage && (
          <div className={styles.actions}>
            {onToggleStatus && module.status !== "ARCHIVED" && (
              <button
                type="button"
                className={styles.toggleButton}
                onClick={() => onToggleStatus(module)}
              >
                {module.status === "ACTIVE" ? m.card.deactivate : m.card.activate}
              </button>
            )}
            <Link href={`/app/modules/${module.id}/edit`} className={styles.editLink}>
              {m.card.edit}
            </Link>
          </div>
        )}
      </footer>
    </article>
  );
}
