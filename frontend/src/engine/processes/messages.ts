// The texts of the commands of the process control, in the Ubuntu in Brazilian Portuguese the other commands of the engine speak.

export const messages = {
  nice: {
    invalidAdjustment: (value: string) => `nice: '${value}' não é um número válido`,
    notPermitted: "nice: não foi possível definir a prioridade: Permissão negada",
    missingValue: "nice: a opção requer um argumento -- 'n'",
    commandNotFound: (name: string) => `nice: '${name}': Arquivo ou diretório inexistente`,
  },
  renice: {
    usage: "Uso: renice [-n] PRIORIDADE [-g|-p|-u] IDENTIFICADOR...",
    invalidPriority: (value: string) => `renice: valor de prioridade inválido: ${value}`,
    invalidId: (value: string) => `renice: ID inválido: ${value}`,
    changed: (pid: number, from: number, to: number) => `${pid} (ID do processo) prioridade antiga ${from}, nova prioridade ${to}`,
    failedSet: (pid: number) => `renice: falha ao definir a prioridade de ${pid} (ID do processo): Permissão negada`,
    failedGet: (pid: number) => `renice: falha ao obter a prioridade de ${pid} (ID do processo): Processo inexistente`,
  },
  ps: {
    unknownField: (name: string) => `erro: especificador de formato definido pelo usuário desconhecido "${name}"`,
  },
  ping: {
    missingDestination: "ping: erro de uso: endereço de destino obrigatório",
    unknownHost: (name: string) => `ping: ${name}: Nome ou serviço desconhecido`,
    invalidCount: (value: string) => `ping: argumento inválido: '${value}'`,
    invalidInterval: (value: string) => `ping: intervalo inválido: '${value}'`,
    tooFast: "ping: não é possível inundar; o intervalo mínimo permitido para o usuário é 200ms",
  },
  yes: {
    // yes has no error message of its own: an unknown option is the one of the engine.
  },
  watch: {
    missingCommand: "watch: falta o comando a executar",
    invalidInterval: (value: string) => `watch: intervalo inválido '${value}'`,
    header: (interval: number, command: string) => `A cada ${interval.toFixed(1).replace(".", ",")}s: ${command}`,
  },
  kill: {
    invalidSpec: (value: string) => `bash: kill: ${value}: especificação de sinal inválida`,
    notPermitted: (pid: number) => `bash: kill: (${pid}) - Operação não permitida`,
    noSuchProcess: (pid: number) => `bash: kill: (${pid}) - Processo inexistente`,
    jobsUnsupported: (spec: string) => `bash: kill: ${spec}: este sinal só funciona com o PID do processo`,
    usage: "kill: uso: kill [-s sinal | -n num | -sinal] pid | jobspec ... ou kill -l [sinal]",
  },
} as const;
