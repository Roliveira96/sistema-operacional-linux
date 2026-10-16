import { messages } from "./messages";
import { niceOf, niceOfPid, priorityOf } from "./priority";
import type { EngineCommand, EngineContext, EngineProcess, Output } from "./types";

/** One line of the table of processes the engine lists (a system process, a service, a session or a command of the user). */
export interface ProcessLine {
  pid: number;
  ppid: number;
  usuario: string;
  tty: string;
  estado: string;
  comando: string;
  cpu: number;
  mem: number;
  processo?: object;
}

type Lister = (machine: unknown) => ProcessLine[];
let listLines: Lister = () => [];

/** Told once, at registration, how the engine lists the processes (its `listarProcessos`). */
export function setProcessLister(lister: Lister): void {
  listLines = lister;
}

/** The processes the engine lists, as `ps` and `top` read them. */
export const processLines = (machine: unknown): ProcessLine[] => listLines(machine);

export const niceOfLine = (line: ProcessLine) => (line.processo ? niceOf(line.processo as EngineProcess) : niceOfPid(line.pid));
export const priorityOfLine = (line: ProcessLine) => (line.processo ? priorityOf(line.processo as EngineProcess) : 80 + niceOfPid(line.pid));
export const programOf = (command: string) => command.replace(/^-/, "").split(" ")[0]!.split("/").pop() ?? command;

type Column = { title: string; align: "left" | "right"; min: number; value: (line: ProcessLine, uidOf: (name: string) => number) => string };

/** The fields `ps -o` knows, by their names. */
const FIELDS: Record<string, Column> = {
  pid: { title: "PID", align: "right", min: 7, value: (l) => String(l.pid) },
  ppid: { title: "PPID", align: "right", min: 7, value: (l) => String(l.ppid) },
  ni: { title: "NI", align: "right", min: 3, value: (l) => String(niceOfLine(l)) },
  pri: { title: "PRI", align: "right", min: 3, value: (l) => String(priorityOfLine(l)) },
  user: { title: "USER", align: "left", min: 8, value: (l) => l.usuario.substring(0, 8) },
  uid: { title: "UID", align: "right", min: 5, value: (l, uidOf) => String(uidOf(l.usuario)) },
  stat: { title: "STAT", align: "left", min: 4, value: (l) => l.estado },
  s: { title: "S", align: "left", min: 1, value: (l) => l.estado.charAt(0) },
  tty: { title: "TT", align: "left", min: 8, value: (l) => l.tty },
  time: { title: "TIME", align: "right", min: 8, value: () => "00:00:00" },
  c: { title: "C", align: "right", min: 2, value: () => "0" },
  pcpu: { title: "%CPU", align: "right", min: 4, value: (l) => l.cpu.toFixed(1) },
  pmem: { title: "%MEM", align: "right", min: 4, value: (l) => l.mem.toFixed(1) },
  comm: { title: "COMMAND", align: "left", min: 0, value: (l) => programOf(l.comando) },
  cmd: { title: "COMMAND", align: "left", min: 0, value: (l) => l.comando },
};
const ALIASES: Record<string, string> = { args: "cmd", command: "cmd", "%cpu": "pcpu", "%mem": "pmem", nice: "ni", priority: "pri", ucmd: "comm", tt: "tty", state: "s", ppid_: "ppid" };

/** The table of `ps -o`: the fields asked for, in that order; `name=TITLE` renames the header and `name=` hides it. */
function customTable(spec: string, lines: ProcessLine[], uidOf: (name: string) => number): string[] | string {
  const columns: { column: Column; title: string }[] = [];
  for (const part of spec.split(/[,\s]+/).filter(Boolean)) {
    const [raw, ...renamed] = part.split("=");
    const key = ALIASES[raw!.toLowerCase()] ?? raw!.toLowerCase();
    const column = FIELDS[key];
    if (column === undefined) return raw!;
    columns.push({ column, title: renamed.length > 0 ? renamed.join("=") : column.title });
  }
  const rows = lines.map((line) => columns.map(({ column }) => column.value(line, uidOf)));
  const widths = columns.map(({ title }, i) => Math.max(columns[i]!.column.min, title.length, ...rows.map((row) => row[i]!.length)));
  const pad = (text: string, i: number) => (columns[i]!.column.align === "right" ? text.padStart(widths[i]!) : text.padEnd(widths[i]!));
  const headerHidden = columns.every(({ title }) => title === "");
  const out = headerHidden ? [] : [columns.map(({ title }, i) => pad(title, i)).join(" ").trimEnd()];
  for (const row of rows) out.push(row.map((text, i) => pad(text, i)).join(" ").trimEnd());
  return out;
}

/** `ps -l`: the long format, with the priority, the niceness and the parent of each process. */
function longTable(lines: ProcessLine[], uidOf: (name: string) => number): string[] {
  const out = ["F S   UID     PID    PPID  C PRI  NI ADDR SZ WCHAN  TTY          TIME CMD"];
  for (const l of lines) {
    const waiting = l.estado.startsWith("S") && /bash/.test(l.comando) ? "do_wai" : "-";
    out.push(
      `${uidOf(l.usuario) === 0 ? "4" : "0"} ${l.estado.charAt(0)} ${String(uidOf(l.usuario)).padStart(5)} ${String(l.pid).padStart(7)} ${String(l.ppid).padStart(7)} ${"0".padStart(2)} ` +
        `${String(priorityOfLine(l)).padStart(3)} ${String(niceOfLine(l)).padStart(3)} - ${String(1500 + (l.pid % 3000)).padStart(5)} ${waiting.padEnd(6)} ${l.tty.padEnd(8)} 00:00:00 ${programOf(l.comando)}`,
    );
  }
  return out;
}

/**
 * Draws the tree of parents and children over a table the engine printed: the rows are put under their parent, and the command column
 * gets the ` \_ ` of ps f. The columns are found by counting (the header of the engine is not aligned with its rows), so it works with
 * every format: the PID is the token under the header PID, and the command is whatever comes after the last column of the header.
 */
export function forest(text: string, lines: ProcessLine[]): string {
  const rows = text.split("\n");
  const header = rows[0] ?? "";
  const titles = header.trim().split(/\s+/);
  const pidColumn = titles.indexOf("PID");
  const lastTitle = titles[titles.length - 1];
  if (pidColumn < 0 || (lastTitle !== "COMMAND" && lastTitle !== "CMD")) return text;
  const body = rows.slice(1).filter((row) => row.trim() !== "");

  /** Where the command of a row starts: after as many columns as the header has before its last one. */
  const commandStart = (row: string): number => {
    const tokens = [...row.matchAll(/\S+/g)];
    return tokens[titles.length - 1]?.index ?? row.length;
  };
  const pidOf = (row: string): number => Number(row.trim().split(/\s+/)[pidColumn]);

  const byPid = new Map<number, string>();
  for (const row of body) byPid.set(pidOf(row), row);
  const parentOf = new Map(lines.map((line) => [line.pid, line.ppid]));
  const children = new Map<number, number[]>();
  const roots: number[] = [];
  for (const pid of [...byPid.keys()].sort((a, b) => a - b)) {
    const parent = parentOf.get(pid);
    if (parent !== undefined && byPid.has(parent) && parent !== pid) children.set(parent, [...(children.get(parent) ?? []), pid]);
    else roots.push(pid);
  }
  const out = [header];
  const walk = (pid: number, depth: number) => {
    const row = byPid.get(pid)!;
    const start = commandStart(row);
    out.push(depth === 0 ? row : `${row.slice(0, start)}${" ".repeat(depth * 2 - 1)}\\_ ${row.slice(start)}`);
    for (const child of children.get(pid) ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return out.join("\n") + "\n";
}

/** The words of the command line that ask for something new; the rest is the engine's own ps. */
interface Asked {
  long: boolean;
  forest: boolean;
  format: string | null;
  /** The arguments for the engine's own ps: everything but what only this one understands. */
  rest: string[];
  all: boolean;
  user: string | null;
  pids: string[] | null;
  name: string | null;
}

function parse(args: string[]): Asked {
  const asked: Asked = { long: false, forest: false, format: null, rest: [], all: false, user: null, pids: null, name: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--forest") asked.forest = true;
    else if (arg === "-o" || arg === "--format") asked.format = args[++i] ?? "";
    else if (arg.startsWith("--format=")) asked.format = arg.slice("--format=".length);
    else if (arg.startsWith("-o") && arg.length > 2) asked.format = arg.slice(2);
    else if (arg === "-u" || arg === "--user" || arg === "-p" || arg === "--pid" || arg === "-C") {
      // These select processes; the engine's ps needs to see them too.
      const value = args[++i] ?? "";
      if (arg === "-u" || arg === "--user") asked.user = value;
      else if (arg === "-C") asked.name = value;
      else asked.pids = value.split(",");
      asked.rest.push(arg, value);
    } else if (/^-[A-Za-z]+$/.test(arg)) {
      // Letters together: -el, -ef, -lA. l is the long format; e, A and f select everything, as the engine's ps does.
      for (const letter of arg.slice(1)) {
        if (letter === "l") asked.long = true;
        else if (letter === "e" || letter === "A" || letter === "f") asked.all = true;
      }
      asked.rest.push(arg);
    } else if (/^[a-zA-Z]+$/.test(arg)) {
      // The BSD style (aux, axf): an f among its letters is the forest, which the engine does not know.
      if (arg.includes("f")) asked.forest = true;
      if (/[ax]/.test(arg)) asked.all = true;
      const others = arg.replace(/f/g, "");
      if (others !== "") asked.rest.push(others);
    } else asked.rest.push(arg);
  }
  return asked;
}

class Capture implements Output {
  text = "";
  escrever(text: string) {
    this.text += text;
  }
}

/**
 * ps, extended: `-l` (priority and niceness), `-o FIELDS` (any of pid, ppid, ni, pri, user, stat, tty, time, comm, cmd...) and the forest
 * (`--forest`, `f`). What is not new, the engine's own ps prints; the forest is drawn over what it printed.
 */
export function makePs(original: EngineCommand): EngineCommand {
  return {
    nome: "ps",
    resumo: original.resumo,
    embutido: original.embutido,
    ajuda: {
      ...(original.ajuda ?? { uso: "ps", descricao: original.resumo }),
      uso: "ps [aux] [-e] [-f] [-l] [-o CAMPOS] [--forest] [-u USUÁRIO] [-p PID[,PID]...] [-C COMANDO]",
      opcoes: [
        ...(original.ajuda?.opcoes ?? []),
        ["-l", "formato longo: mostra o PID do pai, a prioridade (PRI) e o nice (NI)"],
        ["-o CAMPOS", "escolhe as colunas: pid, ppid, ni, pri, user, uid, stat, tty, time, pcpu, pmem, comm, cmd (use campo=TÍTULO para renomear)"],
        ["--forest, f", "desenha a árvore de pais e filhos"],
      ],
      exemplos: [
        ...(original.ajuda?.exemplos ?? []),
        ["ps -l", "lista os processos do terminal com prioridade e nice"],
        ["ps -o pid,ppid,ni,stat,comm -p 2451", "mostra só essas colunas do processo 2451"],
        ["ps -ef --forest", "todos os processos, em árvore"],
      ],
    },
    async executar(args: string[], context: EngineContext): Promise<number> {
      const asked = parse(args);
      if (!asked.long && asked.format === null && !asked.forest) return original.executar(args, context);

      const uidOf = (name: string) => (context.maquina.contas as unknown as { usuario(name: string): { uid: number } | undefined }).usuario(name)?.uid ?? 0;
      let text: string;
      if (asked.long || asked.format !== null) {
        let lines = listLines(context.maquina);
        if (asked.user !== null) lines = lines.filter((l) => l.usuario === asked.user);
        if (asked.pids !== null) lines = lines.filter((l) => asked.pids!.includes(String(l.pid)));
        if (asked.name !== null) lines = lines.filter((l) => programOf(l.comando) === asked.name);
        const filtered = asked.user !== null || asked.pids !== null || asked.name !== null;
        if (!asked.all && !filtered) lines = lines.filter((l) => l.tty === context.sessao.tty);
        const table = asked.format !== null ? customTable(asked.format, lines, uidOf) : longTable(lines, uidOf);
        if (typeof table === "string") {
          context.falhar(messages.ps.unknownField(table));
          return 1;
        }
        text = table.join("\n") + "\n";
      } else {
        const capture = new Capture();
        const status = await original.executar(asked.rest, context.com({ saida: capture }));
        if (status !== 0) {
          context.escrever(capture.text);
          return status;
        }
        text = capture.text;
      }
      context.escrever(asked.forest ? forest(text, listLines(context.maquina)) : text);
      return 0;
    },
  };
}
