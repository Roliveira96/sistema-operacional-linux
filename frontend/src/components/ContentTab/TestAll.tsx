"use client";

import { useEffect, useMemo, useState } from "react";
import { CardTester } from "@/components/CardBuilder/CardTester";
import cardStyles from "@/components/CardBuilder/CardBuilder.module.scss";
import { groupCards, parseCard, type CardGroup, type CardModel } from "@/lib/cardModel";
import { allLayers, type SetupLayer } from "@/lib/setup";
import { saveTest } from "@/lib/testRecord";
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

interface TestAllProps {
  moduleId: string;
  service: Pick<ContentAuthoringService, "content">;
  practice: Pick<PracticeService, "topicScenario">;
  /** Called after each card is tested, so the list can show its new mark. */
  onResult: () => void;
  onClose: () => void;
}

/**
 * Tests every card of the module, one after the other, each on a clean machine with the snapshots
 * of the module and of the cards above it, as the student gets them (SPEC-021). Each result is
 * recorded the same way as a test of a single card.
 */
export function TestAll({ moduleId, service, practice, onResult, onClose }: TestAllProps) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [failedToLoad, setFailedToLoad] = useState(false);
  const [at, setAt] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);

  useEffect(() => {
    let active = true;
    service
      .content(moduleId)
      .then(({ blocks, setup }) => {
        if (!active) return;
        const groups = groupCards(blocks.filter((b) => b.active));
        const list: Item[] = [];
        groups.forEach((group, i) => {
          const card = parseCard(group);
          const own = card.setup && card.setup.steps.length > 0;
          if (card.commands.length === 0 && !own) return;
          const before = allLayers(setup, groups.slice(0, i).flatMap((g) => g.blocks));
          const title = card.title.trim() || m.intro;
          list.push({ group, card, title, layers: own ? [...before, { id: group.key, kind: "card", label: title, setup: card.setup! }] : before });
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
  if (!items) return <p className={cardStyles.hint}>{m.loading}</p>;

  const finished = at >= items.length;
  const current = items[at];
  const passed = results.filter(Boolean).length;

  return (
    <div className={cardStyles.tester} role="region" aria-label={m.title}>
      <div className={cardStyles.groupHead}>
        <h3 className={cardStyles.groupTitle}>{m.title}</h3>
        <button type="button" className={cardStyles.secondary} onClick={onClose}>
          {m.close}
        </button>
      </div>
      {items.length === 0 && <p className={cardStyles.hint}>{m.nothing}</p>}
      {items.length > 0 && (
        <p className={cardStyles.hint} role="status">
          {finished ? m.summary(passed, items.length) : m.progress(at + 1, items.length, current!.title)}
        </p>
      )}
      <ol className={cardStyles.results}>
        {items.map((item, i) => (
          <li key={item.group.key} className={`${cardStyles.result} ${results[i] === undefined ? "" : results[i] ? cardStyles.resultGood : cardStyles.resultBad}`}>
            <code>{item.title}</code>
            <span className={cardStyles.resultText}>{results[i] === undefined ? (i === at ? m.running : m.pending) : results[i] ? m.passed : m.failed}</span>
          </li>
        ))}
      </ol>
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
    </div>
  );
}
