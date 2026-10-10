import { afterEach, describe, expect, it, vi } from "vitest";
import { testBank, type BankItem } from "./bankTest";
import { createEngineSandbox, type EngineSandbox } from "./bankTestEngine";

// The first mount loads the whole legacy engine, which is slow when the machine is busy.
vi.setConfig({ testTimeout: 180_000 });

let engine: EngineSandbox | null = null;
afterEach(() => {
  engine?.destroy();
  engine = null;
  document.body.innerHTML = "";
});

const solution = (...commands: string[]) => ({ summary: "", steps: commands.map((command) => ({ command })) });

// Covers SPEC-023 12 on the real terminal: the batteries over a bank, the dependency nobody declared and the snapshots of the base.
describe("bank test on the real terminal", () => {
  it("prepares the base from the layers, tests the bank and finds the dependency of the script on its folder", async () => {
    engine = await createEngineSandbox(null, [{ id: "module", kind: "module", label: "Módulo", setup: solution("mkdir /treino") }]);
    expect(engine.conflicts).toEqual([]);
    const items: BankItem[] = [
      { id: "dir", title: "Pasta", dependsOn: null, solution: solution("mkdir /treino/lab"), conditions: [{ kind: "DIR_EXISTS", path: "/treino/lab" }] },
      // Writes inside the folder of the first one without saying so.
      { id: "file", title: "Arquivo", dependsOn: null, solution: solution("touch /treino/lab/ola.sh"), conditions: [{ kind: "FILE_EXISTS", path: "/treino/lab/ola.sh" }] },
      { id: "solo", title: "Solto", dependsOn: null, solution: solution("mkdir /treino/solto"), conditions: [{ kind: "DIR_EXISTS", path: "/treino/solto" }] },
    ];
    const report = await testBank(items, engine.sandbox!, { seed: 11 });
    expect(report.conflicts).toEqual(["file"]);
    expect(report.suggested).toEqual([{ id: "file", on: "dir" }]);
    expect(report.status).toBe("failed");

    // Declared, the same bank passes, and the rounds always take the folder along.
    const declared = items.map((it) => (it.id === "file" ? { ...it, dependsOn: "dir" } : it));
    expect((await testBank(declared, engine.sandbox!, { seed: 11 })).status).toBe("ok");
  });

  it("does not give a sandbox when a snapshot of the base fails", async () => {
    engine = await createEngineSandbox(null, [{ id: "bank", kind: "card", label: "Banco", setup: solution("mkdir /nao/existe") }]);
    expect(engine.sandbox).toBeNull();
    expect(engine.conflicts).toHaveLength(1);
    expect(engine.conflicts[0]!.layer.id).toBe("bank");
  });
});
