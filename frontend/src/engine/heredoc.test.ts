import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runLayers } from "@/lib/setupRunner";
import { mountTerminalWindow, type TerminalWindow } from "./terminalWindow";

// The first mount loads the whole legacy engine, which is slow when the machine is busy.
vi.setConfig({ testTimeout: 120_000 });

let win: TerminalWindow | null = null;
afterEach(() => {
  win?.destroy();
  win = null;
  document.body.innerHTML = "";
});

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  win = await mountTerminalWindow(host, null, { onCommand: () => {} });
  win.setSpeed(100);
  return win;
}

const NL = String.fromCharCode(10);

// The scripts of the teachers create files with heredocs (cat << 'EOF' > file).
describe("heredoc in the terminal of the application", () => {
  it("writes the body to the file, as it is with a quoted delimiter and with the variables replaced without quotes", async () => {
    const t = await mount();
    const script = [
      "NOME=Ana",
      "cat << 'EOF' > /tmp/literal.txt",
      "Olá $NOME, ${NOME} e $(whoami)",
      'aspas "duplas" e \'simples\' e barra \\ e #hash',
      "EOF",
      "cat <<EOF > /tmp/expandido.txt",
      "Olá $NOME e ${NOME}! Custa \\$5",
      "EOF",
      "cat <<- FIM > /tmp/tabs.txt",
      "\tlinha com tab",
      "\tFIM",
      "outra linha depois",
    ].join(NL);
    // The last two lines show where the heredoc ends: "FIM" with a tab closes it, and the next line is a command.
    await t.execute({ command: `printf '%s\\n' ok > /dev/null` });
    const results = await runLayers(t, [{ id: "own", kind: "card", label: "x", setup: { summary: "", steps: [], files: [{ path: "/tmp/s.sh", content: script + NL, mode: "755" }] } }]);
    expect(results.every((r) => r.status === 0)).toBe(true);
    const run = await t.execute({ command: "bash /tmp/s.sh" });
    expect(run.output).toContain("outra: comando não encontrado");

    expect((await t.execute({ command: "cat /tmp/literal.txt" })).output).toBe(["Olá $NOME, ${NOME} e $(whoami)", 'aspas "duplas" e \'simples\' e barra \\ e #hash'].join(NL));
    expect((await t.execute({ command: "cat /tmp/expandido.txt" })).output).toBe("Olá Ana e Ana! Custa $5");
    expect((await t.execute({ command: "cat /tmp/tabs.txt" })).output).toBe("linha com tab");
  });

  it("takes several heredocs in a row and a heredoc piped into another command", async () => {
    const t = await mount();
    const script = ["cat << 'A' > /tmp/a.txt", "um", "A", "cat << 'B' > /tmp/b.txt", "dois", "tres", "B", "cat << 'C' | wc -l", "x", "y", "z", "C", "echo depois"].join(NL);
    await runLayers(t, [{ id: "own", kind: "card", label: "x", setup: { summary: "", steps: [], files: [{ path: "/tmp/s.sh", content: script + NL }] } }]);
    const run = await t.execute({ command: "bash /tmp/s.sh" });
    expect(run.status).toBe(0);
    expect(run.output).toContain("3");
    expect(run.output).toContain("depois");
    expect((await t.execute({ command: "cat /tmp/a.txt" })).output).toBe("um");
    expect((await t.execute({ command: "cat /tmp/b.txt" })).output).toBe("dois" + NL + "tres");
  });

  it("does not print the variables on set -e", async () => {
    const t = await mount();
    const run = await t.execute({ command: "set -e" });
    expect(run).toEqual({ status: 0, output: "" });
    expect((await t.execute({ command: "set -o pipefail" })).output).toBe("");
    expect((await t.execute({ command: "set" })).output).toContain("HOME=");
  });

  // The script of the professor: it must build the whole laboratory.
  it("runs the laboratory script of the professor and creates every folder and file", async () => {
    const t = await mount();
    const script = readFileSync("src/test/fixtures/laboratorio-dev.sh", "utf8");
    const results = await runLayers(t, [{ id: "own", kind: "module", label: "Módulo", setup: { summary: "", steps: [{ command: "mkdir -p /home/ricardo/financeiro" }], files: [{ path: "/home/ricardo/financeiro/teste.sh", content: script, mode: "755" }] } }]);
    expect(results.every((r) => r.status === 0)).toBe(true);

    const run = await t.execute({ command: "bash /home/ricardo/financeiro/teste.sh" });
    expect(run.status).toBe(0);
    expect(run.output).toContain("🛸 Criando ambiente em: /home/ricardo/laboratorio_dev...");
    expect(run.output).toContain("✅ AMBIENTE CRIADO COM SUCESSO!");
    expect(run.output).not.toMatch(/erro de sintaxe|comando não encontrado|HOME=/);

    const base = "/home/ricardo/laboratorio_dev";
    const expected = [
      "",
      "/anotacoes",
      "/anotacoes/aulas",
      "/anotacoes/dicas_de_terminal.txt",
      "/documentacoes",
      "/documentacoes/guia_git.md",
      "/laboratorio_secreto",
      "/laboratorio_secreto/desafios",
      "/laboratorio_secreto/desafios/enigma.txt",
      "/missoes",
      "/missoes/missao_01_primeiros_passos.txt",
      "/projetos_web",
      "/projetos_web/mini_game",
      "/projetos_web/mini_game/estilos",
      "/projetos_web/mini_game/estilos/game.css",
      "/projetos_web/mini_game/index.html",
      "/projetos_web/mini_game/scripts",
      "/projetos_web/mini_game/scripts/game.js",
      "/projetos_web/site_cyberpunk",
      "/projetos_web/site_cyberpunk/assets",
      "/projetos_web/site_cyberpunk/css",
      "/projetos_web/site_cyberpunk/css/style.css",
      "/projetos_web/site_cyberpunk/index.html",
      "/projetos_web/site_cyberpunk/js",
      "/projetos_web/site_cyberpunk/js/app.js",
      "/README.md",
    ].map((p) => base + p);
    const found = (await t.execute({ command: `find ${base}` })).output.split(NL);
    expect([...found].sort()).toEqual([...expected].sort());

    // The files have the text of the script, byte for byte, and belong to the user.
    expect((await t.execute({ command: "cat /home/ricardo/laboratorio_dev/projetos_web/site_cyberpunk/css/style.css" })).output).toContain("box-shadow: 0 0 25px rgba(0, 255, 204, 0.35);");
    expect((await t.execute({ command: "cat /home/ricardo/laboratorio_dev/README.md" })).output).toContain('> "Errar faz parte do código. Ler a mensagem de erro é o verdadeiro superpoder!"');
    expect((await t.execute({ command: "grep -c 'btnConectar' /home/ricardo/laboratorio_dev/projetos_web/site_cyberpunk/index.html" })).output).toBe("1");
    expect((await t.execute({ command: "ls -ld /home/ricardo/laboratorio_dev" })).output).toContain("ricardo ricardo");
  });
});
