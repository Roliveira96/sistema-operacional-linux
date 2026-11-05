"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/Button/Button";
import { StudentChat } from "@/components/ExamChat/ExamChat";
import chatStyles from "@/components/ExamChat/ExamChat.module.scss";
import { ExamRunner, type ExamRunnerRoom } from "@/components/ExamRunner/ExamRunner";
import { useAuth } from "@/hooks/useAuth";
import { useRouteParams } from "@/hooks/useRouteParams";
import { descriptionText } from "@/lib/description";
import { messages } from "@/messages/pt-BR";
import { ApiProblemError } from "@/services/httpClient";
import { assessmentService, describeAssessmentError, type ExamChatMessage, type RoomSocket, type StudentAttempt } from "@/services/assessmentService";
import styles from "../../page.module.scss";
import own from "../simulate/page.module.scss";
import take from "./page.module.scss";

const m = messages.assessments;
const t = m.take;
const r = m.room;

/** How long the window waits to connect to the room again after it fell. */
const RECONNECT_MS = 1000;

/** Why the exam cannot be entered, in the words of the student (SPEC-090 RN-01). */
function reasonOf(cause: unknown): string {
  if (cause instanceof ApiProblemError && t.errors[cause.type]) return t.errors[cause.type]!;
  return describeAssessmentError(cause);
}

type Help = { status: "NONE" | "OPEN" | "ANSWERED" | "CANCELED"; answer?: string };
type Phase = "connecting" | "waiting" | "in";

/**
 * The window of the exam of the student (SPEC-090, SPEC-091): it joins the room of the exam and waits there until the teacher starts it; then it
 * enters the attempt and shows it over the whole window. The room hears the commands, the screen while the teacher watches and the request for help,
 * and tells the end of the exam by the teacher. When the room cannot be reached the exam goes on without it. The teacher and the administrator have
 * no attempt and go back to the assessment.
 */
export default function TakePage({ params }: { params: Promise<{ id: string; assessmentId: string }> | { id: string; assessmentId: string } }) {
  const { user } = useAuth();
  const router = useRouter();
  const isStudent = user.role === "STUDENT";
  const route = useRouteParams(params);
  const classId = route?.id ?? null;
  const assessmentId = route?.assessmentId ?? null;
  const backHref = `/app/classes/${classId}/assessments/${assessmentId}`;

  const [phase, setPhase] = useState<Phase>("connecting");
  const [attempt, setAttempt] = useState<StudentAttempt | null>(null);
  const [title, setTitle] = useState("");
  // the general instructions of the exam (SPEC-094), filtered html, and whether their column is open
  const [instructions, setInstructions] = useState("");
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [help, setHelp] = useState<Help>({ status: "NONE" });
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [ended, setEnded] = useState<string | null>(null);
  const [watched, setWatched] = useState(false);
  // the conversation with the teacher (SPEC-093): the messages, whether the column is open and the new ones of the teacher while it is closed
  const [chat, setChat] = useState<ExamChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [online, setOnline] = useState(false);
  const chatOpenRef = useRef(false);
  useEffect(() => {
    chatOpenRef.current = chatOpen;
  }, [chatOpen]);

  const socket = useRef<RoomSocket | null>(null);
  const connected = useRef(false);
  /** The commands that ran while the room was away, sent again with their instant when it is back (SPEC-091 D-05). */
  const pending = useRef<{ position: number; command: string; output: string; at: string }[]>([]);
  /** The question the student is in, told again when the room comes back (SPEC-092 revision 2). */
  const lastQuestion = useRef<{ position: number; title: string } | null>(null);

  useEffect(() => {
    if (!isStudent && classId && assessmentId) router.replace(backHref);
  }, [isStudent, classId, assessmentId, backHref, router]);

  useEffect(() => {
    if (!classId || !assessmentId || !isStudent) return;
    let alive = true;
    assessmentService.get(classId, assessmentId).then(
      (got) => {
        if (!alive) return;
        setTitle(got.title);
        setInstructions(descriptionText(got.description ?? "") ? got.description : "");
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [classId, assessmentId, isStudent]);

  // the room: wait while the teacher has not started, then enter the exam; with no room the exam is entered anyway
  useEffect(() => {
    if (!classId || !assessmentId || !isStudent) return;
    let alive = true;
    let entered = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const enter = () => {
      if (entered || !alive) return;
      entered = true;
      setPhase("in");
      assessmentService.enterAttempt(classId, assessmentId).then(
        (got) => {
          if (!alive) return;
          setAttempt(got);
          setError(null);
        },
        (cause) => alive && setError(reasonOf(cause)),
      );
    };
    const connect = () => {
      socket.current = assessmentService.openRoom(classId, assessmentId, {
        onOpen: () => {
          if (!alive) return;
          connected.current = true;
          setOnline(true);
          const queued = pending.current.splice(0);
          queued.forEach((c) => socket.current?.send("room:command", c));
          if (lastQuestion.current) socket.current?.send("room:question", lastQuestion.current);
        },
        onMessage: ({ type, data }) => {
          if (!alive) return;
          const body = (data ?? {}) as Record<string, unknown>;
          switch (type) {
            case "room:snapshot":
              if (body.help) setHelp(body.help as Help);
              if (Array.isArray(body.chat)) setChat(body.chat as ExamChatMessage[]);
              if (body.waiting === true && !entered) setPhase("waiting");
              else enter();
              break;
            case "room:admitted":
              enter();
              break;
            case "help:state":
              setHelp(body as unknown as Help);
              break;
            case "room:ended":
              setEnded(String(body.reason ?? ""));
              break;
            case "room:watch-on":
              setWatched(true);
              break;
            case "room:watch-off":
              setWatched(false);
              break;
            case "chat:message": {
              const got = body as unknown as ExamChatMessage;
              setChat((all) => (all.some((x) => x.id === got.id) ? all : [...all, got]));
              if (got.from === "TEACHER" && !chatOpenRef.current) setUnread((n) => n + 1);
              break;
            }
          }
        },
        onClose: () => {
          if (!alive) return;
          connected.current = false;
          setOnline(false);
          setWatched(false);
          enter(); // without the room the exam goes on; the server still decides who may enter
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
  }, [classId, assessmentId, isStudent, round]);

  const save = useCallback((position: number, answer: unknown) => assessmentService.saveAnswer(classId!, assessmentId!, position, answer), [classId, assessmentId]);
  const check = useCallback((position: number, snapshot: unknown) => assessmentService.checkAnswer(classId!, assessmentId!, position, snapshot), [classId, assessmentId]);
  const submit = useCallback(() => assessmentService.submitAttempt(classId!, assessmentId!), [classId, assessmentId]);

  const room = useMemo<ExamRunnerRoom>(
    () => ({
      watched,
      onCommand: (position, command, output) => {
        if (connected.current) socket.current?.send("room:command", { position, command, output });
        else pending.current.push({ position, command, output, at: new Date().toISOString() });
      },
      onQuestion: (position, questionTitle) => {
        lastQuestion.current = { position, title: questionTitle };
        if (connected.current) socket.current?.send("room:question", lastQuestion.current);
      },
      onScreen: (position, questionTitle, screen) => socket.current?.send("room:screen", { position, title: questionTitle, screen }),
      header: (position) => (
        <div className={take.help}>
          {instructions && (
            <div className={chatStyles.student}>
              <Button
                variant="secondary"
                aria-expanded={instructionsOpen}
                onClick={() => {
                  setInstructionsOpen(!instructionsOpen);
                  setChatOpen(false);
                }}
              >
                {t.instructions.open}
              </Button>
              {instructionsOpen && (
                <section
                  className={chatStyles.column}
                  aria-label={t.instructions.title}
                  onKeyDown={(e) => e.key === "Escape" && setInstructionsOpen(false)}
                >
                  <div className={take.instructionsHead}>
                    <h2 className={styles.heading}>{t.instructions.title}</h2>
                    <Button variant="secondary" onClick={() => setInstructionsOpen(false)}>
                      {t.instructions.close}
                    </Button>
                  </div>
                  {/* html that the server filtered when the instructions were saved (SPEC-077 RN-01) */}
                  <div className={`${styles.richText} ${take.instructionsBody}`} dangerouslySetInnerHTML={{ __html: instructions }} />
                </section>
              )}
            </div>
          )}
          <StudentChat
            messages={chat}
            open={chatOpen}
            unread={unread}
            online={online}
            onToggle={() => {
              setChatOpen(!chatOpen);
              setInstructionsOpen(false);
              setUnread(0);
            }}
            onSend={(text) => socket.current?.send("chat:send", { text })}
          />
          {help.status === "OPEN" ? (
            <>
              <span role="status">{r.helpOpen}</span>
              <Button variant="secondary" onClick={() => socket.current?.send("help:lower", {})}>
                {r.helpCancel}
              </Button>
            </>
          ) : asking ? (
            <>
              <label className={take.question}>
                {r.helpQuestion}
                <textarea rows={2} maxLength={300} value={question} onChange={(e) => setQuestion(e.target.value)} />
              </label>
              <Button
                onClick={() => {
                  socket.current?.send("help:raise", { position, question: question.trim() });
                  setAsking(false);
                  setQuestion("");
                }}
              >
                {r.helpSend}
              </Button>
              <Button variant="secondary" onClick={() => setAsking(false)}>
                {r.helpBack}
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setAsking(true)}>
              {r.help}
            </Button>
          )}
          {help.status === "ANSWERED" && (
            <div role="status" className={take.answer}>
              <strong>{r.helpAnswered}</strong>
              {help.answer && <p>{help.answer}</p>}
            </div>
          )}
        </div>
      ),
    }),
    [watched, help, asking, question, chat, chatOpen, unread, online, instructions, instructionsOpen],
  );

  if (!classId || !assessmentId || !isStudent) return null;

  return (
    <main className={own.window}>
      <h1 className={own.srOnly}>{t.title}</h1>
      {ended !== null ? (
        <div className={take.ended} role="alert">
          <h2>{r.ended}</h2>
          {ended && <p>{ended}</p>}
        </div>
      ) : (
        <>
          {error && (
            <div className={`${styles.problem} ${own.inset}`}>
              <span role="alert">{error}</span>
              <Button variant="secondary" onClick={() => setRound((n) => n + 1)}>
                {m.retry}
              </Button>
            </div>
          )}
          {phase === "waiting" && (
            <div className={take.waiting}>
              <span className={take.pulse} aria-hidden="true" />
              <p role="status" className={take.waitingText}>
                {r.waiting}
              </p>
              <p className={take.watchedNote}>{r.watched}</p>
              {instructions && (
                <section className={take.waitingInstructions}>
                  <h2 className={styles.heading}>{t.instructions.title}</h2>
                  <div className={styles.richText} dangerouslySetInnerHTML={{ __html: instructions }} />
                </section>
              )}
            </div>
          )}
          {!error && phase !== "waiting" && !attempt && (
            <p role="status" className={`${styles.muted} ${own.inset}`}>
              {t.loading}
            </p>
          )}
          {attempt && <ExamRunner attempt={attempt} title={title} save={save} check={check} submit={submit} room={room} />}
        </>
      )}
    </main>
  );
}
