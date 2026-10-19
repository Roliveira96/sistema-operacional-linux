"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import type { LiveTerminalCommand } from "@/services/classroomService";
import type { DiaryLiveSession, Session, SessionDiary as Diary } from "@/services/scheduleService";
import { hasContentToShow, SessionContentView } from "./SessionContentView";
import styles from "./SessionDiary.module.scss";

const m = messages.schedule.diary;

export interface SessionDiaryProps {
  classId: string;
  session: Session;
  role: "teacher" | "student";
  /** Reads the diary of the lesson (SPEC-073 RN-04). */
  load: (session: Session) => Promise<Diary>;
  /** Reads the commands the teacher ran in a live class, when it is expanded. */
  loadCommands: (liveSessionId: string) => Promise<LiveTerminalCommand[]>;
  /** The content of the lesson is shown too; the panel of the day that already shows it apart asks for false. */
  showContent?: boolean;
  /** A diary with nothing in it says so: the cards of the timeline ask for it (SPEC-073 CA-12); the panel of the day does not. */
  showEmpty?: boolean;
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; diary: Diary };

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/**
 * The diary of a lesson (SPEC-073, 3.1): the notes of the teacher (the private ones only to him), the content, and the live classes linked to the
 * lesson with the commands the teacher ran, which are read when a live class is expanded. It is the same in the panel of the day and in the cards of
 * the timeline.
 */
export function SessionDiary({ session, role, load, loadCommands, showContent = true, showEmpty = false }: SessionDiaryProps) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    load(session).then(
      (diary) => active && setState({ kind: "ready", diary }),
      () => active && setState({ kind: "error" }),
    );
    return () => {
      active = false;
    };
  }, [session, load]);

  if (state.kind === "loading") return <p className={styles.muted}>{m.loading}</p>;
  if (state.kind === "error") return <p className={styles.muted}>{m.loadError}</p>;

  const { content, liveSessions } = state.diary;
  const privateNotes = role === "teacher" ? (content.teacherPrivateNotes ?? "") : "";
  const empty = !content.teacherNotes && !privateNotes && !(showContent && hasContentToShow(content)) && liveSessions.length === 0;
  if (empty && showEmpty) return <p className={styles.muted}>{m.nothing}</p>;
  return (
    <div className={styles.diary}>
      {content.teacherNotes && (
        <section className={styles.section}>
          <h4 className={styles.heading}>{m.notes}</h4>
          {/* HTML filtered by the server when it was saved (SPEC-073 RN-03). */}
          <div className={styles.text} dangerouslySetInnerHTML={{ __html: content.teacherNotes }} />
        </section>
      )}
      {privateNotes && (
        <section className={styles.section}>
          <div className={styles.headingRow}>
            <h4 className={styles.heading}>{m.privateNotes}</h4>
            <span className={styles.tag}>{m.onlyYou}</span>
          </div>
          <div className={styles.text} dangerouslySetInnerHTML={{ __html: privateNotes }} />
        </section>
      )}
      {showContent && hasContentToShow(content) && <SessionContentView content={content} />}
      {liveSessions.length > 0 && (
        <section className={styles.section}>
          <h4 className={styles.heading}>{m.liveSessions}</h4>
          <ul className={styles.rooms}>
            {liveSessions.map((room) => (
              <LiveRoom key={room.id} room={room} loadCommands={loadCommands} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** A live class linked to the lesson: its title, when it was, and its commands, read when it is expanded. */
function LiveRoom({ room, loadCommands }: { room: DiaryLiveSession; loadCommands: (liveSessionId: string) => Promise<LiveTerminalCommand[]> }) {
  const [open, setOpen] = useState(false);
  const [commands, setCommands] = useState<LiveTerminalCommand[] | null>(null);
  const [failed, setFailed] = useState(false);
  const listId = useId();

  useEffect(() => {
    if (!open || commands !== null) return;
    let active = true;
    loadCommands(room.id).then(
      (list) => active && setCommands(list),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [open, commands, loadCommands, room.id]);

  const when = room.status === "ACTIVE" ? m.inProgress : m.duration(room.durationMinutes);
  return (
    <li className={styles.room}>
      <div className={styles.roomHead}>
        <span className={styles.roomTitle}>{room.title}</span>
        <span className={styles.muted}>{timeOf(room.startedAt)}</span>
        <span className={styles.muted}>{when}</span>
        {room.commandCount > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => {
              setFailed(false);
              setOpen((v) => !v);
            }}
          >
            {open ? m.hideCommands : m.showCommands(room.commandCount)}
          </Button>
        ) : (
          <span className={styles.muted}>{m.noCommands}</span>
        )}
      </div>
      {open && failed && <p className={styles.muted}>{m.commandsError}</p>}
      {open && !failed && commands === null && <p className={styles.muted}>{m.commandsLoading}</p>}
      {open && commands !== null && (
        <ol id={listId} className={styles.commands} aria-label={m.commandsOf(room.title)}>
          {commands.map((command, index) => (
            <CommandItem key={`${command.ranAt}-${index}`} command={command} />
          ))}
        </ol>
      )}
    </li>
  );
}

/** One command: the terminal, the line (to copy), the exit status and the output, folded. */
function CommandItem({ command }: { command: LiveTerminalCommand }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    void navigator.clipboard?.writeText(command.command).then(
      () => setCopied(true),
      () => undefined,
    );
  };

  const status =
    command.exitStatus === null ? (
      <span className={`${styles.status} ${styles.statusNone}`}>{m.interrupted}</span>
    ) : command.exitStatus === 0 ? (
      <span className={`${styles.status} ${styles.statusOk}`}>{m.exitOk}</span>
    ) : (
      <span className={`${styles.status} ${styles.statusError}`}>{m.exitError(command.exitStatus)}</span>
    );

  return (
    <li className={styles.command}>
      <div className={styles.commandRow}>
        <span className={styles.terminal}>{m.terminal(command.terminal)}</span>
        <code className={styles.line}>{command.command}</code>
        {status}
        <Button variant="ghost" size="sm" onClick={copy}>
          {copied ? m.copied : m.copy}
        </Button>
        {command.output && (
          <Button variant="ghost" size="sm" aria-expanded={shown} onClick={() => setShown((v) => !v)}>
            {shown ? m.hideOutput : m.showOutput}
          </Button>
        )}
      </div>
      {shown && (
        <pre className={styles.output}>
          {command.output}
          {command.outputTruncated && <span className={styles.muted}>{m.truncated}</span>}
        </pre>
      )}
    </li>
  );
}
