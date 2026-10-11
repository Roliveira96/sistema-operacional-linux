import { defineCommand, listProcesses, outputOf, parseOptions, rejectOptions, statusOf } from "./helpers";
import { addresses, PORT_NAMES, resolve, SERVICES } from "./network";
import type { EngineCommand, EngineContext } from "./types";

// SPEC-033: traceroute, netstat, dig and scp. Nothing reaches a real network: every answer comes from the names the engine already knows.

/** The sum of the octets (or letters): a small number that stays the same for the same address, so the times and ids are repeatable. */
const seedOf = (text: string): number => [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0);

/** The round trip time to an address, in ms: the loopback is the fastest, the local network is close, the internet is far. */
export const baseMs = (ip: string, local: boolean): number => (ip === "127.0.0.1" ? 0.04 : local ? 0.3 + (seedOf(ip) % 4) / 10 : 8 + (seedOf(ip) % 25));

const isThisMachine = (name: string, context: EngineContext): boolean => {
  const { ip, hostname } = addresses(context);
  return name === "localhost" || name === "127.0.0.1" || name === hostname || name === ip;
};

// ───────────── traceroute ─────────────

const traceroute = defineCommand(
  "traceroute",
  "mostra o caminho até uma máquina: traceroute google.com",
  {
    uso: "traceroute [-n] [-m SALTOS] DESTINO",
    descricao: "Mostra, salto a salto, por onde os pacotes passam até o destino. No simulador o caminho é fixo: a própria máquina tem 1 salto, a rede local 1 e a internet 4.",
    h: "ajuda",
    opcoes: [
      ["-n", "não converte os endereços em nomes"],
      ["-m SALTOS", "número máximo de saltos (padrão 30)"],
    ],
    exemplos: [
      ["traceroute google.com", "mostra os 4 saltos até o google.com"],
      ["traceroute -n 8.8.8.8", "só com endereços, sem nomes"],
    ],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "nmh", withValue: "m" });
    if (rejectOptions("traceroute", parsed, context)) return 2;
    const name = parsed.operands[0];
    if (name === undefined) {
      context.falhar("Uso: traceroute [-n] [-m SALTOS] DESTINO");
      return 2;
    }
    const maxText = parsed.values.get("m");
    const max = maxText === undefined ? 30 : Number(maxText);
    if (!Number.isInteger(max) || max < 1 || max > 255) {
      context.falhar(`traceroute: valor de saltos inválido '${maxText}'`);
      return 2;
    }
    const target = resolve(name, context);
    if (target === null) {
      context.falhar(`${name}: Nome ou serviço desconhecido`);
      context.falhar(`Cannot handle "host" cmdline arg \`${name}' on position 1 (argc 1)`);
      return 2;
    }
    const { gateway } = addresses(context);
    const hops: { name: string; ip: string; base: number }[] =
      target.local || target.ip === gateway
        ? [{ name: target.name, ip: target.ip, base: baseMs(target.ip, true) }]
        : [
            { name: "_gateway", ip: gateway, base: baseMs(gateway, true) },
            { name: "10.20.30.1", ip: "10.20.30.1", base: 4.2 },
            { name: "200.100.50.1", ip: "200.100.50.1", base: 6.8 },
            { name: target.name, ip: target.ip, base: baseMs(target.ip, false) },
          ];
    context.linha(`traceroute to ${name} (${target.ip}), ${max} hops max, 60 byte packets`);
    hops.slice(0, max).forEach((hop, index) => {
      const times = [0, 0.1, 0.2].map((extra) => `${(hop.base + extra).toFixed(3)} ms`).join("  ");
      const who = parsed.flags.has("n") ? hop.ip : `${hop.name} (${hop.ip})`;
      context.linha(`${String(index + 1).padStart(2)}  ${who}  ${times}`);
    });
    return 0;
  },
);

// ───────────── netstat ─────────────

interface Socket {
  proto: string;
  local: string;
  foreign: string;
  state: string;
  program: string;
}

/** One line of the table of sockets, in the columns of the classic netstat. */
const socketLine = (cells: string[], withProgram: boolean): string => {
  const [proto, recv, send, local, foreign, state, program] = cells as [string, string, string, string, string, string, string];
  const line = `${proto.padEnd(5)} ${recv.padStart(6)} ${send.padStart(6)} ${local.padEnd(23)} ${foreign.padEnd(23)} ${state.padEnd(11)}`;
  return (withProgram ? `${line} ${program}` : line).trimEnd();
};

const netstat = defineCommand(
  "netstat",
  "mostra as conexões e portas de rede: netstat -tuln",
  {
    uso: "netstat [-t] [-u] [-l] [-a] [-n] [-p] [-r]",
    descricao: "Mostra as portas à espera de conexão (os serviços ativos da máquina) e a tabela de rotas. Comando clássico que o ss substituiu. No simulador não há conexões estabelecidas.",
    h: "ajuda",
    opcoes: [
      ["-t", "só TCP"],
      ["-u", "só UDP"],
      ["-l", "só os que estão à espera de conexão"],
      ["-a", "todos"],
      ["-n", "mostra números em vez de nomes de serviço"],
      ["-p", "mostra o processo dono do socket"],
      ["-r", "mostra a tabela de rotas"],
    ],
    exemplos: [
      ["netstat -tuln", "portas TCP e UDP abertas"],
      ["netstat -r", "tabela de rotas"],
    ],
  },
  async (args, context) => {
    const parsed = parseOptions(args, { known: "tulanprh" });
    if (rejectOptions("netstat", parsed, context)) return 1;
    if (parsed.flags.has("r")) {
      const { gateway } = addresses(context);
      const network = `${gateway.split(".").slice(0, 3).join(".")}.0`;
      const cells = (a: string, b: string, c: string, d: string) => `${a.padEnd(15)} ${b.padEnd(15)} ${c.padEnd(15)} ${d.padEnd(7)} ${"0".padStart(3)} ${"0".padEnd(6)} ${"0".padStart(5)} eth0`;
      context.linha("Kernel IP routing table");
      context.linha(`${"Destination".padEnd(15)} ${"Gateway".padEnd(15)} ${"Genmask".padEnd(15)} ${"Flags".padEnd(7)} ${"MSS".padStart(3)} ${"Window".padEnd(6)} ${"irtt".padStart(5)} Iface`);
      context.linha(cells("0.0.0.0", gateway, "0.0.0.0", "UG"));
      context.linha(cells(network, "0.0.0.0", "255.255.255.0", "U"));
      return 0;
    }
    const onlyServers = parsed.flags.has("l") && !parsed.flags.has("a");
    const listing = parsed.flags.has("l") || parsed.flags.has("a");
    const wantsTcp = parsed.flags.has("t") || !parsed.flags.has("u");
    const wantsUdp = parsed.flags.has("u") || !parsed.flags.has("t");
    const withProgram = parsed.flags.has("p");
    const processes = withProgram ? await listProcesses(context) : [];
    const port = (value: number): string => (parsed.flags.has("n") ? String(value) : (PORT_NAMES[value] ?? String(value)));
    const owner = (program: string): string => `${processes.find((process) => process.comando.includes(program))?.pid ?? 1}/${program}`;
    const sockets: Socket[] = [];
    if (listing) {
      if (wantsUdp) sockets.push({ proto: "udp", local: `127.0.0.53:${port(53)}`, foreign: "0.0.0.0:*", state: "", program: owner("systemd-resolve") });
      if (wantsTcp) sockets.push({ proto: "tcp", local: `127.0.0.53:${port(53)}`, foreign: "0.0.0.0:*", state: "LISTEN", program: owner("systemd-resolve") });
      if (wantsTcp) {
        for (const service of SERVICES) {
          if ((await statusOf(`systemctl is-active ${service.unit}`, context)) !== 0) continue;
          sockets.push({ proto: "tcp", local: `${service.bind}:${port(service.port)}`, foreign: "0.0.0.0:*", state: "LISTEN", program: owner(service.program) });
          if (service.v6) sockets.push({ proto: "tcp6", local: `:::${port(service.port)}`, foreign: ":::*", state: "LISTEN", program: owner(service.program) });
        }
      }
    }
    context.linha(`Active Internet connections (${onlyServers ? "only servers" : listing ? "servers and established" : "w/o servers"})`);
    context.linha(socketLine(["Proto", "Recv-Q", "Send-Q", "Local Address", "Foreign Address", "State", "PID/Program name"], withProgram));
    for (const socket of sockets) context.linha(socketLine([socket.proto, "0", "0", socket.local, socket.foreign, socket.state, socket.program], withProgram));
    return 0;
  },
);

// ───────────── dig ─────────────

const RECORD_TYPES = ["A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA", "PTR", "ANY"];
const DIG_USAGE = "Usage:  dig [@global-server] [q-opt] {q-opt} {d-opt} [domain] [q-type] [q-class]";

const dig = defineCommand(
  "dig",
  "consulta o servidor de nomes (DNS): dig google.com",
  {
    uso: "dig [@SERVIDOR] NOME [TIPO] [+short]",
    descricao: "Pergunta ao servidor de nomes qual é o endereço de um nome e mostra a resposta completa. O simulador responde só o tipo A, pelos nomes conhecidos.",
    h: "ajuda",
    opcoes: [
      ["@SERVIDOR", "pergunta a esse servidor, em vez do padrão"],
      ["TIPO", "tipo do registro (A é o único com resposta)"],
      ["+short", "mostra só o endereço"],
    ],
    exemplos: [
      ["dig google.com", "resposta completa"],
      ["dig +short google.com", "só o endereço"],
      ["dig @8.8.8.8 ubuntu.com", "pergunta ao servidor 8.8.8.8"],
    ],
  },
  (args, context) => {
    let server = "127.0.0.53";
    let short = false;
    const operands: string[] = [];
    for (const arg of args) {
      if (arg.startsWith("@")) server = arg.slice(1);
      else if (arg === "+short") short = true;
      else if (arg.startsWith("+")) continue;
      else if (arg.startsWith("-")) {
        context.falhar(`Invalid option: ${arg}`);
        context.falhar(DIG_USAGE);
        return 1;
      } else operands.push(arg);
    }
    const name = operands[0];
    if (name === undefined) {
      context.falhar(DIG_USAGE);
      return 1;
    }
    let type = (operands[1] ?? "A").toUpperCase();
    if (!RECORD_TYPES.includes(type)) {
      context.falhar(`;; Warning, ignoring invalid type ${operands[1]}`);
      type = "A";
    }
    const target = resolve(name, context);
    const answer = type === "A" || type === "ANY" ? target?.ip : undefined;
    if (short) {
      if (answer) context.linha(answer);
      return 0;
    }
    const seed = seedOf(name);
    const status = target === null ? "NXDOMAIN" : "NOERROR";
    const fqdn = `${name}.`;
    context.linha();
    context.linha(`; <<>> DiG 9.18.28-0ubuntu0.24.04.1-Ubuntu <<>> ${args.join(" ")}`);
    context.linha(";; global options: +cmd");
    context.linha(";; Got answer:");
    context.linha(`;; ->>HEADER<<- opcode: QUERY, status: ${status}, id: ${10000 + ((seed * 37) % 50000)}`);
    context.linha(`;; flags: qr rd ra; QUERY: 1, ANSWER: ${answer ? 1 : 0}, AUTHORITY: 0, ADDITIONAL: 1`);
    context.linha();
    context.linha(";; OPT PSEUDOSECTION:");
    context.linha("; EDNS: version: 0, flags:; udp: 65494");
    context.linha(";; QUESTION SECTION:");
    context.linha(`;${fqdn}\t\t\tIN\t${type}`);
    if (answer) {
      context.linha();
      context.linha(";; ANSWER SECTION:");
      context.linha(`${fqdn}\t\t300\tIN\tA\t${answer}`);
    }
    context.linha();
    context.linha(`;; Query time: ${(seed % 30) + 1} msec`);
    context.linha(`;; SERVER: ${server}#53(${server}) (UDP)`);
    context.linha(`;; WHEN: ${new Date().toString().replace(/ GMT.*$/, "")}`);
    context.linha(`;; MSG SIZE  rcvd: ${name.length + 44}`);
    context.linha();
    return 0;
  },
);

// ───────────── scp ─────────────

const REMOTE = /^(?:([^@/:]+)@)?([^/:@]+):(.*)$/;
const quote = (text: string): string => `'${text.replace(/'/g, "'\\''")}'`;
const SCP_USAGE = "usage: scp [-qr] [-P port] source ... target";

const scp = defineCommand(
  "scp",
  "copia arquivos para outra máquina: scp arquivo localhost:/tmp/",
  {
    uso: "scp [-qr] [-P PORTA] ORIGEM... DESTINO",
    descricao: "Copia arquivos entre máquinas pelo SSH. O simulador só alcança a própria máquina (localhost e o nome dela), com o serviço ssh ativo, e não pede senha.",
    opcoes: [
      ["-r", "copia pastas, com o que há dentro"],
      ["-q", "não mostra o andamento"],
      ["-P PORTA", "porta do SSH (padrão 22)"],
    ],
    exemplos: [
      ["scp relatorio.txt localhost:/tmp/", "copia um arquivo para /tmp"],
      ["scp -r projeto localhost:/tmp/", "copia uma pasta"],
      ["scp localhost:/etc/hostname .", "traz um arquivo para a pasta atual"],
    ],
  },
  async (args, context) => {
    const parsed = parseOptions(args, { known: "rqPiCvh", withValue: "Pi" });
    if (rejectOptions("scp", parsed, context)) return 1;
    if (parsed.operands.length < 2) {
      context.falhar(SCP_USAGE);
      return 1;
    }
    const port = parsed.values.get("P") ?? "22";
    const operands = parsed.operands;
    const remoteMatch = (text: string) => (text.startsWith("/") || text.startsWith(".") ? null : REMOTE.exec(text));
    const remotes = operands.map(remoteMatch);
    const hostOf = remotes.find((match) => match !== null)?.[2];
    if (hostOf !== undefined) {
      const target = resolve(hostOf, context);
      if (target === null) {
        context.falhar(`ssh: Could not resolve hostname ${hostOf}: Nome ou serviço desconhecido`);
        return 255;
      }
      if (!isThisMachine(hostOf, context)) {
        context.falhar(`ssh: connect to host ${hostOf} port ${port}: Connection timed out`);
        context.falhar("scp: Connection closed");
        return 255;
      }
      if ((await statusOf("systemctl is-active ssh", context)) !== 0) {
        context.falhar(`ssh: connect to host ${hostOf} port ${port}: Connection refused`);
        context.falhar("scp: Connection closed");
        return 255;
      }
    }
    const home = (await outputOf("echo ~", context)).text.trim() || "/root";
    // The remote side is the same machine: its relative paths start at the home folder, the local ones at the current folder.
    const pathOf = (text: string, match: RegExpExecArray | null): string => {
      if (match === null) return text;
      const path = match[3]!;
      return path === "" ? home : path.startsWith("/") ? path : `${home}/${path}`;
    };
    const paths = operands.map((text, index) => pathOf(text, remotes[index]!));
    const destination = paths[paths.length - 1]!;
    let status = 0;
    for (let i = 0; i < paths.length - 1; i++) {
      const source = paths[i]!;
      const shown = operands[i]!;
      if ((await statusOf(`test -e ${quote(source)}`, context)) !== 0) {
        context.falhar(`scp: ${source}: No such file or directory`);
        status = 1;
        continue;
      }
      const isDirectory = (await statusOf(`test -d ${quote(source)}`, context)) === 0;
      if (isDirectory && !parsed.flags.has("r")) {
        context.falhar(`scp: ${source}: not a regular file`);
        status = 1;
        continue;
      }
      if ((await statusOf(`cp ${isDirectory ? "-r " : ""}${quote(source)} ${quote(destination)}`, context)) !== 0) {
        context.falhar(`scp: ${destination}: No such file or directory`);
        status = 1;
        continue;
      }
      // ponytail: one progress line per source (a folder counts as one), real scp prints one per file inside it.
      if (!parsed.flags.has("q") && !isDirectory) {
        const size = Number((await outputOf(`wc -c < ${quote(source)}`, context)).text.trim()) || 0;
        const base = shown.replace(/^.*[/:]/, "") || shown;
        context.linha(`${base.padEnd(45)}${"100%".padStart(4)} ${String(size).padStart(5)}   ${((size / 1024) * 1000).toFixed(1).padStart(6)}KB/s   00:00`);
      }
    }
    return status;
  },
);

export const networkToolCommands: EngineCommand[] = [traceroute, netstat, dig, scp];
