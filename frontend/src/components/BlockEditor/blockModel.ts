import { authoringMessages } from "@/messages/authoring.pt-BR";

export type Payload = Record<string, unknown>;

/**
 * What the author picks. Several kinds are stored with the same block type: a text without a
 * title is "HTML / Texto" and with a title is a "Card"; a tip is a tip or "Cai na prova".
 */
export const KINDS = ["HTML", "CARD", "COMMAND", "TIP", "EXAM", "REAL", "STEPS", "CARDS", "WIDGET", "RAW_HTML"] as const;
export type Kind = (typeof KINDS)[number];

/** The kind of a stored block. */
export function kindOf(type: string, payload: Payload): Kind {
  switch (type) {
    case "TEXT":
      return typeof payload.title === "string" && payload.title.trim() ? "CARD" : "HTML";
    case "COMMAND":
      return "COMMAND";
    case "TIP":
      return payload.variant === "WARNING" ? "EXAM" : "TIP";
    case "CURIOSITY":
      return "REAL";
    case "STEP_BY_STEP":
      return "STEPS";
    case "CARDS":
      return "CARDS";
    case "WIDGET":
      return "WIDGET";
    default:
      return "RAW_HTML";
  }
}

/** The block type and the starting payload of a new block of this kind. */
export function newBlockOf(kind: Kind): { type: string; payload: Payload } {
  switch (kind) {
    case "HTML":
      return { type: "TEXT", payload: { html: "" } };
    case "CARD":
      return { type: "TEXT", payload: { title: "", command: "", html: "" } };
    case "COMMAND":
      return { type: "COMMAND", payload: { steps: [emptyStep()] } };
    case "TIP":
      return { type: "TIP", payload: { variant: "DEFAULT", title: "", html: "" } };
    case "EXAM":
      return { type: "TIP", payload: { variant: "WARNING", title: "Cai na prova", html: "" } };
    case "REAL":
      return { type: "CURIOSITY", payload: { title: "Na vida real", html: "" } };
    case "STEPS":
      return { type: "STEP_BY_STEP", payload: { steps: [""] } };
    case "CARDS":
      return { type: "CARDS", payload: { cards: [{ title: "", text: "" }] } };
    case "WIDGET":
      return { type: "WIDGET", payload: { component: "PERMISSION_CALCULATOR", params: {} } };
    default:
      return { type: "LEGACY_HTML", payload: { html: "" } };
  }
}

export function emptyStep(): Payload {
  return { command: "", explanation: "", outputExplanation: "", terminal: 1 };
}

const plain = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/** A one-line summary of a block for the list: its title, its first command or the start of its text. */
export function blockSummary(type: string, payload: Payload): string {
  const clip = (value: string) => (value.length > 90 ? `${value.slice(0, 90)}…` : value);
  const str = (key: string) => (typeof payload[key] === "string" ? plain(payload[key] as string) : "");

  if (type === "COMMAND" && Array.isArray(payload.steps)) {
    const steps = payload.steps as { command?: unknown }[];
    const first = typeof steps[0]?.command === "string" ? steps[0].command : "";
    const more = steps.length > 1 ? ` (+${steps.length - 1})` : "";
    return clip(`${first}${more}`) || "—";
  }
  if (type === "STEP_BY_STEP" && Array.isArray(payload.steps)) return clip(String(payload.steps[0] ?? "")) || "—";
  if (type === "CARDS" && Array.isArray(payload.cards)) {
    return clip((payload.cards as { title?: unknown }[]).map((c) => String(c.title ?? "")).join(" · ")) || "—";
  }
  if (type === "WIDGET") {
    const m = authoringMessages.blocks.fields;
    return payload.component === "LS_ANATOMY" ? m.componentLs : m.componentPermission;
  }
  return clip(str("title") || str("command") || str("html")) || "—";
}
