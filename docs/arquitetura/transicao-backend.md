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

### 2.2 Stack Tecnológica Definida

| Camada | Tecnologia | Papel Arquitetural e Justificativa Técnica |
| :--- | :--- | :--- |
| **Client Core** | **TypeScript** | Modelagem tipada de nós de i-node, matriz de permissões POSIX (`rwx`), cálculo de `umask`, pilha de identidades (`su`/`sudo`) e parser de shell sem latência de rede. |
| **Client UI** | **React** | Componentização reativa da interface: emulador de terminal xterm/ANSI, painel lateral colapsável de exercícios, lobby de autenticação por token e modais de suporte. |
| **Server Core** | **Golang (Go)** | Alta performance compilada, gerenciamento de I/O não-bloqueante e concorrência nativa via Goroutines e Channels (pilha inicial de ~2 KB por conexão WSS). |
| **Server HTTP** | **Gin-Gonic** | Micro-framework HTTP minimalista de alto desempenho (Radix tree router) para roteamento de endpoints RESTful, middlewares JWT e validação de tokens. |
| **Server ORM** | **GORM** | Mapeamento Objeto-Relacional idiomático para Go, com suporte a migrations automáticas (*AutoMigrate*), integridade referencial e transações atômicas ACID. |
| **Server Realtime**| **WebSocket Hub (Go)** | Orquestrador concorrente de eventos (*readPump* / *writePump*) para streaming de telemetria, fila de dúvidas FIFO e despacho assíncrono para *worker pool* de correção. |
| **Banco de Dados**| **PostgreSQL** | SGBD relacional robusto com suporte a tipos complexos (`JSONB` para snapshots e logs de telemetria, UUID nativo e constraints relacionais). |

---

## 3. Modelo de Dados Relacional (PostgreSQL / GORM)

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
- `nota_bruta_automatica`: DECIMAL(5,2) NULL (Pontuação emitida automaticamente pelo avaliador VFS)
- `nota_final_homologada`: DECIMAL(5,2) NULL (Nota definitiva após revisão e prerrogativa docente)
- `homologado_por_docente_id`: UUID NULL (FK ➔ `Usuario.id`)
- `homologado_em`: TIMESTAMP NULL
- `justificativa_revisao_nota`: TEXT NULL
- `ip_origem`: VARCHAR(45)
- `subrede_laboratorio_valida`: BOOLEAN DEFAULT true (Verifica se IP pertence à sub-rede institucional do lab)
- `user_agent`: TEXT
- `fingerprint_hash`: VARCHAR(64) (Hash unidirecional dos parâmetros de ambiente do navegador)
- `resolucao_tela`: VARCHAR(20) (ex: "1920x1080")
- `geolocalizacao_estimada`: JSONB NULL (Latitude, longitude e precisão quando autorizado na modalidade remota)
- `conexoes_ativas_count`: INTEGER DEFAULT 1 (Controle de concorrência do mutex de sessão)
- *Constraint:* UNIQUE(`avaliacao_id`, `aluno_id`, `janela_id`)

#### `ObservacaoDocenteSessao` (Dossiê Comportamental Presencial em Sala)
- `id`: UUID (PK)
- `sessao_id`: UUID (FK ➔ `SessaoAvaliacao.id`)
- `docente_id`: UUID (FK ➔ `Usuario.id`)
- `tipo_ocorrencia`: ENUM (`USO_SMARTPHONE`, `CONVERSA_PARALELA`, `COMPORTAMENTO_ATIPICO`, `ANOTACAO_PEDAGOGICA_POSITIVA`, `OUTRO`)
- `descricao`: TEXT (Registro presencial circunstanciado pelo professor)
- `registrado_em`: TIMESTAMP

#### `EventoTimelineSessao` (Registro Cronológico Consolidado da Timeline Forense)
- `id`: UUID (PK)
- `sessao_id`: UUID (FK ➔ `SessaoAvaliacao.id`)
- `tipo_evento`: ENUM (`INICIO_SESSAO`, `QUESTAO_SUBMETIDA`, `QUESTAO_CONCLUIDA`, `AJUDA_SOLICITADA`, `AJUDA_CANCELADA`, `AJUDA_ATENDIDA_PRIVADA`, `AJUDA_ATENDIDA_LOTE`, `DEVTOOLS_ADVERTENCIA`, `DEVTOOLS_REINCIDENCIA`, `ABA_OCULTA`, `SESSAO_CONFLITO`)
- `payload_detalhes`: JSONB (Metadados do evento, textos de dúvidas ou mensagens)
- `timestamp_servidor`: TIMESTAMP

#### `InfracaoSeguranca` (Registro Forense e Trilha de Auditoria Anti-Fraude)
- `id`: UUID (PK)
- `sessao_id`: UUID (FK ➔ `SessaoAvaliacao.id`)
- `tipo`: ENUM (`DEVTOOLS_DETECTADO`, `VISIBILITY_TAB_HIDDEN`, `CONCORRENCIA_SESSAO_MUTEX`, `IP_FORA_SUBREDE`)
- `nivel_advertencia`: ENUM (`PRIMEIRA_ADVERTENCIA_LOCAL`, `REINCIDENCIA_ALERTA_DOCENTE`, `ANULACAO_POTENCIAL`)
- `detalhes`: JSONB (Metadados da ocorrência: deltas de janela, tempo de aba oculta, IPs conflitantes)
- `registrado_em`: TIMESTAMP

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

### 4.4 Trilha Forense, Observações e Revisão Manual de Notas

```typescript
// GET /api/v1/avaliacoes/:avaliacaoId/sessoes/:sessaoId/timeline
export interface ObterTimelineSessaoResponse {
  sessaoId: string;
  aluno: {
    id: string;
    ra: string;
    nome: string;
  };
  eventos: Array<{
    id: string;
    tipo: 'INICIO_SESSAO' | 'QUESTAO_SUBMETIDA' | 'QUESTAO_CONCLUIDA' |
          'AJUDA_SOLICITADA' | 'AJUDA_CANCELADA' | 'AJUDA_ATENDIDA_PRIVADA' |
          'AJUDA_ATENDIDA_LOTE' | 'DEVTOOLS_ADVERTENCIA' | 'DEVTOOLS_REINCIDENCIA' |
          'ABA_OCULTA' | 'SESSAO_CONFLITO';
    timestampServidor: string;
    payload: Record<string, unknown>;
  }>;
  observacoesDocente: Array<{
    id: string;
    tipo: string;
    descricao: string;
    registradoEm: string;
  }>;
}

// POST /api/v1/avaliacoes/:avaliacaoId/sessoes/:sessaoId/observacoes
export interface RegistrarObservacaoDocenteRequest {
  tipoOcorrencia: 'USO_SMARTPHONE' | 'CONVERSA_PARALELA' | 'COMPORTAMENTO_ATIPICO' | 'ANOTACAO_PEDAGOGICA_POSITIVA' | 'OUTRO';
  descricao: string;
}

export interface RegistrarObservacaoDocenteResponse {
  id: string;
  registradoEm: string;
  sucesso: boolean;
}

// PATCH /api/v1/avaliacoes/:avaliacaoId/sessoes/:sessaoId/revisar-nota
export interface RevisarNotaRequest {
  notaFinalHomologada: number;
  justificativa: string; // Obrigatório: motivação pedagógica do ajuste/penalidade
}

export interface RevisarNotaResponse {
  sessaoId: string;
  notaBrutaOriginal: number;
  notaFinalHomologada: number;
  homologadoEm: string;
  sucesso: boolean;
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

### 6.3 Governança Avaliativa, Telemetria de Segurança e Políticas Anti-Fraude

#### 1. Detecção Heurística de DevTools e Visibilidade (`security:violation`)
O cliente monitora redimensionamentos discrepantes, sentinelas de depuração e alternância de aba (`visibilitychange`). Na primeira ocorrência, é gerada uma advertência modal local. Na reincidência, despacha-se o evento de violação para registro e exibição no Cockpit docente.

```typescript
// Evento emitido pelo cliente na reincidência: 'security:violation'
export interface SecurityViolationPayload {
  sessaoId: string;
  alunoId: string;
  ra: string;
  tipo: 'DEVTOOLS_DETECTADO' | 'VISIBILITY_TAB_HIDDEN';
  tempoOcultoMs?: number;
  janelaDimensoes?: {
    innerWidth: number;
    innerHeight: number;
    outerWidth: number;
    outerHeight: number;
  };
  reincidenciaNumero: number;
  timestamp: number;
}

// Evento emitido pelo servidor para o Cockpit docente: 'cockpit:student-security-alert'
export interface CockpitSecurityAlertPayload {
  alunoId: string;
  ra: string;
  nome: string;
  terminalId: string;
  tipo: 'DEVTOOLS_DETECTADO' | 'VISIBILITY_TAB_HIDDEN' | 'CONCORRENCIA_SESSAO_MUTEX';
  reincidenciasTotal: number;
  statusBadge: 'ALERTA_AMARELO' | 'ALERTA_VERMELHO_CRITICO';
  mensagemDescritiva: string;
  detectadoEm: string;
}
```

#### 2. Bloqueio de Concorrência de Sessão e Mutex Anti-Proxy (`session:mutex`)
Cada avaliação ativa mantém exclusão mútua estrita de conexão. Uma nova conexão com as mesmas credenciais causa a terminação imediata da sessão anterior.

```typescript
// Evento enviado pelo servidor para a conexão anterior encerrada: 'session:terminated'
export interface SessionTerminatedPayload {
  sessaoId: string;
  motivoCodigo: '4409_CONFLICT';
  motivoTexto: 'Conexão encerrada: Nova sessão de avaliação detectada em outro dispositivo.';
  novoIpConexao: string;
  terminadoEm: string;
}

// Notificação emitida para o Cockpit docente: 'cockpit:session-collision'
export interface SessionCollisionAlertPayload {
  alunoId: string;
  ra: string;
  nome: string;
  sessaoId: string;
  ipSessaoAnterior: string;
  ipNovaSessao: string;
  colisaoDetectadaEm: string;
}
```

#### 3. Handshake Forense de Rede e Limitações de Sandbox
No momento do handshake WebSocket e início da avaliação, o cliente transmite metadados forenses permitidos pela sandbox do navegador:

```typescript
// Payload transmitido no handshake de conexão: 'session:handshake'
export interface SessionHandshakePayload {
  sessaoId: string;
  tokenLiberacao: string;
  fingerprintHash: string; // Hash SHA-256 de User-Agent, canvas, WebGL e idioma
  screenResolution: string; // ex: "1920x1080"
  timezone: string; // ex: "America/Sao_Paulo"
  geolocalizacaoOpcional?: {
    latitude: number;
    longitude: number;
    precisaoMetros: number;
  };
}
```

*Nota Técnica sobre Limitações de Sandbox W3C:* Em conformidade com o modelo de segurança e privacidade da W3C, navegadores web modernos operam em sandbox estrita e não fornecem acesso a dados de hardware de nível de enlace (como endereço MAC da placa de rede). Portanto, a higidez das avaliações fundamenta-se na triagem de IP institucional no gateway do laboratório da UTFPR, no controle de concorrência por mutex e nas sentinelas heurísticas de aplicação.


