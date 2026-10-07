# Especificação Técnica: Transição de Simulador Client-Side para Plataforma Educacional Integrada (Front-end ➔ Back-end)

**Projeto:** Plataforma de Aprendizagem e Avaliação Prática para Sistemas Operacionais  
**Curso:** Tecnologia em Sistemas para Internet (TSI) — UTFPR Campus Guarapuava  
**Autor:** Ricardo Martins de Oliveira  
**Orientadora:** Profª. Dra. Sediane Carmem Lunardi Hernandes  
**Status:** Alicerce Arquitetural (Fase 1)

---

## 1. Contexto e Diagnóstico do Sistema Atual

### 1.1 Estado Atual (Client-Side Puro)
O simulador atual foi construído integralmente em **TypeScript modular**, empacotado via **Vite**, executando em memória no browser do usuário sem dependência de emulação de hardware (como x86/QEMU) ou WebAssembly:
- **Árvore VFS (`src/linux/`):** Sistema de arquivos virtual com suporte a nós de arquivo, diretório, links simbólicos, arquivos dinâmicos gerados (`/etc/passwd`, `/etc/shadow`) e permissões POSIX rigorosas (octal, simbólica e cálculo de `umask`).
- **Sessão e Identidade (`Sessao.ts`, `Contas.ts`):** Pilha de execução com alternância de usuários (`su`, `sudo`, `exit`), UIDs/GIDs e permissões de superusuário.
- **Shell e Comandos (`src/shell/`):** Analisador léxico com suporte a pipelines (`|`), redirecionamentos (`>`, `>>`, `<`), variáveis de ambiente e mais de 50 utilitários Linux implementados.
- **Avaliação em Memória:** Os desafios e simulados (`TelaSimulado.ts`) validam o estado do VFS diretamente via código JavaScript em execução no navegador.

### 1.2 Limitações e Vulnerabilidades do Modelo Exclusivo em Cliente
1. **Insegurança nas Avaliações (Risco DevTools / F12):** Em um exame formal, qualquer aluno com conhecimento básico de desenvolvimento web pode abrir as Ferramentas de Desenvolvedor, inspecionar os critérios de correção ou manipular variáveis globais de estado para marcar questões como concluídas.
2. **Ausência de Telemetria e Persistência:** O professor não tem visibilidade do histórico de comandos executados pelos alunos, comandos errados mais frequentes, tempo de hesitação por tarefa ou notas consolidadas da turma.
3. **Falta de Gestão Acadêmica:** Não há separação por turmas, controle de presenças via tokens temporais de liberação em sala de aula, nem agendamentos para avaliações de segunda chamada / repescagem.

---

## 2. Visão Arquitetural da Plataforma Integrada

A nova arquitetura adota um **modelo híbrido de baixa latência e alta confiabilidade**:

```
+-----------------------------------------------------------------------------------+
|                            CLIENTE (Navegador do Aluno)                           |
|                                                                                   |
|  [ Interface UI / Terminal GNOME ] ──▶ [ Bash Parser & Comandos TS ]              |
|                                                     │                             |
|                                        [ VFS Local (In-Memory) ]                  |
|                                                     │                             |
|                                        [ Snapshot Serializer ]                    |
|                                                     │ (JSON Assinado / Payload)   |
+-----------------------------------------------------+-----------------------------+
                                                      │ HTTPS / WSS
                                                      ▼
+-----------------------------------------------------------------------------------+
|                        BACK-END (Serviço Educacional UTFPR)                       |
|                                                                                   |
|  [ Gateway de API REST & Auth ] ──▶ [ Validador de Janela & Token de Turma ]     |
|                                                     │                             |
|                                      [ Motor de Correção Desacoplado ]            |
|                                        (Headless VFS Evaluator)                   |
|                                                     │                             |
|                                      [ Banco de Dados Relacional ]                |
|                               (Turmas, Avaliações, Submissões, Telemetria)        |
+-----------------------------------------------------------------------------------+
```

### 2.1 Princípios de Design
1. **Execução Interativa Local (Zero-Lag):** A digitação, o preenchimento de comandos (`Tab`), visualização de cores ANSI e respostas imediatas continuam rodando localmente no browser. Isso elimina o gargalo e custo de hospedar dezenas de contêineres Docker simultâneos por aluno no laboratório da UTFPR.
2. **Correção Desacoplada no Servidor:** O código que decide se o desafio foi cumprido com êxito roda **exclusivamente no servidor**. O cliente apenas envia o estado final do VFS serializado e/ou o log de comandos executados.
3. **Controle de Acesso por Sessão e Tokens:** No início da aula presencial, a professora gera ou projeta um **Token de Liberação** (ex: `SO-TURMAA-8742`), com validade restrita ao horário da aula. Alunos em repescagem recebem tokens vinculados a janelas específicas.

---

## 3. Modelo de Dados Relacional (PostgreSQL / Prisma / TypeORM)

```
[ Usuario ] 1 ── * [ InscricaoTurma ] * ── 1 [ Turma ]
     │                                           │
     │ 1                                         │ 1
     ▼                                           ▼
[ SessaoAvaliacao ] * ────────────────────── 1 [ Avaliacao ]
     │                                           │
     │ 1                                         │ 1
     ▼                                           ▼
[ SubmissaoQuestao ] *                      [ JanelaAplicacao ] (Repescagens)
```

### 3.1 Definição das Entidades

#### `Usuario` (Usuário / Aluno / Docente)
- `id`: UUID (PK)
- `ra`: VARCHAR(20) UNIQUE (Registro Acadêmico UTFPR)
- `nome`: VARCHAR(120)
- `email`: VARCHAR(120) UNIQUE
- `senha_hash`: VARCHAR(255)
- `perfil`: ENUM (`DOCENTE`, `ESTUDANTE`, `ADMINISTRADOR`)
- `criado_em`: TIMESTAMP
- `atualizado_em`: TIMESTAMP

#### `Turma` (Instância de Disciplina no Semestre)
- `id`: UUID (PK)
- `codigo_disciplina`: VARCHAR(20) (ex: `SI34E` - Sistemas Operacionais)
- `semestre`: VARCHAR(10) (ex: `2026/1`)
- `docente_id`: UUID (FK ➔ `Usuario.id`)
- `ativo`: BOOLEAN DEFAULT true
- `criado_em`: TIMESTAMP

#### `InscricaoTurma` (Matrícula do Aluno na Turma)
- `id`: UUID (PK)
- `turma_id`: UUID (FK ➔ `Turma.id`)
- `aluno_id`: UUID (FK ➔ `Usuario.id`)
- `ativo`: BOOLEAN DEFAULT true
- `data_matricula`: TIMESTAMP
- *Constraint:* UNIQUE(`turma_id`, `aluno_id`)

#### `Avaliacao` (Exame ou Prática Laboratorial)
- `id`: UUID (PK)
- `turma_id`: UUID (FK ➔ `Turma.id`)
- `titulo`: VARCHAR(150) (ex: "Prova Prática 1: Permissões e Gerenciamento de Usuários")
- `descricao`: TEXT
- `peso`: DECIMAL(4,2)
- `duracao_minutos`: INTEGER (ex: 50)
- `questoes_config`: JSONB (Definição dos cenários, enunciados, VFS base e critério de aceite no servidor)
- `permitir_repescagem`: BOOLEAN DEFAULT false
- `criado_em`: TIMESTAMP

#### `JanelaAplicacao` (Janela Temporal e Tokens de Aplicação / Repescagem)
- `id`: UUID (PK)
- `avaliacao_id`: UUID (FK ➔ `Avaliacao.id`)
- `tipo`: ENUM (`REGULAR`, `REPESCAGEM`, `SEGUNDA_CHAMADA`, `TREINAMENTO_LIVRE`)
- `token_liberacao`: VARCHAR(32) (Senha dinâmica fornecida pela docente em sala)
- `data_inicio`: TIMESTAMP
- `data_fim`: TIMESTAMP
- `aluno_especifico_id`: UUID NULL (Se nulo, liberado para qualquer aluno matriculado com o token; se preenchido, restrito ao aluno específico em repescagem)
- `ativo`: BOOLEAN DEFAULT true

#### `SessaoAvaliacao` (Tentativa do Aluno)
- `id`: UUID (PK)
- `avaliacao_id`: UUID (FK ➔ `Avaliacao.id`)
- `janela_id`: UUID (FK ➔ `JanelaAplicacao.id`)
- `aluno_id`: UUID (FK ➔ `Usuario.id`)
- `data_inicio`: TIMESTAMP
- `data_limite_entrega`: TIMESTAMP (Calculada pelo servidor: `data_inicio + duracao_minutos`)
- `data_submissao`: TIMESTAMP NULL
- `status`: ENUM (`EM_ANDAMENTO`, `FINALIZADO`, `TEMPO_ESGOTADO`, `CANCELADO`)
- `nota_final`: DECIMAL(5,2) NULL
- `ip_origem`: VARCHAR(45)
- `user_agent`: TEXT
- *Constraint:* UNIQUE(`avaliacao_id`, `aluno_id`, `janela_id`)

#### `SubmissaoQuestao` (Resultado por Questão e Telemetria)
- `id`: UUID (PK)
- `sessao_id`: UUID (FK ➔ `SessaoAvaliacao.id`)
- `questao_id`: VARCHAR(50)
- `status`: ENUM (`PENDENTE`, `APROVADO`, `REPROVADO`)
- `nota`: DECIMAL(5,2)
- `vfs_snapshot_enviado`: JSONB (Estado final dos nós relevantes manipulados)
- `log_comandos`: JSONB (Array cronológico: `[{ timestamp, comando, exitCode, outputSnippet }]`)
- `tempo_gasto_segundos`: INTEGER
- `erros_detectados`: JSONB
- `avaliado_em`: TIMESTAMP

---

## 4. Contratos de API RESTful (Interfaces TypeScript)

### 4.1 Autenticação e Perfil
```typescript
// POST /api/v1/auth/login
export interface LoginRequest {
  ra: string;
  senha: string;
}

export interface LoginResponse {
  token: string; // JWT
  usuario: {
    id: string;
    ra: string;
    nome: string;
    perfil: 'DOCENTE' | 'ESTUDANTE' | 'ADMINISTRADOR';
  };
}
```

### 4.2 Desbloqueio e Início de Avaliação
```typescript
// POST /api/v1/avaliacoes/validar-token
export interface ValidarTokenRequest {
  tokenLiberacao: string;
}

export interface ValidarTokenResponse {
  valido: boolean;
  avaliacao: {
    id: string;
    titulo: string;
    duracaoMinutos: number;
    turma: string;
    tipoJanela: 'REGULAR' | 'REPESCAGEM' | 'SEGUNDA_CHAMADA';
  };
}

// POST /api/v1/avaliacoes/:avaliacaoId/iniciar
export interface IniciarSessaoRequest {
  tokenLiberacao: string;
}

export interface IniciarSessaoResponse {
  sessaoId: string;
  dataInicio: string; // ISO 8601
  dataLimite: string; // ISO 8601
  questoes: Array<{
    id: string;
    titulo: string;
    enunciadoMarkdown: string;
    peso: number;
    ambienteInicialConfig: {
      diretorioInicial: string;
      arquivosIniciais?: Record<string, string>;
    };
  }>;
}
```

### 4.3 Submissão Segura e Telemetria
```typescript
// POST /api/v1/avaliacoes/:avaliacaoId/submeter-questao
export interface SubmeterQuestaoRequest {
  sessaoId: string;
  questaoId: string;
  vfsSnapshot: VfsSnapshotData; // Árvore serializada do VFS
  logComandos: Array<{
    timestamp: number;
    comando: string;
    codigoRetorno: number;
  }>;
}

export interface SubmeterQuestaoResponse {
  aprovado: boolean;
  mensagemDocente?: string;
  criteriosAtendidos: Array<{
    regra: string;
    sucesso: boolean;
    detalhe?: string;
  }>;
}

// POST /api/v1/avaliacoes/:avaliacaoId/finalizar
export interface FinalizarAvaliacaoRequest {
  sessaoId: string;
}

export interface FinalizarAvaliacaoResponse {
  sessaoId: string;
  notaFinal: number;
  dataSubmissao: string;
  aprovado: boolean;
}
```

---

## 5. Protocolo de Verificação de Estado VFS Desacoplada

Para evitar que o cliente seja o juiz da própria nota:
1. **Serialização Mínima de Estado:** Ao invés de enviar centenas de arquivos do sistema (`/bin`, `/usr`), o cliente gera um snapshot apenas das áreas alteradas ou das pastas monitoradas pela questão (ex: `/home/aluno`, `/etc/group`, `/var/www/html`).
2. **Reconstituição no Servidor:** O servidor carrega a classe `SistemaDeArquivos` em modo headless (Node.js) com o estado inicial da questão e aplica as alterações do snapshot ou executa o replay dos comandos.
3. **Avaliação das Asserções:** As regras de negócio (ex: "o arquivo `/tmp/relatorio.txt` tem permissão 640 e pertence ao grupo `financeiro`?") são checadas exclusivamente em ambiente de servidor, retornando um veredito criptograficamente auditável.

---

## 6. Arquitetura Reativa WebSocket e Fila de Suporte ("Mãozinha Virtual")

Para suportar tanto o feedback de validação em tempo real quanto a dinâmica pedagógica de sala de aula sem requisições HTTP bloqueantes, a plataforma implementa uma camada reativa bidirecional via **WebSockets (WSS)**.

### 6.1 Topologia de Salas e Canais de Eventos
- `/ws/avaliacoes/:sessaoId`: Canal privado entre o terminal do aluno e o validador de comandos no servidor.
- `/ws/turmas/:turmaId/cockpit`: Canal de supervisão docente agregada (telemetria em tempo real, status dos terminais e gerenciamento da fila de suporte).

### 6.2 Ciclo de Vida e Contratos de Eventos da Fila de Suporte

#### 1. Abertura do Chamado (`help:request`)
O discente preenche obrigatoriamente um resumo textual de sua dificuldade na interface antes de solicitar atendimento.

```typescript
// Evento emitido pelo cliente do estudante: 'help:request'
export interface HelpRequestPayload {
  sessaoId: string;
  alunoId: string;
  ra: string;
  nome: string;
  terminalId: string;
  questaoAtualId?: string;
  resumoDuvida: string; // Obrigatório: síntese da dificuldade enfrentada
  timestamp: number;
}

// Evento emitido pelo servidor para o Cockpit docente: 'help:enqueued'
export interface HelpEnqueuedPayload {
  ticketId: string;
  posicaoFila: number;
  aluno: {
    id: string;
    ra: string;
    nome: string;
  };
  terminalId: string;
  questaoAtualId?: string;
  resumoDuvida: string;
  solicitadoEm: string; // ISO 8601
}
```

#### 2. Cancelamento Autônomo (`help:cancel`)
Se o estudante resolver a questão autonomamente ou acompanhar uma explicação presencial, ele pode cancelar o pedido imediatamente.

```typescript
// Evento emitido pelo cliente do estudante: 'help:cancel'
export interface HelpCancelPayload {
  ticketId: string;
  motivo?: string; // ex: 'resolvido_autonomamente'
}

// Evento emitido pelo servidor para o Cockpit docente: 'help:removed'
export interface HelpRemovedPayload {
  ticketId: string;
  motivo: 'cancelado_pelo_aluno' | 'expirado';
}
```

#### 3. Atendimento Docente 1:1 (`help:respond-private`)
A professora atende uma dúvida pontual ou atípica abrindo um diálogo privado com o terminal do estudante.

```typescript
// Evento emitido pelo Cockpit docente: 'help:respond-private'
export interface HelpRespondPrivatePayload {
  ticketId: string;
  alunoId: string;
  mensagem: string;
}

// Evento entregue pelo servidor ao terminal do aluno: 'help:private-message'
export interface HelpPrivateMessagePayload {
  ticketId: string;
  docenteNome: string;
  mensagem: string;
  enviadoEm: string;
}
```

#### 4. Atendimento em Lote por Broadcast Inteligente (`help:broadcast-batch`)
Para dúvidas recorrentes na turma, a professora seleciona múltiplos cartões na fila e transmite uma orientação unificada.

```typescript
// Evento emitido pelo Cockpit docente: 'help:broadcast-batch'
export interface HelpBroadcastBatchPayload {
  ticketIds: string[]; // IDs dos chamados selecionados via multiselect
  orientacaoDocente: string; // Texto explicativo / dica pedagógica
}

// Evento transmitido pelo servidor para a sala inteira: 'classroom:broadcast'
export interface ClassroomBroadcastPayload {
  mensagemFormatada: string; // "Respondendo às dúvidas de Aluno A, Aluno B e Aluno C: [orientacaoDocente]"
  alunosContemplados: Array<{ id: string; nome: string }>;
  enviadoEm: string;
}

// Evento despachado para os clientes dos alunos contemplados: 'help:resolved'
export interface HelpResolvedPayload {
  ticketId: string;
  tipoResolucao: 'INDIVIDUAL' | 'BROADCAST_LOTE';
  mensagem?: string;
  resolvidoEm: string;
}
```

