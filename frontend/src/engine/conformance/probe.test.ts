import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { mountMachine } from "../testkit";

it("probe", async () => {
  const win = await mountMachine();
  const { Shell } = await import("@legacy-engine/shell/Shell");
  const { Maquina } = await import("@legacy-engine/linux/Maquina");
  const { CATALOGO } = await import("@legacy-engine/linux/Pacotes");
  const cmds: string[] = (Shell.obterRegistro() as any).nomes();
  const m: any = Maquina.criar();
  const bins: string[] = [];
  for (const dir of ["/usr/bin", "/usr/sbin", "/bin", "/sbin", "/usr/local/bin"]) {
    const d = m.fs.obter(dir);
    if (d?.filhos) for (const [n] of d.filhos) bins.push(dir + "/" + n);
  }
  const notCmd = bins.filter((b) => !cmds.includes(b.split("/").pop()!));
  const pk = CATALOGO.map((p: any) => `${p.nome}[${p.base ? "base" : ""}]:${p.programas.join(",")}`);
  writeFileSync("C:/Users/ricar/AppData/Local/Temp/probe.json", JSON.stringify({ cmds, notCmd, pk }, null, 1));
  win.destroy();
});
