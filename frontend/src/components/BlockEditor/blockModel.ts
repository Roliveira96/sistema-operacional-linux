import { authoringMessages } from "@/messages/authoring.pt-BR";

export type Payload = Record<string, unknown>;

export const BLOCK_TYPES = ["TEXT", "COMMAND", "TIP", "CURIOSITY", "STEP_BY_STEP", "CARDS", "WIDGET", "LEGACY_HTML"] as const;
export type AuthoredType = (typeof BLOCK_TYPES)[number];

/** What a new block starts with: enough to be edited, not yet valid to save. */
export function emptyPayload(type: string): Payload {
  switch (type) {
    case "TEXT":
      return { title: "", command: "", html: "" };
    case "COMMAND":
      return { steps: [emptyStep()] };
    case "TIP":
      return { variant: "DEFAULT", title: "", html: "" };
    case "CURIOSITY":
      return { title: "", html: "" };
    case "STEP_BY_STEP":
      return { steps: [""] };
    case "CARDS":
      return { cards: [{ title: "", text: "" }] };
    case "WIDGET":
      return { component: "PERMISSION_CALCULATOR", params: {} };
    default:
      return { html: "" };
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
