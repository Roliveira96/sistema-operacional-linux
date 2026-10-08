"use client";

import { useState, useEffect, useCallback } from "react";
import { moduleService, type CourseModuleSummary } from "@/services/moduleService";

interface UseModulesOptions {
  isPublic?: boolean;
  initialLimit?: number;
}

export function useModules(options: UseModulesOptions = {}) {
  const [modules, setModules] = useState<CourseModuleSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(options.initialLimit || 10);
  const [status, setStatus] = useState<string>("");
  const [visibility, setVisibility] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [classId, setClassId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  const reload = useCallback(() => {
    setReloadTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let active = true;

    const promise = options.isPublic
      ? moduleService.listPublicModules({ page, limit, search: search.trim() || undefined })
      : moduleService.listModules({
          page,
          limit,
          status: status || undefined,
          visibility: visibility || undefined,
          classId: classId || undefined,
          search: search.trim() || undefined,
        });

    promise
      .then((res) => {
        if (active) {
          setModules(res.items);
          setTotal(res.total);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Erro ao carregar módulos");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [options.isPublic, page, limit, status, visibility, search, classId, reloadTrigger]);

  return {
    modules,
    total,
    page,
    limit,
    status,
    visibility,
    search,
    classId,
    loading,
    error,
    setPage,
    setStatus,
    setVisibility,
    setSearch,
    setClassId,
    reload,
  };
}
