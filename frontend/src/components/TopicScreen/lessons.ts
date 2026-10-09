import type { Step } from "@/engine/engine";
import type { ContentBlock } from "@/services/contentService";

// Lesson cards of the prototype topic screen rebuilt from the content blocks
// (SPEC-016 P-01): a titled TEXT block opens a lesson card, and the untitled
// blocks after it belong to it. Blocks before the first lesson form the
// concepts card.

export interface LessonCard {
  kind: "concepts" | "lesson";
  /** Command shown in the card header (lessons only). */
  command?: string;
  title?: string;
  blocks: ContentBlock[];
  /** Global indexes of the card steps in the topic script. */
  firstStep: number;
  stepCount: number;
}

export interface TopicScript {
  cards: LessonCard[];
  /** Every example command, in order: the script of the player. */
  steps: Step[];
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

function stepsOf(block: ContentBlock): Step[] {
  const raw = Array.isArray(block.payload.steps) ? (block.payload.steps as Step[]) : [];
  return raw.filter((s) => typeof s?.command === "string");
}

export function buildScript(blocks: ContentBlock[]): TopicScript {
  const cards: LessonCard[] = [];
  const steps: Step[] = [];
  let card: LessonCard | null = null;

  for (const block of [...blocks].sort((a, b) => a.position - b.position)) {
    const title = block.type === "TEXT" ? text(block.payload.title) : undefined;
    if (title) {
      card = { kind: "lesson", title, command: text(block.payload.command), blocks: [], firstStep: steps.length, stepCount: 0 };
      cards.push(card);
    } else if (!card) {
      card = { kind: "concepts", blocks: [], firstStep: steps.length, stepCount: 0 };
      cards.push(card);
    }
    card.blocks.push(block);
    if (block.type === "COMMAND") {
      const own = stepsOf(block);
      steps.push(...own);
      card.stepCount += own.length;
    }
  }
  return { cards, steps };
}

/** Index of the card that holds the global step, or -1. */
export function cardOfStep(cards: LessonCard[], step: number): number {
  return cards.findIndex((c) => step >= c.firstStep && step < c.firstStep + c.stepCount);
}

/** Splits a legacy module description ("pwd · ls — Summary") into its tags line and summary. */
export function subtitleOf(description: string): string {
  const separator = description.indexOf(" — ");
  return separator < 0 ? description : description.slice(0, separator);
}
