import { absolutePath, defineCommand, linesOf, listProcesses, parseOptions, rejectOptions, statusOf, writeFile } from "./helpers";
import { msg } from "./messages";
import { textOf } from "./system";
import type { EngineCommand, EngineContext } from "./types";

const MAC = "52:54:00:12:34:56";

/** The address of the machine, the same one `hostname -I` shows, and the gateway of its network. */
function addresses(context: EngineContext): { ip: string; gateway: string; broadcast: string; hostname: string } {
  const ip = (context.maquina.constructor as unknown as { IP?: string }).IP ?? "192.168.0.10";
  const prefix = ip.split(".").slice(0, 3).join(".");
  return { ip, gateway: `${prefix}.1`, broadcast: `${prefix}.255`, hostname: context.maquina.hostname };
}

/** The names of the internet the simulator answers for, with a fixed address and round trip time (RN-07). */
const INTERNET: Record<string, string> = {
  "8.8.8.8": "8.8.8.8",
  "1.1.1.1": "1.1.1.1",
  "google.com": "142.250.80.46",
  "ubuntu.com": "185.125.190.20",
};

interface Target {
  /** The name or address as typed. */
  name: string;
  ip: string;
  /** True for the machine itself and its network. */
  local: boolean;
}

/** Who answers to a name: the machine, its gateway, the names of /etc/hosts and the fixed list of the internet. */
function resolve(name: string, context: EngineContext): Target | null {
  const { ip, gateway, hostname } = addresses(context);
  if (name === "localhost" || name === "127.0.0.1") return { name, ip: "127.0.0.1", local: true };
  if (name === hostname || name === ip) return { name, ip, local: true };
  if (name === gateway) return { name, ip: gateway, local: true };
  for (const line of linesOf(textOf(context, "/etc/hosts"))) {
    const [address, ...names] = line.replace(/#.*/, "").trim().split(/\s+/);
    if (address && names.includes(name)) return { name, ip: address, local: true };
  }
  const known = INTERNET[name];
  if (known) return { name, ip: known, local: false };
  return null;
}

interface Iface {
  name: string;
  state: string;
  flags: string;
  mtu: number;
  mac: string;
  brd: string | null;
  inet: string;
}

function interfaces(context: EngineContext): Iface[] {
  const { ip, broadcast } = addresses(context);
  return [
    { name: "lo", state: "UNKNOWN", flags: "LOOPBACK,UP,LOWER_UP", mtu: 65536, mac: "00:00:00:00:00:00", brd: null, inet: "127.0.0.1/8" },
    { name: "eth0", state: "UP", flags: "BROADCAST,MULTICAST,UP,LOWER_UP", mtu: 1500, mac: MAC, brd: broadcast, inet: `${ip}/24` },
  ];
}

const ipCommand = defineCommand(
  "ip",
  "mostra e configura a rede: ip a | ip route",
  {
    uso: "ip [-br] OBJETO [show] [INTERFACE]",
    descricao: "Mostra as interfaces de rede (a, addr, address), as rotas (route) e as ligações (link). No simulador só consulta, não altera nada.",
    opcoes: [
      ["-br", "resumo de uma linha por interface"],
      ["a, addr, address", "endereços das interfaces"],
      ["r, route", "tabela de rotas"],
      ["l, link", "estado das ligações"],
    ],
    exemplos: [
      ["ip a", "endereços de todas as interfaces"],
      ["ip -br a", "resumo dos endereços"],
    ],
  },
  (args, context) => {
    const rest = [...args];
    let brief = false;
    while (rest[0]?.startsWith("-")) {
      const flag = rest.shift()!;
      if (flag === "-br" || flag === "-brief" || flag === "--brief") brief = true;
      else if (!["-4", "-6", "-s", "-o", "-c", "-color"].includes(flag)) {
        context.falhar(msg.ipUnknownOption(flag));
        return 1;
      }
    }
    const object = rest.shift();
    if (object === undefined) {
      context.falhar(msg.ipUsage);
      return 255;
    }
    if (rest[0] === "show" || rest[0] === "list" || rest[0] === "ls") rest.shift();
    const { ip, gateway } = addresses(context);
    if (["a", "addr", "address"].includes(object) || ["l", "link"].includes(object)) {
      const wantsLink = object === "l" || object === "link";
      let list = interfaces(context);
      const only = rest[0] === "dev" ? rest[1] : rest[0];
      if (only !== undefined) {
        list = list.filter((iface) => iface.name === only);
        if (list.length === 0) {
          context.falhar(msg.ipNoDevice(only));
          return 1;
        }
      }
      list.forEach((iface) => {
        if (brief) {
          context.linha(`${iface.name.padEnd(16)} ${iface.state.padEnd(14)} ${wantsLink ? `${iface.mac} <${iface.flags}>` : iface.inet}`);
          return;
        }
        const index = iface.name === "lo" ? 1 : 2;
        const qdisc = iface.name === "lo" ? "noqueue" : "fq_codel";
        context.linha(`${index}: ${iface.name}: <${iface.flags}> mtu ${iface.mtu} qdisc ${qdisc} state ${iface.state} group default qlen 1000`);
        context.linha(`    link/${iface.name === "lo" ? "loopback" : "ether"} ${iface.mac} brd ${iface.brd ? "ff:ff:ff:ff:ff:ff" : "00:00:00:00:00:00"}`);
        if (!wantsLink) {
          context.linha(`    inet ${iface.inet}${iface.brd ? ` brd ${iface.brd}` : ""} scope ${iface.name === "lo" ? "host" : "global"} ${iface.name}`);
          context.linha("       valid_lft forever preferred_lft forever");
        }
      });
      return 0;
    }
    if (object === "r" || object === "route") {
      context.linha(`default via ${gateway} dev eth0 proto dhcp src ${ip} metric 100`);
      context.linha(`${gateway.split(".").slice(0, 3).join(".")}.0/24 dev eth0 proto kernel scope link src ${ip} metric 100`);
      return 0;
    }
    context.falhar(msg.ipUnknownObject(object));
    return 1;
  },
);

/** Services whose sockets `ss` lists when the service is active on the machine. */
const SERVICES: { unit: string; program: string; port: number; udp?: boolean; bind: string; v6: boolean }[] = [
  { unit: "ssh", program: "sshd", port: 22, bind: "0.0.0.0", v6: true },
  { unit: "nginx", program: "nginx", port: 80, bind: "0.0.0.0", v6: true },
  { unit: "mysql", program: "mysqld", port: 3306, bind: "127.0.0.1", v6: false },
];
const PORT_NAMES: Record<number, string> = { 22: "ssh", 53: "domain", 80: "http", 3306: "mysql" };

const ss = defineCommand(
  "ss",
  "mostra as portas e conexões de rede: ss -tuln",
  {
    uso: "ss [-t] [-u] [-l] [-a] [-n] [-p]",
    descricao: "Lista os sockets de rede. Com -l mostra as portas à espera de conexão, que vêm dos serviços ativos na máquina.",
    h: "ajuda",
    opcoes: [
      ["-t", "só TCP"],
      ["-u", "só UDP"],
      ["-l", "só os que estão à espera de conexão"],
      ["-a", "todos"],
      ["-n", "mostra números em vez de nomes de serviço"],
      ["-p", "mostra o processo dono do socket"],
    ],
    exemplos: [["ss -tuln", "portas TCP e UDP abertas"]],
  },
  async (args, context) => {
    const parsed = parseOptions(args, { known: "tulanphH" });
    if (rejectOptions("ss", parsed, context)) return 1;
    const wantsTcp = parsed.flags.has("t") || !parsed.flags.has("u");
    const wantsUdp = parsed.flags.has("u") || !parsed.flags.has("t");
    const listening = parsed.flags.has("l") || parsed.flags.has("a");
    const rows: string[][] = [];
    const processes = parsed.flags.has("p") ? await listProcesses(context) : [];
    const owner = (program: string): string => {
      if (!parsed.flags.has("p")) return "";
      const found = processes.find((process) => process.comando.includes(program));
      return `users:(("${program}",pid=${found?.pid ?? 1},fd=3))`;
    };
    const port = (value: number): string => (parsed.flags.has("n") ? String(value) : (PORT_NAMES[value] ?? String(value)));
    if (listening) {
      if (wantsUdp) rows.push(["udp", "UNCONN", "0", "0", `127.0.0.53%lo:${port(53)}`, "0.0.0.0:*", owner("systemd-resolve")]);
      if (wantsTcp) rows.push(["tcp", "LISTEN", "0", "4096", `127.0.0.53%lo:${port(53)}`, "0.0.0.0:*", owner("systemd-resolve")]);
      if (wantsTcp) {
        for (const service of SERVICES) {
          if ((await statusOf(`systemctl is-active ${service.unit}`, context)) !== 0) continue;
          rows.push(["tcp", "LISTEN", "0", "511", `${service.bind}:${port(service.port)}`, "0.0.0.0:*", owner(service.program)]);
          if (service.v6) rows.push(["tcp", "LISTEN", "0", "511", `[::]:${port(service.port)}`, "[::]:*", owner(service.program)]);
        }
      }
    }
    const showNetid = wantsTcp && wantsUdp;
    const header = [...(showNetid ? ["Netid"] : []), "State", "Recv-Q", "Send-Q", "Local Address:Port", "Peer Address:Port", ...(parsed.flags.has("p") ? ["Process"] : [])];
    const table = rows.map((row) => [...(showNetid ? [row[0]!] : []), ...row.slice(1, 6), ...(parsed.flags.has("p") ? [row[6]!] : [])]);
    const widths = header.map((title, i) => Math.max(title.length, ...table.map((row) => row[i]!.length)));
    const format = (cells: string[]) => cells.map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i]!))).join(" ").trimEnd();
    if (!parsed.flags.has("H")) context.linha(format(header));
    for (const row of table) context.linha(format(row));
    return 0;
  },
);

const ifconfig = defineCommand(
  "ifconfig",
  "mostra a configuração das interfaces de rede: ifconfig",
  {
    uso: "ifconfig [INTERFACE]",
    descricao: "Mostra as interfaces de rede e os números de cada uma (comando clássico, que o ip substituiu). Só consulta.",
    exemplos: [["ifconfig eth0", "só a interface eth0"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "a" });
    if (rejectOptions("ifconfig", parsed, context)) return 1;
    const { ip, broadcast } = addresses(context);
    const blocks: Record<string, string[]> = {
      eth0: [
        "eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500",
        `        inet ${ip}  netmask 255.255.255.0  broadcast ${broadcast}`,
        "        inet6 fe80::5054:ff:fe12:3456  prefixlen 64  scopeid 0x20<link>",
        `        ether ${MAC}  txqueuelen 1000  (Ethernet)`,
        "        RX packets 18342  bytes 24580312 (24.5 MB)",
        "        RX errors 0  dropped 0  overruns 0  frame 0",
        "        TX packets 9120  bytes 1204816 (1.2 MB)",
        "        TX errors 0  dropped 0 overruns 0  carrier 0  collisions 0",
      ],
      lo: [
        "lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536",
        "        inet 127.0.0.1  netmask 255.0.0.0",
        "        inet6 ::1  prefixlen 128  scopeid 0x10<host>",
        "        loop  txqueuelen 1000  (Loopback Local)",
        "        RX packets 2210  bytes 188420 (188.4 KB)",
        "        RX errors 0  dropped 0  overruns 0  frame 0",
        "        TX packets 2210  bytes 188420 (188.4 KB)",
        "        TX errors 0  dropped 0 overruns 0  carrier 0  collisions 0",
      ],
    };
    const wanted = parsed.operands[0];
    if (wanted !== undefined && !blocks[wanted]) {
      context.falhar(msg.ifconfigNoDevice(wanted));
      return 1;
    }
    const names = wanted !== undefined ? [wanted] : ["eth0", "lo"];
    names.forEach((name, index) => {
      if (index > 0) context.linha();
      for (const line of blocks[name]!) context.linha(line);
    });
    return 0;
  },
);

const NAMES: Record<string, string> = { "google.com": "142.250.80.46", "ubuntu.com": "185.125.190.20", localhost: "127.0.0.1" };

const nslookup = defineCommand(
  "nslookup",
  "consulta o endereço de um nome: nslookup google.com",
  {
    uso: "nslookup NOME",
    descricao: "Pergunta ao servidor de nomes (DNS) qual é o endereço de um nome. O simulador responde só pelos nomes conhecidos.",
    exemplos: [["nslookup google.com", "mostra o endereço do google.com"]],
  },
  (args, context) => {
    const parsed = parseOptions(args, { known: "" });
    if (rejectOptions("nslookup", parsed, context)) return 1;
    const name = parsed.operands[0];
    if (name === undefined) {
      context.linha("Server:\t\t127.0.0.53");
      context.linha("Address:\t127.0.0.53#53");
      return 0;
    }
    const target = NAMES[name] ?? (resolve(name, context)?.ip ?? null);
    context.linha("Server:\t\t127.0.0.53");
    context.linha("Address:\t127.0.0.53#53");
    context.linha();
    if (target === null) {
      context.linha(`** server can't find ${name}: NXDOMAIN`);
      return 1;
    }
    if (name !== "localhost" && !resolve(name, context)?.local) context.linha("Non-authoritative answer:");
    context.linha(`Name:\t${name}`);
    context.linha(`Address: ${target}`);
    return 0;
  },
);

const wget = defineCommand(
  "wget",
  "baixa um arquivo de um endereço web: wget http://localhost",
  {
    uso: "wget [-q] [-O ARQUIVO] URL",
    descricao: "Baixa o conteúdo de um endereço web e guarda num arquivo. O simulador não usa a rede real: só alcança a própria máquina e os nomes conhecidos.",
    h: "ajuda",
    opcoes: [
      ["-V, --version", "mostra a versão"],
      ["-q", "não escreve o andamento"],
      ["-O ARQUIVO", "grava com esse nome (- escreve na tela)"],
    ],
    exemplos: [["wget -O pagina.html http://localhost", "baixa a página local"]],
  },
  async (args, context) => {
    const parsed = parseOptions(args, { known: "VqOh", withValue: "O", long: { version: "V", quiet: "q" } });
    if (rejectOptions("wget", parsed, context)) return 2;
    if (parsed.flags.has("V")) {
      context.linha("GNU Wget 1.21.4 construído em linux-gnu.");
      context.linha();
      context.linha("-cares +digest -gpgme +https +ipv6 +iri +large-file -metalink +nls +ntlm +opie +psl +ssl/gnutls");
      return 0;
    }
    const url = parsed.operands[0];
    if (url === undefined) {
      context.falhar(msg.wgetMissingUrl);
      return 1;
    }
    const match = /^(?:https?:\/\/)?([^/:]+)(?::(\d+))?(\/[^?#]*)?/.exec(url);
    const host = match?.[1] ?? url;
    const path = match?.[3] ?? "/";
    const quiet = parsed.flags.has("q");
    const target = resolve(host, context);
    const say = (text: string) => {
      if (!quiet) context.falhar(text);
    };
    if (!target) {
      context.falhar(msg.wgetNoResolve(host));
      return 4;
    }
    const isLocal = target.local;
    if (isLocal && (await statusOf("systemctl is-active nginx", context)) !== 0 && host !== addresses(context).gateway) {
      say(`Resolvendo ${host} (${host})... ${target.ip}`);
      context.falhar(msg.wgetRefused(host, target.ip));
      return 4;
    }
    const body = isLocal
      ? "<html><head><title>Welcome to nginx!</title></head><body><h1>Welcome to nginx!</h1></body></html>\n"
      : `<html><head><title>${host}</title></head></html>\n`;
    const name = parsed.values.get("O") ?? (path.endsWith("/") ? "index.html" : (path.split("/").pop() as string));
    if (name === "-") {
      context.escrever(body);
      return 0;
    }
    const failure = writeFile(context, name, body);
    if (failure !== null) {
      context.falhar(`${name}: ${failure}`);
      return 3;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
    say(`--${stamp}--  ${url}`);
    say(`Resolvendo ${host} (${host})... ${target.ip}`);
    say(`Conectando-se a ${host} (${host})|${target.ip}|:80... conectado.`);
    say("A requisição HTTP foi enviada, aguardando resposta... 200 OK");
    say(`Tamanho: ${body.length} [text/html]`);
    say(`Salvando em: “${name}”`);
    say("");
    say(`${name.padEnd(19)} 100%[===================>] ${String(body.length).padStart(7)}  --.-KB/s    em 0s`);
    say("");
    say(`${stamp} (65,2 MB/s) - “${name}” salvo [${body.length}/${body.length}]`);
    return 0;
  },
);

const ssh = defineCommand(
  "ssh",
  "conecta a outra máquina: ssh usuario@servidor",
  {
    uso: "ssh [-V] [USUÁRIO@]DESTINO",
    descricao: "Cliente de acesso remoto seguro. No simulador as conexões SSH são abertas pelas abas do terminal; aqui só mostra a versão.",
    opcoes: [["-V", "mostra a versão do cliente"]],
    exemplos: [["ssh -V", "mostra a versão"]],
  },
  (args, context) => {
    if (args.includes("-V")) {
      context.falhar("OpenSSH_9.6p1 Ubuntu-3ubuntu13, OpenSSL 3.0.13 30 Jan 2024");
      return 0;
    }
    if (args.length === 0) {
      context.falhar("usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] [-B bind_interface] [-b bind_address]");
      context.falhar("           [-c cipher_spec] [-D [bind_address:]port] [-E log_file] [-F configfile]");
      context.falhar("           destination [command [argument ...]]");
      return 255;
    }
    context.falhar(msg.sshSimulator);
    return 255;
  },
);

const UFW_CONF = "/etc/ufw/ufw.conf";
const UFW_RULES = "/etc/ufw/user.rules";
const UFW_SERVICES: Record<string, string> = { ssh: "22/tcp", http: "80/tcp", https: "443/tcp" };

interface UfwState {
  enabled: boolean;
  incoming: string;
  outgoing: string;
  rules: { action: string; spec: string }[];
}

function readUfw(context: EngineContext): UfwState {
  const state: UfwState = { enabled: /^ENABLED=yes/m.test(textOf(context, UFW_CONF)), incoming: "deny", outgoing: "allow", rules: [] };
  for (const line of linesOf(textOf(context, UFW_RULES))) {
    const [kind, a, b] = line.trim().split(/\s+/);
    if (kind === "default" && a === "incoming" && b) state.incoming = b;
    else if (kind === "default" && a === "outgoing" && b) state.outgoing = b;
    else if ((kind === "allow" || kind === "deny") && a) state.rules.push({ action: kind, spec: a });
  }
  return state;
}

function writeUfw(context: EngineContext, state: UfwState): string | null {
  if (!context.tentarLocalizar("/etc/ufw")) context.maquina.criarDiretorio("/etc/ufw", 0, 0, 0o755);
  const conf = writeFile(context, absolutePath(UFW_CONF, "/"), `ENABLED=${state.enabled ? "yes" : "no"}\n`, 0o644);
  const rules = [`default incoming ${state.incoming}`, `default outgoing ${state.outgoing}`, ...state.rules.map((rule) => `${rule.action} ${rule.spec}`)].join("\n");
  return conf ?? writeFile(context, UFW_RULES, `${rules}\n`, 0o640);
}

const normalizeSpec = (text: string): string | null => {
  const named = UFW_SERVICES[text];
  if (named) return named;
  return /^\d{1,5}(\/(tcp|udp))?$/.test(text) ? text : null;
};

function ufwStatus(state: UfwState, mode: string | undefined, context: EngineContext): void {
  if (!state.enabled) {
    context.linha(msg.ufwInactive);
    return;
  }
  context.linha(msg.ufwActive);
  if (mode === "verbose") {
    context.linha(`Registro: ativado (baixo)`);
    context.linha(`Padrão: ${state.incoming} (entrada), ${state.outgoing} (saída), disabled (roteado)`);
    context.linha("Novos perfis: skip");
  }
  context.linha();
  const numbered = mode === "numbered";
  context.linha(`${numbered ? "     " : ""}${"Para".padEnd(27)}${"Ação".padEnd(12)}De`);
  context.linha(`${numbered ? "     " : ""}${"----".padEnd(27)}${"----".padEnd(12)}--`);
  state.rules.forEach((rule, index) => {
    const prefix = numbered ? `[${String(index + 1).padStart(2)}] ` : "";
    const action = `${rule.action.toUpperCase()}${numbered || mode === "verbose" ? " IN" : ""}`;
    context.linha(`${prefix}${rule.spec.padEnd(27)}${action.padEnd(12)}Anywhere`);
  });
}

const ufw = defineCommand(
  "ufw",
  "firewall simples: ufw enable | ufw allow 22",
  {
    uso: "ufw COMANDO [ARGUMENTOS]",
    descricao: "Controla o firewall. É preciso ser root (use sudo). As regras ficam guardadas em /etc/ufw.",
    h: "ajuda",
    opcoes: [
      ["enable, disable", "liga e desliga o firewall"],
      ["status [verbose|numbered]", "mostra o estado e as regras"],
      ["allow PORTA[/protocolo]", "permite a entrada na porta"],
      ["deny PORTA[/protocolo]", "bloqueia a entrada na porta"],
      ["delete allow|deny PORTA", "apaga a regra"],
      ["default allow|deny [incoming|outgoing]", "muda a política padrão"],
    ],
    exemplos: [
      ["sudo ufw allow 22/tcp", "libera o SSH"],
      ["sudo ufw status numbered", "lista as regras com número"],
    ],
  },
  (args, context) => {
    if (args.length === 0) {
      context.falhar(msg.ufwUsage);
      return 1;
    }
    const [subcommand, ...rest] = args;
    if (!context.ehRoot()) {
      context.falhar(msg.ufwNeedsRoot);
      return 1;
    }
    const state = readUfw(context);
    const save = (): number => {
      const failure = writeUfw(context, state);
      if (failure !== null) {
        context.falhar(`ufw: ${failure}`);
        return 1;
      }
      return 0;
    };
    switch (subcommand) {
      case "status":
        ufwStatus(state, rest[0], context);
        return 0;
      case "enable":
        state.enabled = true;
        context.linha(msg.ufwEnabled);
        return save();
      case "disable":
        state.enabled = false;
        context.linha(msg.ufwDisabled);
        return save();
      case "allow":
      case "deny": {
        const spec = normalizeSpec(rest[0] ?? "");
        if (spec === null) {
          context.falhar(msg.ufwBadRule(rest.join(" ")));
          return 1;
        }
        if (state.rules.some((rule) => rule.action === subcommand && rule.spec === spec)) {
          context.linha(msg.ufwRuleExists);
          return 0;
        }
        state.rules.push({ action: subcommand, spec });
        context.linha(msg.ufwRuleAdded);
        return save();
      }
      case "delete": {
        const [action, target] = rest;
        const spec = normalizeSpec(target ?? "");
        const index = state.rules.findIndex((rule) => rule.action === action && rule.spec === spec);
        if (index === -1) {
          context.linha(msg.ufwRuleMissing);
          return 0;
        }
        state.rules.splice(index, 1);
        context.linha(msg.ufwRuleDeleted);
        return save();
      }
      case "default": {
        const [policy, direction = "incoming"] = rest;
        if (!policy || !["allow", "deny"].includes(policy) || !["incoming", "outgoing"].includes(direction)) {
          context.falhar(msg.ufwBadDefault);
          return 1;
        }
        if (direction === "incoming") state.incoming = policy;
        else state.outgoing = policy;
        context.linha(msg.ufwDefaultChanged(direction, policy));
        return save();
      }
      default:
        context.falhar(msg.ufwUsage);
        return 1;
    }
  },
);

export const networkCommands: EngineCommand[] = [ipCommand, ss, ifconfig, nslookup, wget, ssh, ufw];
