"use client";

import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { AssessmentQuestionPicker } from "@/components/AssessmentQuestionPicker/AssessmentQuestionPicker";
import { Button } from "@/components/Button/Button";
import { equalWeights, formatPeriod, formatScore, fromLocalInput, sumWeights, toLocalInput } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import {
  describeAssessmentError,
  type AssessmentInput,
  type AssessmentType,
  type Audience,
  type Composition,
  type Difficulty,
  type DrawRule,
  type EligibleQuestions,
  type Modality,
  type PickedQuestion,
  type QuestionQuery,
  type Stock,
} from "@/services/assessmentService";
import styles from "./AssessmentForm.module.scss";

const m = messages.assessments.form;

const TABS = ["data", "period", "questions", "participants", "notes"] as const;
type Tab = (typeof TABS)[number];
const LEVELS: Difficulty[] = ["EASY", "MEDIUM", "HARD"];
const LEVEL_LEGEND: Record<Difficulty, string> = { EASY: m.draw.easy, MEDIUM: m.draw.medium, HARD: m.draw.hard };
const MAX_QUESTIONS = 50;
const MAX_SCORE = 100;
const MIN_DURATION = 5;

/** What the form starts from: a lesson to convert (SPEC-075 CA-25), a saved assessment to edit, or nothing. */
export interface AssessmentFormInitial {
  classSessionId?: string;
  title?: string;
  description?: string;
  type?: AssessmentType;
  maxScore?: number;
  durationMinutes?: number;
  moduleId?: string;
  startsAt?: string;
  endsAt?: string;
  composition?: Composition;
  items?: PickedQuestion[];
  drawRules?: DrawRule[];
  audience?: Audience;
  studentIds?: string[];
  teacherPrivateNotes?: string | null;
  modality?: Modality;
  requiresClearance?: boolean;
}

/**
 * What the form sends. A new assessment sends everything; an edit leaves the dates and the lesson out (they have a route of their own); a frozen
 * one sends only the title, the instructions, the audience and the notes (RN-10). The page decides which route the notes take.
 */
export type AssessmentFormValue = Partial<AssessmentInput> & { title: string; description: string; audience: Audience; teacherPrivateNotes: string };

export interface AssessmentFormProps {
  mode: "create" | "edit";
  /** The modules assigned to the class, the only ones an assessment may take its questions from (RN-05). */
  modules: { id: string; title: string }[];
  /** The students of the class whose enrollment is active, for the audience. */
  students: { id: string; name: string; academicId?: string }[];
  initial?: AssessmentFormInitial;
  /** The assessment already started: the composition is locked and the audience can only grow (RN-10). */
  frozen?: boolean;
  /** Reads the eligible questions and the stock of the module; it must keep its identity between renders. */
  loadQuestions: (query: QuestionQuery) => Promise<EligibleQuestions>;
  /** Saves; it rejects with the error of the server, which the form shows. */
  onSubmit: (value: AssessmentFormValue) => Promise<void>;
  onCancel?: () => void;
}

type Draw = Record<Difficulty, { quantity: number; points: number }>;
const emptyDraw = (rules: DrawRule[] = []): Draw =>
  Object.fromEntries(
    LEVELS.map((level) => {
      const rule = rules.find((r) => r.difficulty === level);
      return [level, { quantity: rule?.quantity ?? 0, points: rule?.pointsPerQuestion ?? 0 }];
    }),
  ) as Draw;

/** Whether a number of points has at most two decimal places. */
const hundredths = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

/** The form of an assessment in tabs (SPEC-075 section 3.1, in the pattern of SPEC-044), with the checks the server repeats. */
export function AssessmentForm({ mode, modules, students, initial = {}, frozen = false, loadQuestions, onSubmit, onCancel }: AssessmentFormProps) {
  const baseId = useId();
  const editing = mode === "edit";

  const [active, setActive] = useState<Tab>("data");
  const [title, setTitle] = useState(initial.title ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [type, setType] = useState<AssessmentType>(initial.type ?? "EXAM");
  const [maxScore, setMaxScore] = useState(initial.maxScore ?? 10);
  // an exam is in person and asks for the clearance, an assignment is online (SPEC-076 RN-01, RN-02)
  const startModality: Modality = initial.modality ?? (initial.type === "ASSIGNMENT" ? "ONLINE" : "IN_PERSON");
  const [modality, setModality] = useState<Modality>(startModality);
  const [requires, setRequires] = useState(initial.requiresClearance ?? startModality === "IN_PERSON");
  const [duration, setDuration] = useState(initial.durationMinutes ? String(initial.durationMinutes) : "");
  const [starts, setStarts] = useState(toLocalInput(initial.startsAt));
  const [ends, setEnds] = useState(toLocalInput(initial.endsAt));
  const [moduleId, setModuleId] = useState(initial.moduleId ?? "");
  const [composition, setComposition] = useState<Composition>(initial.composition ?? "MANUAL");
  const [items, setItems] = useState<PickedQuestion[]>(initial.items ?? []);
  const [draw, setDraw] = useState<Draw>(() => emptyDraw(initial.drawRules));
  const [stock, setStock] = useState<Stock | null>(null);
  const [audience, setAudience] = useState<Audience>(initial.audience ?? "ALL_CLASS");
  const [studentIds, setStudentIds] = useState<string[]>(initial.studentIds ?? []);
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState(initial.teacherPrivateNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const tabId = (t: Tab) => `${baseId}-tab-${t}`;
  const panelId = (t: Tab) => `${baseId}-panel-${t}`;

  // The stock of each level, for the draw: asked when the module is chosen.
  useEffect(() => {
    if (composition !== "DRAW" || !moduleId) return;
    let alive = true;
    loadQuestions({ moduleId, pageSize: 1 }).then(
      (r) => alive && setStock(r.stock),
      () => alive && setStock(null),
    );
    return () => {
      alive = false;
    };
  }, [composition, moduleId, loadQuestions]);

  // ── the checks of the form ────────────────────────────────────────────────
  const scoreOk = maxScore >= 0.01 && maxScore <= MAX_SCORE && hundredths(maxScore);
  const maxCents = Math.round(maxScore * 100);
  const periodMinutes = starts && ends ? (Date.parse(fromLocalInput(ends)) - Date.parse(fromLocalInput(starts))) / 60000 : undefined;
  const periodError = !starts || !ends ? null : ends <= starts ? m.endAfterStart : type === "EXAM" && starts.slice(0, 10) !== ends.slice(0, 10) ? m.examSameDay : null;
  const periodOk = editing || (Boolean(starts && ends) && !periodError);
  const durationNumber = duration === "" ? undefined : Number(duration);
  const durationOk =
    durationNumber === undefined ||
    (Number.isInteger(durationNumber) && durationNumber >= MIN_DURATION && (periodMinutes === undefined || periodMinutes <= 0 || durationNumber <= periodMinutes));

  const weightsCents = sumWeights(items.map((i) => i.weight));
  const manualOk = items.length >= 1 && items.length <= MAX_QUESTIONS && items.every((i) => i.weight >= 0.01 && i.weight <= MAX_SCORE) && weightsCents === maxCents;

  const total = LEVELS.reduce((sum, l) => sum + draw[l].quantity, 0);
  const drawCents = LEVELS.reduce((sum, l) => sum + draw[l].quantity * Math.round(draw[l].points * 100), 0);
  const drawOk =
    total >= 1 && total <= MAX_QUESTIONS && LEVELS.every((l) => draw[l].quantity === 0 || (draw[l].points >= 0.01 && draw[l].points <= MAX_SCORE && hundredths(draw[l].points))) && drawCents === maxCents;
  const short = (level: Difficulty) => stock !== null && draw[level].quantity > (stock[level] ?? 0);
  const stockOk = !LEVELS.some(short);

  const studentsOk = audience === "ALL_CLASS" || studentIds.length >= 1;

  const blockers: string[] = [];
  if (!title.trim()) blockers.push(m.blockers.title);
  if (!frozen) {
    if (!scoreOk) blockers.push(m.blockers.maxScore);
    if (!periodOk) blockers.push(m.blockers.period);
    if (!durationOk) blockers.push(m.blockers.duration);
    if (!moduleId) blockers.push(m.blockers.module);
    if (composition === "MANUAL") {
      if (items.length === 0) blockers.push(m.blockers.questions);
      else if (!manualOk) blockers.push(m.blockers.weights);
    } else {
      if (!drawOk) blockers.push(m.blockers.draw);
      if (!stockOk) blockers.push(m.blockers.stock);
    }
  }
  if (!studentsOk) blockers.push(m.blockers.students);
  const blocked = blockers.length > 0;
  const blockedId = `${baseId}-blocked`;

  // ── what is sent ──────────────────────────────────────────────────────────
  const valueOf = (): AssessmentFormValue => {
    const common = { title: title.trim(), description: description.trim(), audience, ...(audience === "SELECTED" ? { studentIds } : {}), teacherPrivateNotes: notes.trim() };
    if (frozen) return common;
    return {
      ...(!editing && initial.classSessionId ? { classSessionId: initial.classSessionId } : {}),
      moduleId,
      ...common,
      type,
      maxScore,
      modality,
      requiresClearance: modality === "IN_PERSON" && requires,
      ...(durationNumber !== undefined ? { durationMinutes: durationNumber } : {}),
      ...(editing ? {} : { startsAt: fromLocalInput(starts), endsAt: fromLocalInput(ends) }),
      composition,
      ...(composition === "MANUAL"
        ? { items: items.map(({ questionId, weight }) => ({ questionId, weight })) }
        : {
            draw: {
              total,
              rules: LEVELS.filter((l) => draw[l].quantity > 0).map((l) => ({ difficulty: l, quantity: draw[l].quantity, pointsPerQuestion: draw[l].points })),
            },
          }),
    };
  };

  const changeType = (next: AssessmentType) => {
    if (next === type) return;
    setType(next);
    // the modality and the requirement go back to what the new type has by default
    const defaults: Modality = next === "ASSIGNMENT" ? "ONLINE" : "IN_PERSON";
    setModality(defaults);
    setRequires(defaults === "IN_PERSON");
  };
  const changeModality = (next: Modality) => {
    setModality(next);
    setRequires(next === "IN_PERSON");
  };

  // The ref closes the door in the same tick; the state only shows it. A save that worked stays locked: the page leaves for the next screen, and
  // an unlocked form in the meantime let a second press create the assessment twice.
  const sending = useRef(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (blocked || busy || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(valueOf());
    } catch (cause) {
      setError(describeAssessmentError(cause));
      sending.current = false;
      setBusy(false);
    }
  };

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, t: Tab) => {
    const at = TABS.indexOf(t);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(at + 1, TABS.length - 1);
    else if (e.key === "ArrowLeft") next = Math.max(at - 1, 0);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = TABS[next]!;
    setActive(target);
    tabRefs.current[target]?.focus();
  };

  /** A panel of a tab; the inactive ones stay mounted, only hidden, so nothing typed is lost. */
  const panel = (t: Tab, children: ReactNode) => (
    <div role="tabpanel" id={panelId(t)} aria-labelledby={tabId(t)} hidden={active !== t} className={styles.panel}>
      {children}
    </div>
  );

  const required = (
    <span aria-hidden="true" className={styles.required}>
      *
    </span>
  );
  const shown = students.filter((s) => `${s.name} ${s.academicId ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const lockedIds = new Set(frozen ? (initial.studentIds ?? []) : []);
  const toggleStudent = (id: string) => setStudentIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const setLevel = (level: Difficulty, change: Partial<Draw[Difficulty]>) => setDraw((d) => ({ ...d, [level]: { ...d[level], ...change } }));
  const distribute = () =>
    setItems((list) => {
      const weights = equalWeights(maxScore, list.length);
      return list.map((it, i) => ({ ...it, weight: weights[i]! }));
    });
  const diff = maxCents - (composition === "MANUAL" ? weightsCents : drawCents);

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <div role="tablist" aria-label={m.tabsLabel} className={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t}
            ref={(el) => {
              tabRefs.current[t] = el;
            }}
            type="button"
            role="tab"
            id={tabId(t)}
            aria-selected={active === t}
            aria-controls={panelId(t)}
            tabIndex={active === t ? 0 : -1}
            className={`${styles.tab} ${active === t ? styles.tabActive : ""}`}
            onClick={() => setActive(t)}
            onKeyDown={(e) => onTabKeyDown(e, t)}
          >
            {m.tabs[t]}
          </button>
        ))}
      </div>

      {panel(
        "data",
        <>
          <div className={styles.field}>
            <label htmlFor={`${baseId}-title`}>
              {m.title} {required}
            </label>
            <input id={`${baseId}-title`} type="text" value={title} maxLength={150} required onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor={`${baseId}-description`}>{m.description}</label>
            <textarea id={`${baseId}-description`} value={description} maxLength={5000} rows={4} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor={`${baseId}-type`}>{m.type}</label>
              <select id={`${baseId}-type`} value={type} disabled={frozen} onChange={(e) => changeType(e.target.value as AssessmentType)}>
                <option value="EXAM">{messages.assessments.type.EXAM}</option>
                <option value="ASSIGNMENT">{messages.assessments.type.ASSIGNMENT}</option>
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor={`${baseId}-score`}>
                {m.maxScore} {required}
              </label>
              <input
                id={`${baseId}-score`}
                type="number"
                min={0.01}
                max={MAX_SCORE}
                step={0.01}
                value={maxScore}
                disabled={frozen}
                required
                onChange={(e) => setMaxScore(e.target.value === "" ? 0 : Number(e.target.value))}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor={`${baseId}-duration`}>{m.duration}</label>
              <input id={`${baseId}-duration`} type="number" min={MIN_DURATION} step={1} value={duration} disabled={frozen} aria-describedby={`${baseId}-duration-help`} onChange={(e) => setDuration(e.target.value)} />
            </div>
          </div>
          <p id={`${baseId}-duration-help`} className={durationOk ? styles.hint : styles.problem}>
            {durationOk ? m.durationHelp : m.durationRange(periodMinutes && periodMinutes > 0 ? periodMinutes : undefined)}
          </p>
          <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor={`${baseId}-modality`}>{m.modality}</label>
              <select
                id={`${baseId}-modality`}
                value={modality}
                disabled={frozen}
                aria-describedby={type === "ASSIGNMENT" ? `${baseId}-modality-why` : undefined}
                onChange={(e) => changeModality(e.target.value as Modality)}
              >
                <option value="IN_PERSON" disabled={type === "ASSIGNMENT"}>
                  {messages.assessments.modality.IN_PERSON}
                </option>
                <option value="ONLINE">{messages.assessments.modality.ONLINE}</option>
              </select>
              {type === "ASSIGNMENT" && (
                <p id={`${baseId}-modality-why`} className={styles.hint}>
                  {m.assignmentOnlineOnly}
                </p>
              )}
            </div>
            {modality === "IN_PERSON" && (
              <label className={styles.choice}>
                <input type="checkbox" checked={requires} disabled={frozen} onChange={(e) => setRequires(e.target.checked)} />
                {m.requiresClearance}
              </label>
            )}
          </div>
          {frozen && <p className={styles.notice}>{m.frozenModality}</p>}
        </>,
      )}

      {panel(
        "period",
        editing ? (
          <>
            <p className={styles.fact}>{formatPeriod(initial.startsAt ?? "", initial.endsAt ?? "")}</p>
            <p className={styles.hint}>{m.datesAreRescheduled}</p>
          </>
        ) : (
          <>
            <div className={styles.row}>
              <div className={styles.field}>
                <label htmlFor={`${baseId}-starts`}>
                  {m.starts} {required}
                </label>
                <input id={`${baseId}-starts`} type="datetime-local" value={starts} required onChange={(e) => setStarts(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label htmlFor={`${baseId}-ends`}>
                  {m.ends} {required}
                </label>
                <input id={`${baseId}-ends`} type="datetime-local" value={ends} required onChange={(e) => setEnds(e.target.value)} />
              </div>
            </div>
            {periodError && <p className={styles.problem}>{periodError}</p>}
          </>
        ),
      )}

      {panel(
        "questions",
        <>
          {frozen && <p className={styles.notice}>{m.frozen}</p>}
          <div className={styles.field}>
            <label htmlFor={`${baseId}-module`}>
              {m.module} {required}
            </label>
            <select
              id={`${baseId}-module`}
              value={moduleId}
              disabled={frozen}
              required
              onChange={(e) => {
                setModuleId(e.target.value);
                setItems([]); // the questions belong to the module
                setStock(null);
              }}
            >
              <option value="">{m.chooseModule}</option>
              {modules.map((mod) => (
                <option key={mod.id} value={mod.id}>
                  {mod.title}
                </option>
              ))}
            </select>
          </div>
          <fieldset className={styles.group} role="radiogroup">
            <legend>{m.composition}</legend>
            {(["MANUAL", "DRAW"] as const).map((c) => (
              <label key={c} className={styles.choice}>
                <input type="radio" name={`${baseId}-composition`} checked={composition === c} disabled={frozen} onChange={() => setComposition(c)} />
                {messages.assessments.composition[c]}
              </label>
            ))}
          </fieldset>

          {composition === "MANUAL" ? (
            <>
              {moduleId ? (
                <AssessmentQuestionPicker moduleId={moduleId} load={loadQuestions} selected={items} onChange={setItems} disabled={frozen} />
              ) : (
                <p className={styles.hint}>{m.chooseModuleFirst}</p>
              )}
              <div className={styles.sumRow}>
                <p role="status" className={styles.sum} data-ok={diff === 0 ? "true" : "false"}>
                  <span>{m.sumWeights(formatScore(weightsCents / 100), formatScore(maxScore))}</span>
                  {diff > 0 && <span>{m.missing(formatScore(diff / 100))}</span>}
                  {diff < 0 && <span>{m.over(formatScore(-diff / 100))}</span>}
                </p>
                <Button variant="secondary" disabled={frozen || items.length === 0} onClick={distribute}>
                  {m.distribute}
                </Button>
              </div>
            </>
          ) : (
            <>
              {LEVELS.map((level) => (
                <fieldset key={level} className={styles.level}>
                  <legend>{LEVEL_LEGEND[level]}</legend>
                  <div className={styles.field}>
                    <label htmlFor={`${baseId}-${level}-quantity`}>{m.draw.quantity}</label>
                    <input
                      id={`${baseId}-${level}-quantity`}
                      type="number"
                      min={0}
                      max={MAX_QUESTIONS}
                      step={1}
                      value={draw[level].quantity}
                      disabled={frozen}
                      onChange={(e) => setLevel(level, { quantity: e.target.value === "" ? 0 : Math.max(0, Math.trunc(Number(e.target.value))) })}
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor={`${baseId}-${level}-points`}>{m.draw.points}</label>
                    <input
                      id={`${baseId}-${level}-points`}
                      type="number"
                      min={0}
                      max={MAX_SCORE}
                      step={0.01}
                      value={draw[level].points}
                      disabled={frozen}
                      onChange={(e) => setLevel(level, { points: e.target.value === "" ? 0 : Number(e.target.value) })}
                    />
                  </div>
                  {stock && <span className={styles.stock}>{m.draw.stock(stock[level] ?? 0)}</span>}
                  {short(level) && <p className={styles.problem}>{m.draw.short(stock?.[level] ?? 0)}</p>}
                </fieldset>
              ))}
              <p className={styles.fact}>{m.draw.total(total)}</p>
              <p role="status" className={styles.sum} data-ok={diff === 0 ? "true" : "false"}>
                <span>{m.sumPoints(formatScore(drawCents / 100), formatScore(maxScore))}</span>
                {diff > 0 && <span>{m.missing(formatScore(diff / 100))}</span>}
                {diff < 0 && <span>{m.over(formatScore(-diff / 100))}</span>}
              </p>
            </>
          )}
        </>,
      )}

      {panel(
        "participants",
        <>
          <fieldset className={styles.group} role="radiogroup">
            <legend>{m.audience}</legend>
            <label className={styles.choice}>
              <input type="radio" name={`${baseId}-audience`} checked={audience === "ALL_CLASS"} onChange={() => setAudience("ALL_CLASS")} />
              {messages.assessments.audience.ALL_CLASS}
            </label>
            <label className={styles.choice}>
              <input
                type="radio"
                name={`${baseId}-audience`}
                checked={audience === "SELECTED"}
                disabled={frozen && initial.audience !== "SELECTED"}
                onChange={() => setAudience("SELECTED")}
              />
              {messages.assessments.audience.SELECTED}
            </label>
          </fieldset>
          {audience === "SELECTED" && (
            <>
              <div className={styles.field}>
                <label htmlFor={`${baseId}-student-search`}>{m.searchStudent}</label>
                <input id={`${baseId}-student-search`} type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <ul className={styles.students}>
                {shown.map((s) => (
                  <li key={s.id}>
                    <label className={styles.choice}>
                      <input type="checkbox" aria-label={m.include(s.name)} checked={studentIds.includes(s.id)} disabled={lockedIds.has(s.id)} onChange={() => toggleStudent(s.id)} />
                      <span>{s.name}</span>
                      {s.academicId && <span className={styles.hint}>{s.academicId}</span>}
                    </label>
                  </li>
                ))}
              </ul>
              <p className={styles.fact}>{m.chosen(studentIds.length)}</p>
            </>
          )}
        </>,
      )}

      {panel(
        "notes",
        <div className={styles.field}>
          <label htmlFor={`${baseId}-notes`}>{m.notes}</label>
          <textarea id={`${baseId}-notes`} value={notes} maxLength={5000} rows={6} aria-describedby={`${baseId}-notes-help`} onChange={(e) => setNotes(e.target.value)} />
          <p id={`${baseId}-notes-help`} className={styles.hint}>
            {m.notesHelp}
          </p>
        </div>,
      )}

      {error && (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      )}
      {blocked && (
        <p id={blockedId} className={styles.hint}>
          {(editing ? m.blockedEdit : m.blockedCreate)(blockers.join("; "))}
        </p>
      )}
      <div className={styles.actions}>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {m.back}
          </Button>
        )}
        <Button variant="primary" type="submit" disabled={blocked || busy} aria-describedby={blocked ? blockedId : undefined}>
          {editing ? m.submitEdit : m.submitCreate}
        </Button>
      </div>
    </form>
  );
}
