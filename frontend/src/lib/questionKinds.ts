// The kinds of question of the bank of the module and of the exercises of a card (SPEC-035 RN-01, RN-02). A new kind is added
// here, with its messages, and the screens ask this module what the kind has instead of comparing names.

export type QuestionKind = "PRACTICAL" | "THEORETICAL_BOOLEAN" | "THEORETICAL_SINGLE" | "THEORETICAL_MATCHING" | "DISCURSIVE";

/** The kinds the teacher can create in the bank of the module, in the order the choice shows them. */
export const QUESTION_KINDS: QuestionKind[] = ["PRACTICAL", "THEORETICAL_BOOLEAN", "THEORETICAL_SINGLE", "THEORETICAL_MATCHING", "DISCURSIVE"];

/** The kinds of the exercises of a card: a descriptive question waits for the teacher and is not one of them (SPEC-039 D-09). */
export const CARD_KINDS: QuestionKind[] = QUESTION_KINDS.filter((k) => k !== "DISCURSIVE");

/** Reads a kind; anything else (or nothing) is a practical question, the kind every exercise had before. */
export const parseKind = (value: unknown): QuestionKind =>
  value === "THEORETICAL_BOOLEAN" || value === "THEORETICAL_SINGLE" || value === "THEORETICAL_MATCHING" || value === "DISCURSIVE" ? value : "PRACTICAL";

/** Whether the student solves it in the terminal, with a solution, conditions and a machine. */
export const usesTerminal = (kind: QuestionKind | undefined): boolean => (kind ?? "PRACTICAL") === "PRACTICAL";

/** Whether the question is a true or false one. */
export const isTrueFalse = (kind: QuestionKind | string | undefined): boolean => kind === "THEORETICAL_BOOLEAN";

/** Whether the question is a single choice one (SPEC-036). */
export const isSingleChoice = (kind: QuestionKind | string | undefined): boolean => kind === "THEORETICAL_SINGLE";

/** Whether the question is a matching one, linking two columns (SPEC-037). */
export const isMatching = (kind: QuestionKind | string | undefined): boolean => kind === "THEORETICAL_MATCHING";

/** Whether the question is a descriptive one, graded by the teacher (SPEC-039). */
export const isDiscursive = (kind: QuestionKind | string | undefined): boolean => kind === "DISCURSIVE";

/** The sizes the teacher can choose for the answer of a descriptive question, in characters of text (SPEC-039 D-05). */
export const ANSWER_SIZES = [500, 1000, 2000, 5000, 10000] as const;
export const DEFAULT_ANSWER_SIZE = 2000;

/** The text of an answer, as the server counts it against the size: the markup out, the entities read. */
export const answerText = (html: string): string =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

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
