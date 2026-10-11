import { absolutePath, decimal, defineCommand, messageOf, parseOptions, rejectOptions, writeFile } from "./helpers";
import { msg } from "./messages";
import { textOf } from "./system";
import type { EngineCommand, EngineNode } from "./types";

/** The biggest file dd writes (RN-09): keeps the serialized state of the machine small. */
export const DD_LIMIT = 65536;

const UNITS: Record<string, number> = { c: 1, w: 2, b: 512, k: 1024, K: 1024, M: 1048576, G: 1073741824 };

/** "512", "4k", "1M": a size operand of dd, in bytes, or null when it is not one. */
function parseSize(text: string): number | null {
  const match = /^(\d+)([cwbkKMG]?)$/.exec(text);
  return match ? Number(match[1]) * (UNITS[match[2] || "c"] ?? 1) : null;
}

const dd = defineCommand(
  "dd",
  "copia bytes de um lugar para outro: dd if=/dev/zero of=arquivo bs=1k count=4",
  {
    uso: "dd [OPERANDO]...",
    descricao: "Copia bytes de uma origem para um destino, em blocos. No simulador o arquivo gerado tem no máximo 64 KiB.",
    opcoes: [
      ["if=ARQUIVO", "origem: um arquivo ou /dev/zero (sem isso, lê a entrada padrão)"],
      ["of=ARQUIVO", "destino (sem isso, escreve na tela)"],
      ["bs=TAMANHO", "tamanho do bloco, com sufixo k, M ou G (padrão 512)"],
      ["count=N", "copia só N blocos"],
    ],
    exemplos: [["dd if=/dev/zero of=zero.img bs=1k count=4", "cria um arquivo de 4 KB com zeros"]],
  },
  (args, context) => {
    const operands = new Map<string, string>();
    for (const arg of args) {
      const eq = arg.indexOf("=");
      const key = eq === -1 ? "" : arg.slice(0, eq);
      if (!["if", "of", "bs", "count", "status", "conv"].includes(key)) {
        context.falhar(msg.ddInvalidOperand(arg));
        context.falhar(msg.tryHelp("dd"));
        return 1;
      }
      operands.set(key, arg.slice(eq + 1));
    }
    const blockSize = operands.has("bs") ? parseSize(operands.get("bs")!) : 512;
    if (blockSize === null || blockSize < 1) {
      context.falhar(msg.ddInvalidNumber("bs", operands.get("bs") ?? ""));
      return 1;
    }
    const count = operands.has("count") ? Number(operands.get("count")) : null;
    if (count !== null && (!Number.isInteger(count) || count < 0)) {
      context.falhar(msg.ddInvalidNumber("count", operands.get("count") ?? ""));
      return 1;
    }
    const source = operands.get("if");
    let data: string;
    const wanted = count === null ? null : blockSize * count;
    if (source === "/dev/zero" || source === "/dev/urandom") {
      if (wanted === null || wanted > DD_LIMIT) {
        context.falhar(msg.ddLimit(wanted ?? Infinity, DD_LIMIT));
        return 1;
      }
      data = source === "/dev/zero" ? "\0".repeat(wanted) : Array.from({ length: wanted }, () => String.fromCharCode(Math.floor(Math.random() * 128))).join("");
    } else {
      let text: string;
      if (source === undefined) text = context.entrada ?? "";
      else {
        try {
          const node: EngineNode = context.localizar(source);
          if (node.ehDiretorio()) {
            context.falhar(msg.isDirectory("dd", source));
            return 1;
          }
          text = node.ler?.() ?? "";
        } catch (error) {
          context.falhar(msg.ddCannotOpen(source, messageOf(error)));
          return 1;
        }
      }
      data = wanted === null ? text : text.slice(0, wanted);
      if (data.length > DD_LIMIT) {
        context.falhar(msg.ddLimit(data.length, DD_LIMIT));
        return 1;
      }
    }
    const destination = operands.get("of");
    if (destination === undefined) context.escrever(data);
    else {
      const failure = writeFile(context, destination, data);
      if (failure !== null) {
        context.falhar(msg.ddCannotWrite(destination, failure));
        return 1;
      }
    }
    if (operands.get("status") !== "none") {
      const total = data.length;
      const full = Math.floor(total / blockSize);
      const partial = total % blockSize > 0 ? 1 : 0;
      context.falhar(`${full}+${partial} registros de entrada`);
      context.falhar(`${full}+${partial} registros de saída`);
      const size = total < 1000 ? `${total} bytes` : `${total} bytes (${decimal(total / 1000, 1)} kB, ${decimal(total / 1024, 1)} KiB)`;
      context.falhar(`${size} copiados, 0,0001 s, ${decimal(total / 0.0001 / 1e6, 1)} MB/s`);
    }
    return 0;
  },
);

/** Sizes as swapon shows them: 4G, 512M, 0B. */
function swapSize(kilobytes: number): string {
  if (kilobytes === 0) return "0B";
  const units = ["K", "M", "G", "T"];
  let value = kilobytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${Number.isInteger(value) ? value : decimal(value, 1)}${units[unit]}`;
}

const swapon = defineCommand(
  "swapon",
  "mostra a memória de troca (swap): swapon --show",
  {
    uso: "swapon [--show]",
    descricao: "Mostra a memória de troca, o espaço em disco que o sistema usa quando a RAM acaba. Sem swap, não escreve nada. Só consulta.",
    h: "ajuda",
    opcoes: [["--show", "mostra a tabela (é o padrão)"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "h", knownLong: ["show"] });
    if (rejectOptions("swapon", parsed, context)) return 1;
    const info = textOf(context, "/proc/meminfo");
    const total = Number(/^SwapTotal:\s+(\d+)/m.exec(info)?.[1] ?? "0");
    const free = Number(/^SwapFree:\s+(\d+)/m.exec(info)?.[1] ?? "0");
    if (total === 0) return 0;
    const size = swapSize(total);
    const used = swapSize(total - free);
    context.linha(`NAME      TYPE ${"SIZE".padStart(Math.max(4, size.length))} ${"USED".padStart(Math.max(4, used.length))} PRIO`);
    context.linha(`/swap.img file ${size.padStart(Math.max(4, size.length))} ${used.padStart(Math.max(4, used.length))}   -2`);
    return 0;
  },
);

type DuOptions = {
  all: boolean;
  human: boolean;
  si: boolean;
  total: boolean;
  apparent: boolean;
  follow: boolean;
  separate: boolean;
  nul: boolean;
  maxDepth: number;
  /** The unit of the plain numbers, in bytes. */
  unit: number;
  excludes: string[];
};

const BLOCK = 4096;

/** "*.txt" and "a?" as a test over a name. */
const globMatches = (pattern: string, name: string): boolean =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`).test(name);

/** The size in the format `du -h` shows, which rounds up: 8,0K, 20K, 1,5M. */
function humanSize(bytes: number, si: boolean): string {
  if (bytes === 0) return "0";
  const base = si ? 1000 : 1024;
  const suffixes = si ? ["k", "M", "G", "T"] : ["K", "M", "G", "T"];
  let value = bytes / base;
  let index = 0;
  while (value >= base && index < suffixes.length - 1) {
    value /= base;
    index++;
  }
  const text = value < 10 ? decimal(Math.ceil(value * 10 - 1e-9) / 10, 1) : String(Math.ceil(value - 1e-9));
  return `${text}${suffixes[index]}`;
}

function formatSize(bytes: number, options: DuOptions): string {
  if (options.human || options.si) return humanSize(bytes, options.si);
  return String(Math.ceil(bytes / options.unit - 1e-9));
}

const du = defineCommand(
  "du",
  "quanto espaço uma pasta ocupa: du -sh /var/log | du -h --max-depth=1 /var",
  {
    uso: "du [OPÇÃO]... [ARQUIVO]...",
    descricao: "Mostra quanto espaço em disco cada pasta (e arquivo citado) ocupa. Por padrão conta em blocos de 4 KB e mostra em KB.",
    h: "outra",
    opcoes: [
      ["-a", "mostra também os arquivos de dentro das pastas"],
      ["-s", "só o total de cada argumento"],
      ["-h", "tamanhos legíveis (K, M, G)"],
      ["--si", "como -h, mas com potências de 1000"],
      ["-c, --total", "acrescenta uma linha com o total"],
      ["-d N, --max-depth=N", "mostra até N níveis de pastas"],
      ["-k, -m", "mostra em KB ou em MB"],
      ["-B TAMANHO, --block-size=TAMANHO", "mostra na unidade dada (1K, 1M, 1G)"],
      ["-b, --apparent-size", "tamanho do conteúdo (em bytes com -b), não dos blocos"],
      ["-S", "não soma as subpastas no total da pasta"],
      ["-x", "não atravessa outros sistemas de arquivos"],
      ["-L", "segue os links simbólicos"],
      ["--exclude=PADRÃO", "ignora o que combina com o padrão"],
      ["-0", "termina cada linha com NUL em vez de quebra de linha"],
    ],
    exemplos: [
      ["du -sh *", "tamanho de cada item da pasta"],
      ["du -h --max-depth=1 /var", "um nível de /var"],
      ["du -shc a.txt b.txt", "resumo com total"],
    ],
  },
  (args, context) => {
    const excludes = args.filter((arg) => arg.startsWith("--exclude=")).map((arg) => arg.slice("--exclude=".length));
    const rest = args.filter((arg) => !arg.startsWith("--exclude="));
    const parsed = parseOptions(rest, {
      known: "ashcdkmbxLS0B",
      withValue: "dB",
      long: {
        all: "a",
        summarize: "s",
        "human-readable": "h",
        total: "c",
        "max-depth": "d",
        bytes: "b",
        "block-size": "B",
        dereference: "L",
        "one-file-system": "x",
        "separate-dirs": "S",
        null: "0",
      },
      knownLong: ["apparent-size", "si"],
    });
    if (rejectOptions("du", parsed, context)) return 1;
    const flags = parsed.flags;
    let unit = 1024;
    if (flags.has("m")) unit = 1048576;
    const blockSize = parsed.values.get("B");
    if (blockSize !== undefined) {
      const match = /^(\d*)([KMGT]?)B?$/i.exec(blockSize);
      const multiplier = { "": 1, K: 1024, M: 1048576, G: 1073741824, T: 1099511627776 }[(match?.[2] ?? "").toUpperCase() as "" | "K" | "M" | "G" | "T"];
      if (!match || multiplier === undefined || (match[1] === "" && match[2] === "")) {
        context.falhar(msg.duInvalidBlockSize(blockSize));
        return 1;
      }
      unit = Number(match[1] || 1) * multiplier;
    }
    if (flags.has("b")) unit = 1;
    const depthText = parsed.values.get("d");
    const options: DuOptions = {
      all: flags.has("a"),
      human: flags.has("h"),
      si: flags.has("--si"),
      total: flags.has("c"),
      apparent: flags.has("b") || flags.has("--apparent-size"),
      follow: flags.has("L"),
      separate: flags.has("S"),
      nul: flags.has("0"),
      maxDepth: flags.has("s") ? 0 : depthText === undefined ? Infinity : Number(depthText),
      unit,
      excludes,
    };
    if (Number.isNaN(options.maxDepth)) {
      context.falhar(msg.duInvalidDepth(depthText ?? ""));
      return 1;
    }
    const paths = parsed.operands.length > 0 ? parsed.operands : ["."];
    let status = 0;
    const emit = (bytes: number, path: string) => context.escrever(`${formatSize(bytes, options)}\t${path}${options.nul ? "\0" : "\n"}`);
    const excluded = (path: string): boolean => options.excludes.some((pattern) => globMatches(pattern, path.slice(path.lastIndexOf("/") + 1)));
    const measure = (path: string, node: EngineNode, depth: number): number => {
      if (node.alvo !== undefined) {
        const folder = path.includes("/") ? absolutePath(path.slice(0, path.lastIndexOf("/")) || "/", context.quadro.cwd) : context.quadro.cwd;
        const target = options.follow ? context.tentarLocalizar(node.alvo.startsWith("/") ? node.alvo : absolutePath(node.alvo, folder)) : null;
        if (target) return measure(path, target, depth);
        if (depth === 0 || options.all) emit(0, path);
        return 0;
      }
      if (!node.ehDiretorio()) {
        const bytes = options.apparent ? node.tamanho() : Math.ceil(node.tamanho() / BLOCK) * BLOCK;
        if (depth === 0 || (options.all && depth <= options.maxDepth)) emit(bytes, path);
        return bytes;
      }
      let total = BLOCK;
      if (!context.fs.pode(node, context.credencial, "r") || !context.fs.pode(node, context.credencial, "x")) {
        context.falhar(msg.duUnreadable(path));
        status = 1;
      } else {
        for (const name of node.nomesOrdenados?.() ?? []) {
          const child = node.obter?.(name);
          if (!child) continue;
          const childPath = path === "/" ? `/${name}` : `${path.replace(/\/$/, "")}/${name}`;
          if (excluded(childPath)) continue;
          const size = measure(childPath, child, depth + 1);
          if (!(options.separate && child.ehDiretorio())) total += size;
        }
      }
      if (depth <= options.maxDepth) emit(total, path);
      return total;
    };
    let grand = 0;
    for (const path of paths) {
      if (excluded(path)) continue;
      try {
        grand += measure(path, context.localizarSemSeguir(path), 0);
      } catch (error) {
        context.falhar(msg.duCannotAccess(path, messageOf(error)));
        status = 1;
      }
    }
    if (options.total) emit(grand, "total");
    return status;
  },
);

export const diskCommands: EngineCommand[] = [dd, swapon, du];

