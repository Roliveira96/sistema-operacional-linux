"use client";

import { useEffect, useMemo, useState } from "react";
import { CardTester } from "@/components/CardBuilder/CardTester";
import { groupCards, parseCard, type CardGroup, type CardModel } from "@/lib/cardModel";
import { allLayers, hasSetup, type SetupLayer } from "@/lib/setup";
import { activeCards, moduleFingerprint, saveModuleTest, saveTest } from "@/lib/testRecord";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import type { ContentAuthoringService } from "@/services/contentAuthoringService";
import type { PracticeService } from "@/services/practiceService";
import styles from "./TestAll.module.scss";

const m = authoringMessages.cards.testAll;

interface Item {
  group: CardGroup;
  card: CardModel;
  title: string;
  layers: SetupLayer[];
}

/** The whole module on one machine: every snapshot, then the commands of every card in order. */
interface Whole {
  commands: CardModel["commands"];
  sections: Record<number, string>;
  layers: SetupLayer[];
  fingerprint: string;
  /** The cards that have commands, in order, with how many each has. */
  cards: { key: string; title: string; count: number }[];
  /** The same commands with the cards in the opposite order, to find the activities that depend on others. */
  reversed: { commands: CardModel["commands"]; sections: Record<number, string> };
}

type Phase = "units" | "sequence" | "inverse";

/** Whether each card ended as expected, from the verdict of each of its commands. */
function perCard(cards: Whole["cards"], good: boolean[]): boolean[] {
  let from = 0;
  return cards.map(({ count }) => {
    const ok = good.slice(from, from + count).every(Boolean);
    from += count;
    return ok;
  });
}

/** The title of the card a command belongs to, given where each card starts. */
function ownerOf(sections: Record<number, string>, index: number): string {
  let title = "";
  for (const [start, name] of Object.entries(sections)) if (Number(start) <= index) title = name;
  return title;
}

type Mark = "idle" | "running" | "good" | "bad";

function Icon({ mark }: { mark: Mark }) {
  const symbol = mark === "good" ? "✓" : mark === "bad" ? "✗" : mark === "running" ? "…" : "•";
  return (
    <span className={`${styles.icon} ${mark === "good" ? styles.iconGood : mark === "bad" ? styles.iconBad : ""}`} aria-hidden="true">
      {symbol}
    </span>
  );
}

interface TestAllProps {
  moduleId: string;
  service: Pick<ContentAuthoringService, "content">;
  practice: Pick<PracticeService, "topicScenario">;
  /** Called after each result is recorded, so the list can show its new mark. */
  onResult: () => void;
  onClose: () => void;
}

/**
 * The test of a module, in three steps: each activity on its own machine (unit), the whole module on
 * one machine in order (sequence), and the same in reverse order to find the activities that depend
 * on others (inverse). The panel shows the verdict first and the detail of one step at a time (SPEC-021).
 */
export function TestAll({ moduleId, service, practice, onResult, onClose }: TestAllProps) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [whole, setWhole] = useState<Whole | null>(null);
  const [failedToLoad, setFailedToLoad] = useState(false);
  const [at, setAt] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  /** The first command that failed in each activity of the unit test, by card key. */
  const [unitFailures, setUnitFailures] = useState<Record<string, string>>({});
  const [sequence, setSequence] = useState<boolean | null>(null);
  const [forward, setForward] = useState<boolean[] | null>(null);
  const [backward, setBackward] = useState<boolean[] | null>(null);
  const [picked, setPicked] = useState<Phase | null>(null);

  useEffect(() => {
    let active = true;
    service
      .content(moduleId)
      .then(({ blocks, setup }) => {
        if (!active) return;
        const groups = groupCards(blocks.filter((b) => b.active));
        const list: Item[] = [];
        const cards = groups.map(parseCard);
        const withCommands = cards.map((card, i) => ({ card, key: groups[i]!.key, title: card.title.trim() || m.intro })).filter((c) => c.card.commands.length > 0);
        const reversedSections: Record<number, string> = {};
        const reversedCommands: CardModel["commands"] = [];
        [...withCommands].reverse().forEach((c) => {
          reversedSections[reversedCommands.length] = c.title;
          reversedCommands.push(...c.card.commands);
        });
        const commands: CardModel["commands"] = [];
        const sections: Record<number, string> = {};
        groups.forEach((group, i) => {
          const card = cards[i]!;
          const title = card.title.trim() || m.intro;
          if (card.commands.length > 0) sections[commands.length] = title;
          commands.push(...card.commands);
          const own = hasSetup(card.setup);
          if (card.commands.length === 0 && !own) return;
          const before = allLayers(setup, groups.slice(0, i).flatMap((g) => g.blocks));
          list.push({ group, card, title, layers: own ? [...before, { id: group.key, kind: "card", label: title, setup: card.setup! }] : before });
        });
        setWhole({
          commands,
          sections,
          layers: allLayers(setup, groups.flatMap((g) => g.blocks)),
          fingerprint: moduleFingerprint(activeCards(blocks), setup),
          cards: withCommands.map((c) => ({ key: c.key, title: c.title, count: c.card.commands.length })),
          reversed: { commands: reversedCommands, sections: reversedSections },
        });
        setItems(list);
      })
      .catch(() => active && setFailedToLoad(true));
    return () => {
      active = false;
    };
  }, [service, moduleId]);

  const loadBase = useMemo(() => () => practice.topicScenario(moduleId), [practice, moduleId]);

  if (failedToLoad)
    return (
      <p className={styles.problemsTitle} role="alert">
        {m.loadFailed}
      </p>
    );
  if (!items || !whole) return <p className={styles.lead}>{m.loading}</p>;

  const unitsDone = at >= items.length;
  const current = items[at];
  const unitsOk = unitsDone && results.every(Boolean);
  const needsTwo = whole.cards.length < 2;
  const inverseDone = backward !== null || (sequence !== null && needsTwo);
  const nothing = items.length === 0 && whole.commands.length === 0 && whole.layers.length === 0;

  // The activities that pass in their order and fail when the order is reversed, or fail alone, need what another one did.
  const forwardCards = forward ? perCard(whole.cards, forward) : [];
  const backwardCards = backward ? perCard([...whole.cards].reverse(), backward).reverse() : [];
  const unitOf = (key: string) => results[items.findIndex((item) => item.group.key === key)];
  const dependents: { title: string; reason: string }[] = [];
  if (backward) {
    whole.cards.forEach((card, i) => {
      if (!forwardCards[i]) return;
      if (unitOf(card.key) === false) dependents.push({ title: card.title, reason: m.dependsAlone });
      else if (!backwardCards[i]) dependents.push({ title: card.title, reason: m.dependsOnEarlier });
    });
  }

  // What went wrong, in plain words: the activity and the command.
  const problems: { title: string; text: string }[] = [];
  items.forEach((item, i) => {
    if (results[i] === false) problems.push({ title: item.title, text: m.unitProblem(unitFailures[item.group.key] ?? "") });
  });
  if (forward) {
    const first = forward.findIndex((ok) => !ok);
    if (first >= 0) problems.push({ title: ownerOf(whole.sections, first), text: m.sequenceProblem(whole.commands[first]?.command ?? "") });
  }
  dependents.forEach((d) => problems.push({ title: d.title, text: d.reason }));

  const forwardFailed = forward ? forward.filter((ok) => !ok).length : 0;
  const stepMark = (phase: Phase): Mark => {
    if (phase === "units") return !unitsDone ? "running" : unitsOk ? "good" : "bad";
    if (phase === "sequence") return sequence === null ? (unitsDone ? "running" : "idle") : sequence ? "good" : "bad";
    if (!inverseDone) return sequence === null ? "idle" : "running";
    // With a single activity there is no order to compare.
    if (needsTwo) return "idle";
    return dependents.length === 0 ? "good" : "bad";
  };
  const captions: Record<Phase, string> = {
    units: !unitsDone ? m.progress(at + 1, items.length, current!.title) : m.unitsResult(results.filter(Boolean).length, items.length),
    sequence: sequence === null ? (unitsDone ? m.running : m.waiting) : m.sequenceResult(whole.commands.length - forwardFailed, whole.commands.length),
    inverse: !inverseDone ? (sequence === null ? m.waiting : m.running) : needsTwo ? m.inverseNeedsTwo : dependents.length === 0 ? m.noDependencies : m.dependencies(dependents.length),
  };
  const names: Record<Phase, string> = { units: m.unitsName, sequence: m.sequenceName, inverse: m.inverseName };

  // The step on screen: the one that is running, or the first problem once everything ended; the author can pick another.
  const running: Phase = !unitsDone ? "units" : sequence === null ? "sequence" : "inverse";
  const problemPhase: Phase | undefined = !unitsOk ? "units" : sequence === false ? "sequence" : dependents.length > 0 ? "inverse" : undefined;
  const shown: Phase = picked ?? (inverseDone ? (problemPhase ?? "units") : running);

  // The tests done so far: each activity alone, each command of the sequence and each command of the inverse order.
  const unitPassed = results.filter(Boolean).length;
  const sequencePassed = forward ? forward.filter(Boolean).length : 0;
  const inversePassed = backward ? backward.filter(Boolean).length : 0;
  const counts = { activities: results.length, sequence: forward ? forward.length : 0, inverse: backward ? backward.length : 0 };
  const done = counts.activities + counts.sequence + counts.inverse;
  const passedTests = unitPassed + sequencePassed + inversePassed;

  const finished = unitsDone && sequence !== null && inverseDone;
  const passed = unitsOk && sequence === true;

  return (
    <section className={styles.panel} aria-label={m.moduleTitle}>
      <div className={styles.head}>
        <div>
          <h3 className={styles.title}>{m.moduleTitle}</h3>
          <p className={styles.lead}>{m.lead}</p>
        </div>
        <button type="button" className={styles.close} onClick={onClose}>
          {m.close}
        </button>
      </div>

      {nothing && <p className={styles.lead}>{m.nothing}</p>}

      {finished && !nothing && (
        <div className={`${styles.verdict} ${passed ? styles.verdictGood : styles.verdictBad}`} role="status">
          <span className={styles.verdictTitle}>{passed ? m.approved : m.reproved}</span>
          <span className={styles.verdictText}>{passed ? (dependents.length > 0 ? m.approvedWithDependencies : m.approvedText) : m.reprovedText}</span>
        </div>
      )}

      {!nothing && (
        <p className={styles.totals} aria-label={m.totalsLabel}>
          <strong>{m.totals(done, passedTests, done - passedTests)}</strong>
          <span>{m.totalsDetail(counts.activities, counts.sequence, counts.inverse)}</span>
        </p>
      )}

      {!nothing && (
        <ol className={styles.steps} role="tablist" aria-label={m.scoreboard}>
          {(["units", "sequence", "inverse"] as Phase[]).map((phase, i) => (
            <li key={phase}>
              <button type="button" role="tab" aria-selected={shown === phase} className={styles.step} onClick={() => setPicked(phase)}>
                <Icon mark={stepMark(phase)} />
                <span className={styles.stepText}>
                  <span className={styles.stepName}>{`${i + 1}. ${names[phase]}`}</span>
                  <span className={styles.stepCaption}>{captions[phase]}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}

      {problems.length > 0 && (
        <div className={styles.problems} role="alert" aria-label={m.problemsTitle}>
          <p className={styles.problemsTitle}>{m.problemsTitle}</p>
          {problems.map((p, i) => (
            <p key={i} className={styles.problem}>
              <strong>{p.title}</strong>
              <span>{p.text}</span>
            </p>
          ))}
        </div>
      )}

      {!nothing && (
        <>
          <div className={styles.detail} hidden={shown !== "units"}>
            <p className={styles.detailHelp}>{m.unitsHelp}</p>
            <ul className={styles.activities}>
              {items.map((item, i) => (
                <li key={item.group.key} className={styles.activity}>
                  <Icon mark={results[i] === undefined ? (i === at ? "running" : "idle") : results[i] ? "good" : "bad"} />
                  <span className={styles.activityName}>{item.title}</span>
                  <span className={styles.activityState}>{results[i] === undefined ? (i === at ? m.running : m.waiting) : results[i] ? m.passed : m.failed}</span>
                </li>
              ))}
            </ul>
            {current && (
              <CardTester
                key={current.group.key}
                compact
                commands={current.card.commands}
                loadBase={loadBase}
                layers={current.layers}
                onClose={onClose}
                onVerdicts={(good) => {
                  const bad = good.findIndex((ok) => !ok);
                  if (bad >= 0) setUnitFailures((prev) => ({ ...prev, [current.group.key]: current.card.commands[bad]?.command ?? "" }));
                }}
                onFinish={(ok) => {
                  saveTest(moduleId, current.group.key, ok, current.card);
                  setResults((prev) => [...prev, ok]);
                  onResult();
                  // Leaves the result of this card on screen for a moment before the next one starts.
                  window.setTimeout(() => setAt((n) => n + 1), 1200);
                }}
              />
            )}
          </div>

          {unitsDone && (
            <div className={styles.detail} hidden={shown !== "sequence"}>
              <p className={styles.detailHelp}>{m.sequenceHelp}</p>
              <CardTester
                compact
                commands={whole.commands}
                loadBase={loadBase}
                layers={whole.layers}
                sections={whole.sections}
                onClose={onClose}
                onVerdicts={setForward}
                onFinish={(ok) => {
                  setSequence(ok);
                  saveModuleTest(moduleId, ok && results.every(Boolean), whole.fingerprint);
                  onResult();
                }}
              />
            </div>
          )}

          {sequence !== null && (
            <div className={styles.detail} hidden={shown !== "inverse"}>
              <p className={styles.detailHelp}>{m.inverseHelp}</p>
              {needsTwo ? (
                <p className={styles.detailHelp}>{m.inverseNeedsTwo}</p>
              ) : (
                <CardTester compact commands={whole.reversed.commands} loadBase={loadBase} layers={whole.layers} sections={whole.reversed.sections} onClose={onClose} onVerdicts={setBackward} />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
