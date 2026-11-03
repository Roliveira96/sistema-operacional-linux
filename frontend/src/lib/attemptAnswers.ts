import type { SimulatedResponse } from "@/lib/assessmentSimulation";

type Link = { left: string; right: string };

/** The answer of the screen in the form the server grades (SPEC-090 RN-04): the same form the bank of questions uses. */
export function toApiAnswer(kind: string, response: SimulatedResponse): unknown {
  switch (kind) {
    case "THEORETICAL_BOOLEAN":
      return { value: response };
    case "THEORETICAL_SINGLE":
      return { choice: response };
    case "THEORETICAL_MATCHING":
      return { links: response };
    default:
      return { html: response };
  }
}

/** The answer saved on the server, back in the form of the screen; nothing when there is none or it does not fit the kind. */
export function fromApiAnswer(kind: string, answer: unknown): SimulatedResponse | undefined {
  if (!answer || typeof answer !== "object") return undefined;
  const a = answer as { value?: unknown; choice?: unknown; links?: unknown; html?: unknown };
  switch (kind) {
    case "THEORETICAL_BOOLEAN":
      return typeof a.value === "boolean" ? a.value : undefined;
    case "THEORETICAL_SINGLE":
      return typeof a.choice === "string" ? a.choice : undefined;
    case "THEORETICAL_MATCHING":
      return Array.isArray(a.links) ? (a.links as Link[]) : undefined;
    case "DISCURSIVE":
      return typeof a.html === "string" ? a.html : undefined;
    default:
      return undefined;
  }
}

/** A hash of the text (FNV-1a), to order the same way every time. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The items in an order that depends only on the seed: the alternatives of an attempt stay in place when the student comes back. */
export function stableOrder<T extends { id: string }>(items: T[], seed: string): T[] {
  return [...items].sort((a, b) => hash(`${seed}:${a.id}`) - hash(`${seed}:${b.id}`));
}
