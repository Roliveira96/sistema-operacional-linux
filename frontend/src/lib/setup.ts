// Snapshots as scripts, in layers (SPEC-021). A snapshot is a list of commands that prepares the
// machine of the student: the module has one, shared by every card, and each card can have its own.
// The machine is prepared by running them in order: the module first, then the cards.

export interface SetupStep {
  command: string;
  /** Terminal tab that runs it (1 to 3). Defaults to 1. */
  terminal?: number;
  login?: { user: string; password: string };
  /** Answers to the questions the command asks. */
  answers?: string[];
}

export interface Setup {
  summary: string;
  steps: SetupStep[];
}

/** One snapshot in the order the machine is prepared with. */
export interface SetupLayer {
  /** "module" or the id of the header block of the card. */
  id: string;
  kind: "module" | "card";
  /** "Módulo" or the title of the card. */
  label: string;
  setup: Setup;
}

export const emptySetup = (): Setup => ({ summary: "", steps: [] });

const str = (v: unknown) => (typeof v === "string" ? v : "");

function parseStep(raw: unknown): SetupStep | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const command = str(r.command);
  if (command.trim() === "") return undefined;
  const step: SetupStep = { command };
  if (typeof r.terminal === "number") step.terminal = r.terminal;
  const login = r.login as { user?: unknown; password?: unknown } | undefined;
  if (login && str(login.user)) step.login = { user: str(login.user), password: str(login.password) };
  if (Array.isArray(r.answers) && r.answers.length > 0) step.answers = r.answers.map(str);
  return step;
}

/** The snapshot stored in a payload, or undefined when there is none. */
export function parseSetup(raw: unknown): Setup | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as { summary?: unknown; steps?: unknown };
  const steps = Array.isArray(r.steps) ? r.steps.map(parseStep).filter((s): s is SetupStep => s !== undefined) : [];
  return { summary: str(r.summary), steps };
}

/**
 * A card saved with the first version of the snapshots (SPEC-020) kept the image of a machine and the
 * commands typed to make it. Those commands are the steps of the snapshot now.
 */
export function legacySetup(raw: unknown): Setup | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as { summary?: unknown; commands?: unknown };
  const steps = Array.isArray(r.commands) ? r.commands.map((c) => parseStep({ command: c })).filter((s): s is SetupStep => s !== undefined) : [];
  return steps.length > 0 ? { summary: str(r.summary), steps } : undefined;
}

/** What is sent to the server: trimmed, without the empty parts. */
export function setupPayload(setup: Setup): { summary?: string; steps: SetupStep[] } {
  const steps = setup.steps.map((s) => {
    const step: SetupStep = { command: s.command.trim() };
    if (s.terminal && s.terminal !== 1) step.terminal = s.terminal;
    if (s.login && s.login.user.trim()) step.login = { user: s.login.user.trim(), password: s.login.password };
    const answers = (s.answers ?? []).filter((a) => a.trim() !== "");
    if (answers.length > 0) step.answers = answers;
    return step;
  });
  const summary = setup.summary.trim();
  return summary ? { summary, steps } : { steps };
}

/** A block, as the authoring list and the study screen give it. */
interface LayerBlock {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  active?: boolean;
}

/** The snapshot layers of the cards: the header of a card (a text with a title) carries its own. */
export function cardLayers(blocks: LayerBlock[]): SetupLayer[] {
  const layers: SetupLayer[] = [];
  for (const block of blocks) {
    const title = str(block.payload.title).trim();
    if (block.type !== "TEXT" || title === "" || block.active === false) continue;
    const setup = parseSetup(block.payload.setup);
    if (setup && setup.steps.length > 0) layers.push({ id: block.id, kind: "card", label: title, setup });
  }
  return layers;
}

/** All the layers in the order the machine is prepared: the module, then the cards. */
export function allLayers(moduleSetup: Setup | undefined, blocks: LayerBlock[]): SetupLayer[] {
  const layers = moduleSetup && moduleSetup.steps.length > 0 ? [{ id: "module", kind: "module" as const, label: "Módulo", setup: moduleSetup }] : [];
  return [...layers, ...cardLayers(blocks)];
}

export const stepCount = (layers: SetupLayer[]) => layers.reduce((n, l) => n + l.setup.steps.length, 0);
