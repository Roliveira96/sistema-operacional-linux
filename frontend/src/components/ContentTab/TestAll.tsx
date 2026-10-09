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

  useEffect(() => {
    let active = true;
    service
      .content(moduleId)
      .then(({ blocks, setup }) => {
        if (!active) return;
        const groups = groupCards(blocks.filter((b) => b.active));
        const list: Item[] = [];
        const cards = groups.map(parseCard);
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
        setWhole({ commands, sections, layers: allLayers(setup, groups.flatMap((g) => g.blocks)), fingerprint: moduleFingerprint(activeCards(blocks), setup) });
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
            onFinish={(ok) => {
              setSequence(ok);
              saveModuleTest(moduleId, ok && results.every(Boolean), whole.fingerprint);
              onResult();
            }}
          />
          {sequence !== null && (
            <p className={sequence && results.every(Boolean) ? cardStyles.saved : cardStyles.error} role="status">
              {sequence && results.every(Boolean) ? m.moduleOk : m.moduleBad}
            </p>
          )}
        </>
      )}
    </div>
  );
}
