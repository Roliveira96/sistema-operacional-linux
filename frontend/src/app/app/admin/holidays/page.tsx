"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { messages } from "@/messages/pt-BR";
import { type Holiday, type HolidayScope, scheduleService } from "@/services/scheduleService";
import styles from "./page.module.scss";

export default function HolidaysPage() {
  const { user } = useAuth();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [items, setItems] = useState<Holiday[]>([]);

  // Form states
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<HolidayScope>("RECESS");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role !== "ADMIN") return;
    let active = true;
    scheduleService.holidays(year).then((data) => {
      if (active) setItems(data);
    });
    return () => {
      active = false;
    };
  }, [user?.role, year]);

  if (user?.role !== "ADMIN") {
    return (
      <div className={styles.page}>
        <div className={styles.restricted}>
          {messages.schedule.holidays.adminOnly}
        </div>
      </div>
    );
  }

  const handleToggleActive = async (h: Holiday) => {
    const updated = await scheduleService.updateHoliday(h.id, {
      date: h.date,
      name: h.name,
      scope: h.scope,
      active: !h.active,
    });
    setItems((current) => current.map((item) => (item.id === h.id ? updated : item)));
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date.trim() || !name.trim()) {
      setFormError(messages.schedule.holidays.required);
      return;
    }
    setFormError(null);
    const created = await scheduleService.createHoliday({
      date: date.trim(),
      name: name.trim(),
      scope,
      active: true,
    });
    setItems((current) => [
      ...current,
      { ...created, date: date.trim(), name: name.trim(), scope },
    ]);
    setDate("");
    setName("");
  };

  const handleDelete = async (id: string) => {
    await scheduleService.deleteHoliday(id);
    setItems((current) => current.filter((h) => h.id !== id));
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{messages.schedule.holidays.title}</h1>
        <p className={styles.subtitle}>{messages.schedule.holidays.subtitle}</p>
      </header>

      <div className={styles.yearBar}>
        <button
          type="button"
          className={styles.navBtn}
          onClick={() => setYear((y) => y - 1)}
        >
          {messages.schedule.holidays.previousYear}
        </button>
        <span className={styles.yearTitle}>{year}</span>
        <button
          type="button"
          className={styles.navBtn}
          onClick={() => setYear((y) => y + 1)}
        >
          {messages.schedule.holidays.nextYear}
        </button>
      </div>

      <form noValidate onSubmit={handleAdd} className={styles.addForm}>
        <div className={styles.field}>
          <label htmlFor="holiday-date">{messages.schedule.holidays.date}</label>
          <input
            id="holiday-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="holiday-name">{messages.schedule.holidays.name}</label>
          <input
            id="holiday-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="holiday-scope">{messages.schedule.holidays.scope}</label>
          <select
            id="holiday-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as HolidayScope)}
          >
            <option value="NATIONAL">{messages.schedule.holidays.scopes.NATIONAL}</option>
            <option value="LOCAL">{messages.schedule.holidays.scopes.LOCAL}</option>
            <option value="RECESS">{messages.schedule.holidays.scopes.RECESS}</option>
          </select>
        </div>

        <button type="submit" className={styles.addBtn}>
          {messages.schedule.holidays.add}
        </button>

        {formError && <span className={styles.error}>{formError}</span>}
      </form>

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{messages.schedule.holidays.date}</th>
              <th>{messages.schedule.holidays.name}</th>
              <th>{messages.schedule.holidays.scope}</th>
              <th>{messages.schedule.holidays.active}</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {items.map((h) => {
              const scopeLabel = messages.schedule.holidays.scopes[h.scope];
              return (
                <tr key={h.id}>
                  <td>{h.date}</td>
                  <td>{h.name}</td>
                  <td>{scopeLabel}</td>
                  <td>
                    <label>
                      <input
                        type="checkbox"
                        aria-label={messages.schedule.holidays.activeOf(h.name)}
                        checked={h.active}
                        onChange={() => handleToggleActive(h)}
                      />
                    </label>
                  </td>
                  <td>
                    {h.scope !== "NATIONAL" && (
                      <button
                        type="button"
                        className={styles.deleteBtn}
                        onClick={() => handleDelete(h.id)}
                        aria-label={messages.schedule.holidays.delete(h.name)}
                      >
                        {messages.schedule.holidays.delete(h.name)}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
