"use client";

import { useEffect, useRef, type ComponentType } from "react";
import { CardsBlock, CuriosityBlock, Html, LegacyHtmlBlock, StepByStepBlock, TipBlock, UnknownBlock, WidgetBlock } from "@/components/ContentRenderer/blocks";
import { ExercisesBlock } from "@/components/ContentRenderer/ExercisesBlock";
import type { TopicPlayer } from "@/hooks/useTopicPlayer";
import { SKIP_ATTRIBUTE } from "@/lib/narration";
import { INTRO_LABEL, type LessonCard, type ScriptStep, type TopicScript } from "@/lib/topicScript";
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
  EXERCISES: ExercisesBlock,
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
                <code className={styles.command} data-narrate="command">
                  {terminal > 1 && (
                    <span className={styles.terminalTag} title={m.onTerminal(terminal)} {...{ [SKIP_ATTRIBUTE]: "" }}>
                      T{terminal}
                    </span>
                  )}
                  {step.command}
                </code>
                {step.expectError && (
                  <span className={styles.expectError} title={m.expectErrorTitle} {...{ [SKIP_ATTRIBUTE]: "" }}>
                    {m.expectError}
                  </span>
                )}
                {step.explanation && (
                  <span className={styles.explanation} data-narrate="explanation">
                    {step.explanation}
                  </span>
                )}
                {step.outputExplanation && (
                  <span className={styles.outputExplanation} data-narrate="outputExplanation">
                    {step.outputExplanation}
                  </span>
                )}
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
        if (block.type === "TEXT") {
          return (
            <div key={block.id} data-block={block.id}>
              <Html html={typeof payload.html === "string" ? payload.html : ""} className={styles.text} />
            </div>
          );
        }
        if (block.type === "COMMAND") {
          const from = starts[i] ?? card.start;
          const count = Array.isArray(payload.steps) ? payload.steps.length : 0;
          const own = steps.slice(from, from + count);
          return own.length ? <Examples key={block.id} steps={own} player={player} intro={card.index === 0 && card.label === INTRO_LABEL} /> : null;
        }
        const Component = PLAIN[block.type];
        return (
          <div key={block.id} data-block={block.id}>
            {Component ? <Component payload={payload} /> : <UnknownBlock />}
          </div>
        );
      })}
    </>
  );
}

export interface LessonPanelProps {
  script: TopicScript;
  player: TopicPlayer;
  completedBlockIds?: Set<string>;
  completedAtByBlock?: Record<string, string>;
  onToggleBlockProgress?: (blockId: string, completed: boolean) => void;
}

function formatDate(iso?: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** The "Comandos e dicas" tab: the module blocks grouped in lesson cards (SPEC-016). */
export function LessonPanel({ script, player, completedBlockIds, completedAtByBlock, onToggleBlockProgress }: LessonPanelProps) {
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

  // The card being played, not the next command of the script: playing the second card of a
  // fresh module must highlight the second card, not the first one.
  const activeCard = player.activeCard ?? -1;

  return (
    <div ref={panel} className={styles.panel}>
      {script.cards.map((card) => {
        const hasSteps = card.end > card.start;
        const playing = player.playing && player.playingCard === card.index;
        const mainBlock = card.blocks[0];
        const blockId = mainBlock?.id ?? "";
        const isCompleted = blockId ? completedBlockIds?.has(blockId) ?? false : false;
        const completedAtText = blockId ? formatDate(completedAtByBlock?.[blockId]) : "";

        return (
          <article key={card.index} className={`${styles.card} ${activeCard === card.index ? styles.active : ""} ${isCompleted ? styles.cardCompleted : ""}`} data-card={card.index}>
            <header className={styles.header}>
              <code className={styles.tag}>{card.label}</code>
              <h2 className={styles.title} data-card-title={card.index}>
                {card.title}
              </h2>
              {onToggleBlockProgress && blockId && (
                <button
                  type="button"
                  className={`${styles.blockCheck} ${isCompleted ? styles.blockCompleted : ""}`}
                  onClick={() => onToggleBlockProgress(blockId, !isCompleted)}
                  title={isCompleted ? `Concluído em ${completedAtText}` : "Marcar este bloco como lido"}
                  aria-label={isCompleted ? `Concluído em ${completedAtText}` : "Marcar este bloco como lido"}
                >
                  {isCompleted ? `✓ Visto ${completedAtText ? `(${completedAtText})` : ""}` : "☐ Marcar como visto"}
                </button>
              )}
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
