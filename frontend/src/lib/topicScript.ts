// Groups the content blocks of a module into the lesson cards of the prototype
// and flattens their commands into the script the player runs (SPEC-016).
import type { ContentBlock } from "@/services/contentService";
import type { TerminalStep } from "@/engine/terminalWindow";

/** A command of the script with its explanation, ready for the screen. */
export interface ScriptStep extends TerminalStep {
  /** Position in the whole script, across cards. */
  index: number;
  explanation?: string;
}

export interface LessonCard {
  index: number;
  /** Short label shown in the player and on the card (the command or concept). */
  label: string;
  title: string;
  blocks: ContentBlock[];
  /** Range of the script steps of this card: [start, end). */
  start: number;
  end: number;
}

export interface TopicScript {
  cards: LessonCard[];
  steps: ScriptStep[];
}

/** Label of the introductory card (blocks before the first titled TEXT block). */
export const INTRO_LABEL = "conceitos";
const INTRO_TITLE = "Antes dos comandos";

const text = (value: unknown): string => (typeof value === "string" ? value : "");

interface RawStep {
  command?: unknown;
  explanation?: unknown;
  terminal?: unknown;
  login?: { user?: unknown; password?: unknown };
  answers?: unknown;
}

function toStep(raw: RawStep, index: number): ScriptStep {
  const step: ScriptStep = { index, command: text(raw.command) };
  if (typeof raw.explanation === "string" && raw.explanation) step.explanation = raw.explanation;
  if (typeof raw.terminal === "number") step.terminal = raw.terminal;
  if (raw.login && typeof raw.login.user === "string") {
    step.login = { user: raw.login.user, password: text(raw.login.password) };
  }
  if (Array.isArray(raw.answers)) step.answers = raw.answers.filter((a): a is string => typeof a === "string");
  return step;
}

/**
 * A TEXT block with a title opens a new card; the blocks after it, until the
 * next titled TEXT block, belong to it. The blocks before the first card form
 * the introductory "concepts" card.
 */
export function buildTopicScript(blocks: ContentBlock[]): TopicScript {
  const cards: LessonCard[] = [];
  const steps: ScriptStep[] = [];

  const open = (label: string, title: string): LessonCard => {
    const card: LessonCard = { index: cards.length, label, title, blocks: [], start: steps.length, end: steps.length };
    cards.push(card);
    return card;
  };

  let current: LessonCard | null = null;
  for (const block of [...blocks].sort((a, b) => a.position - b.position)) {
    const title = text(block.payload.title);
    if (block.type === "TEXT" && title) {
      current = open(text(block.payload.command) || title, title);
    } else {
      current ??= open(INTRO_LABEL, INTRO_TITLE);
    }
    current.blocks.push(block);
    if (block.type === "COMMAND" && Array.isArray(block.payload.steps)) {
      for (const raw of block.payload.steps as RawStep[]) steps.push(toStep(raw, steps.length));
      current.end = steps.length;
    }
  }
  return { cards, steps };
}

/** Index of the card that owns a script step, or -1. */
export function cardOfStep(cards: LessonCard[], step: number): number {
  return cards.findIndex((card) => step >= card.start && step < card.end);
}
