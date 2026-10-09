"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ModuleCard } from "@/components/ModuleCard/ModuleCard";
import { ptBR } from "@/messages/pt-BR";
import { moduleService, type CourseModuleSummary } from "@/services/moduleService";
import styles from "./page.module.scss";

export default function ModulesPage() {
  const m = ptBR.modules;
  const [modules, setModules] = useState<CourseModuleSummary[]>([]);
  const [originalModules, setOriginalModules] = useState<CourseModuleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState("");
  const [search, setSearch] = useState("");
  const [reloadTrigger, setReloadTrigger] = useState(0);

  const [isReordering, setIsReordering] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; isError?: boolean } | null>(null);

  const draggedIndexRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;

    void moduleService
      .listModules({
        status: statusFilter || undefined,
        visibility: visibilityFilter || undefined,
        search: search.trim() || undefined,
        limit: 50,
      })
      .then((res) => {
        if (active) {
          setModules(res.items);
          setOriginalModules(res.items);
        }
      })
      .catch(() => {
        if (active) {
          setModules([]);
          setOriginalModules([]);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [statusFilter, visibilityFilter, search, reloadTrigger]);

  const handleToggleStatus = async (mod: CourseModuleSummary) => {
    const newStatus = mod.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await moduleService.updateModule(mod.id, { status: newStatus });
      setReloadTrigger((prev) => prev + 1);
    } catch {
      // Ignora erro de transição
    }
  };

  const handleStartReorder = () => {
    setIsReordering(true);
    setFeedback(null);
  };

  const handleCancelReorder = () => {
    setIsReordering(false);
    setModules([...originalModules]);
    setFeedback(null);
  };

  const handleSaveOrder = async () => {
    setSavingOrder(true);
    setFeedback(null);
    try {
      const moduleIds = modules.map((item) => item.id);
      await moduleService.reorderModules(moduleIds);
      setOriginalModules([...modules]);
      setIsReordering(false);
      setFeedback({ message: m.reorderSuccess });
    } catch {
      setFeedback({ message: m.reorderError, isError: true });
    } finally {
      setSavingOrder(false);
    }
  };

  const handleDragStart = (index: number) => {
    draggedIndexRef.current = index;
  };

  const handleDragOver = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
  };

  const handleDrop = (targetIndex: number) => {
    const fromIndex = draggedIndexRef.current;
    if (fromIndex === null || fromIndex === targetIndex) return;

    const nextModules = [...modules];
    const [movedItem] = nextModules.splice(fromIndex, 1);
    if (movedItem) {
      nextModules.splice(targetIndex, 0, movedItem);
      setModules(nextModules);
    }
    draggedIndexRef.current = null;
  };

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleArea}>
          <h1 className={styles.title}>{m.title}</h1>
          <p className={styles.subtitle}>{m.subtitle}</p>
        </div>

        <div className={styles.headerActions}>
          {!isReordering ? (
            <>
              {modules.length > 1 && (
                <button
                  type="button"
                  className={styles.reorderButton}
                  onClick={handleStartReorder}
                  disabled={loading}
                >
                  {m.reorderButton}
                </button>
              )}
              <Link href="/app/modules/new" className={styles.newButton}>
                + {m.newButton}
              </Link>
            </>
          ) : (
            <div className={styles.reorderActionsGroup}>
              <button
                type="button"
                className={styles.saveButton}
                onClick={() => void handleSaveOrder()}
                disabled={savingOrder}
              >
                {savingOrder ? "Salvando…" : m.saveOrderButton}
              </button>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={handleCancelReorder}
                disabled={savingOrder}
              >
                {m.cancelOrderButton}
              </button>
            </div>
          )}
        </div>
      </header>

      {feedback && (
        <div
          className={`${styles.notice} ${feedback.isError ? styles.noticeError : styles.noticeSuccess}`}
          role="status"
        >
          {feedback.message}
        </div>
      )}

      {isReordering && (
        <div className={styles.reorderNotice} role="status">
          ℹ️ {m.reorderInstruction}
        </div>
      )}

      <section className={styles.filtersBar}>
        <div className={styles.selectsGroup}>
          <select
            className={styles.select}
            value={visibilityFilter}
            onChange={(e) => setVisibilityFilter(e.target.value)}
            aria-label="Filtro de visibilidade"
            disabled={isReordering}
          >
            <option value="">Todas as Visibilidades</option>
            <option value="PUBLIC">{m.visibilityBadge.PUBLIC}</option>
            <option value="AUTHENTICATED">{m.visibilityBadge.AUTHENTICATED}</option>
            <option value="PRIVATE">{m.visibilityBadge.PRIVATE}</option>
          </select>

          <select
            className={styles.select}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filtro de status"
            disabled={isReordering}
          >
            <option value="">Todos os Status</option>
            <option value="ACTIVE">{m.statusBadge.ACTIVE}</option>
            <option value="INACTIVE">{m.statusBadge.INACTIVE}</option>
            <option value="ARCHIVED">{m.statusBadge.ARCHIVED}</option>
          </select>
        </div>

        <input
          type="search"
          className={styles.searchInput}
          placeholder={m.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar módulos"
          disabled={isReordering}
        />
      </section>

      {loading ? (
        <div className={styles.loading}>Carregando módulos…</div>
      ) : modules.length === 0 ? (
        <div className={styles.emptyState}>{m.emptyList}</div>
      ) : (
        <section className={styles.grid}>
          {modules.map((mod, index) => (
            <ModuleCard
              key={mod.id}
              module={mod}
              href={`/app/modules/${mod.id}`}
              canManage
              onToggleStatus={handleToggleStatus}
              isReordering={isReordering}
              dragIndex={index}
              onDragStart={() => handleDragStart(index)}
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(index)}
            />
          ))}
        </section>
      )}
    </main>
  );
}
