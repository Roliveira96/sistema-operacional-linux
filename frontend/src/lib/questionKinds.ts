// The kinds of question of the bank of the module and of the exercises of a card (SPEC-035 RN-01, RN-02). A new kind is added
// here, with its messages, and the screens ask this module what the kind has instead of comparing names.

export type QuestionKind = "PRACTICAL" | "THEORETICAL_BOOLEAN" | "THEORETICAL_SINGLE";

/** The kinds the teacher can create, in the order the choice shows them. */
export const QUESTION_KINDS: QuestionKind[] = ["PRACTICAL", "THEORETICAL_BOOLEAN", "THEORETICAL_SINGLE"];

/** Reads a kind; anything else (or nothing) is a practical question, the kind every exercise had before. */
export const parseKind = (value: unknown): QuestionKind =>
  value === "THEORETICAL_BOOLEAN" || value === "THEORETICAL_SINGLE" ? value : "PRACTICAL";

/** Whether the student solves it in the terminal, with a solution, conditions and a machine. */
export const usesTerminal = (kind: QuestionKind | undefined): boolean => (kind ?? "PRACTICAL") === "PRACTICAL";

/** Whether the question is a true or false one. */
export const isTrueFalse = (kind: QuestionKind | string | undefined): boolean => kind === "THEORETICAL_BOOLEAN";

/** Whether the question is a single choice one (SPEC-036). */
export const isSingleChoice = (kind: QuestionKind | string | undefined): boolean => kind === "THEORETICAL_SINGLE";

/** Limits of the alternatives of a single choice question (SPEC-036 RN-02). */
export const MIN_CHOICES = 2;
export const MAX_CHOICES = 7;

/** The text of html without the markup, to compare alternatives: lower case, spaces collapsed. */
export const plainText = (html: string): string =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Whether a description has something to read: text, or at least an image. */
export const hasDescription = (html: string): boolean => html.replace(/<[^>]*>/g, "").trim() !== "" || /<img\s/i.test(html);
