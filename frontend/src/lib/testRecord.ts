// What the last test of a card said, shown in the content list. It is kept in this browser
// (ponytail: per author and device; move to the server if the whole team must see it).

import { groupCards, parseCard, type CardModel } from "./cardModel";
import type { AuthoredBlock } from "@/services/contentAuthoringService";
import { hasExercises } from "./exercises";
import { hasSetup, setupPayload, type Setup } from "./setup";

export interface TestRecord {
  passed: boolean;
  at: string;
  /** What was tested; a card changed since then is shown as such. */
  fingerprint: string;
}

export type TestStatus = "none" | "untested" | "passed" | "failed" | "stale";

const key = (moduleId: string, cardKey: string) => `card-test:${moduleId}:${cardKey}`;

/** The parts of a card a test depends on: its commands and its own snapshot. */
export function fingerprint(card: Pick<CardModel, "commands" | "setup"> & { exercises?: CardModel["exercises"] }): string {
  return JSON.stringify({
    commands: card.commands.map((c) => [c.terminal, c.command.trim(), c.expectError, c.login ?? null, c.answers]),
    setup: card.setup ? setupPayload(card.setup) : null,
    // The exercises are tested too: their solution, how they end and the base state of the group.
    exercises: card.exercises ? { setup: card.exercises.setup ? setupPayload(card.exercises.setup) : null, items: card.exercises.items.map((ex) => [ex.solution ? setupPayload(ex.solution) : null, ex.conditions]) } : null,
  });
}

export function saveTest(moduleId: string, cardKey: string, passed: boolean, card: Pick<CardModel, "commands" | "setup" | "exercises">) {
  try {
    const record: TestRecord = { passed, at: new Date().toISOString(), fingerprint: fingerprint(card) };
    localStorage.setItem(key(moduleId, cardKey), JSON.stringify(record));
  } catch {
    // Storage can be blocked; the test still ran.
  }
}

export function readTest(moduleId: string, cardKey: string): TestRecord | undefined {
  try {
    const raw = localStorage.getItem(key(moduleId, cardKey));
    return raw ? (JSON.parse(raw) as TestRecord) : undefined;
  } catch {
    return undefined;
  }
}

/** "none" when the card has nothing to test (no commands and no snapshot). */
export function testStatus(moduleId: string, cardKey: string, card: Pick<CardModel, "commands" | "setup" | "exercises">): TestStatus {
  if (card.commands.length === 0 && !hasSetup(card.setup) && !hasExercises(card.exercises)) return "none";
  const record = readTest(moduleId, cardKey);
  if (!record) return "untested";
  if (record.fingerprint !== fingerprint(card)) return "stale";
  return record.passed ? "passed" : "failed";
}

// ---- the test of the whole module: the environment, then every exercise in sequence on one machine

const moduleKey = (moduleId: string) => `module-test:${moduleId}`;

/** What the module test depends on: the snapshot of the module and the commands and snapshot of each card. */
export function moduleFingerprint(cards: Pick<CardModel, "commands" | "setup" | "exercises">[], setup?: Setup): string {
  return JSON.stringify({ setup: setup ? setupPayload(setup) : null, cards: cards.map(fingerprint) });
}

export function saveModuleTest(moduleId: string, passed: boolean, fingerprintOfModule: string) {
  try {
    const record: TestRecord = { passed, at: new Date().toISOString(), fingerprint: fingerprintOfModule };
    localStorage.setItem(moduleKey(moduleId), JSON.stringify(record));
  } catch {
    // Storage can be blocked; the test still ran.
  }
}

export function moduleTestStatus(moduleId: string, fingerprintOfModule: string): Exclude<TestStatus, "none"> {
  try {
    const raw = localStorage.getItem(moduleKey(moduleId));
    if (!raw) return "untested";
    const record = JSON.parse(raw) as TestRecord;
    if (record.fingerprint !== fingerprintOfModule) return "stale";
    return record.passed ? "passed" : "failed";
  } catch {
    return "untested";
  }
}

/** The cards students get: the ones that are active, in order. */
export function activeCards(blocks: AuthoredBlock[]): CardModel[] {
  return groupCards(blocks.filter((b) => b.active)).map(parseCard);
}
