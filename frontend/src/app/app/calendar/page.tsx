"use client";

import { useCallback } from "react";
import { ClassCalendar } from "@/components/ClassCalendar/ClassCalendar";
import { messages } from "@/messages/pt-BR";
import { scheduleService } from "@/services/scheduleService";
import styles from "./page.module.scss";

export default function CalendarPage() {
  const load = useCallback((from: string, to: string) => {
    return scheduleService.myCalendar(from, to);
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{messages.schedule.page.title}</h1>
        <p className={styles.subtitle}>{messages.schedule.page.subtitle}</p>
      </header>

      <ClassCalendar
        load={load}
        showClassFilter
        editable={false}
        classHref={(id) => `/app/classes/${id}?tab=schedule`}
      />
    </div>
  );
}
