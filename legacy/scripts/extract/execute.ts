// Runs legacy content to capture scenarios and solution states (SPEC-005
// RN-04). Everything here only reads the legacy code: machines are created,
// prepared and driven through the legacy shell exactly as the app does.
import { MotorQuestoesSimulado } from '../../src/app/MotorQuestoesSimulado';
import type { Desafio, ModalidadeSimulado, Passo, Topico } from '../../src/conteudo/Topico';
import type { Usuario } from '../../src/linux/Contas';
import { Maquina } from '../../src/linux/Maquina';
import { Serializador, type MaquinaJson } from '../../src/linux/Serializador';
import type { Sessao } from '../../src/linux/Sessao';
import type { Interacao, PedidoDeEdicao } from '../../src/shell/Contexto';
import type { Interpretador } from '../../src/shell/Interpretador';
import { SaidaEmTexto } from '../../src/shell/Saida';
import { Shell } from '../../src/shell/Shell';

/** Answers interactive prompts from a queue, like the legacy test helper. */
class ScriptedInteraction implements Interacao {
  private readonly answers: string[] = [];

  public push(answers: string[]): void {
    this.answers.push(...answers);
  }

  public async perguntar(): Promise<string> {
    return this.answers.shift() ?? '';
  }

  public limparTela(): void {}

  public async editar(pedido: PedidoDeEdicao): Promise<void> {
    pedido.gravar(pedido.conteudo);
  }

  public desconectar(): void {}
}

/** Deterministic pseudo-random generator, so artifacts are reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where a question comes from: a study topic or a simulado modality. */
export type Origin = { kind: 'topic'; topic: Topico } | { kind: 'modality'; modality: ModalidadeSimulado };

/** Applies the base preparation of the origin (topic or modality). */
export function prepareBase(machine: Maquina, origin: Origin): void {
  if (origin.kind === 'topic') origin.topic.preparar(machine);
  else origin.modality.preparar?.(machine);
}

/** Applies the question-specific preparation, in the legacy engine order. */
export function prepareQuestion(machine: Maquina, origin: Origin, challenge: Desafio): void {
  if (origin.kind === 'topic') challenge.preparar?.(machine);
  else MotorQuestoesSimulado.prepararPrerequisitos([challenge], machine);
}

export function newMachine(): Maquina {
  return Maquina.criar();
}

export function snapshot(machine: Maquina): MaquinaJson {
  return Serializador.paraJson(machine);
}

/**
 * Builds a machine at the question scenario: base preparation plus the
 * question preparation. When previous challenges are given (topic challenges
 * that build on each other, as in the legacy single-machine flow), their
 * preparations and reference solutions are applied first.
 */
export async function scenarioMachine(origin: Origin, challenge: Desafio, previous: Desafio[] = []): Promise<Maquina> {
  const machine = newMachine();
  prepareBase(machine, origin);
  for (const p of previous) {
    prepareQuestion(machine, origin, p);
    await runSteps(machine, p.solucao);
  }
  prepareQuestion(machine, origin, challenge);
  return machine;
}

/**
 * Runs command steps. Terminal 1 is root; other terminals open a session as
 * the login user of their first step (or root when there is none).
 */
export async function runSteps(machine: Maquina, steps: Passo[]): Promise<void> {
  const interpreter: Interpretador = Shell.criarInterpretador();
  const output = new SaidaEmTexto();
  const interaction = new ScriptedInteraction();
  const sessions = new Map<number, Sessao>();
  const root = machine.contas.usuario('root') as Usuario;

  for (const step of steps) {
    const terminal = step.terminal ?? 1;
    let session = sessions.get(terminal);
    if (!session) {
      const user = step.login ? machine.contas.usuario(step.login.usuario) : undefined;
      session = machine.abrirSessao(user ?? root);
      sessions.set(terminal, session);
    }
    if (step.respostas) interaction.push(step.respostas);
    await interpreter.executarLinha(step.comando, machine, session, output, interaction);
  }
}

/** Runs plain command lines in a single root session (alternative solutions). */
export async function runCommands(machine: Maquina, commands: string[]): Promise<void> {
  await runSteps(machine, commands.map((comando) => ({ comando })));
}
