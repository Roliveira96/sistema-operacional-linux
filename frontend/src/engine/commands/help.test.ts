import { describe, expect, it } from "vitest";
import { newCommands } from "./index";

// Covers SPEC-028 RN-14 and CA-17 (the shape of SPEC-027, RN-09): every new command has a help that starts with its name.
describe("the help of the new commands (CA-17)", () => {
  it("adds 47 commands to the engine", () => {
    expect(newCommands.map((command) => command.nome).sort()).toEqual(
      [
        "base64", "basename", "cal", "dd", "diff", "dirname", "du", "file", "hostnamectl", "ifconfig", "ip", "lscpu", "md5sum", "nl", "nproc", "nslookup",
        "paste", "rev", "seq", "sha256sum", "cksum", "base32", "od", "hexdump", "sha1sum", "sha224sum", "sha384sum", "sha512sum", "ssh-keygen", "ssh-copy-id", "shuf", "ss", "ssh", "swapon", "tac", "time", "tty", "ufw", "wget", "whatis", "whereis", "xxd", "expr", "traceroute", "netstat", "dig", "scp",
      ].sort(),
    );
  });

  it.each(newCommands.map((command) => [command.nome, command] as const))("%s has a help that starts with its name and says what it does", (_name, command) => {
    const help = command.ajuda;
    expect(help, `${command.nome} has no ajuda`).toBeDefined();
    expect(help!.uso.startsWith(command.nome), `the uso of ${command.nome} must start with its name`).toBe(true);
    expect(help!.descricao.trim().length).toBeGreaterThan(10);
    expect(command.resumo.trim().length).toBeGreaterThan(10);
    for (const [option, text] of [...(help!.opcoes ?? []), ...(help!.exemplos ?? [])]) {
      expect(option.trim(), `${command.nome}: empty left column`).not.toBe("");
      expect(text.trim(), `${command.nome}: empty explanation for ${option}`).not.toBe("");
    }
    const listed = (help!.opcoes ?? []).some(([option]) => /(^|[ ,|])-[A-Za-z]*h/.test(option));
    if (help!.h === "outra") expect(listed, `${command.nome}: -h is another option and is not listed`).toBe(true);
    if (help!.h === "ajuda") expect(listed, `${command.nome}: -h is the help and must not be listed as an option`).toBe(false);
  });
});
