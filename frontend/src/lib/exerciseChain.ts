// An exercise can depend on another one (SPEC-023 D-16, TCC "Herança de Cenários"): its machine is built again from the recipe of
// the chain it depends on, the solutions recorded, never from a machine in use.

import { hasSetup, type Setup, type SetupLayer } from "./setup";

/** What the chain needs to know of an exercise of the bank. */
export interface ChainLink {
  id: string;
  title: string;
  /** The exercise whose recipe is built before this one, or null. */
  dependsOn: string | null;
  solution?: Setup;
}

/** The exercises `id` depends on, the oldest first: its antecessor, the antecessor of that, and so on. A missing link ends the chain and a cycle is cut. */
export function ancestors(links: ChainLink[], id: string): ChainLink[] {
  const byId = new Map(links.map((l) => [l.id, l]));
  const chain: ChainLink[] = [];
  const seen = new Set([id]);
  for (let next = byId.get(id)?.dependsOn; next && !seen.has(next); ) {
    seen.add(next);
    const link = byId.get(next);
    if (!link) break;
    chain.unshift(link);
    next = link.dependsOn;
  }
  return chain;
}

/** The layers that build the machine of the exercise: the solutions of the ones it depends on, the oldest first. */
export function chainLayers(links: ChainLink[], id: string, label: (title: string) => string): SetupLayer[] {
  return ancestors(links, id).flatMap((link) => (hasSetup(link.solution) ? [{ id: `chain-${link.id}`, kind: "card" as const, label: label(link.title), setup: link.solution }] : []));
}

/**
 * The order a run needs for the exercises asked for: each one comes after the ones it depends on, which are pulled in when they were not
 * asked for (the safe draw of SPEC-023 D-18). `pulled` says which exercise was pulled in by which.
 */
export function withChains(order: string[], links: ChainLink[]): { order: string[]; pulled: { id: string; by: string }[] } {
  const result: string[] = [];
  const pulled: { id: string; by: string }[] = [];
  const asked = new Set(order);
  for (const id of order) {
    for (const link of ancestors(links, id)) {
      if (result.includes(link.id)) continue;
      result.push(link.id);
      if (!asked.has(link.id)) pulled.push({ id: link.id, by: id });
    }
    if (!result.includes(id)) result.push(id);
  }
  return { order: result, pulled };
}

/** Whether `id` has to come after another exercise, by the dependencies. */
export const dependsOnAnother = (links: ChainLink[], id: string) => ancestors(links, id).length > 0;
