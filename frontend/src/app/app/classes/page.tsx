"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArchiveClassModal } from "@/components/ArchiveClassModal/ArchiveClassModal";
import { Button } from "@/components/Button/Button";
import { ClassCard } from "@/components/ClassCard/ClassCard";
import { messages } from "@/messages/pt-BR";
import { classService, type ClassSummary } from "@/services/classService";
import styles from "./page.module.scss";

type StatusTab = "ACTIVE" | "DRAFT" | "ARCHIVED";

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [activeTab, setActiveTab] = useState<StatusTab>("ACTIVE");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [archiveTarget, setArchiveTarget] = useState<ClassSummary | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  useEffect(() => {
    let active = true;
    void classService
      .listClasses({
        status: activeTab,
        search: search.trim() || undefined,
        limit: 50,
      })
      .then((res) => {
        if (active) setClasses(res.items);
      })
      .catch(() => {
        if (active) setClasses([]);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [activeTab, search, reloadTrigger]);

  const handleArchiveConfirm = async (reason: string) => {
    if (!archiveTarget) return;
    setIsArchiving(true);
    try {
      await classService.archiveClass(archiveTarget.id, reason);
      setArchiveTarget(null);
      setIsLoading(true);
      setReloadTrigger((prev) => prev + 1);
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleArea}>
          <h1 className={styles.title}>{messages.classes.title}</h1>
          <p className={styles.subtitle}>{messages.classes.subtitle}</p>
        </div>
        <Link href="/app/classes/new">
          <Button variant="primary">{messages.classes.newClass}</Button>
        </Link>
      </header>

      <section className={styles.filters} aria-label="Filtros de turmas">
        <div className={styles.searchBar}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder={messages.classes.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "ACTIVE"}
            className={`${styles.tab} ${activeTab === "ACTIVE" ? styles.activeTab : ""}`}
            onClick={() => setActiveTab("ACTIVE")}
          >
            {messages.classes.activeTab}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "DRAFT"}
            className={`${styles.tab} ${activeTab === "DRAFT" ? styles.activeTab : ""}`}
            onClick={() => setActiveTab("DRAFT")}
          >
            {messages.classes.draftTab}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "ARCHIVED"}
            className={`${styles.tab} ${activeTab === "ARCHIVED" ? styles.activeTab : ""}`}
            onClick={() => setActiveTab("ARCHIVED")}
          >
            {messages.classes.archivedTab}
          </button>
        </div>
      </section>

      {isLoading ? (
        <div className={styles.emptyState}>Carregando turmas...</div>
      ) : classes.length === 0 ? (
        <div className={styles.emptyState}>{messages.classes.emptyList}</div>
      ) : (
        <div className={styles.grid}>
          {classes.map((c) => (
            <ClassCard
              key={c.id}
              classGroup={c}
              onArchive={() => setArchiveTarget(c)}
            />
          ))}
        </div>
      )}

      {archiveTarget && (
        <ArchiveClassModal
          isOpen={Boolean(archiveTarget)}
          className={archiveTarget.name}
          onClose={() => setArchiveTarget(null)}
          onConfirm={handleArchiveConfirm}
          isSubmitting={isArchiving}
        />
      )}
    </main>
  );
}
