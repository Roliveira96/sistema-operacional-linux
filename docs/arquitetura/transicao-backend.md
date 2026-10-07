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
- `status_conta`: ENUM (`ATIVO`, `INATIVO`) DEFAULT `ATIVO` (Suspensão administrativa de acesso)
- `deleted_at`: TIMESTAMP NULL (GORM Soft Delete: exclusão lógica com preservação integral de submissões e telemetria)
- `criado_em`: TIMESTAMP
- `atualizado_em`: TIMESTAMP

#### `Turma` (Instância de Disciplina no Semestre)
- `id`: UUID (PK)
- `codigo_disciplina`: VARCHAR(20) (ex: `SI34E` - Sistemas Operacionais)
- `nome_disciplina`: VARCHAR(150) (ex: "Sistemas Operacionais")
- `semestre`: VARCHAR(10) (ex: `2026/1`)
- `docente_id`: UUID (FK ➔ `Usuario.id`)
- `vigencia_inicio`: DATE (Data de início oficial do semestre letivo)
- `vigencia_fim`: DATE (Data de encerramento do semestre letivo)
- `ementa`: TEXT (Ementa acadêmica e eixos curriculares da disciplina)
- `criterios_avaliacao`: JSONB (Pesos das avaliações, fórmulas de cálculo da média e nota mínima para aprovação)
- `diretrizes_institucionais`: TEXT (Políticas de assiduidade, conduta em laboratório e código de integridade)
- `link_convite_token`: VARCHAR(64) UNIQUE (Token alfanumérico seguro para URLs de convite compartilhável)
- `requer_moderacao`: BOOLEAN DEFAULT true (Exige deferimento da docente para solicitações via link)
- `ativo`: BOOLEAN DEFAULT true
- `criado_em`: TIMESTAMP
- `atualizado_em`: TIMESTAMP

#### `InscricaoTurma` / `matriculas_turmas` (Matrícula e Ciclo de Ingresso/Vida do Aluno na Turma)
- `id`: UUID (PK)
- `turma_id`: UUID (FK ➔ `Turma.id`)
- `aluno_id`: UUID NULL (FK ➔ `Usuario.id` - nulo durante o estágio de pré-matrícula não ativada)
- `ra_provisorio`: VARCHAR(20) NULL (Registro Acadêmico institucional para reconciliação na importação CSV)
- `email_provisorio`: VARCHAR(120) NULL (E-mail acadêmico institucional informado na lista)
- `nome_provisorio`: VARCHAR(120) NULL (Nome completo discente informado na lista)
- `status`: ENUM (`ATIVO`, `TRANSFERIDO`, `DESVINCULADO`, `TRANCADO`, `PENDENTE_MODERACAO`, `DEFERIDO`, `INDEFERIDO`, `PRE_MATRICULA`)
- `turma_origem_transferencia_id`: UUID NULL (FK ➔ `Turma.id` - rastreabilidade em caso de remanejamento entre turnos)
- `transferido_em`: TIMESTAMP NULL (Data/hora em que a migração de turma foi efetuada)
- `motivo_transferencia`: TEXT NULL (Justificativa pedagógica/administrativa do remanejamento)
- `origem_ingresso`: ENUM (`LINK_COMPARTILHADO`, `IMPORTACAO_CSV`, `MATRICULA_DIRETA_DOCENTE`)
- `token_ativacao_hash`: VARCHAR(64) NULL (Hash SHA-256 do token efêmero de ativação por e-mail)
- `token_ativacao_expira_em`: TIMESTAMP NULL
- `solicitado_em`: TIMESTAMP
- `deliberado_em`: TIMESTAMP NULL (Momento de deferimento ou indeferimento da matrícula)
- `deliberado_por_id`: UUID NULL (FK ➔ `Usuario.id` - Docente responsável pela deliberação)
- `motivo_indeferimento`: TEXT NULL
- `ativo`: BOOLEAN DEFAULT true
- *Constraint:* UNIQUE(`turma_id`, `aluno_id`) (aplicada para vínculos com `aluno_id` não nulo)

#### `AvisoTurma` (Comunicados Pedagógicos e Mural da Turma)
- `id`: UUID (PK)
- `turma_id`: UUID (FK ➔ `Turma.id`)
- `docente_id`: UUID (FK ➔ `Usuario.id`)
- `titulo`: VARCHAR(150)
- `conteudo_markdown`: TEXT
- `publico_alvo`: ENUM (`TODOS_MATRICULADOS`, `DISCENTES_SELECIONADOS`)
- `discentes_alvo_ids`: JSONB NULL (Array de UUIDs quando segmentado via multiselect)
- `publicar_em`: TIMESTAMP (Data/hora de agendamento de publicação)
- `requer_confirmacao`: BOOLEAN DEFAULT false (Flag para Read Receipt obrigatório)
- `status`: ENUM (`RASCUNHO`, `AGENDADO`, `PUBLICADO`, `ARQUIVADO`)
- `criado_em`: TIMESTAMP
- `atualizado_em`: TIMESTAMP

#### `ConfirmacaoLeituraAviso` (Registro de Ciência Discente / Read Receipt)
- `id`: UUID (PK)
- `aviso_id`: UUID (FK ➔ `AvisoTurma.id`)
- `aluno_id`: UUID (FK ➔ `Usuario.id`)
- `confirmado_em`: TIMESTAMP (Momento exato da confirmação de ciência pelo estudante)
- `ip_origem`: VARCHAR(45)
- *Constraint:* UNIQUE(`aviso_id`, `aluno_id`)

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
- `status`: ENUM (`EM_ANDAMENTO`, `FINALIZADO`, `TEMPO_ESGOTADO`, `CANCELADO`, `BLOQUEADO_DOCENTE`)
- `nota_bruta_automatica`: DECIMAL(5,2) NULL (Pontuação emitida automaticamente pelo avaliador VFS)
- `nota_final_homologada`: DECIMAL(5,2) NULL (Nota definitiva após revisão e prerrogativa docente)
- `homologado_por_docente_id`: UUID NULL (FK ➔ `Usuario.id`)
- `homologado_em`: TIMESTAMP NULL
- `justificativa_revisao_nota`: TEXT NULL
- `bloqueado_em`: TIMESTAMP NULL (Momento de encerramento compulsório ou bloqueio acidental)
- `reaberto_em`: TIMESTAMP NULL (Momento da reversão operacional pela professora)
- `tempo_compensado_segundos`: INTEGER DEFAULT 0 (Total de segundos acrescidos à data limite por delta t)
- `motivo_reabertura`: TEXT NULL (Justificativa acadêmica da reversão do bloqueio)
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
- `tipo_evento`: ENUM (`INICIO_SESSAO`, `QUESTAO_SUBMETIDA`, `QUESTAO_CONCLUIDA`, `AJUDA_SOLICITADA`, `AJUDA_CANCELADA`, `AJUDA_ATENDIDA_PRIVADA`, `AJUDA_ATENDIDA_LOTE`, `DEVTOOLS_ADVERTENCIA`, `DEVTOOLS_REINCIDENCIA`, `ABA_OCULTA`, `SESSAO_CONFLITO`, `SESSAO_BLOQUEADA_DOCENTE`, `SESSAO_REABERTA_COMPENSADA`)
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

### 4.2 Gestão de Turmas e Onboarding Discente

```typescript
// POST /api/v1/turmas
export interface CriarTurmaRequest {
  codigoDisciplina: string; // ex: "SI34E"
  nomeDisciplina: string; // ex: "Sistemas Operacionais"
  semestre: string; // ex: "2026/1"
  vigenciaInicio: string; // YYYY-MM-DD
  vigenciaFim: string; // YYYY-MM-DD
  ementa: string;
  criteriosAvaliacao: {
    mediaMinimaAprovacao: number;
    pesosAvaliacoes: Record<string, number>;
    formulaCalculo: string;
  };
  diretrizesInstitucionais: string;
  requerModeracao: boolean;
}

export interface CriarTurmaResponse {
  turmaId: string;
  codigoDisciplina: string;
  linkConviteToken: string;
  linkConviteUrl: string; // ex: "https://plataforma.utfpr.edu.br/ingressar?token=tk_..."
  criadoEm: string;
}

// POST /api/v1/turmas/:turmaId/solicitar-ingresso
export interface SolicitarIngressoTurmaRequest {
  linkConviteToken: string;
}

export interface SolicitarIngressoTurmaResponse {
  inscricaoId: string;
  status: 'PENDENTE_MODERACAO' | 'DEFERIDO';
  mensagem: string;
}

// GET /api/v1/turmas/:turmaId/inscricoes/pendentes
export interface FilaModeracaoTurmaResponse {
  turmaId: string;
  totalPendentes: number;
  solicitacoes: Array<{
    inscricaoId: string;
    aluno: {
      id: string;
      ra: string;
      nome: string;
      email: string;
    };
    solicitadoEm: string;
  }>;
}

// PATCH /api/v1/turmas/:turmaId/inscricoes/:inscricaoId/moderar
export interface ModerarInscricaoRequest {
  decisao: 'DEFERIR' | 'INDEFERIR';
  motivoIndeferimento?: string;
}

export interface ModerarInscricaoResponse {
  inscricaoId: string;
  status: 'DEFERIDO' | 'INDEFERIDO';
  deliberadoEm: string;
  sucesso: boolean;
}

// POST /api/v1/turmas/:turmaId/importar-csv
// Content-Type: multipart/form-data com arquivo CSV (colunas obrigatórias: ra,nome,email)
export interface ImportarCsvTurmaResponse {
  turmaId: string;
  totalLinhasProcessadas: number;
  vinculosImediatosDeferidos: number;
  preMatriculasCriadas: number;
  emailsEnfileirados: number;
  errosValidacao?: Array<{
    linha: number;
    motivo: string;
  }>;
}

// POST /api/v1/turmas/:turmaOrigemId/remanejar-aluno
export interface RemanejarAlunoTurmaRequest {
  alunoId: string;
  turmaDestinoId: string;
  motivo?: string;
}

export interface RemanejarAlunoTurmaResponse {
  alunoId: string;
  matriculaOrigemId: string;
  matriculaDestinoId: string;
  statusOrigem: 'TRANSFERIDO';
  statusDestino: 'ATIVO';
  remanejadoEm: string;
  sucesso: boolean;
}

// PATCH /api/v1/usuarios/:usuarioId/status
export interface AlterarStatusContaRequest {
  status: 'ATIVO' | 'INATIVO';
  motivo?: string;
}

export interface AlterarStatusContaResponse {
  usuarioId: string;
  novoStatus: 'ATIVO' | 'INATIVO';
  tokensRevogados: boolean;
  atualizadoEm: string;
  sucesso: boolean;
}

// DELETE /api/v1/usuarios/:usuarioId
export interface ExcluirUsuarioSoftDeleteResponse {
  usuarioId: string;
  deletedAt: string; // ISO 8601
  statusPreservado: 'EXCLUIDO_LOGICO';
  mensagem: string; // "Conta excluída logicamente; histórico de notas e telemetria preservados integralmente para fins de auditoria."
  sucesso: boolean;
}

// POST /api/v1/turmas/:turmaId/avisos
export interface CriarAvisoTurmaRequest {
  titulo: string;
  conteudoMarkdown: string;
  publicoAlvo: 'TODOS_MATRICULADOS' | 'DISCENTES_SELECIONADOS';
  discentesAlvoIds?: string[]; // UUIDs dos discentes selecionados via multiselect
  publicarEm?: string; // ISO 8601 (se nulo, publica imediatamente)
  requerConfirmacao: boolean;
}

export interface CriarAvisoTurmaResponse {
  avisoId: string;
  status: 'PUBLICADO' | 'AGENDADO';
  publicadoEm?: string;
  sucesso: boolean;
}

// POST /api/v1/turmas/:turmaId/avisos/:avisoId/confirmar-leitura
export interface ConfirmarLeituraAvisoResponse {
  avisoId: string;
  alunoId: string;
  confirmadoEm: string;
  sucesso: boolean;
}

// GET /api/v1/turmas/:turmaId/avisos/:avisoId/metricas-leitura
export interface MetricasLeituraAvisoResponse {
  avisoId: string;
  totalElegiveis: number;
  totalConfirmados: number;
  percentualAdesao: number; // ex: 85.5%
  confirmados: Array<{
    alunoId: string;
    ra: string;
    nome: string;
    confirmadoEm: string;
  }>;
  pendentes: Array<{
    alunoId: string;
    ra: string;
    nome: string;
  }>;
}
```

### 4.3 Desbloqueio e Início de Avaliação
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
    envelopeCifradoOffline: {
      nonceSessao: string;
      hashesCriterios: Array<{
        caminhoAlvoHmac: string;
        tipoNo: 'ARQUIVO' | 'DIRETORIO' | 'LINK';
        permissoesOctalHmac: string;
        conteudoSha256?: string;
        uidGidHmac?: string;
      }>;
      assinaturaServidor: string; // HMAC gerado com chave secreta efêmera do servidor
    };
  }>;
}
```

### 4.4 Submissão Segura e Telemetria
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

### 4.5 Trilha Forense, Observações e Revisão Manual de Notas

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

// POST /api/v1/avaliacoes/:avaliacaoId/sessoes/:sessaoId/reabrir
export interface ReabrirSessaoRequest {
  justificativa: string; // Obrigatório: motivação do cancelamento da suspensão / equívoco operacional
}

export interface ReabrirSessaoResponse {
  sessaoId: string;
  status: 'EM_ANDAMENTO';
  deltaSegundosCompensados: number;
  novaDataLimiteEntrega: string; // ISO 8601 recalculada com acréscimo de Delta T
  reabertoEm: string;
  sucesso: boolean;
}

// POST /api/v1/avaliacoes/:avaliacaoId/sessoes/:sessaoId/reconciliar-offline
export interface ReconciliarOfflineRequest {
  pacoteProofJson: {
    sessaoId: string;
    alunoId: string;
    ra: string;
    geradoEm: string;
    telemetriaIndexedDb: Array<{
      timestamp: number;
      questaoId: string;
      comando: string;
      exitCode: number;
      snapshotDiff: VfsSnapshotData;
    }>;
    vfsFinalSnapshot: VfsSnapshotData;
    checksumIntegridade: string;
  };
}

export interface ReconciliarOfflineResponse {
  sessaoId: string;
  status: 'FINALIZADO';
  questoesAprovadasTotal: number;
  questoesTotal: number;
  notaFinalCalculada: number;
  discrepanciasDetectadas: Array<{
    questaoId: string;
    motivo: string;
  }>;
  reconciliadoEm: string;
  sucesso: boolean;
}
```

---

## 5. Protocolo de Validação Híbrida e Contingência Offline por Asserções Cifradas

### 5.1 O Problema da Dependência Estrita de Conectividade de Rede
A orquestração exclusiva via WebSocket apresenta vulnerabilidade em ambientes acadêmicos com oscilações de link. Sem uma rota de contingência, quedas momentâneas de sinal de rede no laboratório congelariam o avanço das tarefas, interrompendo o raciocínio do discente e desperdiçando tempo letivo.

### 5.2 Envelope Criptografado de Asserções Locais (Zero-Knowledge Validation)
Para permitir que o terminal valide o cumprimento de tarefas localmente sem revelar respostas via DevTools (F12):
1. **Hashes Criptográficos Unidirecionais:** Na carga inicial da prova, o servidor transmite critérios de validação estruturados sob hashes HMAC-SHA256 (caminhos de nós, máscaras de permissão octal, nós esperados e hash SHA-256 de conteúdos normalizados);
2. **Impossibilidade de Engenharia Reversa:** Inspecionar os testes em memória ou no código JavaScript expõe apenas cadeias criptográficas não reversíveis. O discente é incapaz de deduzir a resposta correta por inspeção de código ou forjar o estado interno do avaliador.

### 5.3 Comutação Automática Online/Offline (Graceful Degradation)
1. **Regime Conectado:** O cliente emite eventos de quebra de linha (`Enter`) via WebSocket e recebe o retorno instantâneo do validador em retaguarda;
2. **Regime Desconectado:** Ao detectar interrupção do socket, o cliente comuta transparentemente para o motor local alimentado pelos hashes cifrados. A interface confirma o acerto, avança no roteiro de tarefas e persiste todos os comandos, carimbos de tempo e snapshots no **IndexedDB** local do navegador.

### 5.4 Reconciliação Soberana no Servidor Go (Replay Canônico & Auditoria)
A nota definitiva permanece sob custódia soberana do servidor:
1. **Replay Determinístico:** Ao restabelecer a conexão ou mediante envio do arquivo `.proof`, o servidor em Go reconstitui sequencialmente o VFS a partir do log de comandos armazenado no IndexedDB;
2. **Auditoria de Integridade:** O servidor executa a suíte canônica de testes de aceitação e compara os resultados oficiais com os eventos offline. Qualquer discrepância matemática ou temporal é anotada na Timeline Forense como violação de integridade.

### 5.5 Especificação do Pacote de Contingência Física (`.proof`)
Em situações de pane prolongada de conectividade:
- O estudante finaliza a prova e o cliente exporta um arquivo assinado `avaliacao_<ra>_<sessaoId>.proof`;
- O discente entrega o arquivo em pendrive institucional para a professora;
- A docente importa o pacote via interface do Cockpit docente, acionando o endpoint `/reconciliar-offline` para ingestão e correção soberana.

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

#### 4. Reabertura de Sessão e Compensação Temporal Dinâmica (`session:reopened`)
Quando a professora reverte um encerramento acidental, o servidor calcula $\Delta t = t_{\text{reabertura}} - t_{\text{bloqueio}}$, ajusta a data limite e notifica o terminal do estudante via WebSocket:

```typescript
// Evento emitido pelo servidor diretamente ao terminal do aluno: 'session:reopened'
export interface SessionReopenedPayload {
  sessaoId: string;
  novaDataLimiteEntrega: string; // ISO 8601 recalculada com Delta T somado
  deltaSegundosCompensados: number; // Quantidade de segundos acrescidos
  vfsSnapshotRestaurado: VfsSnapshotData; // Último snapshot válido antes do bloqueio
  docenteNome: string;
  justificativa: string;
  reabertoEm: string;
}
```

---

## 7. Arquitetura de Fila Assíncrona e Worker Pool em Go (E-mails Transacionais)

Na ingestão em lote de turmas a partir de planilhas CSV institucionais com 40 a 60 alunos por turma (ou centenas em múltiplas turmas), o processamento síncrono de notificações de correio eletrônico via SMTP/TLS dentro do ciclo da requisição HTTP causaria bloqueios de rede, esgotamento de conexões e *HTTP 504 Gateway Timeout*.

Para mitigar esse problema com alta escalabilidade, o back-end em Go adota o padrão **Producer-Consumer** com **Buffered Channels** e **Worker Pool**:

```
[ Gin HTTP Handler: /importar-csv ]
             │ (Valida CSV & Transação ACID no PostgreSQL)
             ▼
[ Buffer de Mensagens: chan EmailJob ]  (Capacidade: 1000 jobs)
             │
      ┌──────┼────────────────────────┐
      ▼      ▼                        ▼
 [ Worker 1 ] [ Worker 2 ] ... [ Worker N ] (Goroutines em Background)
      │      │                        │
      └──────┴──────┬─────────────────┘
                    ▼ (Rate Limiter: time.Ticker - ex: 5 msgs/seg)
           [ Servidor SMTP Institucional ]
                    │
                    ▼
      [ Discente: E-mail com Token de Ativação Único ]
```

### 7.1 Modelagem das Estruturas de Trabalho em Go

```go
package mailer

import (
	"time"
	"github.com/google/uuid"
)

// EmailJob define a carga de trabalho enfileirada no canal buffereado
type EmailJob struct {
	ID                 uuid.UUID `json:"id"`
	TurmaID            uuid.UUID `json:"turma_id"`
	InscricaoID        uuid.UUID `json:"inscricao_id"`
	NomeDestinatario   string    `json:"nome_destinatario"`
	EmailDestinatario  string    `json:"email_destinatario"`
	RADestinatario     string    `json:"ra_destinatario"`
	DisciplinaCodigo   string    `json:"disciplina_codigo"`
	DisciplinaNome     string    `json:"disciplina_nome"`
	DocenteNome        string    `json:"docente_nome"`
	TokenAtivacaoPlano string    `json:"token_ativacao_plano"`
	ExpiraEm           time.Time `json:"expira_em"`
	TentativasAtuais   int       `json:"tentativas_atuais"`
	MaxTentativas      int       `json:"max_tentativas"`
}

// MailerPool gerencia o conjunto de goroutines operárias
type MailerPool struct {
	jobQueue    chan EmailJob
	workerCount int
	rateLimiter *time.Ticker
	smtpConfig  SMTPConfig
}

type SMTPConfig struct {
	Host     string
	Port     int
	User     string
	Password string
	From     string
}
```

### 7.2 Ciclo de Vida do Despacho Assíncrono

1. **Enfileiramento Não-Bloqueante (Produtor):** O handler Gin valida os registros do CSV, efetua inserções atômicas no PostgreSQL e despeja os jobs no canal `jobQueue <- job`. A rota HTTP devolve imediatamente o status `202 Accepted` em menos de 50ms;
2. **Consumo Concorrente e Rate Limiting (Consumidor):** Cada worker do pool aguarda o disparo do `rateLimiter.C` antes de tentar a conexão SMTP, evitando saturação do servidor da UTFPR ou acionamento de filtros antispam corporativos;
3. **Template HTML Estilizado:** O e-mail renderiza um template HTML responsivo com tipografia moderna, logotipo institucional, resumo da disciplina e o botão de ação "Ativar Conta e Acessar Turma" contendo o token efêmero assinado;
4. **Tratamento de Falhas com Backoff Exponencial:** Caso o envio falhe (ex.: erro de rede SMTP temporário), o job é reenfileirado com atraso calculado ($2^{\text{tentativa}} \times t_{\text{base}}$) até o limite configurado (`max_tentativas = 5`). Se esgotadas as tentativas, o status é registrado como `FALHA_ENTREGA` na base de dados para reenvio manual pelo docente.

---

## 8. Serviços de Persistência GORM e Transações do Ciclo de Vida Discente

Para assegurar a integridade referencial e o cumprimento estrito das três dimensões de governança discente (remanejamento de turno/turma, inativação cautelar e soft delete forense), a camada de repositório em Go implementa padrões de transação atômica ACID e controle de escopo do GORM:

### 8.1 Transação Atômica de Remanejamento entre Turmas

A troca de turma (ex.: matutino para noturno) não remove o registro anterior nem duplica o discente. A operação preserva a imutabilidade do histórico acadêmico:

```go
func (s *TurmaService) RemanejarAluno(ctx context.Context, alunoID, origemTurmaID, destinoTurmaID uuid.UUID, motivo string) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		// 1. Localiza a matrícula ativa na turma de origem
		var matriculaOrigem MatriculaTurma
		if err := tx.Where("turma_id = ? AND aluno_id = ? AND status = ?", origemTurmaID, alunoID, "ATIVO").
			First(&matriculaOrigem).Error; err != nil {
			return fmt.Errorf("matrícula ativa não encontrada na turma de origem: %w", err)
		}

		// 2. Marca a matrícula de origem como TRANSFERIDO, resguardando histórico de notas
		agora := time.Now()
		if err := tx.Model(&matriculaOrigem).Updates(map[string]interface{}{
			"status":               "TRANSFERIDO",
			"transferido_em":       agora,
			"motivo_transferencia": motivo,
		}).Error; err != nil {
			return fmt.Errorf("falha ao atualizar status da matrícula de origem: %w", err)
		}

		// 3. Cria a nova matrícula na turma de destino apontando a origem
		matriculaDestino := MatriculaTurma{
			ID:                         uuid.New(),
			TurmaID:                    destinoTurmaID,
			AlunoID:                    &alunoID,
			Status:                     "ATIVO",
			OrigemIngresso:             "TRANSFERENCIA_TURMA",
			TurmaOrigemTransferenciaID: &origemTurmaID,
			SolicitadoEm:               agora,
			DeliberadoEm:               &agora,
			Ativo:                      true,
		}
		if err := tx.Create(&matriculaDestino).Error; err != nil {
			return fmt.Errorf("falha ao criar nova matrícula na turma de destino: %w", err)
		}

		return nil
	})
}
```

### 8.2 Inativação Cautelar e Derrubada de Sessão Ativa

Ao suspender uma conta, a persistência no banco é combinada com um comando de encerramento compulsório via WebSocket:

```go
func (s *UsuarioService) InativarConta(ctx context.Context, usuarioID uuid.UUID, motivo string) error {
	if err := s.db.Model(&Usuario{}).Where("id = ?", usuarioID).
		Update("status_conta", "INATIVO").Error; err != nil {
		return err
	}

	// Notifica o Hub de WebSockets para fechar conexões ativas imediatamente
	s.wsHub.ForcedDisconnect(usuarioID, "CONTA_SUSPENSA_ADMINISTRATIVAMENTE")
	return nil
}
```

### 8.3 Exclusão Lógica e Consulta Forense via Unscoped

Para desligamento de curso, o registro é excluído logicamente (`db.Delete`), mas permanece integralmente consultável para a coordenação acadêmica:

```go
// Exclusão Lógica (Soft Delete padrão GORM)
func (s *UsuarioService) ExcluirConta(ctx context.Context, usuarioID uuid.UUID) error {
	return s.db.Delete(&Usuario{}, "id = ?", usuarioID).Error
}

// Consulta de Auditoria Forense e Histórico Acadêmico (Preserva todos os registros)
func (s *UsuarioService) ObterDossieForenseCompleto(ctx context.Context, ra string) (*Usuario, error) {
	var usuario Usuario
	err := s.db.Unscoped().
		Preload("Matriculas.Turma").
		Preload("SessoesAvaliacao.Submissoes").
		Preload("SessoesAvaliacao.EventosTimeline").
		Where("ra = ?", ra).
		First(&usuario).Error
	return &usuario, err
}
```




