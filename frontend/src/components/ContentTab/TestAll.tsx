"use client";

import { useEffect, useMemo, useState } from "react";
import { CardTester } from "@/components/CardBuilder/CardTester";
import cardStyles from "@/components/CardBuilder/CardBuilder.module.scss";
import { groupCards, parseCard, type CardGroup, type CardModel } from "@/lib/cardModel";
import { allLayers, type SetupLayer } from "@/lib/setup";
import { activeCards, moduleFingerprint, saveModuleTest, saveTest } from "@/lib/testRecord";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import type { ContentAuthoringService } from "@/services/contentAuthoringService";
import type { PracticeService } from "@/services/practiceService";

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

/** Whether each card ended as expected, from the verdict of each of its commands. */
function perCard(cards: Whole["cards"], good: boolean[]): boolean[] {
  let from = 0;
  return cards.map(({ count }) => {
    const ok = good.slice(from, from + count).every(Boolean);
    from += count;
    return ok;
  });
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
 * The test of a module. First the unit tests: each card on its own clean machine, with the snapshots
 * of the module and of the cards above it, as the student gets them. Then the test of the module:
 * one clean machine, the environment, and the exercises one after the other without zeroing it.
 * Each result is recorded; the module passes when every card and the sequence pass (SPEC-021).
 */
export function TestAll({ moduleId, service, practice, onResult, onClose }: TestAllProps) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [whole, setWhole] = useState<Whole | null>(null);
  const [failedToLoad, setFailedToLoad] = useState(false);
  const [at, setAt] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const [sequence, setSequence] = useState<boolean | null>(null);
  const [forward, setForward] = useState<boolean[] | null>(null);
  const [backward, setBackward] = useState<boolean[] | null>(null);

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
          const own = card.setup && card.setup.steps.length > 0;
          if (card.commands.length === 0 && !own) return;
          const before = allLayers(setup, groups.slice(0, i).flatMap((g) => g.blocks));
          list.push({ group, card, title, layers: own ? [...before, { id: group.key, kind: "card", label: title, setup: card.setup! }] : before });
        });
        setWhole({ commands, sections, layers: allLayers(setup, groups.flatMap((g) => g.blocks)), fingerprint: moduleFingerprint(activeCards(blocks), setup),
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
      <p className={cardStyles.error} role="alert">
        {m.loadFailed}
      </p>
    );
  if (!items || !whole) return <p className={cardStyles.hint}>{m.loading}</p>;

  const unitsDone = at >= items.length;
  const current = items[at];
  const passed = results.filter(Boolean).length;
  const unitsOk = unitsDone && results.every(Boolean);
  // The activities that pass in their order and fail when the order is reversed need what an earlier one did.
  const forwardCards = forward ? perCard(whole.cards, forward) : [];
  const backwardCards = backward ? perCard([...whole.cards].reverse(), backward).reverse() : [];
  // A card that works in the sequence but not alone also needs what the others did.
  const unitOf = (key: string) => results[items.findIndex((item) => item.group.key === key)];
  const dependents: { title: string; reason: string }[] = [];
  if (backward) {
    whole.cards.forEach((card, i) => {
      if (!forwardCards[i]) return;
      if (unitOf(card.key) === false) dependents.push({ title: card.title, reason: m.dependsAlone });
      else if (!backwardCards[i]) dependents.push({ title: card.title, reason: m.dependsOnEarlier });
    });
  }
  const nothing = items.length === 0 && whole.commands.length === 0 && whole.layers.length === 0;

  return (
    <div className={cardStyles.tester} role="region" aria-label={m.moduleTitle}>
      <div className={cardStyles.groupHead}>
        <h3 className={cardStyles.groupTitle}>{m.moduleTitle}</h3>
        <button type="button" className={cardStyles.secondary} onClick={onClose}>
          {m.close}
        </button>
      </div>
      <p className={cardStyles.hint}>{m.moduleHelp}</p>
      {nothing && <p className={cardStyles.hint}>{m.nothing}</p>}
      {!nothing && (
        <ul className={cardStyles.results} aria-label={m.scoreboard}>
          <li className={`${cardStyles.result} ${!unitsDone ? "" : unitsOk ? cardStyles.resultGood : cardStyles.resultBad}`}>
            <code>{m.unitsName}</code>
            <span className={cardStyles.resultText}>{!unitsDone ? m.pending : unitsOk ? m.ok : m.failed}</span>
          </li>
          <li className={`${cardStyles.result} ${sequence === null ? "" : sequence ? cardStyles.resultGood : cardStyles.resultBad}`}>
            <code>{m.sequenceName}</code>
            <span className={cardStyles.resultText}>{sequence === null ? m.pending : sequence ? m.ok : m.failed}</span>
          </li>
          <li className={`${cardStyles.result} ${!backward ? "" : dependents.length === 0 ? cardStyles.resultGood : cardStyles.resultBad}`}>
            <code>{m.inverseName}</code>
            <span className={cardStyles.resultText}>{!backward ? m.pending : dependents.length === 0 ? m.noDependencies : m.dependencies(dependents.length)}</span>
          </li>
        </ul>
      )}

      {items.length > 0 && (
        <>
          <h4 className={cardStyles.groupTitle}>{m.unitsTitle}</h4>
          <p className={cardStyles.hint} role="status">
            {unitsDone ? m.summary(passed, items.length) : m.progress(at + 1, items.length, current!.title)}
          </p>
          <ol className={cardStyles.results}>
            {items.map((item, i) => (
              <li key={item.group.key} className={`${cardStyles.result} ${results[i] === undefined ? "" : results[i] ? cardStyles.resultGood : cardStyles.resultBad}`}>
                <code>{item.title}</code>
                <span className={cardStyles.resultText}>{results[i] === undefined ? (i === at ? m.running : m.pending) : results[i] ? m.passed : m.failed}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      {current && (
        <CardTester
          key={current.group.key}
          commands={current.card.commands}
          loadBase={loadBase}
          layers={current.layers}
          onClose={onClose}
          onFinish={(ok) => {
            saveTest(moduleId, current.group.key, ok, current.card);
            setResults((prev) => [...prev, ok]);
            onResult();
            // Leaves the result of this card on screen for a moment before the next one starts.
            window.setTimeout(() => setAt((n) => n + 1), 1200);
          }}
        />
      )}

      {unitsDone && !nothing && (
        <>
          <h4 className={cardStyles.groupTitle}>{m.sequenceTitle}</h4>
          <p className={cardStyles.hint}>{m.sequenceHelp}</p>
          <CardTester
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
          {sequence !== null && (
            <>
              <h4 className={cardStyles.groupTitle}>{m.inverseTitle}</h4>
              <p className={cardStyles.hint}>{m.inverseHelp}</p>
              {whole.cards.length < 2 ? (
                <p className={cardStyles.hint}>{m.inverseNeedsTwo}</p>
              ) : (
                <CardTester commands={whole.reversed.commands} loadBase={loadBase} layers={whole.layers} sections={whole.reversed.sections} onClose={onClose} onVerdicts={setBackward} />
              )}
              {backward && dependents.length > 0 && (
                <ul className={cardStyles.results} aria-label={m.dependentsTitle}>
                  {dependents.map(({ title, reason }) => (
                    <li key={title} className={`${cardStyles.result} ${cardStyles.resultBad}`}>
                      <code>{title}</code>
                      <span className={cardStyles.resultText}>{reason}</span>
                    </li>
                  ))}
                </ul>
              )}
              {(backward || whole.cards.length < 2) && (
                <p className={sequence && unitsOk ? cardStyles.saved : cardStyles.error} role="status">
                  {sequence && unitsOk ? m.moduleOk : m.moduleBad}
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
