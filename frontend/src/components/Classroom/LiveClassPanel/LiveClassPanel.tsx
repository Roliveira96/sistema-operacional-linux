"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/Button/Button";
import { ButtonLink } from "@/components/Button/ButtonLink";
import { isoDate } from "@/lib/calendar";
import { messages } from "@/messages/pt-BR";
import { classroomService, type ActiveRoom, type LiveSessionSummary } from "@/services/classroomService";
import { ApiProblemError } from "@/services/httpClient";
import { scheduleService, type Session } from "@/services/scheduleService";
import { readPdfInfo } from "../SlidePresenter/pdfRenderer";
import { StudentNotesPanel } from "../StudentNotesPanel/StudentNotesPanel";
import styles from "./LiveClassPanel.module.scss";

const m = messages.classroom.panel;

const MAX_PAGES = 100;
const MAX_BYTES = 25 * 1024 * 1024;

export interface LiveClassPanelProps {
  classId: string;
  role: "teacher" | "student";
  archived: boolean;
}

interface Loaded {
  room: ActiveRoom;
  sessions: LiveSessionSummary[];
  lessons: Session[];
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** The section "Aula ao vivo" of the page of the class: start, go back to or end the class in progress, and the previous ones (SPEC-051, 3.1). */
export function LiveClassPanel({ classId, role, archived }: LiveClassPanelProps) {
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState(false);
  const [lesson, setLesson] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"start" | "end" | null>(null);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notesOf, setNotesOf] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  // The PDF chosen, once it was read; and the reading itself, which the start waits for when it is still going.
  const deck = useRef<{ file: File; pageCount: number } | null>(null);
  const reading = useRef<Promise<void>>(Promise.resolve());
  const id = useId();

  const load = useCallback(async (): Promise<Loaded> => {
    const today = new Date();
    const [room, sessions, lessons] = await Promise.all([
      classroomService.getActive(classId),
      classroomService.listSessions(classId),
      role === "teacher" && !archived
        ? scheduleService.classCalendar(classId, isoDate(today), isoDate(today)).then(
            (calendar) => calendar.sessions.filter((s) => s.classId === classId && s.date === isoDate(today) && s.status !== "CANCELED"),
            () => [] as Session[],
          )
        : Promise.resolve([] as Session[]),
    ]);
    return { room, sessions, lessons };
  }, [classId, role, archived]);

  useEffect(() => {
    let active = true;
    load().then(
      (loaded) => {
        if (!active) return;
        setData(loaded);
        setFailed(false);
      },
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [load, attempt]);

  const reload = () => load().then(setData, () => setFailed(true));
  const retry = () => {
    setFailed(false);
    setAttempt((n) => n + 1);
  };

  const readFile = async (file: File | undefined) => {
    deck.current = null;
    setFileError(null);
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return setFileError(m.errors.notPdf);
    if (file.size > MAX_BYTES) return setFileError(m.errors.tooBig);
    try {
      const { pageCount } = await readPdfInfo(file);
      if (pageCount > MAX_PAGES) return setFileError(m.errors.tooManyPages);
      deck.current = { file, pageCount };
    } catch {
      setFileError(m.errors.invalidPdf);
    }
  };
  const chooseFile = (file: File | undefined) => {
    reading.current = readFile(file);
  };

  const problemMessage = (err: unknown): string => {
    if (err instanceof ApiProblemError) {
      if (err.type === "deck-limit-exceeded") return m.errors.deckLimit;
      if (err.type === "class-archived") return m.errors.archived;
      if (err.type === "invalid-pdf") return m.errors.invalidPdf;
      if (err.type === "file-too-large") return m.errors.tooBig;
    }
    return m.errors.start;
  };

  const start = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const name = title.trim();
    if (!name) {
      setTitleError(true);
      titleRef.current?.focus();
      return;
    }
    setTitleError(false);
    setBusy("start");
    try {
      await reading.current;
      const chosen = deck.current;
      let deckId: string | undefined;
      if (chosen) {
        setUploading(true);
        deckId = (await classroomService.uploadDeck(classId, chosen.file, name, chosen.pageCount)).id;
        setUploading(false);
      }
      await classroomService.startSession(classId, { title: name, ...(deckId ? { deckId } : {}), ...(lesson ? { classSessionId: lesson } : {}) });
      router.push(`/app/classes/${classId}/live`);
    } catch (err) {
      setUploading(false);
      setFormError(problemMessage(err));
      setBusy(null);
    }
  };

  const end = async (sessionId: string) => {
    if (!window.confirm(m.endConfirm)) return;
    setBusy("end");
    setFormError(null);
    try {
      await classroomService.endSession(classId, sessionId);
      await reload();
    } catch {
      setFormError(m.errors.end);
    } finally {
      setBusy(null);
    }
  };

  const live = `/app/classes/${classId}/live`;
  const running = data?.room.hasActiveSession ? data.room.session : null;
  const finished = data?.sessions.filter((s) => s.status === "FINISHED") ?? [];

  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.title}>
        {m.title}
      </h2>

      {failed && (
        <div className={styles.error} role="alert">
          <span>{m.loadError}</span>
          <Button variant="secondary" size="sm" onClick={retry}>
            {m.retry}
          </Button>
        </div>
      )}
      {!data && !failed && <p className={styles.muted}>{m.loading}</p>}

      {data && running && (
        <div className={styles.running}>
          <p className={styles.runningTitle}>{m.running(running.title)}</p>
          <p className={styles.muted}>{m.since(time(running.startedAt))}</p>
          <div className={styles.actions}>
            {role === "teacher" ? (
              <>
                <ButtonLink href={live} variant="primary">
                  {m.back}
                </ButtonLink>
                <Button variant="danger" disabled={busy !== null} onClick={() => void end(running.id)}>
                  {busy === "end" ? m.ending : m.end}
                </Button>
              </>
            ) : (
              <ButtonLink href={live} variant="primary">
                {m.enter}
              </ButtonLink>
            )}
          </div>
        </div>
      )}

      {data && !running && role === "student" && <p className={styles.muted}>{m.none}</p>}
      {data && !running && role === "teacher" && archived && <p className={styles.muted}>{m.archived}</p>}
      {data && !running && role === "teacher" && !archived && (
        <form className={styles.form} onSubmit={(e) => void start(e)} noValidate>
          <div className={styles.field}>
            <label htmlFor={`${id}-name`} className={styles.label}>
              {m.titleLabel}
            </label>
            <input
              id={`${id}-name`}
              ref={titleRef}
              className={styles.input}
              value={title}
              placeholder={m.titlePlaceholder}
              maxLength={120}
              aria-invalid={titleError ? true : undefined}
              onChange={(e) => setTitle(e.target.value)}
            />
            {titleError && <span className={styles.fieldError}>{m.errors.titleRequired}</span>}
          </div>
          <div className={styles.field}>
            <label htmlFor={`${id}-deck`} className={styles.label}>
              {m.deckLabel}
            </label>
            <input id={`${id}-deck`} className={styles.input} type="file" accept="application/pdf,.pdf" onChange={(e) => chooseFile(e.target.files?.[0])} />
            {fileError && <span className={styles.fieldError}>{fileError}</span>}
          </div>
          <div className={styles.field}>
            <label htmlFor={`${id}-lesson`} className={styles.label}>
              {m.scheduledLabel}
            </label>
            <select id={`${id}-lesson`} className={styles.input} value={lesson} onChange={(e) => setLesson(e.target.value)}>
              <option value="">{m.scheduledNone}</option>
              {data.lessons.map((s) => (
                <option key={s.id} value={s.id}>
                  {m.scheduledOption(s.startTime, s.endTime)}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={busy !== null}>
            {uploading ? m.uploading : busy === "start" ? m.starting : m.start}
          </Button>
        </form>
      )}

      {formError && (
        <p className={styles.error} role="alert">
          {formError}
        </p>
      )}

      {data && (
        <div className={styles.previous}>
          <h3 className={styles.subtitle}>{m.previous}</h3>
          {finished.length === 0 ? (
            <p className={styles.muted}>{m.noPrevious}</p>
          ) : (
            <ul className={styles.list} aria-label={m.previous}>
              {finished.map((s) => (
                <li key={s.id} className={styles.item}>
                  <div className={styles.itemHead}>
                    <span className={styles.itemTitle}>{s.title}</span>
                    <span className={styles.muted}>{new Date(s.startedAt).toLocaleDateString("pt-BR")}</span>
                    {s.durationMinutes != null && <span className={styles.muted}>{m.duration(s.durationMinutes)}</span>}
                    {role === "student" && s.hasNotes && (
                      <Button variant="ghost" size="sm" onClick={() => setNotesOf(notesOf === s.id ? null : s.id)}>
                        {notesOf === s.id ? m.hideNotes : m.notes}
                      </Button>
                    )}
                  </div>
                  {notesOf === s.id && <StudentNotesPanel classId={classId} sessionId={s.id} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
