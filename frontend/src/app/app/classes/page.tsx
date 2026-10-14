"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArchiveClassModal } from "@/components/ArchiveClassModal/ArchiveClassModal";
import { ButtonLink } from "@/components/Button/ButtonLink";
import { ClassCard } from "@/components/ClassCard/ClassCard";
import { DeleteClassModal } from "@/components/DeleteClassModal/DeleteClassModal";
import { messages } from "@/messages/pt-BR";
import { classService, type ClassSummary } from "@/services/classService";
import { ApiProblemError } from "@/services/httpClient";
import styles from "./page.module.scss";

type StatusTab = "ACTIVE" | "DRAFT" | "ARCHIVED";

function IconSearch() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconEmptyFolder() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [activeTab, setActiveTab] = useState<StatusTab>("ACTIVE");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [archiveTarget, setArchiveTarget] = useState<ClassSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClassSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  const closeDelete = () => {
    setDeleteTarget(null);
    setDeleteError(null);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await classService.deleteClass(deleteTarget.id);
      setDeleteTarget(null);
      setNotice(messages.classes.deleteModal.successMessage);
      setIsLoading(true);
      setReloadTrigger((prev) => prev + 1);
    } catch (err) {
      const notDeletable = err instanceof ApiProblemError && err.type === "class-not-deletable";
      setDeleteError(notDeletable ? messages.classes.deleteModal.errors.notDeletable : messages.classes.deleteModal.errors.generic);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleArea}>
          <div className={styles.headlineRow}>
            <h1 className={styles.title}>{messages.classes.title}</h1>
            <span className={styles.counterBadge}>
              {classes.length} {classes.length === 1 ? "turma" : "turmas"}
            </span>
          </div>
          <p className={styles.subtitle}>{messages.classes.subtitle}</p>
        </div>

        <ButtonLink href="/app/classes/new" variant="primary">
          <IconPlus />
          <span>{messages.classes.newClass}</span>
        </ButtonLink>
      </header>

      <section className={styles.filters} aria-label="Filtros de turmas">
        <div className={styles.searchBar}>
          <span className={styles.searchIcon} aria-hidden="true">
            <IconSearch />
          </span>
          <input
            type="search"
            className={styles.searchInput}
            placeholder={messages.classes.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={messages.classes.searchPlaceholder}
          />
          {search && (
            <button
              type="button"
              className={styles.clearSearchBtn}
              onClick={() => setSearch("")}
              title="Limpar busca"
              aria-label="Limpar busca"
            >
              &times;
            </button>
          )}
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
        <div className={styles.emptyState}>
          <div className={styles.spinner} aria-hidden="true" />
          <span>Carregando turmas...</span>
        </div>
      ) : classes.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon} aria-hidden="true">
            <IconEmptyFolder />
          </div>
          <h2 className={styles.emptyTitle}>{messages.classes.emptyList}</h2>
          <p className={styles.emptyDescription}>
            {search
              ? "Nenhum resultado corresponde à sua pesquisa. Tente usar outros termos."
              : "Comece cadastrando sua primeira turma para gerenciar membros, materiais e avaliações."}
          </p>
          {search ? (
            <button
              type="button"
              className={styles.emptyAction}
              onClick={() => setSearch("")}
            >
              Limpar busca
            </button>
          ) : (
            <Link href="/app/classes/new" className={styles.emptyAction}>
              {messages.classes.newClass}
            </Link>
          )}
        </div>
      ) : (
        <div className={styles.grid}>
          {classes.map((c) => (
            <ClassCard
              key={c.id}
              classGroup={c}
              onArchive={() => setArchiveTarget(c)}
              onDelete={() => {
                setNotice(null);
                setDeleteTarget(c);
              }}
            />
          ))}
        </div>
      )}

      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      {deleteTarget && (
        <DeleteClassModal
          isOpen
          className={deleteTarget.name}
          onClose={closeDelete}
          onConfirm={handleDeleteConfirm}
          isSubmitting={isDeleting}
          error={deleteError}
        />
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

