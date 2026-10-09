"use client";

import { useEffect, useState } from "react";
import { FooterPublic } from "@/components/FooterPublic/FooterPublic";
import { ModuleCard } from "@/components/ModuleCard/ModuleCard";
import { NavbarPublic } from "@/components/NavbarPublic/NavbarPublic";
import { contentMessages } from "@/messages/content.pt-BR";
import { ptBR } from "@/messages/pt-BR";
import { moduleService, type CourseModuleSummary } from "@/services/moduleService";
import styles from "./page.module.scss";

export default function MaterialsPage() {
  const m = ptBR.modules;
  const [modules, setModules] = useState<CourseModuleSummary[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void moduleService
      .listPublicModules({ search: search.trim() || undefined })
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
  }, [search]);

  return (
    <div className={styles.page}>
      <NavbarPublic />

      <main className={styles.main}>
        <div className={styles.container}>
          <header className={styles.header}>
            <span className={styles.seal}>{contentMessages.materialsSeal}</span>
            <h1>{m.publicTitle}</h1>
            <p>{m.publicSubtitle}</p>
            <div className={styles.searchBar}>
              <input
                type="search"
                className={styles.searchInput}
                placeholder={m.searchPlaceholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Buscar materiais"
              />
            </div>
          </header>

          {loading ? (
            <div className={styles.loading}>Carregando materiais…</div>
          ) : modules.length === 0 ? (
            <div className={styles.emptyNotice}>{m.emptyPublicList}</div>
          ) : (
            <div className={styles.grid}>
              {modules.map((mod) => (
                <ModuleCard key={mod.id} module={mod} href={`/materials/${mod.id}`} />
              ))}
            </div>
          )}
        </div>
      </main>

      <FooterPublic />
    </div>
  );
}
