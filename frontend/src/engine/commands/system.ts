import { md5 } from "./digest";
import { binaryFolder } from "./binaries";
import { defineCommand, linesOf, parseOptions, rejectOptions, toBytes } from "./helpers";
import { msg } from "./messages";
import { getRegistry } from "./registry";
import type { EngineCommand, EngineContext } from "./types";

/** The text of a file of the machine, or "" when it does not exist. */
export function textOf(context: EngineContext, path: string): string {
  const node = context.tentarLocalizar(path);
  return node && !node.ehDiretorio() && node.ler ? node.ler() : "";
}

/** The fields of the first processor of /proc/cpuinfo and how many processors it lists. */
export function cpuInfo(context: EngineContext): { count: number; fields: Record<string, string> } {
  const text = textOf(context, "/proc/cpuinfo");
  const count = Math.max(1, (text.match(/^processor\s*:/gm) ?? []).length);
  const fields: Record<string, string> = {};
  for (const line of linesOf(text.split(/\n\s*\n/)[0] ?? "")) {
    const [key, ...rest] = line.split(":");
    if (key !== undefined && rest.length > 0) fields[key.trim()] = rest.join(":").trim();
  }
  return { count, fields };
}

const nproc = defineCommand(
  "nproc",
  "mostra quantos processadores a máquina tem: nproc",
  {
    uso: "nproc [--all] [--ignore=N]",
    descricao: "Mostra o número de processadores (núcleos) disponíveis, o mesmo que /proc/cpuinfo lista.",
    opcoes: [
      ["--all", "conta todos os processadores, mesmo os que não estão em uso"],
      ["--ignore=N", "tira N processadores da conta (sempre sobra pelo menos 1)"],
    ],
    exemplos: [["nproc --ignore=1", "um a menos que o total"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "", knownLong: ["all", "ignore"] });
    if (rejectOptions("nproc", parsed, context)) return 1;
    if (parsed.operands.length > 0) {
      context.falhar(msg.extraOperand("nproc", parsed.operands[0]!));
      context.falhar(msg.tryHelp("nproc"));
      return 1;
    }
    const ignore = Number(parsed.values.get("--ignore") ?? "0");
    if (!Number.isInteger(ignore) || ignore < 0) {
      context.falhar(msg.invalidNumber("nproc", parsed.values.get("--ignore") ?? ""));
      return 1;
    }
    context.linha(String(Math.max(1, cpuInfo(context).count - ignore)));
    return 0;
  },
);

const lscpu = defineCommand(
  "lscpu",
  "mostra dados do processador: lscpu",
  {
    uso: "lscpu",
    descricao: "Mostra um quadro com a arquitetura, o número de processadores, o fabricante e o modelo.",
    h: "ajuda",
    exemplos: [["lscpu | grep Nome", "mostra só o nome do modelo"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "h" });
    if (rejectOptions("lscpu", parsed, context)) return 1;
    const { count, fields } = cpuInfo(context);
    const rows: [string, string][] = [
      ["Arquitetura:", "x86_64"],
      ["Modo(s) operacional da CPU:", "32-bit, 64-bit"],
      ["Ordem dos bytes:", "Little Endian"],
      ["CPU(s):", String(count)],
      ["ID de fornecedor:", fields["vendor_id"] ?? "GenuineIntel"],
      ["Nome do modelo:", fields["model name"] ?? "Intel(R) Xeon(R)"],
      ["Família da CPU:", fields["cpu family"] ?? "6"],
      ["Modelo:", fields["model"] ?? "143"],
      ["Núcleo(s) por soquete:", fields["cpu cores"] ?? "1"],
      ["Soquete(s):", String(count)],
      ["Fabricante do hipervisor:", "KVM"],
      ["Tipo de virtualização:", "total"],
    ];
    const width = Math.max(...rows.map(([label]) => label.length)) + 2;
    for (const [label, value] of rows) context.linha(`${label.padEnd(width)}${value}`);
    return 0;
  },
);

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const WEEKDAYS = "Do Se Te Qu Qu Se Sá";

function monthBlock(year: number, month: number, withYear: boolean): string[] {
  const title = withYear ? `${MONTHS[month]} ${year}` : `${MONTHS[month]}`;
  const lead = Math.floor((20 - title.length) / 2);
  const lines = [`${" ".repeat(Math.max(0, lead))}${title}`.padEnd(20), WEEKDAYS];
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [...Array<string>(first).fill("  "), ...Array.from({ length: days }, (_, i) => String(i + 1).padStart(2))];
  for (let i = 0; i < cells.length; i += 7) lines.push(cells.slice(i, i + 7).join(" ").padEnd(20));
  while (lines.length < 8) lines.push(" ".repeat(20));
  return lines;
}

const cal = defineCommand(
  "cal",
  "mostra o calendário do mês: cal | cal 10 2026",
  {
    uso: "cal [[MÊS] ANO]",
    descricao: "Mostra o calendário do mês atual. Com um número, mostra o ano inteiro; com dois, o mês e o ano.",
    h: "ajuda",
    exemplos: [
      ["cal 10 2026", "calendário de outubro de 2026"],
      ["cal 2026", "o ano inteiro"],
    ],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "h", numericOperands: true });
    if (rejectOptions("cal", parsed, context)) return 1;
    const operands = parsed.operands;
    if (operands.length > 2) {
      context.falhar(msg.extraOperand("cal", operands[2]!));
      return 1;
    }
    const today = new Date();
    const parse = (text: string): number => (/^\d+$/.test(text) ? Number(text) : Number.NaN);
    let month: number | null = today.getMonth() + 1;
    let year = today.getFullYear();
    if (operands.length === 1) {
      year = parse(operands[0]!);
      month = null;
    } else if (operands.length === 2) {
      month = parse(operands[0]!);
      year = parse(operands[1]!);
    }
    if (month !== null && !(month >= 1 && month <= 12)) {
      context.falhar(msg.invalidMonth);
      return 1;
    }
    if (!(year >= 1 && year <= 9999)) {
      context.falhar(msg.invalidYear);
      return 1;
    }
    if (month !== null) {
      for (const line of monthBlock(year, month - 1, true)) context.linha(line.trimEnd());
      return 0;
    }
    const title = String(year);
    context.linha(`${" ".repeat(Math.floor((64 - title.length) / 2))}${title}`);
    for (let row = 0; row < 4; row++) {
      context.linha();
      const blocks = [0, 1, 2].map((i) => monthBlock(year, row * 3 + i, false));
      for (let line = 0; line < 8; line++) context.linha(blocks.map((block) => block[line]).join("  ").trimEnd());
    }
    return 0;
  },
);

const tty = defineCommand(
  "tty",
  "mostra o terminal em uso: tty",
  {
    uso: "tty [-s]",
    descricao: "Mostra o nome do arquivo do terminal ligado à entrada. Se a entrada vem de um pipe, diz que não é um terminal.",
    opcoes: [["-s", "não escreve nada, só devolve o código de saída"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "s", long: { silent: "s", quiet: "s" } });
    if (rejectOptions("tty", parsed, context)) return 1;
    if (context.entrada !== null) {
      if (!parsed.flags.has("s")) context.linha(msg.notATty);
      return 1;
    }
    if (!parsed.flags.has("s")) context.linha(context.sessao.tty.startsWith("/dev/") ? context.sessao.tty : `/dev/${context.sessao.tty}`);
    return 0;
  },
);

const hostnamectl = defineCommand(
  "hostnamectl",
  "mostra os dados da máquina e do sistema: hostnamectl",
  {
    uso: "hostnamectl [status]",
    descricao: "Mostra o nome da máquina, o tipo, o sistema operacional, o kernel e a arquitetura.",
    h: "ajuda",
    opcoes: [["status", "mostra o quadro (é o padrão)"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "h" });
    if (rejectOptions("hostnamectl", parsed, context)) return 1;
    if (parsed.operands.length > 0 && parsed.operands[0] !== "status") {
      context.falhar(msg.unsupportedOperation("hostnamectl"));
      return 1;
    }
    const hostname = context.maquina.hostname;
    const pretty = /^PRETTY_NAME="?([^"\n]*)"?/m.exec(textOf(context, "/etc/os-release"))?.[1] ?? "Ubuntu";
    const kernel = /^Linux version (\S+)/.exec(textOf(context, "/proc/version"))?.[1] ?? "6.8.0";
    const rows: [string, string][] = [
      ["Static hostname", hostname],
      ["Icon name", "computer-vm"],
      ["Chassis", "vm"],
      ["Machine ID", md5(toBytes(hostname))],
      ["Boot ID", md5(toBytes(`${hostname}:boot`))],
      ["Virtualization", "kvm"],
      ["Operating System", pretty],
      ["Kernel", `Linux ${kernel}`],
      ["Architecture", "x86-64"],
    ];
    const width = Math.max(...rows.map(([label]) => label.length));
    for (const [label, value] of rows) context.linha(`${label.padStart(width + 1)}: ${value}`);
    return 0;
  },
);

const whereis = defineCommand(
  "whereis",
  "mostra onde ficam o programa e o manual: whereis ls",
  {
    uso: "whereis NOME...",
    descricao: "Procura o programa e a página de manual de cada nome e mostra os caminhos.",
    exemplos: [["whereis ls", "mostra /usr/bin/ls e o manual dele"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "" });
    if (rejectOptions("whereis", parsed, context)) return 1;
    if (parsed.operands.length === 0) {
      context.falhar(msg.whereisUsage);
      return 1;
    }
    const names = new Set(context.executor.nomesDeComandos());
    for (const name of parsed.operands) {
      if (!names.has(name)) context.linha(`${name}:`);
      else if (context.executor.ehEmbutido(name)) context.linha(`${name}: /usr/share/man/man1/${name}.1.gz`);
      else context.linha(`${name}: ${binaryFolder(name)}/${name} /usr/share/man/man1/${name}.1.gz`);
    }
    return 0;
  },
);

const whatis = defineCommand(
  "whatis",
  "mostra uma linha explicando o comando: whatis ls",
  {
    uso: "whatis COMANDO...",
    descricao: "Mostra a descrição de uma linha de cada comando. Se não conhece o nome, avisa que não achou nada.",
    exemplos: [["whatis ls", "ls (1) - o que o ls faz"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "" });
    if (rejectOptions("whatis", parsed, context)) return 1;
    if (parsed.operands.length === 0) {
      context.falhar(msg.whatisUsage);
      return 1;
    }
    let status = 0;
    for (const name of parsed.operands) {
      const command = getRegistry()?.obter(name);
      if (!command) {
        context.falhar(msg.nothingAppropriate(name));
        status = 16;
        continue;
      }
      const summary = command.resumo.split(": ")[0] ?? command.resumo;
      context.linha(`${`${name} (1)`.padEnd(20)} - ${summary}`);
    }
    return status;
  },
);

export const systemCommands: EngineCommand[] = [nproc, lscpu, cal, tty, hostnamectl, whereis, whatis];
