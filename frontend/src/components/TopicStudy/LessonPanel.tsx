"use client";

import { useEffect, useRef, type ComponentType } from "react";
import { CardsBlock, CuriosityBlock, Html, LegacyHtmlBlock, StepByStepBlock, TipBlock, UnknownBlock, WidgetBlock } from "@/components/ContentRenderer/blocks";
import type { TopicPlayer } from "@/hooks/useTopicPlayer";
import { cardOfStep, INTRO_LABEL, type LessonCard, type ScriptStep, type TopicScript } from "@/lib/topicScript";
import { contentMessages } from "@/messages/content.pt-BR";
import styles from "./LessonPanel.module.scss";

const m = contentMessages.topic.lesson;

type Payload = Record<string, unknown>;

/** Block types that need no special treatment inside a card. */
const PLAIN: Record<string, ComponentType<{ payload: Payload }>> = {
  TIP: TipBlock,
  CURIOSITY: CuriosityBlock,
  STEP_BY_STEP: StepByStepBlock,
  CARDS: CardsBlock,
  WIDGET: WidgetBlock,
  LEGACY_HTML: LegacyHtmlBlock,
};

function Examples({ steps, player, intro }: { steps: ScriptStep[]; player: TopicPlayer; intro: boolean }) {
  return (
    <>
      <div className={styles.label}>{intro ? m.examplesIntro : m.examples}</div>
      <ol className={styles.examples}>
        {steps.map((step) => {
          const terminal = step.terminal ?? 1;
          const current = player.running === step.index;
          const classes = [styles.example, current ? styles.running : "", (player.running ?? player.index) === step.index ? styles.current : "", player.done.has(step.index) ? styles.done : ""];
          return (
            <li key={step.index} className={classes.filter(Boolean).join(" ")} data-step={step.index}>
              <button type="button" className={styles.run} onClick={() => void player.runOne(step.index)} title={m.runStep(terminal)} aria-label={`${m.runStep(terminal)}: ${step.command}`}>
                ▶
              </button>
              <div className={styles.exampleBody}>
                <code className={styles.command}>
                  {terminal > 1 && (
                    <span className={styles.terminalTag} title={m.onTerminal(terminal)}>
                      T{terminal}
                    </span>
                  )}
                  {step.command}
                </code>
                {step.explanation && <span className={styles.explanation}>{step.explanation}</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** Renders the blocks of one card; COMMAND blocks become runnable examples. */
function CardBody({ card, steps, player }: { card: LessonCard; steps: ScriptStep[]; player: TopicPlayer }) {
  // Where the steps of each COMMAND block start inside the script.
  const starts = card.blocks.reduce<number[]>((acc, block, i) => {
    const previous = card.blocks[i - 1];
    const count = previous?.type === "COMMAND" && Array.isArray(previous.payload?.steps) ? previous.payload.steps.length : 0;
    acc.push((acc[i - 1] ?? card.start) + count);
    return acc;
  }, []);

  return (
    <>
      {card.blocks.map((block, i) => {
        const payload = block.payload ?? {};
        if (block.type === "TEXT") return <Html key={block.id} html={typeof payload.html === "string" ? payload.html : ""} className={styles.text} />;
        if (block.type === "COMMAND") {
          const from = starts[i] ?? card.start;
          const count = Array.isArray(payload.steps) ? payload.steps.length : 0;
          const own = steps.slice(from, from + count);
          return own.length ? <Examples key={block.id} steps={own} player={player} intro={card.index === 0 && card.label === INTRO_LABEL} /> : null;
        }
        const Component = PLAIN[block.type];
        return Component ? <Component key={block.id} payload={payload} /> : <UnknownBlock key={block.id} />;
      })}
    </>
  );
}

export interface LessonPanelProps {
  script: TopicScript;
  player: TopicPlayer;
}

/** The "Comandos e dicas" tab: the module blocks grouped in lesson cards (SPEC-016). */
export function LessonPanel({ script, player }: LessonPanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  const { running } = player;

  // Keeps the example that is being typed in view, as the prototype does.
  useEffect(() => {
    if (running === null) return;
    const timer = window.setTimeout(
      () => panel.current?.querySelector(`[data-step="${running}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      400,
    );
    return () => window.clearTimeout(timer);
  }, [running]);

  if (script.cards.length === 0) return <p className={styles.empty}>{m.empty}</p>;

  const target = player.running ?? player.index + 1;
  const activeCard = player.playing || player.running !== null ? cardOfStep(script.cards, target) : -1;

  return (
    <div ref={panel} className={styles.panel}>
      {script.cards.map((card) => {
        const hasSteps = card.end > card.start;
        const playing = player.playing && player.playingCard === card.index;
        return (
          <article key={card.index} className={`${styles.card} ${activeCard === card.index ? styles.active : ""}`} data-card={card.index}>
            <header className={styles.header}>
              <code className={styles.tag}>{card.label}</code>
              <h2 className={styles.title}>{card.title}</h2>
              {hasSteps && (
                <button
                  type="button"
                  className={`${styles.cardPlay} ${playing ? styles.playing : ""}`}
                  onClick={() => player.toggleCard(card.index)}
                  title={m.runCardTitle}
                >
                  {playing ? m.stopCard : m.runCard}
                </button>
              )}
            </header>
            <CardBody card={card} steps={script.steps} player={player} />
          </article>
        );
      })}
    </div>
  );
}
