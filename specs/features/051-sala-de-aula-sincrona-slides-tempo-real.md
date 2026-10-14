# SPEC-051: Sala de Aula Síncrona, Apresentador de Slides e Espelhamento em Tempo Real

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-051 |
| **Status** | Rascunho |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (segunda versão do autor aplicada; pendências P-N01 a P-N06 resolvidas; novas pendências P-O1 a P-O5) |
| **Autor** | Autoria externa, trazida pelo Tech Lead (texto das seções 1 a 9); formato, revisão e pendências por Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classroom` (novo módulo de domínio no backend) e `frontend/src/components/Classroom/` |
| **Contexto de tela** | `/app/classes/:classId/live` (visão da sala ao vivo para docente e discentes) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-004 (infraestrutura local com MinIO), SPEC-009, SPEC-041 e SPEC-049 (turmas, matrícula e auditoria), SPEC-014, SPEC-016 e SPEC-020 (prática, tela de estudo e terminal), SPEC-042 (agenda da turma) |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Spec trazida pelo Tech Lead em 14/10/2026 (arquivo `14-10-26-spec-sala-de-aula-sincrona-slides-tempo-real.md`), em duas versões; não cita documento de `docs/arquitetura/` nem capítulo da monografia |

> **Estado:** Rascunho. Pela regra do repositório (`AI_INSTRUCTIONS.md`, seção 4), só se implementa depois de a seção 10 ficar vazia e de o Tech Lead aprovar. A segunda versão do autor resolveu as seis pendências da rodada anterior; a leitura dela contra o código e a `ARCHITECTURE.md` levantou as cinco da seção 10, sendo a P-O1 a que mais pesa.

---

## 1. Contexto e Problema (Context & Problem Statement)

Atualmente, o ecossistema dispõe de gestão acadêmica de turmas, agenda letiva e catálogo de módulos instrucionais com terminal virtual individualizado. No entanto, durante o momento síncrono da aula, não existe um ambiente integrado de condução pedagógica. O docente depende de ferramentas externas para expor apresentações visuais e demonstrar comandos, gerando dispersão de foco e perda de contexto instrucional.

A ausência de uma sala síncrona na plataforma impede que o docente compartilhe seus slides de aula com controle centralizado de navegação e que alterne de maneira imediata para o módulo de ensino da turma com espelhamento determinístico de comandos e do cursor do mouse. Sem esse mecanismo, os acadêmicos não conseguem acompanhar em tempo real as explicações práticas no terminal e ficam privados de canais interativos organizados de manifestação de dúvidas (como fila de mãos levantadas e caderno síncrono de anotações). Transmissões pesadas de vídeo e áudio contínuas sobrecarregam a largura de banda e excluem discentes em redes oscilantes, tornando indispensável uma solução síncrona orientada a dados e estados leves no navegador.

---

## 2. Objetivos (Goals)

* Permitir que o docente proprietário da turma (ou administrador) inicialize e encerre sessões síncronas de aula a qualquer momento do dia a partir da página da turma, com vínculo relacional opcional à aula agendada da turma.
* Disponibilizar upload e armazenamento de apresentações em PDF no MinIO, consumidas pelo navegador via URLs pré-assinadas renováveis e renderizadas localmente página a página.
* Sincronizar em tempo real via canal WebSocket o estado da apresentação para todos os discentes conectados à sala: índice da lâmina ativa, ponteiro virtual/cursor do docente e anotações visuais sobre o slide.
* Permitir a alternância fluida entre o modo de lâminas e o modo de módulo de ensino, espelhando fielmente para os estudantes o estado serializado da máquina virtual emitido após a execução de comandos da professora, em modo de leitura estrita com teclado travado.
* Implementar fila ordenada cronológica de pedidos de fala (mãos levantadas) para discentes, permitindo moderação direta pela docente.
* Prover caderno individual de anotações privativas do estudante durante a sessão, persistido continuamente e consultável após a aula.
* Garantir reconexão resiliente com entrega de pacote de estado consolidado a participantes que ingressarem com a sessão em andamento, desconectando conexões obsoletas e encerrando salas inativas.

### 2.1. Fora de escopo (Non-Goals)

* Áudio e vídeo.
* Frequência (presença/chamada) e o estado "aula realizada" da agenda: o vínculo com a aula agendada é só relacional (CA-01).
* Conversão de páginas do PDF no servidor: as lâminas são renderizadas no navegador.
* Broker de mensagens externo (NATS ou outro).

---

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

A experiência síncrona organiza-se sob a rota dedicada `/app/classes/:classId/live`, desenhada para visualização imersiva:

* **Casca da Sala Síncrona (`LiveClassroom`):**
  * Gerencia a área central de projeção, a barra superior de status e as gavetas laterais de interação.
  * Exibe indicador de sessão ativa (com cronômetro síncrono), seletor de modo ("Lâminas" e "Módulo de Ensino"), indicador de discentes conectados, botão de alternância do caderno de anotações e botão de ação ("Encerrar Aula" para docente; "Sair da Sala" para discente).
  * Painel lateral retrátil com a fila de dúvidas ("Mãos Levantadas") e o bloco de anotações do acadêmico.
  * Trata o papel do usuário: o docente tem controles de apresentação, desenho e moderação; o discente tem visualização passiva e ações de participação.
* **Projetor de Lâminas (`SlidePresenter`):**
  * Renderiza o PDF página a página com a biblioteca local `pdfjs-dist` (instalada nas dependências do projeto, sem CDN externa), desenhando a página ativa em um elemento de tela.
  * Camada de sobreposição (*canvas overlay*) captura o movimento do mouse do docente (com estrangulamento a cada 50 ms) e os traços de anotação, emitindo coordenadas normalizadas em percentual de 0 a 100.
  * Para discentes: palco em modo receptor estrito, escutando o WebSocket e atualizando a lâmina, o ponteiro do docente (animação suave por transição CSS) e os traços, sem permitir interferência.
  * Controles do docente: avançar, retroceder, ir para a lâmina N, laser, caneta e limpar traços. Atalhos de teclado (setas e barra de espaço) exclusivos do docente.
* **Espelhamento de Módulo e Terminal (`MirroredModuleView`):**
  * Renderiza a estrutura da tela de estudo do módulo (`TopicStudy`).
  * Na visão do docente, o terminal opera de forma interativa normal. A cada comando concluído, o estado serializado da máquina virtual emitido pelo motor é enviado pelo WebSocket.
  * Na visão do estudante, o terminal é montado com a janela bloqueada contra foco e digitação, recebendo o estado serializado do docente e atualizando o visor localmente (ver P-O1).
* **Fila de Dúvidas e Caderno de Anotações (`LiveInteractionDrawer`):**
  * Botão discente "Levantar a mão", que emite o evento para a sala. Lista ordenada cronologicamente (FIFO) ao docente, com ações para abaixar a mão individual ou coletivamente.
  * Bloco de anotações privativas do estudante: editor de texto plano que salva sozinho (debounce) pela API REST.
* **Gerenciamento de Estado e Rede (`useLiveClassroom`):**
  * Conexão WebSocket com o Hub do backend, reconexão automática e recepção do pacote inicial consolidado de estado ao conectar.
  * Se o docente abre a sala em uma segunda aba, a conexão mais nova assume o controle mestre e a aba anterior entra em modo passivo.
  * Renovação automática da URL assinada do PDF antes de ela vencer.
  * Estilização por SCSS Modules e tokens semânticos de `_tokens.scss` sob o tema único escuro, com alvos de toque de no mínimo 44 px.

### 3.2. Backend (Go — Camada de Módulo/Service)

O módulo `classroom` estrutura-se sob Clean Architecture e DDD-lite:

* **Camada de Domínio (`domain`):**
  * Entidades da sala ao vivo (`LiveClassroomSession`), das apresentações enviadas (`SlideDeck`), dos itens da fila de dúvidas (`LiveHandRaise`) e das anotações dos discentes (`LiveClassroomNote`).
  * Constantes de status da sala (`ACTIVE`, `FINISHED`), modos de exibição (`SLIDES`, `MODULE`), status de intervenção (`PENDING`, `ANSWERED`, `LOWERED`) e limites de tolerância temporal.
* **Camada de Serviço (`service`):**
  * `StartSession`: valida que o solicitante é o docente dono da turma ou administrador e recusa turma arquivada; localiza a sessão ativa preexistente ou cria uma nova, ligando opcionalmente a aula agendada informada.
  * `EndSession`: encerra a sala, grava o horário de término, desliga a permissão de transmissão e manda o Hub desconectar os clientes.
  * `UploadSlideDeck`: valida o tamanho (máximo de 25 MB), o formato do arquivo e a contagem de lâminas informada (de 1 a 100), verifica o limite de **20 apresentações por turma**, grava o arquivo no MinIO sob prefixo exclusivo da turma e persiste o registro. Emite URLs pré-assinadas com validade de **15 minutos**.
  * `GetActiveSession`: devolve o estado consolidado da sala para a sincronização de novos participantes e reconexões (modo ativo, lâmina corrente, traços recentes e módulo ativo).
  * `SaveStudentNote` e `GetStudentNote`: gravam e leem o texto privativo do discente matriculado na turma da sessão.
  * Concorrência do docente: ao detectar nova conexão autenticada do docente dono da sala, a anterior é avisada e a mais recente assume o controle de transmissão.
  * Encerramento por inatividade: se o docente perde a conexão WebSocket e não reconecta em **15 minutos**, o serviço encerra a sala.
* **Camada de Transporte e WebSocket (`handler`):**
  * Handlers REST em Gin para o ciclo de vida da sala, o envio de arquivos e as anotações, com erros no padrão RFC 7807 pelo pacote `platform/problem`.
  * Handler de WebSocket sobre o **Hub próprio em memória**, em `backend/internal/platform/hub/` (infraestrutura transversal, `ARCHITECTURE.md` 3.2), com rotinas de leitura e escrita separadas por conexão e autenticação pelo cookie de sessão.
  * Validação estrita de papéis: descarta, com registro de auditoria, qualquer envio de comando de apresentação, traço ou terminal que não venha do docente dono ou do administrador.

---

## 4. Modelo de Dados (Data Model)

Todas as entidades pertencem ao schema `linux_lab` do PostgreSQL e usam UUIDv7 como chave primária, auditoria com data de criação e atualização e exclusão lógica:

* **Tabela `live_classroom_sessions`:**
  * `id` (UUIDv7, PK); `class_id` (FK `classes`); `teacher_id` (FK `users`).
  * `class_session_id` (FK anulável `class_sessions`): vínculo relacional estrito, sem inferência de presença ou chamada nesta fase.
  * `deck_id` (FK anulável `slide_decks`); `active_module_id` (FK anulável `course_modules`).
  * `title` (texto, obrigatório, de 1 a 120 caracteres); `display_mode` (`SLIDES` ou `MODULE`); `current_slide` (inteiro, padrão 1); `status` (`ACTIVE` ou `FINISHED`).
  * `started_at` (obrigatório); `ended_at` (anulável); `created_at`, `updated_at`, `deleted_at`.
  * Índices: composto sobre `(class_id, status)` onde `deleted_at` é nulo (ver P-O4 sobre a unicidade da sala ativa).
* **Tabela `slide_decks`:**
  * `id`; `class_id` (FK `classes`); `uploaded_by` (FK `users`); `title` (de 1 a 120 caracteres); `object_key` (caminho relativo do PDF no bucket); `page_count` (de 1 a 100); `created_at`, `updated_at`, `deleted_at`.
  * Índice em `(class_id)` onde `deleted_at` é nulo.
* **Tabela `live_hand_raises`:**
  * `id`; `session_id` (FK `live_classroom_sessions`); `student_id` (FK `users`); `status` (`PENDING`, `ANSWERED`, `LOWERED`); `requested_at` (obrigatório); `resolved_at` (anulável); `created_at`, `updated_at`, `deleted_at`.
  * Índice composto em `(session_id, status, requested_at)`.
* **Tabela `live_classroom_notes`:**
  * `id`; `session_id` (FK `live_classroom_sessions`); `student_id` (FK `users`); `content` (obrigatório, até 20.000 caracteres); `created_at`, `updated_at`, `deleted_at`.
  * Índice único composto em `(session_id, student_id)` onde `deleted_at` é nulo.

---

## 5. Contrato de API (API Contract)

### 5.1. Inicialização de sala ao vivo

`POST /api/v1/classes/:id/live/start`

* **Papéis autorizados:** `TEACHER` (dono da turma) e `ADMIN`.
* **Entrada:** `title` (obrigatório, 1 a 120 caracteres); `classSessionId` (opcional, aula agendada da turma); `deckId` (opcional); `initialModuleId` (opcional).
* **Resposta (201 Created, ou 200 OK se já havia sala):** `id`, `classId`, `title`, `classSessionId`, `status` (`ACTIVE`), `displayMode`, `currentSlide` e `startedAt`.
* **Erros (RFC 7807):** 400 `validation-error` (título ausente ou inválido); 403 `forbidden`; 404 `class-not-found`; 409 `class-archived`.

### 5.2. Encerramento de sala ao vivo

`POST /api/v1/classes/:id/live/sessions/:sessionId/end`

* **Papéis autorizados:** `TEACHER` (dono) e `ADMIN`. Sem corpo.
* **Resposta (200 OK):** `id`, `status` (`FINISHED`) e `endedAt`.
* **Erros:** 403 `forbidden`; 404 `session-not-found` (inexistente ou de outra turma).

### 5.3. Upload de apresentação

`POST /api/v1/classes/:id/live/decks`

* **Papéis autorizados:** `TEACHER` (dono) e `ADMIN`.
* **Entrada (multipart):** `file` (PDF, até 25 MB); `title` (de 1 a 120 caracteres); `pageCount` (inteiro de 1 a 100, **informado pelo navegador**, que lê o PDF antes de enviar).
* **Resposta (201 Created):** `id`, `title`, `pageCount`, `downloadUrl` (assinada, 15 minutos) e `createdAt`.
* **Erros:** 400 `invalid-pdf` (o arquivo não começa com o cabeçalho de PDF, ou `pageCount` fora de 1 a 100; a leitura do arquivo corrompido ou protegido por senha é feita no navegador, antes do envio); 403 `forbidden`; 409 `deck-limit-exceeded` (20 apresentações); 413 `file-too-large`.

### 5.4. Sala ativa e instantâneo inicial

`GET /api/v1/classes/:id/live/active`

* **Papéis autorizados:** `TEACHER`, `ADMIN` e `STUDENT` com matrícula `ACTIVE`.
* **Resposta (200 OK):** com sala em curso: `session`, `displayMode`, `currentSlide`, `activeModuleId`, `activeDeck` (com `downloadUrl` assinada renovada, 15 minutos), `recentDrawings` e `onlineCount`; sem sala: `hasActiveSession: false`.
* **Erros:** 401 `not-authenticated`; 403 `forbidden` (estudante sem vínculo ativo ou alheio à turma); 404 `class-not-found`.

### 5.5. Gravação das anotações do estudante

`PUT /api/v1/classes/:id/live/sessions/:sessionId/notes`

* **Papéis autorizados:** `STUDENT` com matrícula `ACTIVE`.
* **Entrada:** `content` (obrigatório, até 20.000 caracteres).
* **Resposta (200 OK):** `sessionId`, `savedLength` e `updatedAt`.
* **Erros:** 400 `content-too-long`; 403 `forbidden`.

### 5.6. Consulta das anotações depois da aula

`GET /api/v1/classes/:id/live/sessions/:sessionId/notes`

* **Papéis autorizados:** `STUDENT` (autor das anotações).
* **Resposta (200 OK):** `sessionId`, `content` e `updatedAt`.
* **Erros:** 403 `forbidden`; 404 `notes-not-found` (nenhuma anotação do estudante na sessão).

### 5.7. Protocolo de tempo real (WebSocket)

`GET /api/v1/classes/:id/live/ws`

* **Papéis autorizados:** `TEACHER`, `ADMIN` e `STUDENT` com matrícula `ACTIVE`. Conexão por upgrade HTTP, sobre o Hub próprio em memória.
* **Mensagens só do docente (para a sala):** `live:slide:change` (índice da lâmina); `live:cursor:move` (X e Y em percentual); `live:canvas:draw` (traçado ou limpeza); `live:mode:switch` (`SLIDES` ou `MODULE` e o módulo didático); `live:terminal:sync` (estado serializado da máquina após cada comando); `live:hand:moderate` (estudante atendido ou baixa geral).
* **Mensagens dos estudantes:** `live:hand:raise` e `live:hand:lower`.
* **Mensagens do servidor:** ver P-O3.

---

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| :--- | :--- |
| Sobrecarga no Hub por movimento contínuo de cursor | Estrangulamento no cliente a no máximo 20 eventos por segundo (50 ms), com interpolação visual suave por CSS no receptor (ver P-O5 sobre o limite no servidor). |
| Injeção de comandos de controle ou digitação por discentes | O Hub valida o papel da conexão e descarta mensagens de controle ou de terminal que não venham do docente ou do administrador. O visor do terminal do estudante fica estritamente passivo. |
| Queda da conexão do docente durante a apresentação | A sala fica em espera por até 15 minutos; a reconexão restaura o estado canônico do banco e do Hub. Esgotado o prazo, a sala é encerrada. |
| Docente conectado em várias abas, disputando o controle | A conexão mais recente assume o controle mestre e as anteriores são avisadas e passam a modo passivo. |
| Expiração das URLs de slides em aulas longas | URLs assinadas com validade de 15 minutos; o frontend pede a renovação antes do vencimento. |
| Envio descontrolado de arquivos | No máximo 20 apresentações por turma e 25 MB por PDF. |

---

## 7. Critérios de Aceite (Acceptance Criteria)

* [ ] **CA-01** (evento): QUANDO o docente dono da turma acionar o comando de iniciar a sala, O SISTEMA DEVE criar ou recuperar a sessão com status `ACTIVE` no schema `linux_lab`, ligando opcionalmente a aula agendada sem interferir em registros de frequência.
* [ ] **CA-02** (indesejado): SE um discente ou docente de outra turma tentar iniciar ou encerrar a sala, ENTÃO O SISTEMA DEVE responder 403 `forbidden` (RFC 7807).
* [ ] **CA-03** (evento): QUANDO o docente enviar um PDF de até 25 MB e até 100 páginas, O SISTEMA DEVE gravar o arquivo no MinIO, registrar o `slide_decks` e devolver a URL assinada com validade de 15 minutos.
* [ ] **CA-04** (indesejado): SE a turma já tiver 20 apresentações, ENTÃO O SISTEMA DEVE recusar o envio com 409 `deck-limit-exceeded`.
* [ ] **CA-05** (evento): QUANDO o docente alterar a lâmina ativa, O SISTEMA DEVE transmitir o índice pelo WebSocket e atualizar as telas de todos os estudantes conectados.
* [ ] **CA-06** (evento): QUANDO o docente movimentar o mouse sobre a lâmina, O SISTEMA DEVE transmitir as coordenadas percentuais com estrangulamento de 50 ms e mostrar o ponteiro virtual com suavidade para a turma.
* [ ] **CA-07** (evento): QUANDO o docente alternar para o modo "Módulo de Ensino", O SISTEMA DEVE comutar a visualização da turma e, a cada comando executado, transmitir o estado serializado da máquina virtual, mantendo o terminal dos estudantes bloqueado contra digitação.
* [ ] **CA-08** (evento): QUANDO um estudante levantar a mão, O SISTEMA DEVE colocá-lo na fila por ordem cronológica (FIFO) e exibi-lo no painel de moderação do docente.
* [ ] **CA-09** (evento): QUANDO o docente baixar a mão de um estudante ou limpar a fila, O SISTEMA DEVE atualizar o status do pedido e sincronizar a visão de todos os participantes.
* [ ] **CA-10** (evento): QUANDO um estudante digitar anotações no seu caderno, O SISTEMA DEVE gravar o conteúdo pela API REST, ligado à sessão e ao estudante, permitindo a leitura posterior pelo próprio autor.
* [ ] **CA-11** (estado): ENQUANTO o docente conectar em uma nova aba, O SISTEMA DEVE dar o controle mestre à conexão mais recente e passar a anterior a modo passivo.
* [ ] **CA-12** (evento): QUANDO o docente encerrar a aula, O SISTEMA DEVE gravar o término da sessão, avisar a sala e fechar as conexões WebSocket.
* [ ] **CA-13** (ubíquo): A interface da sala DEVE operar só no tema único escuro, com tokens semânticos de `_tokens.scss` e alvos de toque de no mínimo 44 px.
* [ ] **CA-14** (evento): QUANDO um participante conecta ou reconecta com a sala em andamento, O SISTEMA DEVE entregar o estado consolidado (modo, lâmina, traços recentes e módulo ativo) antes de qualquer outra mensagem. *(Acrescentado na revisão: o objetivo de reconexão da seção 2 não tinha critério.)*
* [ ] **CA-15** (evento): QUANDO o docente fica 15 minutos sem conexão WebSocket, O SISTEMA DEVE encerrar a sala e avisar os estudantes. *(Acrescentado: o teste `TestDocentInactivityTimeout` não tinha critério.)*
* [ ] **CA-16** (indesejado): SE a turma está arquivada, ENTÃO O SISTEMA DEVE recusar o início da sala com 409 `class-archived`. *(Acrescentado: o teste `TestStartSession_ArchivedClass` não tinha critério.)*

---

## 8. Plano de Testes (Test Plan)

Escritos antes da implementação e rodados vermelhos primeiro (SPEC-038).

### Backend (`classroom`)

* **`domain`:** invariantes de status (`ACTIVE`, `FINISHED`) e modos (`SLIDES`, `MODULE`); limites do título da sessão, do nome da apresentação e das páginas do PDF. Cobre CA-03.
* **`service`:**
  * `TestStartSession_OwnerAndAdminAllowed`: início autorizado e recuperação da sessão aberta (CA-01).
  * `TestStartSession_RejectsNonOwner`: recusa a docente de outra turma e a estudante (CA-02).
  * `TestStartSession_ArchivedClass`: recusa em turma arquivada, 409 (CA-16).
  * `TestUploadDeck_SuccessAndMaxLimit`: envio bem-sucedido e bloqueio no vigésimo primeiro (CA-03, CA-04).
  * `TestEndSession_UpdatesTimestampAndClosesRoom`: encerramento com término e desligamento da transmissão (CA-12).
  * `TestStudentNotes_SaveAndRetrieve`: isolamento das anotações entre estudantes e gravação correta (CA-10).
  * `TestDocentInactivityTimeout`: encerramento após 15 minutos sem o docente (CA-15).
  * `TestActiveSession_ReturnsSnapshot`: estado consolidado para quem entra ou reconecta (CA-14).
* **`handler` (`httptest`):**
  * Rotas REST com envelopes RFC 7807 e os status 200, 201, 400, 403, 404, 409 e 413 (CA-02 a CA-04, CA-10).
  * Hub com conexões simuladas de docente e estudantes: difusão de `live:slide:change` (CA-05), `live:cursor:move` (CA-06) e `live:terminal:sync` (CA-07); descarte de eventos de controle de estudante (CA-02); fila `live:hand:raise` em ordem FIFO e moderação (CA-08, CA-09); segunda conexão do docente assumindo o controle (CA-11); `live:ended` ao encerrar (CA-12).
* **`platform/hub`:** entrega e descarte por papel, leitura e escrita separadas por conexão, e substituição de conexão.

### Frontend (Vitest e Testing Library)

* `LiveClassroom.test.tsx`: casca com barra de ferramentas, encerramento do docente e saída do estudante (CA-12); tema único escuro e alvos de 44 px (CA-13).
* `SlidePresenter.test.tsx`: renderização de páginas com `pdfjs-dist`, atalhos de teclado do docente (CA-05) e captura do cursor com estrangulamento de 50 ms (CA-06).
* `MirroredModuleView.test.tsx`: visor do terminal bloqueado contra foco e teclado para estudantes, recebendo o estado serializado (CA-07).
* `LiveInteractionDrawer.test.tsx`: levantar a mão, alternância de estado e moderação FIFO do docente (CA-08, CA-09).
* `StudentNotesPanel.test.tsx`: edição e gravação com debounce (CA-10).
* `useLiveClassroom.test.ts`: reconexão com recebimento do estado inicial (CA-14), controle mestre em nova aba (CA-11) e renovação da URL assinada.
* `classroomService.test.ts`: chamadas REST tipadas.
* **Cobertura:** acima de 80% no escopo (`go test -cover` e Vitest em modo de cobertura).

### Teste manual

* Iniciar a aula como docente e carregar um PDF.
* Abrir a sala em abas de estudante e conferir a troca síncrona das lâminas e o apontamento do mouse.
* Alternar para o módulo, executar comandos e conferir o visor dos estudantes.
* Levantar a mão e moderar pela tela do docente.
* Digitar anotações como estudante e consultá-las depois do encerramento.

---

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/ARCHITECTURE.md` (monólito modular, Hub WebSocket em memória, schema `linux_lab`, tema único escuro); `specs/GLOSSARY.md`; SPEC-009, 014, 016, 020, 041, 042 e 049.
2. **Ordem de implementação:**
   * Termos novos no `specs/GLOSSARY.md`: **Sala ao vivo** (`LiveClassroomSession`), **Apresentação** (`SlideDeck`), **Lâmina** (`Slide`), **Mão levantada** (`LiveHandRaise`) e **Anotações da aula** (`LiveClassroomNote`).
   * Testes vermelhos de serviço, repositório e hub; commit `test(...)`.
   * Migração versionada `backend/migrations/00030_classroom.sql` com as quatro tabelas no schema `linux_lab`, com exclusão lógica.
   * Pacote `backend/internal/platform/hub/` (Hub em memória) e, em `backend/internal/modules/classroom/`, `domain`, `repository`, `service` e `handler`.
   * Rotas e injeção de dependências em `backend/cmd/api/main.go`.
   * Frontend: `pdfjs-dist` no `package.json`, `classroomService.ts`, `useLiveClassroom.ts`, testes vermelhos dos componentes, os componentes de `Classroom/*`, a página `app/classes/[id]/live/page.tsx` e as mensagens em `messages/pt-BR.ts`.
   * Testes automatizados com cobertura acima de 80%, ESLint e Stylelint limpos e status final `Implementada`.
3. **Arquivos a criar ou alterar:**
   * Backend: `backend/migrations/00030_classroom.sql`; `backend/internal/platform/hub/hub.go` e `hub_test.go`; `backend/internal/modules/classroom/domain/{session,deck,interaction,note}.go`; `.../repository/repository.go`; `.../service/service.go` e `service_test.go`; `.../handler/handler.go` e `handler_test.go`; `backend/cmd/api/main.go`.
   * Frontend: `frontend/package.json`; `frontend/src/services/classroomService.ts` e `classroomService.test.ts`; `frontend/src/hooks/useLiveClassroom.ts`; `frontend/src/components/Classroom/{LiveClassroom,SlidePresenter,MirroredModuleView,LiveInteractionDrawer,StudentNotesPanel}/` (componente, `.module.scss` e teste de cada um); `frontend/src/app/app/classes/[id]/live/page.tsx` e `page.module.scss`; `frontend/src/messages/pt-BR.ts`.
   * `specs/GLOSSARY.md`.

---

## 10. Pendências para aprovação

A segunda versão do autor resolveu P-N01 (só o vínculo, sem frequência), P-N02 (a conexão mais nova assume), P-N03 (`pdfjs-dist`), P-N04 (o navegador informa a contagem), P-N05 (URLs de 15 minutos e 20 apresentações) e P-N06 (estado serializado da máquina). Restam as abaixo.

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| P-O1 | **O estado serializado não leva o que está na tela.** P-N06 espelha o terminal enviando só o estado serializado da máquina (arquivos, usuários, processos). No código, o que o estudante vê (o prompt, o comando digitado e a saída impressa) fica na janela, e **não** faz parte desse estado: o `swapMachine` troca a máquina e **mantém a tela de quem o chama** (SPEC-030, CA-23). O estudante veria o estado mudar sem ver os comandos e as saídas do docente. Além disso, o docente digita direto na janela, e o gancho público `onCommand` entrega só o estado, sem o texto do comando. | O espelho precisa também do texto de cada comando e da saída. Duas saídas: **(a)** a spec autoriza uma alteração pequena e testada no adaptador `engine/terminalWindow.ts` (não no `engine/core`) para expor, a cada comando, a linha digitada e a saída; o espelho então imprime as duas e aplica o estado; ou **(b)** o docente passa a digitar por um campo do adaptador que chama `run(step)`, e o espelho reproduz o mesmo `run` na máquina dele (determinístico). Recomendo (a). O autor decide e a seção 3.1 e o CA-07 são ajustados. |
| P-O2 | **O estudante não tem como achar uma aula passada.** A leitura das anotações (5.6) pede o `sessionId`, mas nenhum endpoint lista as salas encerradas da turma, e a rota `GET .../live/active` só devolve a sala em curso. | Acrescentar `GET /api/v1/classes/:id/live/sessions` (docente, administrador e estudante matriculado), com título, início, término e se o estudante tem anotações, ou declarar a consulta das anotações fora desta fase. |
| P-O3 | **Mensagens do servidor para os clientes não estão definidas.** O texto fala em "pacote inicial consolidado" ao conectar, em avisar a aba anterior que perdeu o controle, em avisar a sala do encerramento e em sincronizar a fila e o total online, mas a seção 5.7 só lista as mensagens dos clientes. O instantâneo da seção 5.4 também não inclui o estado do terminal nem a fila de mãos levantadas, que quem reconecta precisa receber. | Definir as mensagens do servidor: `live:snapshot` (primeira mensagem, com modo, lâmina, módulo, traços recentes, estado do terminal, fila e total online), `live:ended` (sala encerrada pelo docente ou por inatividade), `live:control:revoked` (a aba anterior do docente), `live:presence` (total online) e `live:hand:queue` (fila atualizada); e levar o estado do terminal e a fila ao `GET .../live/active`. |
| P-O4 | **Integridade da sala ativa e dos vínculos.** O índice previsto é composto `(class_id, status)`, **não único**: dois pedidos de início quase simultâneos podem criar duas salas ativas na mesma turma. Faltam também as verificações de que `deckId` e `classSessionId` pertencem à mesma turma e de que `initialModuleId` existe, com seus erros (404 `deck-not-found`, `class-session-not-found` e `module-not-found`). | Índice único parcial sobre `class_id` onde `status = ACTIVE` e `deleted_at` é nulo, e o serviço trata o conflito devolvendo a sala existente; validar os três identificadores e acrescentar os erros em 5.1. |
| P-O5 | **Limites só no cliente.** O estrangulamento do cursor (20 por segundo) vale no navegador, que é entrada não confiável (`ARCHITECTURE.md` 3.9). A versão anterior tinha o teto de 100 conexões por sala e o limite no servidor, e a nova os omitiu. | Manter o estrangulamento no cliente e impor no Hub o descarte do que passar de 20 eventos de cursor por segundo por emitente, o tamanho máximo da mensagem e o teto de 100 conexões de estudantes por sala. Confirmar se a omissão foi intencional. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Autoria externa | Texto original trazido pelo Tech Lead |
| 14/10/2026 | Aruna Architect | Formato ajustado ao template; pendências P-01 a P-14 |
| 14/10/2026 | Aruna Architect | Parecer do autor sobre P-01 a P-14 incorporado; pendências P-N01 a P-N06 |
| 14/10/2026 | Aruna Architect | Segunda versão do autor aplicada (P-N01 a P-N06 resolvidas). Correções feitas para estar de acordo com o repositório: a migração passou a `00030_classroom.sql` (o repositório numera em sequência); os erros passam pelo pacote `platform/problem` (não existe `customerrors`); o Hub passou a `platform/hub/` (a `ARCHITECTURE.md` põe o hub em `platform/`, e a versão do autor o colocava em `handler/ws_hub.go`); o erro `invalid-pdf` descreve o que o servidor consegue verificar. Acrescentados os CA-14 a CA-16, que cobriam o texto e os testes do autor sem critério, e o mapeamento dos testes aos critérios. Novas pendências P-O1 a P-O5 |
