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
const since = messages.classroom.admission.since;

/** The last minutes of the exam, when the time turns to a warning (SPEC-092). */
const LAST_MINUTES_MS = 10 * 60_000;

/** How long the room waits to connect again after it fell. */
const RECONNECT_MS = 1500;

type Filter = "all" | "hands" | "waiting" | "doing" | "delivered" | "absent";

const isWaiting = (c: RoomCard) => c.waiting || (c.status === "ABSENT" && c.online);
const isDelivered = (c: RoomCard) => c.status === "SUBMITTED" || c.status === "TIME_EXPIRED" || c.status === "ENDED_BY_TEACHER";
const situationOf = (c: RoomCard) => (isWaiting(c) ? "WAITING" : c.status);

const matches: Record<Filter, (c: RoomCard) => boolean> = {
  all: () => true,
  hands: (c) => !!c.help,
  waiting: isWaiting,
  doing: (c) => c.status === "IN_PROGRESS",
  delivered: isDelivered,
  absent: (c) => c.status === "ABSENT" && !c.online,
};

/** The color of the pill of the situation; the words are always there too. */
const badgeOf: Record<string, string | undefined> = {
  IN_PROGRESS: styles.badgeDoing,
  WAITING: styles.badgeWaiting,
  SUBMITTED: styles.badgeDelivered,
  ENDED_BY_TEACHER: styles.badgeEnded,
};

/** Who needs the teacher first (SPEC-092 CA-01): the raised hand, then who is doing, waiting, delivered and absent. */
const rank = (c: RoomCard) => (c.help ? 0 : c.status === "IN_PROGRESS" ? 1 : isWaiting(c) ? 2 : isDelivered(c) ? 3 : 4);
const byNeed = (a: RoomCard, b: RoomCard) =>
  rank(a) - rank(b) || (a.help && b.help ? a.help.createdAt.localeCompare(b.help.createdAt) : 0) || a.name.localeCompare(b.name);

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
      setCards((all) => (all.some((c) => c.studentId === card.studentId) ? all.map((c) => (c.studentId === card.studentId ? card : c)) : [...all, card]));
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
          setCards(list);
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

  // the clock for the class, in another tab, hears the room through the channel of the browser: no second connection to the room (SPEC-092)
  const clockState = useMemo(
    () => ({
      type: "state",
      startedAt: started?.at ?? null,
      endsAt,
      offset,
      hands: queue.filter((h) => h.status === "OPEN").map((h) => cards.find((c) => c.studentId === h.studentId)?.name ?? ""),
    }),
    [started, endsAt, offset, queue, cards],
  );
  const channel = useRef<BroadcastChannel | null>(null);
  const lastState = useRef(clockState);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(`exam-room:${id}`);
    ch.onmessage = (e: MessageEvent<{ type?: string }>) => {
      if (e.data?.type === "hello") ch.postMessage(lastState.current);
    };
    channel.current = ch;
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [id]);
  useEffect(() => {
    lastState.current = clockState;
    channel.current?.postMessage(clockState);
  }, [clockState]);

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

  const sorted = useMemo(() => [...cards].sort(byNeed), [cards]);
  const shown = sorted.filter(matches[filter]);
  const open = cards.find((c) => c.studentId === watching) ?? null;
  const openScreen = open ? screens[open.studentId] : undefined;
  const left = Math.max(Date.parse(endsAt) - (now + offset), 0);
  const commandsOf = open ? (commands[open.studentId] ?? []) : [];

  return (
    <div className={styles.room}>
      <header className={styles.header}>
        <div className={styles.titles}>
          <p className={styles.kicker}>
            {r.title}
            <span role="status" aria-label={r.connection} className={styles.connection}>
              {connected ? "" : r.reconnecting}
            </span>
          </p>
          <h1 className={styles.title}>{assessment.title}</h1>
          {started && <p className={styles.started}>{r.startedBy(formatHour(started.at), started.name)}</p>}
        </div>
        <div className={`${styles.clock} ${left > 0 && left <= LAST_MINUTES_MS ? styles.ending : ""}`}>
          <span className={styles.clockLabel}>{r.endsIn}</span>
          <span role="timer" aria-label={r.timeLeft} className={styles.timer}>
            {countdown(left)}
          </span>
          <span className={styles.clockLabel}>{r.endsAt(formatHour(endsAt))}</span>
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => window.open(`/app/classes/${classId}/assessments/${id}/room/clock`, "_blank", "noopener")}>
            {r.openClock}
            <span className={styles.srOnly}> ({r.newWindow})</span>
          </Button>
          {!started && assessment.phase === "RUNNING" && <Button onClick={() => setStarting(true)}>{messages.assessments.page.start}</Button>}
        </div>
      </header>

      <div className={styles.pills} role="group" aria-label={r.filter}>
        {(Object.keys(matches) as Filter[]).map((f) => {
          const n = cards.filter(matches[f]).length;
          return (
            <button
              key={f}
              type="button"
              className={`${styles.pill} ${f === "hands" && n > 0 ? styles.pillHands : ""}`}
              aria-pressed={filter === f}
              onClick={() => setFilter(filter === f ? "all" : f)}
            >
              {r.pill(r.filters[f] ?? f, n)}
            </button>
          );
        })}
      </div>

      <div className={styles.body}>
        <section className={styles.students} aria-label={r.students}>
          {shown.length === 0 && cards.length > 0 && <p className={styles.muted}>{r.filterEmpty}</p>}
          <ul className={styles.grid}>
            {shown.map((c) => {
              const situation = situationOf(c);
              return (
                <li key={c.studentId}>
                  <button
                    type="button"
                    className={`${styles.card} ${c.help ? styles.hand : ""} ${watching === c.studentId ? styles.selected : ""} ${situation === "ABSENT" ? styles.absent : ""}`}
                    aria-pressed={watching === c.studentId}
                    onClick={() => watch(watching === c.studentId ? null : c.studentId)}
                  >
                    <span className={styles.cardHead}>
                      <span className={styles.name}>{c.name}</span>
                      <span className={`${styles.badge} ${badgeOf[situation] ?? ""}`}>{r.status[situation] ?? c.status}</span>
                    </span>
                    <span className={styles.meta}>
                      {c.academicId}
                      {c.online && (
                        <span className={styles.online}>
                          <span className={styles.dot} aria-hidden="true" />
                          {r.online}
                        </span>
                      )}
                      {c.status === "IN_PROGRESS" && !c.online && <span className={styles.offline}>{r.offline}</span>}
                    </span>
                    {c.status === "IN_PROGRESS" && c.total > 0 && (
                      <>
                        <span
                          role="progressbar"
                          aria-label={r.progressLabel}
                          aria-valuemin={0}
                          aria-valuenow={c.answered}
                          aria-valuemax={c.total}
                          className={styles.bar}
                        >
                          <span style={{ width: `${(100 * c.answered) / c.total}%` }} />
                        </span>
                        <span className={styles.meta}>{r.progress(c.answered, c.total, c.solved)}</span>
                      </>
                    )}
                    {c.deadlineAt && c.status === "IN_PROGRESS" && (
                      <span className={`${styles.meta} ${styles.mono}`}>{countdown(Math.max(Date.parse(c.deadlineAt) - (now + offset), 0))}</span>
                    )}
                    {c.help && (
                      <span className={styles.handNote}>
                        <span className={styles.handUp}>{r.handUp}</span>
                        {c.help.question && <span className={styles.handQuestion}>{c.help.question}</span>}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className={styles.side}>
          {open ? (
            <section className={styles.student} aria-label={open.name}>
              <div className={styles.studentHead}>
                <h2 className={styles.heading}>{open.name}</h2>
                <span className={`${styles.badge} ${badgeOf[situationOf(open)] ?? ""}`}>{r.status[situationOf(open)] ?? open.status}</span>
                <Button variant="secondary" onClick={() => watch(null)}>
                  {r.close}
                </Button>
              </div>
              {situationOf(open) === "WAITING" || open.status === "ABSENT" ? (
                <p className={styles.empty}>{r.notEntered}</p>
              ) : isDelivered(open) ? (
                <p className={styles.empty}>{r.finished}</p>
              ) : openScreen?.screen ? (
                <>
                  <p className={styles.meta}>{r.question(openScreen.position, openScreen.title)}</p>
                  <div className={styles.mirror}>
                    <TerminalMirror screen={openScreen.screen as ScreenElement} />
                  </div>
                </>
              ) : (
                <p className={styles.empty}>{r.noTerminal}</p>
              )}
              {(open.status === "IN_PROGRESS" || commandsOf.length > 0) && (
                <>
                  <h3 className={styles.subheading}>{r.commands}</h3>
                  {commandsOf.length === 0 && <p className={styles.muted}>{r.noCommands}</p>}
                  <ol aria-label={r.commands} className={styles.commands}>
                    {commandsOf.map((c, i) => (
                      <li key={`${c.executedAt}-${i}`}>
                        <span className={styles.when}>
                          {formatHour(c.executedAt)} · Q{c.position}
                        </span>{" "}
                        <code>$ {c.command}</code>
                        {c.output && <pre className={styles.output}>{c.output}</pre>}
                      </li>
                    ))}
                  </ol>
                </>
              )}
              {open.status === "IN_PROGRESS" && open.attemptId && (
                <div className={styles.danger}>
                  <Button variant="danger" onClick={() => setEnding(open)}>
                    {r.end}
                  </Button>
                </div>
              )}
            </section>
          ) : (
            <p className={styles.hint}>{r.pick}</p>
          )}

          {queue.length === 0 ? (
            <p className={styles.queueNone}>{r.queueNone}</p>
          ) : (
            <section className={styles.queue} aria-label={r.queue}>
              <h2 className={styles.heading}>{r.queue}</h2>
              <ol className={styles.requests}>
                {queue.map((h) => (
                  <li key={h.id} className={styles.request}>
                    <span className={styles.meta}>
                      <button type="button" className={styles.link} onClick={() => watch(h.studentId)}>
                        {r.helpFrom(cards.find((c) => c.studentId === h.studentId)?.name ?? "", h.position)}
                      </button>{" "}
                      · {formatHour(h.createdAt)} · {since(Math.max(0, Math.floor((now + offset - Date.parse(h.createdAt)) / 60_000)))}
                    </span>
                    {h.question && <p className={styles.question}>{h.question}</p>}
                    <div className={styles.reply}>
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
                    </div>
                  </li>
                ))}
              </ol>
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
