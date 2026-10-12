// The kinds of question of the bank of the module and of the exercises of a card (SPEC-035 RN-01, RN-02). A new kind is added
// here, with its messages, and the screens ask this module what the kind has instead of comparing names.

export type QuestionKind = "PRACTICAL" | "THEORETICAL_BOOLEAN" | "THEORETICAL_SINGLE" | "THEORETICAL_MATCHING";

/** The kinds the teacher can create, in the order the choice shows them. */
export const QUESTION_KINDS: QuestionKind[] = ["PRACTICAL", "THEORETICAL_BOOLEAN", "THEORETICAL_SINGLE", "THEORETICAL_MATCHING"];

/** Reads a kind; anything else (or nothing) is a practical question, the kind every exercise had before. */
export const parseKind = (value: unknown): QuestionKind =>
  value === "THEORETICAL_BOOLEAN" || value === "THEORETICAL_SINGLE" || value === "THEORETICAL_MATCHING" ? value : "PRACTICAL";

/** Whether the student solves it in the terminal, with a solution, conditions and a machine. */
export const usesTerminal = (kind: QuestionKind | undefined): boolean => (kind ?? "PRACTICAL") === "PRACTICAL";

/** Whether the question is a true or false one. */
export const isTrueFalse = (kind: QuestionKind | string | undefined): boolean => kind === "THEORETICAL_BOOLEAN";

/** Whether the question is a single choice one (SPEC-036). */
export const isSingleChoice = (kind: QuestionKind | string | undefined): boolean => kind === "THEORETICAL_SINGLE";

/** Whether the question is a matching one, linking two columns (SPEC-037). */
export const isMatching = (kind: QuestionKind | string | undefined): boolean => kind === "THEORETICAL_MATCHING";

/** Limits of the pairs of a matching question (SPEC-037 RN-02). */
export const MIN_PAIRS = 2;
export const MAX_PAIRS = 5;

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
