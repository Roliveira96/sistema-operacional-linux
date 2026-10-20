"use client";

import Link from "next/link";
import { useCallback } from "react";
import { ClassCalendar } from "@/components/ClassCalendar/ClassCalendar";
import { useAuth } from "@/hooks/useAuth";
import { messages } from "@/messages/pt-BR";
import { scheduleService } from "@/services/scheduleService";
import styles from "./page.module.scss";

export default function CalendarPage() {
  const { user } = useAuth();
  const load = useCallback((from: string, to: string) => {
    return scheduleService.myCalendar(from, to);
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{messages.schedule.page.title}</h1>
        <p className={styles.subtitle}>{messages.schedule.page.subtitle}</p>
        {user.role === "ADMIN" && (
          // Holidays (SPEC-042) are the administrator's alone; the link moved here from the bar.
          <Link href="/app/admin/holidays" className={styles.holidaysLink}>
            {messages.schedule.holidays.nav}
          </Link>
        )}
      </header>

      <ClassCalendar
        load={load}
        showClassFilter
        editable={false}
        classHref={(id) => `/app/classes/${id}?tab=schedule`}
        assessmentHref={(a) => `/app/classes/${a.classId}/assessments/${a.id}`}
      />
    </div>
  );
}
