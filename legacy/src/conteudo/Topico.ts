import type { Maquina } from '../linux/Maquina';

/** Um comando do roteiro: digitado sozinho no terminal indicado. */
export interface Passo {
  comando: string;
  /** Comentário mostrado ao lado do comando no card. */
  explicacao?: string;
  /** Respostas digitadas quando o comando perguntar algo (senhas, confirmações). */
  respostas?: string[];
  /** Em qual terminal (1 = root, 2 e 3 = outros usuários). Padrão: 1. */
  terminal?: number;
  /** Se o terminal ainda não estiver logado, faz o login SSH com estes dados. */
  login?: { usuario: string; senha: string };
}

/** Um card de estudo: um comando com explicação, sintaxe, opções, exemplos e dicas. */
export interface Licao {
  comando: string;
  titulo: string;
  descricao: string;
  sintaxe: string;
  opcoes?: Array<[string, string]>;
  exemplos: Passo[];
  dicas?: string[];
  /** "Na vida real": quando isso é usado de verdade, principalmente em servidores. */
  naPratica?: string;
  /** "Cai na prova": o erro mais comum com esse comando. */
  pegadinha?: string;
  /** Widget interativo extra dentro do card. */
  extra?: 'calculadora-permissoes' | 'anatomia-ls';
}

export type NivelDificuldade = 'facil' | 'medio' | 'dificil';

/** Tarefa prática conferida automaticamente olhando o estado da máquina. */
export interface Desafio {
  id: string;
  nivel?: NivelDificuldade;
  enunciado: string;
  dica: string;
  solucao: Passo[];
  verificar(maquina: Maquina): boolean;
  preparar?(maquina: Maquina): void;
  adaptar?(maquina: Maquina): Desafio;
}

/** Questão teórica de múltipla escolha no padrão de exames de certificação. */
export interface QuestaoQuiz {
  id: string;
  nivel?: NivelDificuldade;
  pergunta: string;
  certificacao: string;
  opcoes: string[];
  correta: number;
  explicacao: string;
}

/** Modalidade ou sub-simulado (ex.: Básico, Médio, LPI Essentials, LPIC-1, Quiz). */
export interface ModalidadeSimulado {
  id: string;
  titulo: string;
  icone: string;
  badge?: string;
  descricao: string;
  objetivo?: string;
  preparar?: (maquina: Maquina) => void;
  desafios?: Desafio[];
  questoes?: QuestaoQuiz[];
}

export interface Topico {
  id: string;
  numero: number;
  titulo: string;
  subtitulo: string;
  icone: string;
  /** Nome da variável CSS da cor do tópico (ex.: "--cor-dir"). */
  cor: string;
  resumo: string;
  /** Texto introdutório (HTML) com os conceitos antes dos comandos. */
  conceitos: string;
  /** "Na vida real" do bloco de conceitos. */
  naPratica?: string;
  /** Comandos que mostram os conceitos na prática (o play do bloco de conceitos). */
  demonstracao?: Passo[];
  /** Deixa a máquina no ponto de partida do tópico. */
  preparar(maquina: Maquina): void;
  licoes: Licao[];
  desafios: Desafio[];
  /** Sub-menus / categorias de simulado se o tópico for modular. */
  modalidades?: ModalidadeSimulado[];
}

