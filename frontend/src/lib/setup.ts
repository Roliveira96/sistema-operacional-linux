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

/** A file the machine gets as it is, after the commands of the snapshot ran: logs, pages, anything of text (RN-12). */
export interface SetupFile {
  /** Absolute path. */
  path: string;
  /** The text, exactly as it is: nothing is trimmed or escaped. */
  content: string;
  /** Octal, like "644". */
  mode?: string;
  owner?: string;
  group?: string;
}

/** The limits of the server (SPEC-021 RN-12), checked here to tell the author before sending. */
export const MAX_FILE_BYTES = 1 << 20;
export const MAX_FILES_BYTES = 4 << 20;
export const MAX_FILES = 200;
export const bytesOf = (text: string) => new TextEncoder().encode(text).length;

export interface Setup {
  summary: string;
  steps: SetupStep[];
  files?: SetupFile[];
}

/** The files of a snapshot that the server would refuse: a path that is not absolute, or a permission that is not complete. */
export function invalidFiles(setup: Setup | undefined): { path: string; reason: "path" | "mode" }[] {
  const bad: { path: string; reason: "path" | "mode" }[] = [];
  for (const file of setup?.files ?? []) {
    if (!file.path.trim().startsWith("/") || file.path.trim() === "/") bad.push({ path: file.path, reason: "path" });
    else if (file.mode && !/^[0-7]{3,4}$/.test(file.mode)) bad.push({ path: file.path, reason: "mode" });
  }
  return bad;
}

/** Whether a snapshot does anything: it has commands or files. */
export const hasSetup = (setup: Setup | undefined): setup is Setup => Boolean(setup && (setup.steps.length > 0 || (setup.files?.length ?? 0) > 0));

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

function parseFile(raw: unknown): SetupFile | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const path = str(r.path);
  if (path === "") return undefined;
  const file: SetupFile = { path, content: str(r.content) };
  if (str(r.mode)) file.mode = str(r.mode);
  if (str(r.owner)) file.owner = str(r.owner);
  if (str(r.group)) file.group = str(r.group);
  return file;
}

/** The snapshot stored in a payload, or undefined when there is none. */
export function parseSetup(raw: unknown): Setup | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as { summary?: unknown; steps?: unknown; files?: unknown };
  const steps = Array.isArray(r.steps) ? r.steps.map(parseStep).filter((s): s is SetupStep => s !== undefined) : [];
  const files = Array.isArray(r.files) ? r.files.map(parseFile).filter((f): f is SetupFile => f !== undefined) : [];
  return files.length > 0 ? { summary: str(r.summary), steps, files } : { summary: str(r.summary), steps };
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
export function setupPayload(setup: Setup): { summary?: string; steps: SetupStep[]; files?: SetupFile[] } {
  const steps = setup.steps.map((s) => {
    const step: SetupStep = { command: s.command.trim() };
    if (s.terminal && s.terminal !== 1) step.terminal = s.terminal;
    if (s.login && s.login.user.trim()) step.login = { user: s.login.user.trim(), password: s.login.password };
    const answers = (s.answers ?? []).filter((a) => a.trim() !== "");
    if (answers.length > 0) step.answers = answers;
    return step;
  });
  const summary = setup.summary.trim();
  const out: { summary?: string; steps: SetupStep[]; files?: SetupFile[] } = summary ? { summary, steps } : { steps };
  // The text of a file is sent as it is.
  if (setup.files && setup.files.length > 0) out.files = setup.files.map((f) => ({ path: f.path.trim(), content: f.content, ...(f.mode ? { mode: f.mode } : {}), ...(f.owner ? { owner: f.owner } : {}), ...(f.group ? { group: f.group } : {}) }));
  return out;
}

/** A block, as the authoring list and the study screen give it. */
interface LayerBlock {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  active?: boolean;
}

/**
 * The snapshot layers of the cards, in the order the machine is prepared: the header of a card (a text with a title)
 * carries its own, and the group of exercises of the card, which comes after its blocks, carries the base state of its exercises.
 */
export function cardLayers(blocks: LayerBlock[]): SetupLayer[] {
  const layers: SetupLayer[] = [];
  let title = "";
  for (const block of blocks) {
    if (block.active === false) continue;
    const own = str(block.payload.title).trim();
    if (block.type === "TEXT" && own !== "") {
      title = own;
      const setup = parseSetup(block.payload.setup);
      if (hasSetup(setup)) layers.push({ id: block.id, kind: "card", label: own, setup });
    } else if (block.type === "EXERCISES") {
      const setup = parseSetup(block.payload.setup);
      if (hasSetup(setup)) layers.push({ id: block.id, kind: "card", label: `${title || "Introdução"} (exercícios)`, setup });
    }
  }
  return layers;
}

/** All the layers in the order the machine is prepared: the module, then the cards. */
export function allLayers(moduleSetup: Setup | undefined, blocks: LayerBlock[]): SetupLayer[] {
  const layers = hasSetup(moduleSetup) ? [{ id: "module", kind: "module" as const, label: "Módulo", setup: moduleSetup }] : [];
  return [...layers, ...cardLayers(blocks)];
}

/** How many things a run does: each command, and the files of a snapshot as one. */
export const stepCount = (layers: SetupLayer[]) => layers.reduce((n, l) => n + l.setup.steps.length + ((l.setup.files?.length ?? 0) > 0 ? 1 : 0), 0);
