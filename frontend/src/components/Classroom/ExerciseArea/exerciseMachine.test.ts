import { describe, expect, it } from "vitest";
import type { LiveModuleContent } from "@/services/classroomService";
import { exerciseModule, scenario } from "@/test/exerciseFixtures";
import { exerciseSetup } from "./exerciseMachine";

const commands = (layers: { setup: { steps: { command: string }[] } }[]) => layers.flatMap((l) => l.setup.steps.map((s) => s.command));

// SPEC-065 CA-02: the machine of the exercise is the one the study screen mounts: the scenario of the module, the snapshots of the cards up to this one,
// the one of the group and the solutions of the exercises before this one in the group
describe("exerciseSetup", () => {
  it("starts from the scenario of the module and prepares it with the module, the cards up to this one, the group and the earlier solutions, in that order", () => {
    const setup = exerciseSetup(exerciseModule, "b-2", 1)!;
    expect(setup.scenario).toBe(scenario);
    expect(setup.layers.map((l) => l.id)).toEqual(["module", "b-1", "b-2", "solution-0"]);
    expect(commands(setup.layers)).toEqual(["mkdir /base", "touch /a", "touch /group", "mkdir /um"]);
  });

  it("leaves the later cards out, and has no earlier solution for the first exercise", () => {
    const setup = exerciseSetup(exerciseModule, "b-2", 0)!;
    expect(commands(setup.layers)).toEqual(["mkdir /base", "touch /a", "touch /group"]);
  });

  it("gives the statement, the level, the conditions and the solution of the exercise as the module has them", () => {
    const { item } = exerciseSetup(exerciseModule, "b-2", 1)!;
    expect(item.title).toBe("Segundo");
    expect(item.difficulty).toBe("MEDIUM");
    expect(item.description).toBe("<p>Crie a pasta <b>dois</b> com o arquivo x.txt</p>");
    expect(item.conditions).toEqual([
      { kind: "DIR_EXISTS", path: "/dois" },
      { kind: "FILE_EXISTS", path: "/dois/x.txt" },
    ]);
    expect(item.solution).toEqual({ commands: ["mkdir /dois", "touch /dois/x.txt"], files: [] });
  });

  it("tells the files a solution writes", () => {
    const withFiles: LiveModuleContent = {
      ...exerciseModule,
      blocks: [{ id: "g", type: "EXERCISES", position: 0, payload: { items: [{ title: "T", difficulty: "EASY", conditions: [{ kind: "DIR_EXISTS", path: "/x" }], solution: { steps: [], files: [{ path: "/etc/motd", content: "oi" }] } }] } }],
    };
    expect(exerciseSetup(withFiles, "g", 0)!.item.solution).toEqual({ commands: [], files: ["/etc/motd"] });
  });

  it("works without a snapshot of the module and without the scenario", () => {
    const bare: LiveModuleContent = { moduleId: "m", title: "t", scenario: null, blocks: [exerciseModule.blocks[1]!] };
    const setup = exerciseSetup(bare, "b-2", 0)!;
    expect(setup.scenario).toBeNull();
    expect(setup.layers.map((l) => l.id)).toEqual(["b-2"]);
  });

  it("skips the earlier exercise that has no solution to run", () => {
    const module_: LiveModuleContent = {
      ...exerciseModule,
      blocks: [{ id: "g", type: "EXERCISES", position: 0, payload: { items: [{ title: "Teoria", difficulty: "EASY", kind: "THEORETICAL_BOOLEAN" }, { title: "Prática", difficulty: "EASY", conditions: [{ kind: "DIR_EXISTS", path: "/x" }] }] } }],
    };
    expect(exerciseSetup(module_, "g", 1)!.layers).toEqual([]);
  });

  it("has nothing for a block that is not in the module, is not a group of exercises, or has no such exercise", () => {
    expect(exerciseSetup(exerciseModule, "nope", 0)).toBeNull();
    expect(exerciseSetup(exerciseModule, "b-1", 0)).toBeNull();
    expect(exerciseSetup(exerciseModule, "b-2", 2)).toBeNull();
    expect(exerciseSetup(exerciseModule, "b-2", -1)).toBeNull();
  });

  it("has no condition for an exercise that lists none", () => {
    const module_: LiveModuleContent = { ...exerciseModule, blocks: [{ id: "g", type: "EXERCISES", position: 0, payload: { items: [{ title: "T", difficulty: "EASY" }] } }] };
    const { item } = exerciseSetup(module_, "g", 0)!;
    expect(item.conditions).toEqual([]);
    expect(item.description).toBe("");
    expect(item.solution).toEqual({ commands: [], files: [] });
  });
});
