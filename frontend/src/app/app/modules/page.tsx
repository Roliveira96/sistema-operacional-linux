"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ModuleCard } from "@/components/ModuleCard/ModuleCard";
import { ptBR } from "@/messages/pt-BR";
import { moduleService, type CourseModuleSummary } from "@/services/moduleService";
import styles from "./page.module.scss";

export default function ModulesPage() {
  const m = ptBR.modules;
  const [modules, setModules] = useState<CourseModuleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState("");
  const [search, setSearch] = useState("");
  const [reloadTrigger, setReloadTrigger] = useState(0);

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
        if (active) setModules(res.items);
      })
      .catch(() => {
        if (active) setModules([]);
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
      // Ignora ou trata erro
    }
  };

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleArea}>
          <h1 className={styles.title}>{m.title}</h1>
          <p className={styles.subtitle}>{m.subtitle}</p>
        </div>
        <Link href="/app/modules/new" className={styles.newButton}>
          + {m.newButton}
        </Link>
      </header>

      <section className={styles.filtersBar}>
        <div className={styles.selectsGroup}>
          <select
            className={styles.select}
            value={visibilityFilter}
            onChange={(e) => setVisibilityFilter(e.target.value)}
            aria-label="Filtro de visibilidade"
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
        />
      </section>

      {loading ? (
        <div className={styles.loading}>Carregando módulos…</div>
      ) : modules.length === 0 ? (
        <div className={styles.emptyState}>{m.emptyList}</div>
      ) : (
        <section className={styles.grid}>
          {modules.map((mod) => (
            <ModuleCard
              key={mod.id}
              module={mod}
              canManage
              onToggleStatus={handleToggleStatus}
            />
          ))}
        </section>
      )}
    </main>
  );
}
