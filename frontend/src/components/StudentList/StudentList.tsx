"use client";

import { messages } from "@/messages/pt-BR";
import type { StudentSummary } from "@/services/studentService";
import styles from "./StudentList.module.scss";

export interface StudentListProps {
  students: StudentSummary[];
  totalCount: number;
  page: number;
  perPage: number;
  onPageChange: (newPage: number) => void;
  isLoading?: boolean;
}

export function StudentList({
  students,
  totalCount,
  page,
  perPage,
  onPageChange,
  isLoading = false,
}: StudentListProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyMessage}>Carregando estudantes...</div>
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyMessage}>{messages.students.noStudents}</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.avatarCell}>{messages.students.table.avatar}</th>
              <th>{messages.students.table.academicId}</th>
              <th>{messages.students.table.name}</th>
              <th>{messages.students.table.email}</th>
              <th>{messages.students.table.whatsapp}</th>
              <th>{messages.students.table.discord}</th>
              <th>{messages.students.table.totalClasses}</th>
              <th>{messages.students.table.createdAt}</th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => {
              const initials = (student.name || student.email || "A")
                .substring(0, 2)
                .toUpperCase();

              return (
                <tr key={student.id}>
                  <td className={styles.avatarCell}>
                    {student.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={student.avatarUrl}
                        alt={student.name || student.academicId}
                        className={styles.avatar}
                      />
                    ) : (
                      <div className={styles.avatarPlaceholder}>{initials}</div>
                    )}
                  </td>
                  <td>
                    <span className={styles.academicId}>{`a${student.academicId}`}</span>
                  </td>
                  <td>{student.name || "—"}</td>
                  <td>{student.email}</td>
                  <td>{student.whatsapp || "—"}</td>
                  <td>{student.discord || "—"}</td>
                  <td>
                    <span>{student.totalClassesEnrolled}</span>
                    {student.totalClassesEnrolled === 0 && (
                      <div>
                        <span className={styles.badgeNoClass}>
                          {messages.students.noClassBadge}
                        </span>
                      </div>
                    )}
                  </td>
                  <td>
                    {new Date(student.createdAt).toLocaleDateString("pt-BR")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={styles.pagination}>
        <div className={styles.pageInfo}>
          {messages.students.pagination.pageInfo(page, totalPages)}
        </div>
        <div className={styles.pageButtons}>
          <button
            type="button"
            className={styles.pageBtn}
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
          >
            {messages.students.pagination.previous}
          </button>
          <button
            type="button"
            className={styles.pageBtn}
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
          >
            {messages.students.pagination.next}
          </button>
        </div>
      </div>
    </div>
  );
}
