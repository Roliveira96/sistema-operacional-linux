// The card of the study screen, as the author edits it (SPEC-019). A card is a run of blocks:
// it starts at a text block with a title, and the blocks that follow belong to it. This file
// turns the stored blocks into one editable model and back, keeping the identity of every block
// that stays so the reading progress of the students is not lost.

import type { AuthoredBlock } from "@/services/contentAuthoringService";
import { exercisesPayload, hasExercises, parseExercises, type ExerciseGroup } from "./exercises";
import { newId } from "./newId";
import { hasSetup, invalidFiles, legacySetup, parseSetup, setupPayload, type Setup } from "./setup";

type Payload = Record<string, unknown>;

export type ElementKind = "text" | "html" | "code" | "table" | "image" | "video" | "link" | "block";

/** One piece of the "descrição modular": the text, raw html, a snippet, a table, a picture, a video or a link. */
export interface CardElement {
  id: string;
  kind: ElementKind;
  /** The stored block this element is, to keep its identity; absent for a new one or the header text. */
  blockId?: string;
  updatedAt?: string;
  html: string;
  lang: string;
  code: string;
  headers: string;
  rows: string;
  url: string;
  caption: string;
  /** A block of another type (steps, cards, widget, raw html), kept as it is. */
  block?: AuthoredBlock;
}

export interface CardCommand {
  id: string;
  terminal: number;
  /** The command must fail on purpose (SPEC-020). */
  expectError: boolean;
  command: string;
  explanation: string;
  outputExplanation: string;
  login?: { user: string; password: string };
  answers: string[];
}

/** A tip, a real-world note or an exam alert. */
export interface CardBox {
  id: string;
  blockId?: string;
  updatedAt?: string;
  title: string;
  html: string;
}

export interface CardModel {
  /** The snapshot of this card: commands run after the ones of the module and of the earlier cards (SPEC-021). */
  setup?: Setup;
  headerId?: string;
  headerUpdatedAt?: string;
  pill: string;
  title: string;
  elements: CardElement[];
  commandBlockId?: string;
  commandUpdatedAt?: string;
  commands: CardCommand[];
  tips: CardBox[];
  realWorld: CardBox[];
  exams: CardBox[];
  /** The group of exercises of the card, stored in its own block (SPEC-022). */
  exercises?: ExerciseGroup;
}

/** The stored blocks of one card. */
export interface CardGroup {
  /** The id of its first block: it names the card in the address. */
  key: string;
  /** The text block with a title that opens the card; absent for the introduction. */
  header?: AuthoredBlock;
  blocks: AuthoredBlock[];
}

/** One block ready to be sent to the server (SPEC-019 5.7). */
export interface CardBlockInput {
  id?: string;
  updatedAt?: string;
  type: string;
  payload: Payload;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export { newId };

// ---- grouping

/** Splits the blocks of a module into cards, like the study screen does. */
export function groupCards(blocks: AuthoredBlock[]): CardGroup[] {
  const groups: CardGroup[] = [];
  for (const block of [...blocks].sort((a, b) => a.position - b.position)) {
    const opens = block.type === "TEXT" && str(block.payload.title).trim() !== "";
    if (opens) groups.push({ key: block.id, header: block, blocks: [block] });
    else if (groups.length === 0) groups.push({ key: block.id, blocks: [block] });
    else groups[groups.length - 1]!.blocks.push(block);
  }
  return groups;
}

// ---- elements <-> html

const escapeHtml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The html a non-text element is stored as. Everything is escaped. */
export function elementHtml(el: CardElement): string {
  switch (el.kind) {
    case "code": {
      const lang = /^[A-Za-z0-9_-]+$/.test(el.lang) ? el.lang : "bash";
      return `<pre class="md-code"><code class="language-${lang}">${escapeHtml(el.code)}</code></pre>`;
    }
    case "table": {
      const cells = (line: string) => line.split("|").map((c) => c.trim());
      const head = el.headers.trim() === "" ? "" : `<thead><tr>${cells(el.headers).map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
      const body = el.rows
        .split(String.fromCharCode(10))
        .filter((line) => line.trim() !== "")
        .map((line) => `<tr>${cells(line).map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
        .join("");
      return `<table class="md-table">${head}<tbody>${body}</tbody></table>`;
    }
    case "image": {
      const caption = el.caption.trim();
      return `<figure class="md-image"><img src="${escapeHtml(el.url.trim())}" alt="${escapeHtml(caption)}">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>`;
    }
    case "video":
      return `<div class="md-video"><iframe src="${escapeHtml(el.url.trim())}" allowfullscreen></iframe></div>`;
    case "link":
      return `<p class="md-link"><a href="${escapeHtml(el.url.trim())}">${escapeHtml(el.caption.trim() || el.url.trim())}</a></p>`;
    default:
      return el.html;
  }
}

const blank = (): Omit<CardElement, "id" | "kind"> => ({ html: "", lang: "bash", code: "", headers: "", rows: "", url: "", caption: "" });

export function newElement(kind: Exclude<ElementKind, "block">): CardElement {
  const base = { id: newId(), kind, ...blank() };
  if (kind === "table") return { ...base, headers: "Coluna 1 | Coluna 2", rows: "Valor A | Valor B" };
  return base;
}

// What the visual editor can hold. Anything else (a div, a class, a span, a table with markup in
// its cells) would be lost on opening it there, so it is kept as raw html instead.
const TEXT_TAGS = new Set(["P", "B", "STRONG", "I", "EM", "S", "CODE", "PRE", "UL", "OL", "LI", "H3", "H4", "BLOCKQUOTE", "A", "BR", "HR"]);

function representable(root: Element): boolean {
  for (const el of root.querySelectorAll("*")) {
    if (!TEXT_TAGS.has(el.tagName)) return false;
    for (const attr of el.getAttributeNames()) {
      const codeInPre = el.tagName === "CODE" && el.parentElement?.tagName === "PRE" && attr === "class" && /^language-[\w-]+$/.test(el.getAttribute("class") ?? "");
      if (!codeInPre && !(el.tagName === "A" && attr === "href")) return false;
    }
  }
  return true;
}

/** Html that is safe to show in the preview before the server has filtered it. */
export function looksSafe(html: string): boolean {
  return !/<\s*(script|iframe|object|embed)|\son\w+\s*=|javascript:/i.test(html);
}

/** Reads stored html back into the element it was made from; anything else is a text or raw html. */
export function classify(html: string): Omit<CardElement, "id" | "blockId" | "updatedAt"> {
  const text = { kind: "text" as const, ...blank(), html };
  if (typeof DOMParser === "undefined") return text;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;
  const raw = { ...text, kind: "html" as const };
  const nodes = [...body.childNodes].filter((n) => !(n.nodeType === 3 && (n.textContent ?? "").trim() === ""));
  const only = nodes.length === 1 && nodes[0]!.nodeType === 1 ? (nodes[0] as Element) : undefined;

  if (only) {
    const el = only;
    if (el.tagName === "PRE" && el.children.length === 1 && el.firstElementChild?.tagName === "CODE" && el.firstElementChild.children.length === 0) {
      const lang = /language-([A-Za-z0-9_-]+)/.exec(el.firstElementChild.className)?.[1] ?? "bash";
      return { ...text, kind: "code", html: "", lang, code: el.textContent ?? "" };
    }
    if (el.tagName === "TABLE" && [...el.querySelectorAll("td,th")].every((c) => c.children.length === 0)) {
      const row = (tr: Element) => [...tr.children].map((c) => (c.textContent ?? "").trim()).join(" | ");
      const head = el.querySelector("thead tr");
      const body = [...el.querySelectorAll("tbody tr, :scope > tr")].map(row);
      return { ...text, kind: "table", html: "", headers: head ? row(head) : "", rows: body.join(String.fromCharCode(10)) };
    }
    if (el.tagName === "FIGURE" && el.classList.contains("md-image")) {
      const img = el.querySelector("img");
      return { ...text, kind: "image", html: "", url: img?.getAttribute("src") ?? "", caption: el.querySelector("figcaption")?.textContent ?? img?.getAttribute("alt") ?? "" };
    }
    if (el.classList.contains("md-video")) {
      return { ...text, kind: "video", html: "", url: el.querySelector("iframe")?.getAttribute("src") ?? "" };
    }
    if (el.tagName === "P" && el.classList.contains("md-link") && el.querySelector("a")) {
      const a = el.querySelector("a");
      return { ...text, kind: "link", html: "", url: a?.getAttribute("href") ?? "", caption: a?.textContent ?? "" };
    }
  }
  return representable(body) ? text : raw;
}

// ---- model <-> blocks

const box = (b: AuthoredBlock): CardBox => ({ id: newId(), blockId: b.id, updatedAt: b.updatedAt, title: str(b.payload.title), html: str(b.payload.html) });

export function emptyCard(): CardModel {
  return { pill: "", title: "", elements: [], commands: [], tips: [], realWorld: [], exams: [] };
}

/** The editable model of a stored card. */
export function parseCard(group: CardGroup): CardModel {
  const model = emptyCard();
  if (group.header) {
    model.headerId = group.header.id;
    model.headerUpdatedAt = group.header.updatedAt;
    model.pill = str(group.header.payload.command);
    model.title = str(group.header.payload.title);
    model.setup = parseSetup(group.header.payload.setup) ?? legacySetup(group.header.payload.environment);
    const headerHtml = str(group.header.payload.html);
    if (headerHtml.trim() !== "") model.elements.push({ id: newId(), ...classify(headerHtml) });
  }

  for (const block of group.blocks) {
    if (block === group.header) continue;
    switch (block.type) {
      case "TEXT":
        model.elements.push({ id: newId(), blockId: block.id, updatedAt: block.updatedAt, ...classify(str(block.payload.html)) });
        break;
      case "COMMAND": {
        if (!model.commandBlockId) {
          model.commandBlockId = block.id;
          model.commandUpdatedAt = block.updatedAt;
        }
        const steps = Array.isArray(block.payload.steps) ? (block.payload.steps as Payload[]) : [];
        for (const s of steps) {
          const login = s.login as { user?: unknown; password?: unknown } | undefined;
          model.commands.push({
            id: newId(),
            terminal: typeof s.terminal === "number" ? s.terminal : 1,
            expectError: s.expectError === true,
            command: str(s.command),
            explanation: str(s.explanation),
            outputExplanation: str(s.outputExplanation),
            login: login && str(login.user) ? { user: str(login.user), password: str(login.password) } : undefined,
            answers: Array.isArray(s.answers) ? (s.answers as unknown[]).map(str) : [],
          });
        }
        break;
      }
      case "TIP":
        (block.payload.variant === "WARNING" ? model.exams : model.tips).push(box(block));
        break;
      case "CURIOSITY":
        model.realWorld.push(box(block));
        break;
      case "EXERCISES":
        model.exercises ??= parseExercises(block.payload, block.id, block.updatedAt);
        break;
      default:
        model.elements.push({ id: newId(), kind: "block", blockId: block.id, updatedAt: block.updatedAt, ...blank(), block });
    }
  }
  return model;
}

/** Which item of the model each block built by `buildBlocks` came from, to show the server's errors in place. */
export interface BuiltCard {
  blocks: CardBlockInput[];
  /** The item ids behind each block; for the command block, one id per step. */
  sources: string[][];
}

/** The blocks to store for a card, in the order of the form's sections. */
export function buildBlocks(card: CardModel): BuiltCard {
  const blocks: CardBlockInput[] = [];
  const sources: string[][] = [];
  const push = (b: CardBlockInput, from: string[]) => {
    blocks.push(b);
    sources.push(from);
  };

  const hasHeader = card.title.trim() !== "";
  let rest = card.elements;
  let headerHtml = "";
  let headerFrom: string[] = ["header"];
  if (hasHeader && card.elements[0]?.kind === "text") {
    headerHtml = card.elements[0].html;
    headerFrom = ["header", card.elements[0].id];
    rest = card.elements.slice(1);
  }
  if (hasHeader) {
    const payload: Payload = { title: card.title.trim(), command: card.pill.trim(), html: headerHtml };
    if (hasSetup(card.setup)) payload.setup = setupPayload(card.setup);
    push({ id: card.headerId, updatedAt: card.headerUpdatedAt, type: "TEXT", payload }, headerFrom);
  }

  for (const el of rest) {
    if (el.kind === "block" && el.block) {
      push({ id: el.block.id, updatedAt: el.block.updatedAt, type: el.block.type, payload: el.block.payload }, [el.id]);
    } else {
      push({ id: el.blockId, updatedAt: el.updatedAt, type: "TEXT", payload: { html: elementHtml(el) } }, [el.id]);
    }
  }

  if (card.commands.length > 0) {
    const steps = card.commands.map((c) => {
      const step: Payload = { command: c.command.trim(), terminal: c.terminal };
      if (c.expectError) step.expectError = true;
      if (c.explanation.trim()) step.explanation = c.explanation.trim();
      if (c.outputExplanation.trim()) step.outputExplanation = c.outputExplanation.trim();
      if (c.login && c.login.user.trim()) step.login = { user: c.login.user.trim(), password: c.login.password };
      const answers = c.answers.filter((a) => a.trim() !== "");
      if (answers.length > 0) step.answers = answers;
      return step;
    });
    push({ id: card.commandBlockId, updatedAt: card.commandUpdatedAt, type: "COMMAND", payload: { steps } }, card.commands.map((c) => c.id));
  }

  for (const t of card.tips) push({ id: t.blockId, updatedAt: t.updatedAt, type: "TIP", payload: { variant: "DEFAULT", title: t.title.trim(), html: t.html } }, [t.id]);
  for (const r of card.realWorld) push({ id: r.blockId, updatedAt: r.updatedAt, type: "CURIOSITY", payload: { title: r.title.trim(), html: r.html } }, [r.id]);
  for (const e of card.exams) push({ id: e.blockId, updatedAt: e.updatedAt, type: "TIP", payload: { variant: "WARNING", title: e.title.trim(), html: e.html } }, [e.id]);
  if (hasExercises(card.exercises)) {
    push({ id: card.exercises.blockId, updatedAt: card.exercises.updatedAt, type: "EXERCISES", payload: exercisesPayload(card.exercises) }, ["exercises", ...card.exercises.items.map((ex) => ex.id)]);
  }

  return { blocks, sources };
}

// ---- checks before saving

export type CardErrors = Record<string, string[]>;

const httpUrl = /^https?:\/\/\S+$/i;
const httpsUrl = /^https:\/\/\S+$/i;
const youtubeEmbed = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com)\/embed\/\S+$/i;

/** Problems the form can find on its own; the key is the id of the item (or "title"). */
export function checkCard(card: CardModel, requireTitle: boolean): CardErrors {
  const errors: CardErrors = {};
  const add = (id: string, reason: string) => (errors[id] = [...(errors[id] ?? []), reason]);
  const plain = (html: string) => html.replace(/<[^>]*>/g, "").trim();

  if (requireTitle && card.title.trim() === "") add("title", "required");
  if (hasSetup(card.setup) && card.title.trim() === "") add("setup", "needs-title");
  card.setup?.steps.forEach((s, i) => s.command.trim() === "" && add(`setup-${i}`, "required"));
  if (invalidFiles(card.setup).length > 0) add("setup", "files-invalid");
  if (invalidFiles(card.exercises?.setup).length > 0) add("exercises-setup", "files-invalid");
  for (const ex of card.exercises?.items ?? []) if (invalidFiles(ex.solution).length > 0) add(ex.id, "files-invalid");
  for (const el of card.elements) {
    if (el.kind === "text" && plain(el.html) === "") add(el.id, "required");
    if (el.kind === "code" && el.code.trim() === "") add(el.id, "required");
    if (el.kind === "table" && el.rows.trim() === "" && el.headers.trim() === "") add(el.id, "required");
    if (el.kind === "html" && el.html.trim() === "") add(el.id, "required");
    if (el.kind === "image" && !httpsUrl.test(el.url.trim())) add(el.id, "https");
    if (el.kind === "video" && !youtubeEmbed.test(el.url.trim())) add(el.id, "youtube");
    if (el.kind === "link" && !httpUrl.test(el.url.trim())) add(el.id, "url");
  }
  for (const c of card.commands) if (c.command.trim() === "") add(c.id, "required");
  for (const ex of card.exercises?.items ?? []) {
    if (ex.title.trim() === "") add(ex.id, "required");
    if (ex.hints.some((h) => h.text.trim() === "")) add(ex.id, "hint-required");
  }
  for (const group of [card.tips, card.realWorld, card.exams]) for (const b of group) if (plain(b.html) === "") add(b.id, "required");
  return errors;
}

/** Puts the server's `blocks[i].field` errors on the items of the form. */
export function placeServerErrors(built: BuiltCard, params: { name: string; reason: string }[]): { errors: CardErrors; rest: string[] } {
  const errors: CardErrors = {};
  const rest: string[] = [];
  for (const p of params) {
    const m = /^blocks\[(\d+)\]\.(.*)$/.exec(p.name);
    const from = m ? built.sources[Number(m[1])] : undefined;
    if (!m || !from) {
      rest.push(`${p.name}: ${p.reason}`);
      continue;
    }
    const field = m[2] ?? "";
    if (from[0] === "exercises") {
      const item = /^items\[(\d+)\]/.exec(field);
      const target = item ? (from[1 + Number(item[1])] ?? "exercises") : "exercises";
      errors[target] = [...(errors[target] ?? []), `${field}: ${p.reason}`];
      continue;
    }
    const step = /^steps\[(\d+)\]/.exec(field);
    let target = from[0] ?? "title";
    if (step) target = from[Number(step[1])] ?? target;
    else if (from[0] === "header") target = /^setup\.steps\[(\d+)\]/.test(field) ? `setup-${/^setup\.steps\[(\d+)\]/.exec(field)![1]}` : field.startsWith("setup") ? "setup" : field === "html" && from[1] ? from[1] : "title";
    const shown = step ? field.slice((step[0] ?? "").length).replace(/^\./, "") : field;
    errors[target] = [...(errors[target] ?? []), `${shown}: ${p.reason}`];
  }
  return { errors, rest };
}

/** A short summary of what a card holds, for the list. */
export function cardCounts(group: CardGroup): { texts: number; commands: number; tips: number; real: number; exams: number; exercises: number; others: number } {
  const c = { texts: 0, commands: 0, tips: 0, real: 0, exams: 0, exercises: 0, others: 0 };
  for (const b of group.blocks) {
    if (b === group.header) continue;
    if (b.type === "TEXT") c.texts++;
    else if (b.type === "COMMAND") c.commands += Array.isArray(b.payload.steps) ? b.payload.steps.length : 0;
    else if (b.type === "TIP" && b.payload.variant === "WARNING") c.exams++;
    else if (b.type === "TIP") c.tips++;
    else if (b.type === "CURIOSITY") c.real++;
    else if (b.type === "EXERCISES") c.exercises += Array.isArray(b.payload.items) ? b.payload.items.length : 0;
    else c.others++;
  }
  return c;
}
