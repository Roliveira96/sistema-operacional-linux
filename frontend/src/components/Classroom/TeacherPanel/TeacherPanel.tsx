"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/Button/Button";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import { messages } from "@/messages/pt-BR";
import { classroomService, type ChatTarget, type LiveModuleContent, type LiveSession } from "@/services/classroomService";
import { moduleService } from "@/services/moduleService";
import { AdmissionPanel } from "../AdmissionPanel/AdmissionPanel";
import { elapsed } from "../elapsed";
import { ExerciseBoard } from "../ExerciseBoard/ExerciseBoard";
import { FilesPanel } from "../FilesPanel/FilesPanel";
import { boardExercises, hintMessage, hintsOf } from "../ExerciseBoard/exercises";
import { LiveInteractionDrawer } from "../LiveInteractionDrawer/LiveInteractionDrawer";
import { NoticeToggle } from "../notices/NoticeToggle";
import { useNoticePreference } from "../notices/noticePreference";
import { useRoomNotices } from "../notices/useRoomNotices";
import { OnlineStudents } from "../OnlineStudents/OnlineStudents";
import { SlideThumbnails } from "../SlideThumbnails/SlideThumbnails";
import type { PdfLoader } from "../SlidePresenter/pdfRenderer";
import { TeacherChat } from "../TeacherChat/TeacherChat";
import styles from "./TeacherPanel.module.scss";
import { useUnreadMessages } from "./useUnreadMessages";

const m = messages.classroom;
const t = m.teacher;
const sf = m.studentsFullscreen;

const SOUND_KEY = "live-arrival-sound";
const readSound = () => {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
};

/** What each notice sounds like, in hertz: one tone for a student who arrives, two rising tones for a hand that goes up (SPEC-062). */
const TONES = { arrival: [880], hand: [660, 990] } as const;
export type BeepKind = keyof typeof TONES;

/** A short beep, from the browser itself; no file to load. */
function webAudioBeep(kind: BeepKind = "arrival") {
  try {
    const audio = new AudioContext();
    const volume = audio.createGain();
    volume.gain.value = 0.08;
    volume.connect(audio.destination);
    const tones = TONES[kind];
    tones.forEach((frequency, index) => {
      const tone = audio.createOscillator();
      const start = audio.currentTime + index * 0.16;
      tone.frequency.value = frequency;
      tone.connect(volume);
      tone.start(start);
      tone.stop(start + 0.12);
      if (index === tones.length - 1) tone.onended = () => void audio.close();
    });
  } catch {
    /* no sound is not a failure */
  }
}

export interface TeacherPanelProps {
  classId: string;
  session: LiveSession;
  /** The sound that tells a student arrived, or that a hand went up (SPEC-062). */
  beep?: (kind: BeepKind) => void;
  loader?: PdfLoader;
}

type Step = { n: 1 | 2 | 3; title: string; hint: string; done: boolean };

/**
 * The panel of the teacher: the administrative screen of the live class, with no stage. The class is shown in the presentation window, which
 * the teacher opens from here and may drag to the projector (SPEC-055).
 */
export function TeacherPanel({ classId, session, beep = webAudioBeep, loader }: TeacherPanelProps) {
  const router = useRouter();
  const live = useLiveClassroom({ classId, role: "teacher", view: "panel" });
  const { room, admissions, switchMode } = live;
  const [now, setNow] = useState(() => Date.now());
  const [modules, setModules] = useState<Array<{ id: string; title: string }>>([]);
  const [content, setContent] = useState<LiveModuleContent | null>(null);
  const [chosen, setChosen] = useState("");
  const [pickModule, setPickModule] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sound, setSound] = useState(readSound);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [seenPresenter, setSeenPresenter] = useState(false);
  // The conversation that is open, with the name of the student as it was when it opened (SPEC-063).
  const [talk, setTalk] = useState<{ to: ChatTarget; name: string } | null>(null);
  const talkingWith = talk && talk.to !== "all" ? talk.to.studentId : null;
  const { unread, markRead } = useUnreadMessages(live.chat, live.ready, talkingWith);

  // Opening a conversation reads what was new in it.
  const openConversation = (to: ChatTarget) => {
    setTalk({ to, name: to === "all" ? "" : (admissions.admitted.find((student) => student.studentId === to.studentId)?.name ?? "") });
    if (to !== "all") markRead(to.studentId);
  };

  // The notices of the browser for a hand that goes up and a message of a student, when the teacher is in another window; the click opens that
  // student's conversation (SPEC-064).
  const [noticesOn, setNoticesOn] = useNoticePreference();
  useRoomNotices({
    role: "teacher",
    chat: live.chat,
    hands: live.hands,
    ready: live.ready,
    enabled: noticesOn,
    nameOf: (studentId) => admissions.admitted.find((student) => student.studentId === studentId)?.name ?? live.hands.find((hand) => hand.studentId === studentId)?.name ?? "",
    onOpen: (studentId) => {
      if (studentId) openConversation({ studentId });
    },
  });
  const popup = useRef<Window | null>(null);
  const fullscreenHint = useId();
  const back = `/app/classes/${classId}`;
  const startedAt = new Date(live.startedAt ?? session.startedAt).getTime();

  if (live.presenterConnected && !seenPresenter) setSeenPresenter(true);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    let active = true;
    moduleService.listModules({ limit: 100 }).then(
      (result) => active && setModules(result.items),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);

  // The module of the room: its blocks, for the block in focus, and its title.
  useEffect(() => {
    if (!room.moduleId) return;
    let active = true;
    classroomService.getLiveModule(classId).then(
      (module) => active && setContent(module),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [classId, room.moduleId]);

  // The class that comes from the calendar opens on what it has: the slides if there is a presentation, else the module (SPEC-055 CA-15).
  const started = useRef(false);
  useEffect(() => {
    if (!live.ready || started.current) return;
    started.current = true;
    if (room.mode === "SLIDES" && !room.deck && room.moduleId) switchMode("MODULE", room.moduleId);
  }, [live.ready, room.mode, room.deck, room.moduleId, switchMode]);

  // Who arrives: a beep, if the teacher wants it. The notice on the screen is the one of the waiting room.
  const known = useRef<string[] | null>(null);
  useEffect(() => {
    const ids = admissions.waiting.map((w) => w.studentId);
    const before = known.current;
    known.current = ids;
    if (before && sound && ids.some((id) => !before.includes(id))) beep("arrival");
  }, [admissions.waiting, sound, beep]);

  // Whose hand goes up: another beep, once for each update of the line, with the same switch (SPEC-062 CA-08). The hands the first snapshot brings, and the
  // ones already up when the panel is reloaded, are not news; neither is the same student changing the doubt, nor a hand that goes down.
  const knownHands = useRef<string[] | null>(null);
  useEffect(() => {
    if (!live.ready) {
      knownHands.current = null;
      return;
    }
    const ids = live.hands.map((hand) => hand.studentId);
    const before = knownHands.current;
    knownHands.current = ids;
    if (before && sound && ids.some((id) => !before.includes(id))) beep("hand");
  }, [live.hands, live.ready, sound, beep]);

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      /* the choice just does not last */
    }
  };

  const openPresenter = () => {
    if (popup.current && !popup.current.closed) {
      popup.current.focus();
      return;
    }
    const url = `${window.location.origin}/app/classes/${classId}/live/present`;
    const opened = window.open(url, `presenter-${classId}`, "popup");
    popup.current = opened;
    setBlocked(opened ? null : url);
  };

  const end = async () => {
    const minutes = Math.max(0, Math.floor((Date.now() - startedAt) / 60_000));
    if (!window.confirm(t.endConfirm(t.duration(Math.floor(minutes / 60), minutes % 60), admissions.admitted.length))) return;
    setEnding(true);
    setError(null);
    try {
      await classroomService.endSession(classId, session.id);
      router.push(back);
    } catch {
      setError(t.endError);
      setEnding(false);
    }
  };

  if (live.ended) {
    return (
      <main className={styles.panel}>
        <p className={styles.ended} role="status">
          {m.room.ended}
        </p>
        <Link href={back} className={styles.link}>
          {m.room.backToClass}
        </Link>
      </main>
    );
  }

  const mode = room.mode;
  const total = room.deck?.pageCount ?? 0;
  const goto = (slide: number) => live.changeSlide(Math.min(Math.max(slide, 1), Math.max(total, 1)));
  const switchToModule = () => {
    const id = chosen || room.moduleId;
    if (!id) {
      setPickModule(true);
      return;
    }
    setPickModule(false);
    switchMode("MODULE", id);
  };
  const moduleTitle = modules.find((mod) => mod.id === room.moduleId)?.title ?? content?.title ?? m.room.modeModule;
  const waiting = admissions.waiting.length;
  // The practical exercises of the module the room is in: the module read before is not offered once the room changes it (SPEC-065 3.3). The tips of the
  // round that runs are what the private conversations suggest.
  const exercises = room.moduleId && content?.moduleId === room.moduleId ? boardExercises(content.blocks) : null;
  const tips = live.exercise?.status === "RUNNING" ? hintsOf(exercises, live.exercise).map(hintMessage) : [];

  const steps: Step[] = [
    { n: 1, title: t.steps.open, hint: live.presenterConnected ? t.steps.openDone : t.steps.openHint, done: live.presenterConnected },
    { n: 2, title: t.steps.accept, hint: t.steps.waiting(waiting), done: waiting === 0 },
    {
      n: 3,
      title: t.steps.present,
      hint:
        mode === "SLIDES"
          ? room.deck
            ? t.steps.onSlides(room.slide, total)
            : room.moduleId
              ? t.steps.onModule(moduleTitle)
              : t.steps.nothing
          : t.steps.onModule(moduleTitle),
      done: false,
    },
  ];
  const next = steps.find((step) => !step.done)!.n;
  const status = (step: Step) => (step.done ? t.steps.done : step.n === next ? t.steps.next : t.steps.pending);

  return (
    <main className={styles.panel}>
      <header className={styles.bar}>
        <h1 className={styles.title}>{session.title}</h1>
        <span className={styles.meta} role="timer" aria-label={t.timer}>
          {elapsed(now - startedAt)}
        </span>
        <Button variant="danger" size="sm" disabled={ending || !live.canControl} onClick={() => void end()}>
          {t.end}
        </Button>
      </header>

      {!live.ready && (
        <p className={styles.status} role="status">
          {t.connecting}
        </p>
      )}
      {live.ready && !live.connected && <p className={styles.status}>{t.reconnecting}</p>}
      {live.passive && <p className={styles.status}>{t.passive}</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {blocked && (
        <p className={styles.error} role="alert">
          {t.presenter.blocked(blocked)}
        </p>
      )}
      {seenPresenter && !live.presenterConnected && (
        <p className={styles.error}>
          {t.presenter.closed}{" "}
          <Button variant="secondary" size="sm" onClick={openPresenter}>
            {t.presenter.openAgain}
          </Button>
        </p>
      )}

      {!live.presenterConnected && <p className={styles.error}>{t.presenter.waitingScreen}</p>}

      <div className={styles.body}>
        <div className={styles.main}>
          <ol className={styles.steps} aria-label={t.steps.title}>
            {steps.map((step) => (
              <li key={step.n} className={`${styles.step} ${step.n === next ? styles.next : ""}`} aria-current={step.n === next ? "step" : undefined}>
                <span className={styles.stepStatus}>{status(step)}</span>
                <strong className={styles.stepTitle}>{step.title}</strong>
                <span className={styles.muted}>{step.hint}</span>
                {step.n === 1 && (
                  <Button variant={step.n === next ? "primary" : "secondary"} onClick={openPresenter}>
                    {t.presenter.open}
                  </Button>
                )}
                {step.n === 2 && waiting > 0 && (
                  <Button variant={step.n === next ? "primary" : "secondary"} disabled={!live.canControl} onClick={live.acceptAll}>
                    {t.steps.acceptAll(waiting)}
                  </Button>
                )}
                {step.n === 3 && mode === "SLIDES" && room.moduleId && (
                  <Button variant="secondary" disabled={!live.canControl} onClick={() => switchMode("MODULE", room.moduleId!)}>
                    {t.steps.toModule}
                  </Button>
                )}
                {step.n === 3 && mode === "MODULE" && room.deck && (
                  <Button variant="secondary" disabled={!live.canControl} onClick={() => switchMode("SLIDES")}>
                    {t.steps.toSlides}
                  </Button>
                )}
              </li>
            ))}
          </ol>

          <FilesPanel classId={classId} classSessionId={session.classSessionId} onProject={live.selectDeck} />

          <section className={styles.summary} aria-label={t.summary.title}>
            <dl className={styles.facts}>
              <div>
                <dt>{t.summary.inClass}</dt>
                <dd>{admissions.admitted.length}</dd>
              </div>
              <div>
                <dt>{t.summary.waiting}</dt>
                <dd>{waiting}</dd>
              </div>
              <div>
                <dt>{t.summary.hands}</dt>
                <dd>{live.hands.length}</dd>
              </div>
              <div>
                <dt>{t.summary.presenter}</dt>
                <dd>{live.presenterConnected ? t.summary.connected : t.summary.closed}</dd>
              </div>
            </dl>
          </section>

          <OnlineStudents
            admitted={admissions.admitted}
            online={live.onlineStudents}
            hands={live.hands}
            unread={unread}
            selected={talk?.to ?? null}
            onSelect={openConversation}
          />

          <ExerciseBoard
            exercise={live.exercise}
            exercises={exercises}
            admitted={admissions.admitted}
            online={live.onlineStudents}
            progress={live.exerciseProgress}
            watching={live.watching}
            watchedScreen={live.watchedScreen}
            canControl={live.canControl}
            classOnSlides={mode === "SLIDES"}
            onStart={live.startExercise}
            onEnd={live.endExercise}
            onReveal={live.revealExercise}
            onWatch={live.watchStudent}
            onTip={(studentId) => openConversation({ studentId })}
            onSendTip={(text) => live.sendChat(text, "all")}
          />

          <section className={styles.stage} aria-labelledby="stage-title">
            <h2 id="stage-title" className={styles.sectionTitle}>
              {t.stage.title}
            </h2>
            <div role="radiogroup" aria-label={m.room.modeLabel} className={styles.row}>
              <Button
                variant={mode === "SLIDES" ? "primary" : "secondary"}
                size="sm"
                role="radio"
                aria-checked={mode === "SLIDES"}
                disabled={!live.canControl}
                onClick={() => {
                  setPickModule(false);
                  switchMode("SLIDES");
                }}
              >
                {m.room.modeSlides}
              </Button>
              <Button variant={mode === "MODULE" ? "primary" : "secondary"} size="sm" role="radio" aria-checked={mode === "MODULE"} disabled={!live.canControl} onClick={switchToModule}>
                {m.room.modeModule}
              </Button>
            </div>

            {mode === "SLIDES" &&
              (room.deck ? (
                <>
                  {room.deck.kind === "IMAGE" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the address is the signed one of the bucket, which next/image would not know.
                    <img className={styles.preview} src={room.deck.downloadUrl} alt={room.deck.title} />
                  ) : (
                    <SlideThumbnails deck={room.deck} current={room.slide} onSelect={goto} loader={loader} />
                  )}
                  <div className={styles.row}>
                    <Button variant="secondary" size="sm" disabled={!live.canControl || room.slide <= 1} onClick={() => goto(room.slide - 1)}>
                      {m.slides.previous}
                    </Button>
                    <Button variant="secondary" size="sm" disabled={!live.canControl || room.slide >= total} onClick={() => goto(room.slide + 1)}>
                      {m.slides.next}
                    </Button>
                    <span className={styles.muted}>{m.slides.position(room.slide, total)}</span>
                    <label className={styles.goto}>
                      <span className={styles.srOnly}>{m.slides.goTo}</span>
                      <input
                        type="number"
                        min={1}
                        max={total}
                        value={room.slide}
                        disabled={!live.canControl}
                        onChange={(e) => {
                          const to = Number(e.target.value);
                          if (Number.isFinite(to) && e.target.value !== "") goto(to);
                        }}
                      />
                    </label>
                  </div>
                </>
              ) : (
                <p className={styles.muted}>{m.room.noDeck}</p>
              ))}

            <div className={styles.row}>
              <select aria-label={t.stage.moduleLabel} value={chosen} disabled={!live.canControl} onChange={(e) => setChosen(e.target.value)}>
                <option value="">{t.stage.moduleChoose}</option>
                {modules.map((mod) => (
                  <option key={mod.id} value={mod.id}>
                    {mod.title}
                  </option>
                ))}
              </select>
              <Button variant="secondary" size="sm" disabled={!live.canControl || !chosen} onClick={switchToModule}>
                {t.stage.showModule}
              </Button>
            </div>
            {pickModule && (
              <p className={styles.error} role="alert">
                {m.room.pickModule}
              </p>
            )}

            {/* The request that puts the students in full screen (SPEC-059): the state is the room's, so the panel and the presentation window agree. */}
            <div className={styles.row}>
              <Button
                variant={live.fullscreenRequested ? "primary" : "secondary"}
                size="sm"
                aria-pressed={live.fullscreenRequested}
                aria-describedby={fullscreenHint}
                disabled={!live.canControl}
                onClick={() => live.sendStageFullscreen(!live.fullscreenRequested)}
              >
                {sf.label}
              </Button>
              <span className={styles.state}>{live.fullscreenRequested ? sf.on : sf.off}</span>
            </div>
            <p id={fullscreenHint} className={styles.hint}>
              {sf.hint}
            </p>

            {mode === "MODULE" && content && (
              <label className={styles.row}>
                <span>{t.stage.focusLabel}</span>
                <select
                  aria-label={t.stage.focusLabel}
                  value={room.moduleFocusBlockId ?? ""}
                  disabled={!live.canControl}
                  onChange={(e) => e.target.value && live.focusBlock(e.target.value)}
                >
                  <option value="">{t.stage.focusAuto}</option>
                  {[...content.blocks]
                    .sort((a, b) => a.position - b.position)
                    .map((block, index) => (
                      <option key={block.id} value={block.id}>
                        {t.stage.block(index + 1)}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </section>
        </div>

        <LiveInteractionDrawer
          role="teacher"
          userId=""
          hands={live.hands}
          onRaise={() => undefined}
          onLower={() => undefined}
          onModerate={live.moderate}
          before={
            <TeacherChat
              target={talk?.to ?? null}
              studentName={talk?.name ?? ""}
              chat={live.chat}
              doubt={live.hands.find((hand) => hand.studentId === talkingWith)?.question}
              connected={live.connected}
              onSend={live.sendChat}
              suggestions={tips}
            />
          }
        >
          <AdmissionPanel waiting={admissions.waiting} admitted={admissions.admitted} onAccept={live.acceptStudent} onAcceptAll={live.acceptAll} onRemove={live.removeStudent} />
          <Button variant="ghost" size="sm" aria-pressed={sound} onClick={toggleSound}>
            {t.sound}
          </Button>
          <NoticeToggle enabled={noticesOn} onChange={setNoticesOn} />
        </LiveInteractionDrawer>
      </div>
    </main>
  );
}
