"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Html } from "@/components/ContentRenderer/blocks";
import { contentMessages } from "@/messages/content.pt-BR";
import shared from "@/components/TrueFalseAnswer/TrueFalseAnswer.module.scss";
import styles from "./MatchingAnswer.module.scss";

const m = contentMessages.matching;
const tf = contentMessages.trueFalse;

/** One item of a column, as the student sees it. */
export interface MatchingItem {
  id: string;
  text: string;
}

/** A link between an item of the left column and one of the right column. */
export interface MatchingLink {
  left: string;
  right: string;
}

/** What the student learns after checking a matching exercise (SPEC-037 RN-06). */
export interface MatchingResult {
  links: MatchingLink[];
  passed: boolean;
  pairs: MatchingLink[];
  results: (MatchingLink & { correct: boolean })[];
  explanation?: string | null;
}

interface ExerciseMode {
  /** Exercise: the links are checked with the button, once every item is linked; then the answer is locked (SPEC-037 D-05). */
  mode: "exercise";
  result: MatchingResult | null;
  onAnswer: (links: MatchingLink[]) => void;
  busy?: boolean;
  message?: React.ReactNode;
  disabled?: boolean;
}

interface AssessmentMode {
  /** Assessment: the links change at any time while it is open, with no check and no result (SPEC-035 RN-07). */
  mode: "assessment";
  value: MatchingLink[];
  onChange: (links: MatchingLink[]) => void;
  disabled?: boolean;
}

export type MatchingAnswerProps = (ExerciseMode | AssessmentMode) & {
  /** The columns in the order to show them (already shuffled when the question asks). */
  left: MatchingItem[];
  right: MatchingItem[];
  label?: string;
};

type Line = { x1: number; y1: number; x2: number; y2: number; n: number; state: "" | "right" | "wrong" };

/**
 * The two columns of a matching question (SPEC-037): the student picks an item of each column to link them, and the link appears as an
 * animated line, with the same number and color on both sides. In an exercise the links are checked once all are made, then locked; in
 * an assessment they change freely.
 */
export function MatchingAnswer(props: MatchingAnswerProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [own, setOwn] = useState<MatchingLink[]>([]);
  const [picked, setPicked] = useState<{ side: "left" | "right"; id: string } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const result = props.mode === "exercise" ? props.result : null;
  const links = result ? result.links : props.mode === "assessment" ? props.value : own;
  const locked = result !== null || Boolean(props.disabled) || (props.mode === "exercise" && Boolean(props.busy));

  const numberOf = (leftId: string) => props.left.findIndex((it) => it.id === leftId) + 1;
  const linkOf = (side: "left" | "right", itemId: string) => links.find((l) => l[side] === itemId);
  const stateOf = (link: MatchingLink | undefined): "" | "right" | "wrong" => {
    if (!link || !result) return "";
    const r = result.results.find((x) => x.left === link.left && x.right === link.right);
    return r ? (r.correct ? "right" : "wrong") : "";
  };

  const setLinks = (next: MatchingLink[]) => (props.mode === "assessment" ? props.onChange(next) : setOwn(next));
  const choose = (side: "left" | "right", itemId: string) => {
    if (locked) return;
    if (!picked || picked.side === side) return setPicked(picked?.side === side && picked.id === itemId ? null : { side, id: itemId });
    const link = side === "left" ? { left: itemId, right: picked.id } : { left: picked.id, right: itemId };
    // A new link replaces whatever the two items were linked to.
    setLinks([...links.filter((l) => l.left !== link.left && l.right !== link.right), link].sort((a, b) => numberOf(a.left) - numberOf(b.left)));
    setPicked(null);
  };

  // The lines are drawn from the centers of the linked items, measured after each render and when the size changes.
  useLayoutEffect(() => {
    const measure = () => {
      const root = box.current;
      if (!root) return;
      const origin = root.getBoundingClientRect();
      const at = (itemId: string) => root.querySelector<HTMLElement>(`[data-item="${CSS.escape(itemId)}"]`)?.getBoundingClientRect();
      setLines(
        links.flatMap((l): Line[] => {
          const a = at(l.left);
          const b = at(l.right);
          if (!a || !b || a.width === 0 || b.width === 0) return [];
          return [{ x1: a.right - origin.left, y1: a.top + a.height / 2 - origin.top, x2: b.left - origin.left, y2: b.top + b.height / 2 - origin.top, n: numberOf(l.left), state: stateOf(l) }];
        }),
      );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(links), result]);

  useEffect(() => setPicked(null), [result]);

  const button = (side: "left" | "right", it: MatchingItem) => {
    const link = linkOf(side, it.id);
    const n = link ? numberOf(link.left) : 0;
    const state = stateOf(link);
    return (
      <li key={it.id}>
        <button
          type="button"
          data-item={it.id}
          className={`${shared.option} ${styles.item} ${link ? styles[`pair${n}`] : ""} ${picked?.side === side && picked.id === it.id ? styles.picked : ""} ${state ? shared[state] : ""}`}
          aria-pressed={picked?.side === side && picked.id === it.id}
          disabled={locked}
          onClick={() => choose(side, it.id)}
        >
          <span className={styles.text}>{it.text}</span>
          {link && (
            <span className={styles.badge} aria-label={m.pairBadge(n)}>
              {n}
            </span>
          )}
          {state && side === "left" && <span className={styles.verdict}>{state === "right" ? m.rightLink : m.wrongLink}</span>}
        </button>
      </li>
    );
  };

  const textOf = (side: "left" | "right", itemId: string) => (side === "left" ? props.left : props.right).find((it) => it.id === itemId)?.text ?? "";
  return (
    <div className={shared.answer} aria-label={props.label}>
      <p className={shared.note}>{m.how}</p>
      <div ref={box} className={styles.board}>
        <svg className={styles.lines} aria-hidden="true">
          {lines.map((l) => (
            <line key={`${l.n}-${l.x1}-${l.y1}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className={`${styles.line} ${styles[`stroke${l.n}`]} ${l.state ? styles[l.state] : ""}`} pathLength={1} />
          ))}
        </svg>
        <ul className={styles.column} aria-label={m.left}>
          {props.left.map((it) => button("left", it))}
        </ul>
        <ul className={styles.column} aria-label={m.right}>
          {props.right.map((it) => button("right", it))}
        </ul>
      </div>
      <p className={shared.note} role="status">
        {m.linked(links.length, props.left.length)}
      </p>
      {props.mode === "exercise" && !result && (
        <>
          <button type="button" className={styles.check} disabled={locked || links.length !== props.left.length} onClick={() => props.onAnswer(links)}>
            {m.check}
          </button>
          {props.busy && <p className={shared.note}>{tf.sending}</p>}
          {props.message && (
            <p className={shared.note} role="alert">
              {props.message}
            </p>
          )}
        </>
      )}
      {result && (
        <div id={`${id}-result`} className={`${shared.result} ${result.passed ? shared.resultRight : shared.resultWrong}`}>
          <p className={shared.verdict}>{result.passed ? tf.right : tf.wrong}</p>
          {!result.passed && (
            <>
              <p className={shared.explanationTitle}>{m.correctPairs}</p>
              <ul className={styles.pairs}>
                {result.pairs.map((p) => (
                  <li key={p.left}>{m.pairLine(textOf("left", p.left), textOf("right", p.right))}</li>
                ))}
              </ul>
            </>
          )}
          {result.explanation && (
            <div className={shared.explanation}>
              <p className={shared.explanationTitle}>{tf.explanation}</p>
              <Html html={result.explanation} />
            </div>
          )}
          <p className={shared.note}>{m.locked}</p>
        </div>
      )}
    </div>
  );
}
