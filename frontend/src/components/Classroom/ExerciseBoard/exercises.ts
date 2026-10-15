import { DIFFICULTIES } from "@/lib/exercises";
import { parseKind, usesTerminal } from "@/lib/questionKinds";
import { messages } from "@/messages/pt-BR";
import type { ExerciseDifficulty, ExerciseProgressEntry } from "@/services/classroomService";
import type { ContentBlock } from "@/services/contentService";
import { clean } from "../TeacherChat/TeacherChat";

const m = messages.classroom.exerciseBoard;

/** The minutes of a round: from 1 to 60, and 5 when the teacher says none (SPEC-065 3.1). */
export const DEFAULT_MINUTES = 5;
const MIN_MINUTES = 1;
const MAX_MINUTES = 60;

/** A student who sends no progress for longer than this is "Sem sinal" (SPEC-065 CA-06). */
export const SIGNAL_TIMEOUT_MS = 15_000;

/** A tip of an exercise: what to say, and a command of reference when there is one (empty when there is none). */
export interface BoardHint {
  text: string;
  command: string;
}

/** A practical exercise of the module that the teacher can start (SPEC-065 3.3). */
export interface BoardExercise {
  blockId: string;
  /** The place of the block among all the blocks of the module, from 1: the number the list of the block in focus gives it. */
  blockNumber: number;
  /** The position among the `items` of the block: what the server takes as `index`. */
  index: number;
  title: string;
  difficulty: ExerciseDifficulty;
  /** How many conditions of finalization it has; the server does not start one with none. */
  conditions: number;
  hints: BoardHint[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : "");

function readHints(value: unknown): BoardHint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((hint) => (isRecord(hint) && text(hint.text).trim() !== "" ? [{ text: text(hint.text).trim(), command: text(hint.command).trim() }] : []));
}

/**
 * The practical exercises of the blocks of the module, in the order of the blocks and of the items. The questions that are not solved in the terminal are
 * left out, and the others keep the position they have among the items, which is what the server starts them by.
 */
export function boardExercises(blocks: ContentBlock[]): BoardExercise[] {
  return [...blocks]
    .sort((a, b) => a.position - b.position)
    .flatMap((block, at) => {
      const items: unknown = block.type === "EXERCISES" ? block.payload.items : null;
      if (!Array.isArray(items)) return [];
      return items.flatMap((item: unknown, index) => {
        if (!isRecord(item) || !usesTerminal(parseKind(item.kind))) return [];
        const difficulty = DIFFICULTIES.find((level) => level === item.difficulty) ?? "MEDIUM";
        return [
          {
            blockId: block.id,
            blockNumber: at + 1,
            index,
            title: text(item.title).trim(),
            difficulty,
            conditions: Array.isArray(item.conditions) ? item.conditions.length : 0,
            hints: readHints(item.hints),
          },
        ];
      });
    });
}

/** The tips of the exercise a round is about; none when the exercise is not in the list (a module that is not read yet). */
export function hintsOf(list: BoardExercise[] | null, round: { blockId: string; index: number }): BoardHint[] {
  return list?.find((exercise) => exercise.blockId === round.blockId && exercise.index === round.index)?.hints ?? [];
}

/** The minutes the teacher typed, brought to the limits; the default for what is not a number. */
export function clampMinutes(typed: string | number): number {
  const minutes = typed === "" ? Number.NaN : Math.trunc(Number(typed));
  return Number.isFinite(minutes) ? Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, minutes)) : DEFAULT_MINUTES;
}

const two = (n: number) => String(n).padStart(2, "0");

/** A time span in seconds as mm:ss (the minutes go past 59 and never to hours: a round has at most 60). */
export function mmss(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${two(Math.floor(total / 60))}:${two(total % 60)}`;
}

/** The seconds left of a round by the clock of the server, a started second counting as one left, so the clock reads zero when the round ends. */
export function secondsLeft(endsAt: string, skewMs: number, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(endsAt) - (now + skewMs)) / 1000));
}

export type CardState = "doing" | "done" | "silent";

/**
 * Where a student stands: done when he finished; without signal when more than 15 s went by since his last progress, or since the start of the round when he
 * never sent one (`serverNow` is the time of the server, as the times of the progress are).
 */
export function cardState(entry: ExerciseProgressEntry | undefined, startedAt: string, serverNow: number): CardState {
  if (entry?.completedAt) return "done";
  const last = Date.parse(entry?.at ?? "");
  const since = Number.isFinite(last) ? last : Date.parse(startedAt);
  return serverNow - since > SIGNAL_TIMEOUT_MS ? "silent" : "doing";
}

/** What the chat gets for a tip: the text and the command of reference on a line of its own, clean as the chat takes it (SPEC-065 CA-08). */
export function hintMessage(hint: BoardHint): string {
  return clean(m.tipMessage(hint.text, hint.command));
}
