// Browser persistence of the topic machine and the player speed (SPEC-016,
// P-03). Every access is guarded: without storage the machine simply lives
// while the page is open.

const MACHINE_PREFIX = "exame-so:maquina:v3:";
const SPEED_KEY = "exame-so:velocidade";
const NARRATION_KEY = "exame-so:narracao";
const VOICE_SPEED_KEY = "exame-so:velocidade-voz";
const SPLIT_KEY = "exame-so:divisao";
/** Ranges of the two speed controls of the player (SPEC-018, RF-07). */
export const TYPING_SPEED = { min: 0.5, max: 4, step: 0.25 } as const;
export const VOICE_SPEED = { min: 0.5, max: 2, step: 0.25 } as const;

function loadWithin(key: string, range: { min: number; max: number }): number {
  try {
    const raw = localStorage.getItem(key);
    const value = raw === null ? Number.NaN : Number(raw);
    return value >= range.min && value <= range.max ? value : 1;
  } catch {
    return 1;
  }
}

/** Short, stable hash of a scenario, so a changed scenario drops stale saves. */
export function scenarioHash(snapshot: unknown): string {
  const text = JSON.stringify(snapshot ?? null);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

export function machineKey(moduleId: string, scenario: unknown): string {
  return `${MACHINE_PREFIX}topic-${moduleId}-${scenarioHash(scenario)}`;
}

export function loadMachine(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function saveMachine(key: string, snapshot: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    // no storage or quota exceeded: keep going without saving
  }
}

export function clearMachine(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing to clear
  }
}

/** Typing speed of the commands in the terminal. */
export function loadSpeed(): number {
  return loadWithin(SPEED_KEY, TYPING_SPEED);
}

export function saveSpeed(speed: number): void {
  try {
    localStorage.setItem(SPEED_KEY, String(speed));
  } catch {
    // no storage
  }
}

/** Narration is on unless the student turned it off (SPEC-018, P-06). */
export function loadNarration(): boolean {
  try {
    return localStorage.getItem(NARRATION_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveNarration(enabled: boolean): void {
  try {
    localStorage.setItem(NARRATION_KEY, enabled ? "on" : "off");
  } catch {
    // no storage
  }
}

/** Reading speed of the voice. */
export function loadVoiceSpeed(): number {
  return loadWithin(VOICE_SPEED_KEY, VOICE_SPEED);
}

export function saveVoiceSpeed(speed: number): void {
  try {
    localStorage.setItem(VOICE_SPEED_KEY, String(speed));
  } catch {
    // no storage
  }
}

/** Share of the width given to the study column, in percent (SPEC-016, CA-12). */
export const SPLIT = { min: 25, max: 75, initial: 44, step: 2 } as const;

export function clampSplit(percent: number): number {
  if (!Number.isFinite(percent)) return SPLIT.initial;
  return Math.min(SPLIT.max, Math.max(SPLIT.min, percent));
}

export function loadSplit(): number {
  try {
    const raw = localStorage.getItem(SPLIT_KEY);
    return raw === null ? SPLIT.initial : clampSplit(Number(raw));
  } catch {
    return SPLIT.initial;
  }
}

export function saveSplit(percent: number): void {
  try {
    localStorage.setItem(SPLIT_KEY, String(percent));
  } catch {
    // no storage
  }
}
