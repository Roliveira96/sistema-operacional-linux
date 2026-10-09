"use client";

import type { ReactNode } from "react";
import { ContentRenderer } from "@/components/ContentRenderer/ContentRenderer";
import { WidgetBlock } from "@/components/ContentRenderer/blocks";
import type { Step } from "@/engine/engine";
import { contentMessages } from "@/messages/content.pt-BR";
import type { ContentBlock } from "@/services/contentService";
import type { LessonCard } from "./lessons";
import styles from "./TopicScreen.module.scss";

// Lesson cards with the classes of the prototype stylesheet (topico.css),
// rebuilt from the content blocks (SPEC-016 P-01). HTML fields were filtered
// by the backend (SPEC-011 RN-08) and are rendered as received.

const m = contentMessages.topic;

const text = (v: unknown): string => (typeof v === "string" ? v : "");

export interface StepState {
  /** Step being typed now. */
  running: number | null;
  /** Steps already run. */
  done: ReadonlySet<number>;
}

export interface LessonCardsProps {
  cards: LessonCard[];
  steps: Step[];
  state: StepState;
  /** Card highlighted by the player, or -1. */
  activeCard: number;
  /** Card playing by its own play button, or null. */
  playingCard: number | null;
  onRunStep(index: number): void;
  onToggleCard(card: number): void;
}

/** Splits the lesson text ("<p>description</p><pre><code>syntax</code></pre>"). */
function splitSyntax(html: string): { description: string; syntax: string } {
  const match = /^([\s\S]*?)<pre><code>([\s\S]*?)<\/code><\/pre>\s*$/.exec(html);
  return match ? { description: match[1]!, syntax: match[2]! } : { description: html, syntax: "" };
}

function Examples({ card, steps, state, onRunStep }: Pick<LessonCardsProps, "steps" | "state" | "onRunStep"> & { card: LessonCard }) {
  const items: ReactNode[] = [];
  for (let i = card.firstStep; i < card.firstStep + card.stepCount; i++) {
    const step = steps[i]!;
    const terminal = step.terminal ?? 1;
    const classes = ["exemplo", state.running === i ? "atual executando" : "", state.done.has(i) ? "feito" : ""];
    items.push(
      <li key={i} className={classes.filter(Boolean).join(" ")} data-step={i}>
        <button
          type="button"
          className="exemplo-rodar"
          title={m.runStep(terminal)}
          aria-label={`${m.runStep(terminal)}: ${step.command}`}
          disabled={state.running !== null}
          onClick={() => onRunStep(i)}
        >
          ▶
        </button>
        <div className="exemplo-corpo">
          <code className="exemplo-comando">
            {terminal > 1 && <span className="exemplo-terminal">{m.terminalTag(terminal)}</span>}
            {step.command}
          </code>
          {step.explanation && <span className="exemplo-explicacao">{step.explanation}</span>}
        </div>
      </li>,
    );
  }
  return <ol className="exemplos">{items}</ol>;
}

function Block({ block, first }: { block: ContentBlock; first: boolean }) {
  const html = text(block.payload.html);
  switch (block.type) {
    case "TEXT": {
      if (/^\s*<table>/.test(html)) {
        return (
          <div
            className={styles.options}
            dangerouslySetInnerHTML={{ __html: html.replace("<table>", '<table class="licao-opcoes">') }}
          />
        );
      }
      // The first TEXT of a lesson carries its description and syntax.
      const { description, syntax } = first ? splitSyntax(html) : { description: html, syntax: "" };
      return (
        <>
          <div className={`licao-descricao ${styles.description}`} dangerouslySetInnerHTML={{ __html: description }} />
          {syntax && (
            <div className="licao-sintaxe">
              <span>{m.syntax}</span>
              <code dangerouslySetInnerHTML={{ __html: syntax }} />
            </div>
          )}
        </>
      );
    }
    case "LEGACY_HTML":
      return <div className={styles.concepts} dangerouslySetInnerHTML={{ __html: html }} />;
    case "CURIOSITY":
      return (
        <div className="na-pratica">
          <b>{m.realLife}</b>
          <p dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      );
    case "TIP":
      if (block.payload.variant === "WARNING") {
        return (
          <div className="licao-pegadinha">
            <b>{m.pitfall}</b> <span dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        );
      }
      return <div dangerouslySetInnerHTML={{ __html: html.replace("<ul>", '<ul class="licao-dicas">') }} />;
    case "WIDGET":
      return <WidgetBlock payload={block.payload} />;
    default:
      return <ContentRenderer blocks={[block]} />;
  }
}

function PlayButton({ card, index, playing, onToggleCard }: { card: LessonCard; index: number; playing: boolean; onToggleCard(card: number): void }) {
  if (card.stepCount === 0) return null;
  return (
    <button
      type="button"
      className={`bloco-play ${playing ? "tocando" : ""}`}
      title={m.runCardTitle}
      aria-pressed={playing}
      onClick={() => onToggleCard(index)}
    >
      {playing ? m.stopCard : m.runCard}
    </button>
  );
}

/** The "Comandos e dicas" tab: concepts and lesson cards with their examples. */
export function LessonCards({ cards, steps, state, activeCard, playingCard, onRunStep, onToggleCard }: LessonCardsProps) {
  return (
    <>
      {cards.map((card, index) => {
        const active = index === activeCard ? "bloco-ativo" : "";
        const play = <PlayButton card={card} index={index} playing={playingCard === index} onToggleCard={onToggleCard} />;
        // The card examples are listed once, where its first COMMAND block is.
        const firstCommand = card.blocks.findIndex((b) => b.type === "COMMAND");
        const blocks = card.blocks.map((block, i) => {
          if (block.type !== "COMMAND") return <Block key={block.id} block={block} first={card.kind === "lesson" && i === 0} />;
          if (i !== firstCommand || card.stepCount === 0) return null;
          return (
            <div key={block.id}>
              <div className="licao-rotulo">{card.kind === "concepts" ? m.tryIt : m.examples}</div>
              <Examples card={card} steps={steps} state={state} onRunStep={onRunStep} />
            </div>
          );
        });
        if (card.kind === "concepts") {
          return (
            <div key={index} className={`conceitos bloco ${active}`} data-card={index}>
              {card.stepCount > 0 && (
                <div className="bloco-barra">
                  <span className="bloco-rotulo">{m.conceptsLabel}</span>
                  {play}
                </div>
              )}
              {blocks}
            </div>
          );
        }
        return (
          <article key={index} className={`licao bloco ${active}`} data-card={index}>
            <header>
              {card.command && <code className="licao-comando">{card.command}</code>}
              <h2>{card.title}</h2>
              {play}
            </header>
            {blocks}
          </article>
        );
      })}
    </>
  );
}
