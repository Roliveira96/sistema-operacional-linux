// What the last test of a card said, shown in the content list. It is kept in this browser
// (ponytail: per author and device; move to the server if the whole team must see it).

import type { CardModel } from "./cardModel";
import { setupPayload } from "./setup";

export interface TestRecord {
  passed: boolean;
  at: string;
  /** What was tested; a card changed since then is shown as such. */
  fingerprint: string;
}

export type TestStatus = "none" | "untested" | "passed" | "failed" | "stale";

const key = (moduleId: string, cardKey: string) => `card-test:${moduleId}:${cardKey}`;

/** The parts of a card a test depends on: its commands and its own snapshot. */
export function fingerprint(card: Pick<CardModel, "commands" | "setup">): string {
  return JSON.stringify({
    commands: card.commands.map((c) => [c.terminal, c.command.trim(), c.expectError, c.login ?? null, c.answers]),
    setup: card.setup ? setupPayload(card.setup) : null,
  });
}

export function saveTest(moduleId: string, cardKey: string, passed: boolean, card: Pick<CardModel, "commands" | "setup">) {
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
export function testStatus(moduleId: string, cardKey: string, card: Pick<CardModel, "commands" | "setup">): TestStatus {
  if (card.commands.length === 0 && !(card.setup && card.setup.steps.length > 0)) return "none";
  const record = readTest(moduleId, cardKey);
  if (!record) return "untested";
  if (record.fingerprint !== fingerprint(card)) return "stale";
  return record.passed ? "passed" : "failed";
}
