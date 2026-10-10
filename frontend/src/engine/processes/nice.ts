import { messages } from "./messages";
import { clampNice, niceOf, niceOfPid, setNice, setNiceOfPid } from "./priority";
import type { EngineCommand, EngineContext } from "./types";

const isInteger = (text: string) => /^[+-]?\d+$/.test(text);

/** nice: starts a command with a different niceness; alone, shows the niceness it has (SPEC-029 RN-05). */
export const niceCommand: EngineCommand = {
  nome: "nice",
  resumo: "inicia um comando com outra prioridade (nice -n 10 COMANDO); sem comando, mostra a prioridade atual",
  ajuda: {
    uso: "nice [OPÇÃO] [COMANDO [ARGUMENTO]...]",
    descricao: "Executa o comando com a prioridade ajustada. Quanto maior o número (de -20 a 19), menos o processo disputa a CPU. Sem comando, mostra a prioridade atual.",
    opcoes: [["-n NÚMERO, --adjustment=NÚMERO", "soma NÚMERO à prioridade atual (padrão 10); só o root usa valores negativos"]],
    exemplos: [
      ["nice -n 10 sleep 60 &", "inicia o sleep com prioridade baixa, em segundo plano"],
      ["sudo nice -n -5 sleep 60 &", "o root dá prioridade mais alta"],
      ["nice", "mostra a prioridade atual do terminal"],
    ],
    soPrimeiro: true,
  },
  async executar(args: string[], context: EngineContext): Promise<number> {
    let adjustment = 10;
    let rest = args;
    const first = args[0] ?? "";
    if (first === "-n" || first === "--adjustment") {
      const value = args[1];
      if (value === undefined) {
        context.falhar(messages.nice.missingValue);
        return 125;
      }
      if (!isInteger(value)) {
        context.falhar(messages.nice.invalidAdjustment(value));
        return 125;
      }
      adjustment = Number(value);
      rest = args.slice(2);
    } else if (first.startsWith("--adjustment=")) {
      const value = first.slice("--adjustment=".length);
      if (!isInteger(value)) {
        context.falhar(messages.nice.invalidAdjustment(value));
        return 125;
      }
      adjustment = Number(value);
      rest = args.slice(1);
    } else if (/^-\d+$/.test(first)) {
      // The old form: -10 is +10, and --10 is -10.
      adjustment = Number(first.slice(1));
      rest = args.slice(1);
    } else if (/^--\d+$/.test(first)) {
      adjustment = -Number(first.slice(2));
      rest = args.slice(1);
    }

    const current = niceOf(context.processo);
    if (rest.length === 0) {
      context.linha(String(current));
      return 0;
    }

    let target = clampNice(current + adjustment);
    if (target < current && !context.ehRoot()) {
      // Like GNU nice: it warns, and runs the command anyway with the niceness it already had.
      context.falhar(messages.nice.notPermitted);
      target = current;
    }
    const process = context.processo;
    if (process !== null) {
      // nice becomes the command (it does not start a child): ps shows one process, with the new niceness.
      setNice(process, target);
      process.comando = rest.join(" ");
      process.reutilizavel = true;
    }
    return context.executor.executarArgs(rest, context);
  },
};

/** renice: changes the niceness of processes that are already running (SPEC-029 RN-05). */
export const reniceCommand: EngineCommand = {
  nome: "renice",
  resumo: "muda a prioridade de um processo que já está rodando (renice 10 -p PID)",
  ajuda: {
    uso: "renice [-n] PRIORIDADE [-p|-u] IDENTIFICADOR...",
    descricao: "Muda a prioridade de processos em execução. O usuário comum só aumenta o número (diminui a prioridade) dos seus próprios processos; o root faz qualquer mudança.",
    opcoes: [
      ["-n NÚMERO", "a nova prioridade (também pode vir como primeiro argumento)"],
      ["-p, --pid PID", "os identificadores são PIDs (é o padrão)"],
      ["-u, --user USUÁRIO", "muda todos os processos do usuário"],
    ],
    exemplos: [
      ["renice 10 -p 2451", "põe o processo 2451 com prioridade 10"],
      ["renice -n 5 2451 2460", "o mesmo para dois processos"],
      ["sudo renice -5 -p 2451", "o root dá prioridade mais alta"],
    ],
  },
  async executar(args: string[], context: EngineContext): Promise<number> {
    let rest = [...args];
    if (rest[0] === "-n") rest = rest.slice(1);
    const priority = rest.shift();
    if (priority === undefined) {
      context.falhar(messages.renice.usage);
      return 1;
    }
    if (!isInteger(priority)) {
      context.falhar(messages.renice.invalidPriority(priority));
      return 1;
    }
    const wanted = clampNice(Number(priority));

    // The identifiers: PIDs (after -p, or bare) or users (after -u).
    let mode: "pid" | "user" = "pid";
    const targets: { kind: "pid" | "user"; id: string }[] = [];
    for (const arg of rest) {
      if (arg === "-p" || arg === "--pid") mode = "pid";
      else if (arg === "-u" || arg === "--user") mode = "user";
      else targets.push({ kind: mode, id: arg });
    }
    if (targets.length === 0) {
      context.falhar(messages.renice.usage);
      return 1;
    }

    let status = 0;
    const own = context.credencial.uid;
    const change = (pid: number, owner: number, from: number, set: (value: number) => void) => {
      // Without being root: only your own, and never below what it already has.
      if (!context.ehRoot() && (owner !== own || wanted < from)) {
        context.falhar(messages.renice.failedSet(pid));
        status = 1;
        return;
      }
      set(wanted);
      context.linha(messages.renice.changed(pid, from, wanted));
    };

    for (const target of targets) {
      if (target.kind === "user") {
        const matches = context.maquina.processos.listar().filter((p) => p.uid === Number(target.id) || context.maquina.contas.nomeDoUsuario(p.uid) === target.id);
        if (matches.length === 0) {
          context.falhar(messages.renice.invalidId(target.id));
          status = 1;
        }
        for (const process of matches) change(process.pid, process.uid, niceOf(process), (value) => setNice(process, value));
        continue;
      }
      if (!/^\d+$/.test(target.id)) {
        context.falhar(messages.renice.invalidId(target.id));
        status = 1;
        continue;
      }
      const pid = Number(target.id);
      const process = context.maquina.processos.porPid(pid);
      if (process !== undefined) {
        change(pid, process.uid, niceOf(process), (value) => setNice(process, value));
      } else if (pid === 1 || pid === 2 || pid >= 300) {
        // A process of the system (init, a service): it is not the user's, so only the root changes it.
        change(pid, 0, niceOfPid(pid), (value) => setNiceOfPid(pid, value));
      } else {
        context.falhar(messages.renice.failedGet(pid));
        status = 1;
      }
    }
    return status;
  },
};
