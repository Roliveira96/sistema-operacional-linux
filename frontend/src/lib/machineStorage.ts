// Browser persistence of the topic machine and the player speed (SPEC-016,
// P-03). Every access is guarded: without storage the machine simply lives
// while the page is open.

const MACHINE_PREFIX = "exame-so:maquina:v3:";
const SPEED_KEY = "exame-so:velocidade";
const NARRATION_KEY = "exame-so:narracao";
export const SPEEDS = [0.5, 1, 2, 4] as const;

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

export function loadSpeed(): number {
  try {
    const speed = Number(localStorage.getItem(SPEED_KEY));
    return (SPEEDS as readonly number[]).includes(speed) ? speed : 1;
  } catch {
    return 1;
  }
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
