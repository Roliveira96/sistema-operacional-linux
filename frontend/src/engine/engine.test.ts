// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { createSession, toneOf, VIM_UNSUPPORTED, type EngineIO, type OutputChunk } from "./engine";

interface Manifest {
  scenarios: Array<{ sourceKey: string; snapshot: unknown }>;
  questions: Array<{ sourceKey: string; referenceSolution?: Array<{ command: string }> }>;
}

const manifest = JSON.parse(
  gunzipSync(
    readFileSync(path.resolve(import.meta.dirname, "../../../backend/internal/modules/content/seed/data/content_manifest.json.gz")),
  ).toString("utf8"),
) as Manifest;

const scenario = (key: string) => manifest.scenarios.find((s) => s.sourceKey === `scenario/question/${key}`)!.snapshot;
const solution = (key: string) => manifest.questions.find((q) => q.sourceKey === key)!.referenceSolution!;

function io(overrides: Partial<EngineIO> = {}): EngineIO {
  return { ask: vi.fn().mockResolvedValue(""), edit: vi.fn().mockResolvedValue(null), clear: vi.fn(), ...overrides };
}

function collect() {
  const chunks: OutputChunk[] = [];
  return { chunks, write: (c: OutputChunk) => chunks.push(c), text: () => chunks.map((c) => c.text).join("") };
}

// Covers SPEC-014 CA-01 and CA-08: the legacy engine runs through the adapter.
describe("engine adapter", () => {
  it("restores a scenario, runs commands and serializes the result", async () => {
    const session = await createSession(scenario("dir-1"), io());
    expect(session.prompt()).toMatchObject({ user: "root", isRoot: true });

    const out = collect();
    for (const step of solution("dir-1")) await session.run(step.command, out.write);
    await session.run("pwd", out.write);
    expect(out.text()).toContain("/");

    const snap = session.snapshot() as { formato: string; versao: number };
    expect(snap.formato).toBe("exame-so/maquina");
    expect(snap.versao).toBe(1);
    expect(JSON.stringify(snap)).not.toEqual(JSON.stringify(scenario("dir-1")));
  });

  it("maps output classes to tones and reports errors", async () => {
    const session = await createSession(scenario("dir-1"), io());
    const out = collect();
    await session.run("ls /", out.write);
    expect(out.chunks.some((c) => c.tone === "directory")).toBe(true);
    await session.run("cat /does-not-exist", out.write);
    expect(out.text()).toMatch(/No such file|Arquivo ou diretório|não existe|Não há/i);
    expect(toneOf("c-erro")).toBe("error");
    expect(toneOf(undefined)).toBeUndefined();
    expect(toneOf("c-unknown")).toBeUndefined();
  });

  // Covers SPEC-014 CA-09 at the engine level.
  it("saves nano edits, rejects vim and clears the screen", async () => {
    const edit = vi.fn().mockResolvedValue("hello from nano\n");
    const clear = vi.fn();
    const session = await createSession(scenario("dir-1"), io({ edit, clear }));
    const out = collect();
    await session.run("nano /root/nota.txt", out.write);
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ editor: "nano", path: "/root/nota.txt" }));
    await session.run("cat /root/nota.txt", out.write);
    expect(out.text()).toContain("hello from nano");

    await session.run("vim /root/nota.txt", out.write);
    expect(out.text()).toContain(VIM_UNSUPPORTED);
    await session.run("clear", out.write);
    expect(clear).toHaveBeenCalled();
  });

  it("asks the terminal for interactive answers and survives exit", async () => {
    const ask = vi.fn().mockResolvedValue("Strong#Pass123");
    const session = await createSession(scenario("dir-1"), io({ ask }));
    const out = collect();
    await session.run("useradd -m teste", out.write);
    await session.run("passwd teste", out.write);
    expect(ask).toHaveBeenCalled();
    await session.run("exit", out.write);
    expect(session.prompt().user).toBe("root");
  });

  it("refuses a snapshot without root", async () => {
    await expect(createSession({ formato: "exame-so/maquina", versao: 1, hostname: "h", contas: { usuarios: [], grupos: [] }, raiz: { nome: "", tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", modificadoEm: "x", filhos: [] } }, io())).rejects.toThrow();
  });
});
