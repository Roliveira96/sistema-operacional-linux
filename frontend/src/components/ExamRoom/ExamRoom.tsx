"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AssessmentDialog } from "@/components/AssessmentDialog/AssessmentDialog";
import dialog from "@/components/AssessmentDialog/AssessmentDialog.module.scss";
import { AssessmentStartDialog } from "@/components/AssessmentStartDialog/AssessmentStartDialog";
import { Button } from "@/components/Button/Button";
import { browserNotice, type BrowserNotice } from "@/components/Classroom/notices/browserNotice";
import { webAudioBeep, type BeepKind } from "@/components/Classroom/TeacherPanel/TeacherPanel";
import { TerminalMirror } from "@/components/Classroom/TerminalMirror/TerminalMirror";
import type { ScreenElement } from "@/engine/terminalScreen";
import { countdown, formatHour } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import { assessmentService, describeAssessmentError, type AssessmentDetail, type HelpItem, type RoomCard, type RoomCommand } from "@/services/assessmentService";
import styles from "./ExamRoom.module.scss";

const r = messages.assessments.room;

/** How long the room waits to connect again after it fell. */
const RECONNECT_MS = 1500;

type Filter = "all" | "waiting" | "doing" | "delivered" | "absent";

const isWaiting = (c: RoomCard) => c.waiting || (c.status === "ABSENT" && c.online);
const isDelivered = (c: RoomCard) => c.status === "SUBMITTED" || c.status === "TIME_EXPIRED" || c.status === "ENDED_BY_TEACHER";
const situationOf = (c: RoomCard) => (isWaiting(c) ? "WAITING" : c.status);

const matches: Record<Filter, (c: RoomCard) => boolean> = {
  all: () => true,
  waiting: isWaiting,
  doing: (c) => c.status === "IN_PROGRESS",
  delivered: isDelivered,
  absent: (c) => c.status === "ABSENT" && !c.online,
};

interface Screen {
  position: number;
  title: string;
  screen: unknown;
}

export interface ExamRoomProps {
  classId: string;
  assessment: AssessmentDetail;
  /** The sound of a hand that goes up (SPEC-062); a test puts a double here. */
  beep?: (kind: BeepKind) => void;
  /** The notices of the browser (SPEC-064); a test puts a double here. */
  notice?: BrowserNotice;
}

/**
 * The room of the exam for the teacher (SPEC-091): the header with the time and the counters and the start, a card for each student, the queue of
 * help and, for the student opened, the terminal live and the commands. Everything comes from the room of the server; the teacher only asks to watch
 * a student, answers a request and ends the exam of a student.
 */
export function ExamRoom({ classId, assessment, beep = webAudioBeep, notice = browserNotice }: ExamRoomProps) {
  const id = assessment.id;
  const [connected, setConnected] = useState(false);
  const [started, setStarted] = useState<{ at: string; name: string } | null>(
    assessment.startedAt ? { at: assessment.startedAt, name: assessment.startedByName ?? "" } : null,
  );
  const [cards, setCards] = useState<RoomCard[]>([]);
  const [queue, setQueue] = useState<HelpItem[]>([]);
  const [watching, setWatching] = useState<string | null>(null);
  const [screens, setScreens] = useState<Record<string, Screen>>({});
  const [commands, setCommands] = useState<Record<string, RoomCommand[]>>({});
  const [endsAt, setEndsAt] = useState(assessment.endsAt);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<Filter>("all");
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState<RoomCard | null>(null);
  const [reason, setReason] = useState("");
  const [endError, setEndError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const socket = useRef<ReturnType<typeof assessmentService.openRoom> | null>(null);
  const seenHelp = useRef<Set<string> | null>(null);
  const names = useRef(new Map<string, string>());
  const tell = useRef({ beep, notice });
  useEffect(() => {
    tell.current = { beep, notice };
  });

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const upsert = (card: RoomCard) => {
      names.current.set(card.studentId, card.name);
      setCards((all) => {
        const next = all.some((c) => c.studentId === card.studentId) ? all.map((c) => (c.studentId === card.studentId ? card : c)) : [...all, card];
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });
    };
    const takeQueue = (list: HelpItem[]) => {
      // a request that was not known before is news: the sound and, with the page out of view, the notice of the browser (SPEC-062, SPEC-064)
      const fresh = seenHelp.current ? list.filter((h) => !seenHelp.current!.has(h.id)) : [];
      seenHelp.current = new Set([...(seenHelp.current ?? []), ...list.map((h) => h.id)]);
      if (fresh.length > 0) {
        tell.current.beep("hand");
        const n = tell.current.notice;
        if (n.permission() === "granted" && !n.inView()) {
          const first = fresh[0]!;
          n.show({ title: r.notice.title, body: r.notice.body(names.current.get(first.studentId) ?? "", first.question), tag: `help-${id}` });
        }
      }
      setQueue(list);
    };
    const handle = (type: string, data: Record<string, unknown>) => {
      switch (type) {
        case "room:snapshot": {
          const list = (data.cards as RoomCard[]) ?? [];
          list.forEach((c) => names.current.set(c.studentId, c.name));
          setCards([...list].sort((a, b) => a.name.localeCompare(b.name)));
          seenHelp.current = null;
          takeQueue((data.queue as HelpItem[]) ?? []);
          if (typeof data.startedAt === "string") setStarted({ at: data.startedAt, name: String(data.startedByName ?? "") });
          if (typeof data.endsAt === "string") setEndsAt(data.endsAt);
          if (typeof data.serverNow === "string") setOffset(Date.parse(data.serverNow) - Date.now());
          if (typeof data.watching === "string") setWatching(data.watching);
          break;
        }
        case "room:student":
          upsert(data as unknown as RoomCard);
          break;
        case "room:started":
          setStarted({ at: String(data.startedAt ?? ""), name: String(data.startedByName ?? "") });
          break;
        case "help:queue":
          takeQueue((data.queue as HelpItem[]) ?? []);
          break;
        case "room:commands":
          setCommands((all) => ({ ...all, [String(data.studentId)]: [...((data.commands as RoomCommand[]) ?? [])].reverse() }));
          break;
        case "room:command": {
          const student = String(data.studentId);
          setCommands((all) => ({ ...all, [student]: [data.command as RoomCommand, ...(all[student] ?? [])] }));
          break;
        }
        case "room:screen":
          setScreens((all) => ({ ...all, [String(data.studentId)]: { position: Number(data.position), title: String(data.title ?? ""), screen: data.screen } }));
          break;
      }
    };
    const connect = () => {
      socket.current = assessmentService.openRoom(classId, id, {
        onOpen: () => alive && setConnected(true),
        onMessage: (m) => alive && handle(m.type, (m.data ?? {}) as Record<string, unknown>),
        onClose: () => {
          if (!alive) return;
          setConnected(false);
          timer = setTimeout(connect, RECONNECT_MS);
        },
      });
    };
    connect();
    return () => {
      alive = false;
      clearTimeout(timer);
      socket.current?.close();
    };
  }, [classId, id]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const watch = (studentId: string | null) => {
    setWatching(studentId);
    socket.current?.send("room:watch", { studentId });
  };
  const answer = (h: HelpItem) => {
    socket.current?.send("help:answer", { requestId: h.id, answer: answers[h.id] ?? "" });
    setAnswers((all) => ({ ...all, [h.id]: "" }));
  };
  const start = async () => {
    const got = await assessmentService.start(classId, id);
    if (got.startedAt) setStarted({ at: got.startedAt, name: got.startedByName ?? "" });
    setStarting(false);
  };
  const end = async () => {
    if (!ending?.attemptId) return;
    setEndError(null);
    try {
      await assessmentService.endAttempt(classId, id, ending.attemptId, reason.trim());
      setEnding(null);
      setReason("");
    } catch (cause) {
      setEndError(describeAssessmentError(cause));
    }
  };

  const counts = useMemo(
    () => ({
      waiting: cards.filter(isWaiting).length,
      doing: cards.filter((c) => c.status === "IN_PROGRESS").length,
      delivered: cards.filter(isDelivered).length,
    }),
    [cards],
  );
  const open = cards.find((c) => c.studentId === watching) ?? null;
  const openScreen = open ? screens[open.studentId] : undefined;
  const left = Math.max(Date.parse(endsAt) - (now + offset), 0);

  return (
    <div className={styles.room}>
      <header className={styles.header}>
        <div className={styles.titles}>
          <p className={styles.kicker}>{r.title}</p>
          <h1 className={styles.title}>{assessment.title}</h1>
          {started && <p className={styles.started}>{r.startedBy(formatHour(started.at), started.name)}</p>}
        </div>
        <span role="timer" aria-label={r.timeLeft} className={styles.timer}>
          {countdown(left)}
        </span>
        <ul className={styles.counters}>
          <li>{r.counters.waiting(counts.waiting)}</li>
          <li>{r.counters.doing(counts.doing)}</li>
          <li>{r.counters.delivered(counts.delivered)}</li>
          <li>{r.counters.hands(queue.length)}</li>
        </ul>
        <span role="status" aria-label={r.connection} className={styles.connection}>
          {connected ? "" : r.reconnecting}
        </span>
        {!started && assessment.phase === "RUNNING" && <Button onClick={() => setStarting(true)}>{messages.assessments.page.start}</Button>}
      </header>

      <div className={styles.body}>
        <section className={styles.students} aria-label={r.students}>
          <label className={styles.filter}>
            {r.filter}{" "}
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              {(Object.keys(matches) as Filter[]).map((f) => (
                <option key={f} value={f}>
                  {r.filters[f]}
                </option>
              ))}
            </select>
          </label>
          <ul className={styles.grid}>
            {cards.filter(matches[filter]).map((c) => (
              <li key={c.studentId}>
                <button
                  type="button"
                  className={`${styles.card} ${c.help ? styles.hand : ""} ${watching === c.studentId ? styles.selected : ""}`}
                  aria-pressed={watching === c.studentId}
                  onClick={() => watch(watching === c.studentId ? null : c.studentId)}
                >
                  <span className={styles.name}>{c.name}</span>
                  <span className={styles.meta}>{c.academicId}</span>
                  <span className={styles.situation}>
                    {r.status[situationOf(c)] ?? c.status}
                    {c.status === "IN_PROGRESS" && !c.online ? ` · ${r.offline}` : ""}
                  </span>
                  {c.total > 0 && <span className={styles.meta}>{r.progress(c.answered, c.total, c.solved)}</span>}
                  {c.deadlineAt && c.status === "IN_PROGRESS" && <span className={styles.meta}>{countdown(Math.max(Date.parse(c.deadlineAt) - (now + offset), 0))}</span>}
                  {c.help && <span className={styles.handNote}>{c.help.question ? `${r.handUp}: ${c.help.question}` : r.handUp}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <aside className={styles.side}>
          <section className={styles.queue} aria-label={r.queue}>
            <h2 className={styles.heading}>{r.queue}</h2>
            {queue.length === 0 && <p className={styles.muted}>{r.queueEmpty}</p>}
            <ol className={styles.requests}>
              {queue.map((h) => (
                <li key={h.id} className={styles.request}>
                  <span className={styles.meta}>
                    {r.helpFrom(cards.find((c) => c.studentId === h.studentId)?.name ?? "", h.position)} · {formatHour(h.createdAt)}
                  </span>
                  {h.question && <p className={styles.question}>{h.question}</p>}
                  <textarea
                    aria-label={r.answerLabel}
                    maxLength={300}
                    rows={2}
                    value={answers[h.id] ?? ""}
                    onChange={(e) => setAnswers((all) => ({ ...all, [h.id]: e.target.value }))}
                  />
                  <Button variant="secondary" onClick={() => answer(h)}>
                    {r.answered}
                  </Button>
                </li>
              ))}
            </ol>
          </section>

          {open && (
            <section className={styles.student} aria-label={open.name}>
              <div className={styles.studentHead}>
                <h2 className={styles.heading}>{open.name}</h2>
                <Button variant="secondary" onClick={() => watch(null)}>
                  {r.close}
                </Button>
              </div>
              {openScreen && <p className={styles.meta}>{r.question(openScreen.position, openScreen.title)}</p>}
              <div className={styles.mirror}>
                {openScreen?.screen ? <TerminalMirror screen={openScreen.screen as ScreenElement} /> : <p className={styles.muted}>{r.noTerminal}</p>}
              </div>
              <h3 className={styles.subheading}>{r.commands}</h3>
              {(commands[open.studentId] ?? []).length === 0 && <p className={styles.muted}>{r.noCommands}</p>}
              <ol aria-label={r.commands} className={styles.commands}>
                {(commands[open.studentId] ?? []).map((c, i) => (
                  <li key={`${c.executedAt}-${i}`}>
                    <span className={styles.meta}>
                      {formatHour(c.executedAt)} · Q{c.position}
                    </span>{" "}
                    <code>$ {c.command}</code>
                    {c.output && <pre className={styles.output}>{c.output}</pre>}
                  </li>
                ))}
              </ol>
              {open.status === "IN_PROGRESS" && open.attemptId && (
                <Button variant="danger" onClick={() => setEnding(open)}>
                  {r.end}
                </Button>
              )}
            </section>
          )}
        </aside>
      </div>

      {starting && <AssessmentStartDialog assessment={assessment} onClose={() => setStarting(false)} onConfirm={start} />}
      {ending && (
        <AssessmentDialog title={r.endTitle(ending.name)} onClose={() => setEnding(null)}>
          <p>{r.endText}</p>
          <label className={dialog.field}>
            {r.endReason}
            <textarea maxLength={500} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {endError && (
            <p role="alert" className={dialog.problem}>
              {endError}
            </p>
          )}
          <div className={dialog.actions}>
            <Button variant="secondary" onClick={() => setEnding(null)}>
              {r.endBack}
            </Button>
            <Button variant="danger" disabled={reason.trim() === ""} onClick={() => void end()}>
              {r.endConfirm}
            </Button>
          </div>
        </AssessmentDialog>
      )}
    </div>
  );
}
