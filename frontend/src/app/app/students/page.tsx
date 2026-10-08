"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button/Button";
import { StudentFormModal } from "@/components/StudentFormModal/StudentFormModal";
import { StudentImportCsvModal } from "@/components/StudentImportCsvModal/StudentImportCsvModal";
import { StudentList } from "@/components/StudentList/StudentList";
import { useStudents } from "@/hooks/useStudents";
import { messages } from "@/messages/pt-BR";
import { classService, type ClassSummary } from "@/services/classService";
import styles from "./page.module.scss";

export default function StudentsPage() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [availableClasses, setAvailableClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [bannerFeedback, setBannerFeedback] = useState<string | null>(null);

  const {
    students,
    totalCount,
    page,
    perPage,
    search,
    isLoading,
    setPage,
    setSearch,
    reload,
  } = useStudents();

  useEffect(() => {
    let active = true;
    classService
      .listClasses({ status: "ACTIVE", limit: 100 })
      .then((res) => {
        if (active) {
          setAvailableClasses(
            res.items.map((c: ClassSummary) => ({
              id: c.id,
              name: `${c.name} (${c.semester})`,
            }))
          );
        }
      })
      .catch(() => {
        if (active) setAvailableClasses([]);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleCreatedSuccess = () => {
    setBannerFeedback(messages.students.form.success);
    reload();
  };

  const handleImportSuccess = () => {
    setBannerFeedback(messages.students.importModal.successSummary);
    reload();
  };

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleArea}>
          <h1 className={styles.title}>{messages.students.title}</h1>
          <p className={styles.subtitle}>{messages.students.subtitle}</p>
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => setIsImportOpen(true)}>
            {messages.students.importCsv}
          </Button>
          <Button variant="primary" onClick={() => setIsFormOpen(true)}>
            {messages.students.newStudent}
          </Button>
        </div>
      </header>

      {bannerFeedback && (
        <div className={styles.feedbackBanner} role="status">
          {bannerFeedback}
        </div>
      )}

      <section className={styles.filters} aria-label="Filtros de estudantes">
        <div className={styles.searchBar}>
          <input
            type="search"
            className={styles.searchInput}
            placeholder={messages.students.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className={styles.metaInfo}>
          {messages.students.totalCount(totalCount)}
        </div>
      </section>

      <StudentList
        students={students}
        totalCount={totalCount}
        page={page}
        perPage={perPage}
        onPageChange={setPage}
        isLoading={isLoading}
      />

      <StudentFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSuccess={handleCreatedSuccess}
        availableClasses={availableClasses}
      />

      <StudentImportCsvModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onSuccess={handleImportSuccess}
        availableClasses={availableClasses}
      />
    </main>
  );
}
