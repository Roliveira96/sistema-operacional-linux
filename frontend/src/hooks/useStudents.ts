"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createStudentManual,
  importStudentsCSV,
  listStudents,
  type CSVImportResult,
  type ManualStudentInput,
  type ManualStudentResponse,
  type StudentSummary,
} from "@/services/studentService";

interface UseStudentsOptions {
  initialPerPage?: number;
  initialSearch?: string;
}

export function useStudents(options: UseStudentsOptions = {}) {
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(options.initialPerPage || 10);
  const [search, setSearch] = useState(options.initialSearch || "");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  const reload = useCallback(() => {
    setReloadTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let active = true;

    listStudents({
      page,
      perPage,
      search: search.trim() || undefined,
    })
      .then((res) => {
        if (active) {
          setError(null);
          setStudents(res.items);
          setTotalCount(res.totalCount);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Erro ao carregar estudantes"
          );
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [page, perPage, search, reloadTrigger]);

  const handleCreate = useCallback(
    async (payload: ManualStudentInput): Promise<ManualStudentResponse> => {
      const result = await createStudentManual(payload);
      reload();
      return result;
    },
    [reload]
  );

  const handleImportCSV = useCallback(
    async (file: File, classGroupId?: string): Promise<CSVImportResult> => {
      const result = await importStudentsCSV(file, classGroupId);
      reload();
      return result;
    },
    [reload]
  );

  return {
    students,
    totalCount,
    page,
    perPage,
    search,
    isLoading,
    error,
    setPage,
    setPerPage,
    setSearch,
    reload,
    createStudent: handleCreate,
    importCSV: handleImportCSV,
  };
}
