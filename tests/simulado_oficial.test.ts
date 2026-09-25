import { describe, it, expect } from 'vitest';
import { Maquina } from '../src/linux/Maquina';
import type { Usuario } from '../src/linux/Contas';
import type { Sessao } from '../src/linux/Sessao';
import { Shell } from '../src/shell/Shell';
import type { Interpretador } from '../src/shell/Interpretador';
import { SaidaEmTexto } from '../src/shell/Saida';
import type { Interacao, PedidoDeEdicao } from '../src/shell/Contexto';
import { MotorQuestoesSimulado } from '../src/app/MotorQuestoesSimulado';
import {
  questoesCertificacao,
  desafiosBasico,
  desafiosMedio,
  desafiosAvancado,
  desafiosEssentials,
  desafiosLPIC1,
  desafiosEscola,
  modalidades,
} from '../src/conteudo/simulado';
import type { Desafio, ModalidadeSimulado } from '../src/conteudo/Topico';

export class InteracaoTeste implements Interacao {
  public respostas: string[];

  constructor(respostas: string[] = []) {
    this.respostas = [...respostas];
  }

  public adicionarRespostas(respostas: string[]): void {
    this.respostas.push(...respostas);
  }

  public async perguntar(_pergunta: string, _oculto: boolean): Promise<string> {
    return this.respostas.shift() ?? '';
  }

  public limparTela(): void {}

  public async editar(pedido: PedidoDeEdicao): Promise<void> {
    pedido.gravar(pedido.conteudo);
  }

  public desconectar(): void {}
}

export async function rodarSolucao(
  desafio: Desafio,
  modalidade: ModalidadeSimulado | undefined,
  comandosAlternativos?: string[],
): Promise<{ passou: boolean; maquina: Maquina; saida: string }> {
  const maquina = Maquina.criar();

  // 1. Preparação da modalidade
  if (modalidade?.preparar) {
    modalidade.preparar(maquina);
  }

  // 2. Preparação de pré-requisitos da questão
  MotorQuestoesSimulado.prepararPrerequisitos([desafio], maquina);

  // 3. Sessão root (terminal 1 padrão)
  const root = maquina.contas.usuario('root') as Usuario;
  const sessao: Sessao = maquina.abrirSessao(root);
  const interpretador: Interpretador = Shell.criarInterpretador();
  const saida = new SaidaEmTexto();
  const interacao = new InteracaoTeste();

  if (comandosAlternativos) {
    for (const cmd of comandosAlternativos) {
      await interpretador.executarLinha(cmd, maquina, sessao, saida, interacao);
    }
  } else {
    for (const passo of desafio.solucao) {
      if (passo.respostas) {
        interacao.adicionarRespostas(passo.respostas);
      }
      await interpretador.executarLinha(passo.comando, maquina, sessao, saida, interacao);
    }
  }

  const passou = desafio.verificar(maquina);
  return { passou, maquina, saida: saida.texto };
}

describe('Simulado - Quiz Oficial (30 questões teóricas)', () => {
  it('todas as questões possuem opções válidas e índice correto', () => {
    expect(questoesCertificacao.length).toBe(30);
    for (const q of questoesCertificacao) {
      expect(q.id).toBeDefined();
      expect(q.pergunta.length).toBeGreaterThan(10);
      expect(q.opcoes.length).toBeGreaterThanOrEqual(4);
      expect(q.correta).toBeGreaterThanOrEqual(0);
      expect(q.correta).toBeLessThan(q.opcoes.length);
      expect(q.explicacao.length).toBeGreaterThan(10);
    }
  });
});

const conjuntos: Array<{ nome: string; modalidadeId: string; lista: Desafio[] }> = [
  { nome: 'Linux Básico', modalidadeId: 'basico', lista: desafiosBasico },
  { nome: 'Linux Médio', modalidadeId: 'medio', lista: desafiosMedio },
  { nome: 'Linux Avançado', modalidadeId: 'avancado', lista: desafiosAvancado },
  { nome: 'LPI Linux Essentials', modalidadeId: 'essentials', lista: desafiosEssentials },
  { nome: 'LPIC-1', modalidadeId: 'lpic1', lista: desafiosLPIC1 },
  { nome: 'Servidor Escola', modalidadeId: 'escola', lista: desafiosEscola },
];

for (const conj of conjuntos) {
  const mod = modalidades.find((m) => m.id === conj.modalidadeId);

  describe(`Regra Primordial: ${conj.nome} (30 desafios oficiais)`, () => {
    it(`deve conter 30 desafios cadastrados`, () => {
      expect(conj.lista.length).toBe(30);
    });

    for (const d of conj.lista) {
      it(`[${d.id}] ${d.enunciado.slice(0, 60)}... deve passar com a solução proposta`, async () => {
        const { passou, saida } = await rodarSolucao(d, mod);
        if (!passou) {
          console.error(`FALHA na questão ${d.id}:`, {
            enunciado: d.enunciado,
            solucao: d.solucao,
            saida,
          });
        }
        expect(passou).toBe(true);
      });
    }
  });
}
