"use client";

import Link from "next/link";
import { moduleAccent, orderLabel, splitDescription } from "@/lib/moduleVisual";
import { contentMessages } from "@/messages/content.pt-BR";
import { ptBR } from "@/messages/pt-BR";
import type { CourseModuleSummary } from "@/services/moduleService";
import styles from "./ModuleCard.module.scss";

interface ModuleCardProps {
  module: CourseModuleSummary;
  /** Reading page of the module (SPEC-012); shows a "study" link when set. */
  href?: string;
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

/** Module card in the layout of the prototype menu (SPEC-015). */
export function ModuleCard({ module, href, canManage, onToggleStatus }: ModuleCardProps) {
  const m = ptBR.modules;
  const { tags, summary } = splitDescription(module.description);
  const order = orderLabel(module.displayOrder);
  const isExpired = module.status === "ACTIVE" && !module.isActiveNow;

  return (
    <article className={styles.card} style={moduleAccent(module.color)} data-testid={`module-card-${module.id}`}>
      {order && (
        <span className={styles.order} aria-hidden="true">
          {order}
        </span>
      )}
      {module.icon && (
        <span className={styles.icon} aria-hidden="true">
          {module.icon}
        </span>
      )}

      {/* Visibility and status only matter to who manages the module. */}
      {(canManage || isExpired) && (
        <div className={styles.badges}>
          {canManage && (
            <>
              <span className={`${styles.badge} ${visibilityClassMap[module.visibility] || ""}`}>
                {m.visibilityBadge[module.visibility]}
              </span>
              <span className={`${styles.badge} ${statusClassMap[module.status] || ""}`}>
                {m.statusBadge[module.status]}
              </span>
            </>
          )}
          {isExpired && <span className={`${styles.badge} ${styles.expired}`}>{m.validity.expired}</span>}
        </div>
      )}

      <h3 className={styles.title}>
        {href ? (
          <Link href={href} className={styles.titleLink}>
            {module.title}
          </Link>
        ) : (
          module.title
        )}
      </h3>

      <p className={styles.description}>{summary}</p>

      {tags.length > 0 && (
        <ul className={styles.tags} aria-label={contentMessages.cardTags}>
          {tags.map((tag) => (
            <li key={tag}>
              <code>{tag}</code>
            </li>
          ))}
        </ul>
      )}

      {isExpired && (
        <div className={styles.expiredAlert} role="alert">
          {m.card.expiredAlert}
        </div>
      )}

      <div className={styles.counters}>
        <span>{m.card.materialsCount(module.totalMaterials)}</span>
        <span aria-hidden="true">·</span>
        <span>{m.card.exercisesCount(module.totalExercises)}</span>
      </div>

      {(href || canManage) && (
        <footer className={styles.footer}>
          {href && (
            // The title link covers the whole card; this is only the visual cue.
            <span className={styles.open} aria-hidden="true">
              {contentMessages.study} →
            </span>
          )}
          {canManage && (
            <div className={styles.actions}>
              {onToggleStatus && module.status !== "ARCHIVED" && (
                <button type="button" className={styles.toggleButton} onClick={() => onToggleStatus(module)}>
                  {module.status === "ACTIVE" ? m.card.deactivate : m.card.activate}
                </button>
              )}
              <Link href={`/app/modules/${module.id}/edit`} className={styles.editLink}>
                {m.card.edit}
              </Link>
            </div>
          )}
        </footer>
      )}
    </article>
  );
}
