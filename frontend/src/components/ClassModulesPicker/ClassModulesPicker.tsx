"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import type { ListModulesResult } from "@/services/moduleService";
import styles from "./ClassModulesPicker.module.scss";

const m = messages.classes.modules;

/** The modules come 50 at a time (SPEC-010). */
const PAGE_SIZE = 50;

export interface ModulesQuery {
  search?: string;
  page: number;
  limit: number;
}

interface ClassModulesPickerProps {
  /** Reads a page of the modules the teacher can include; it must keep its identity between renders. */
  load: (query: ModulesQuery) => Promise<ListModulesResult>;
  /** The ids of the modules included in the class, among all the pages. */
  selected: string[];
  onChange: (ids: string[]) => void;
}

/**
 * The modules of a class (SPEC-078 section 3.1): a list with a box for each module, a search and the pages of 50. The choice is controlled by
 * the form and only valid when it is saved.
 */
export function ClassModulesPicker({ load, selected, onChange }: ClassModulesPickerProps) {
  const titleId = useId();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListModulesResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const term = search.trim();

  useEffect(() => {
    let alive = true;
    load({ ...(term ? { search: term } : {}), page, limit: PAGE_SIZE }).then(
      (result) => {
        if (!alive) return;
        setData(result);
        setFailed(false);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [load, term, page, attempt]);

  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <section className={styles.section} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.heading}>
        {m.title}
      </h3>
      <p className={styles.help}>{m.help}</p>

      <div className={styles.tools}>
        <div className={styles.search}>
          <label htmlFor={`${titleId}-search`}>{m.search}</label>
          <input
            id={`${titleId}-search`}
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <p role="status" aria-label={m.chosenLabel} className={styles.count}>
          {m.chosen(selected.length)}
        </p>
      </div>

      {failed ? (
        <div role="alert" className={styles.problem}>
          <span>{m.loadError}</span>
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            {m.retry}
          </Button>
        </div>
      ) : !data ? (
        <p role="status" className={styles.muted}>
          {m.loading}
        </p>
      ) : data.items.length === 0 ? (
        <p className={styles.muted}>
          {term ? (
            m.empty
          ) : (
            <>
              {m.none} <Link href="/app/modules">{m.goToModules}</Link>
            </>
          )}
        </p>
      ) : (
        <>
          <ul className={styles.list} aria-label={m.list}>
            {data.items.map((mod) => (
              <li key={mod.id}>
                <label className={styles.item}>
                  <input type="checkbox" aria-label={m.include(mod.title)} checked={selected.includes(mod.id)} onChange={() => toggle(mod.id)} />
                  <span className={styles.name}>{mod.title}</span>
                  <span className={styles.badge}>{m.visibility[mod.visibility] ?? mod.visibility}</span>
                </label>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <div className={styles.pager}>
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {m.previous}
              </Button>
              <span>{m.page(page, pages)}</span>
              <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                {m.next}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
