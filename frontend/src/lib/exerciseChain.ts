// An exercise can continue from where the previous one of the trail ended (SPEC-023 RN-11, TCC "Herança de Cenários"): its
// machine is built again from the recipe of the chain, the solutions recorded, never from a machine in use.

import { hasSetup, type Setup, type SetupLayer } from "./setup";

/** What the chain needs to know of an exercise of the trail, in the order of the trail. */
export interface ChainLink {
  id: string;
  title: string;
  continues: boolean;
  solution?: Setup;
}

/**
 * The solutions that come before the exercise at `index`: none when it does not continue from the previous one; otherwise the
 * previous one, and the one before it while that one also continues, back to the first of the chain.
 */
export function chainLayers(trail: ChainLink[], index: number, label: (title: string) => string): SetupLayer[] {
  if (index <= 0 || !trail[index]?.continues) return [];
  let first = index - 1;
  while (first > 0 && trail[first]!.continues) first--;
  const layers: SetupLayer[] = [];
  for (let i = first; i < index; i++) {
    const link = trail[i]!;
    if (hasSetup(link.solution)) layers.push({ id: `chain-${link.id}`, kind: "card", label: label(link.title), setup: link.solution });
  }
  return layers;
}
