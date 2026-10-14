# SPEC-051: Sala de Aula Síncrona, Apresentador de Slides e Espelhamento em Tempo Real

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-051 |
| **Status** | Rascunho |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (decisões do autor às pendências P-01 a P-14 incorporadas; novas pendências na seção 10) |
| **Autor** | Autoria externa, trazida pelo Tech Lead (texto original); formato, revisão e pendências por Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classroom` (novo módulo de domínio no backend) e `frontend/src/components/Classroom/` |
| **Contexto de tela** | `/app/classes/:classId/live` (visão da sala ao vivo para docente e discentes) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-004 (infraestrutura local com MinIO), SPEC-009 e SPEC-041 (turmas e matrícula), SPEC-016 (tela de estudo do tópico e terminal), SPEC-042 (agenda da turma) |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Spec trazida pelo Tech Lead em 14/10/2026 (arquivo `14-10-26-spec-sala-de-aula-sincrona-slides-tempo-real.md`) e o parecer do autor sobre as pendências P-01 a P-14 (14/10/2026); não cita documento de `docs/arquitetura/` nem capítulo da monografia |

> **Estado:** Rascunho. Pela regra do repositório (`AI_INSTRUCTIONS.md`, seção 4), só se implementa depois de a seção 10 ficar vazia e de o Tech Lead aprovar. As 14 pendências da primeira revisão foram resolvidas pelo parecer do autor e estão incorporadas abaixo (ver o histórico); restam as novas, na seção 10.

---

## 1. Contexto e Problema (Context & Problem Statement)

Atualmente, o ecossistema dispõe de gestão acadêmica de turmas, agenda letiva e catálogo de módulos instrucionais com terminal virtual individualizado. No entanto, durante o momento síncrono da aula, não existe um ambiente integrado de condução pedagógica. O docente depende de ferramentas externas para expor apresentações visuais e demonstrar comandos, gerando dispersão de foco e perda de contexto instrucional.

A ausência de uma sala síncrona na plataforma impede que o docente compartilhe seus slides de aula com controle centralizado de navegação e que alterne de maneira imediata para o módulo de ensino da turma com espelhamento determinístico de comandos e do cursor do mouse. Sem esse mecanismo, os acadêmicos não conseguem acompanhar em tempo real as explicações práticas no terminal e ficam privados de canais interativos organizados de manifestação de dúvidas (como fila de mãos levantadas e caderno síncrono de anotações).

---

## 2. Objetivos (Goals)

* Permitir que o docente proprietário da turma inicialize e encerre salas ao vivo a qualquer momento do dia, a partir da página da turma, de forma avulsa ou ligada a uma aula agendada do dia (SPEC-042).
* Disponibilizar upload e armazenamento de apresentações em PDF no MinIO, com a renderização das lâminas feita no navegador por biblioteca local, e um deck navegável em tela cheia.
* Sincronizar em tempo real via WebSocket (hub próprio em memória) o estado da apresentação para todos os discentes conectados à sala: lâmina ativa, ponteiro virtual do docente e anotações visuais sobre a lâmina.
* Permitir a alternância fluida entre o modo "Apresentação de Slides" e o modo "Módulo de Ensino", espelhando para os estudantes o conteúdo e a execução do terminal do professor em modo somente leitura.
* Implementar fila ordenada de pedidos de fala ("Levantar a mão") para discentes, permitindo moderação direta pelo docente (deferir, abaixar ou limpar fila).
* Prover caderno individual de anotações privativas do estudante durante a sala, persistido e consultável após a aula.
* Manter streaming pesado de áudio/vídeo explicitamente fora de escopo nesta fase.

### 2.1. Fora de escopo (Non-Goals)

* Áudio e vídeo.
* Conversão de páginas do PDF em imagens no servidor (as lâminas são renderizadas no navegador).
* Broker de mensagens externo (NATS ou outro); uma spec própria o trará se houver mais de uma instância do servidor.
* Alterar `frontend/src/engine/core/` (o espelho usa a API pública do adaptador do terminal; ver P-N06).
* Frequência (presença) dos estudantes e o estado "aula realizada" da agenda (ver P-N01).

---

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

A experiência síncrona organiza-se sob a rota dedicada `/app/classes/:classId/live`, desenhada para visualização imersiva:

* **Casca da Sala (`LiveClassroom`):**
  * Barra superior de controle exibindo indicador de sala ativa (com cronômetro), seletor de modo ("Slides" e "Módulo de Ensino"), indicador de discentes conectados, botão de alternância do caderno de anotações e botão de ação ("Encerrar Aula" para docente; "Sair da Sala" para discente).
  * Painel lateral retrátil contendo a fila de dúvidas ("Mãos Levantadas") e o bloco de anotações do acadêmico.
  * Área central de palco adaptativa, alternando entre o projetor de lâminas e a visão espelhada de módulos.
* **Projetor de Lâminas (`SlidePresenter`):**
  * Renderiza a lâmina atual a partir do PDF, no navegador, com biblioteca local empacotada no projeto, sem CDN (P-N03).
  * Camada de sobreposição (*canvas overlay*) capturando eventos do docente para desenhar o cursor laser (coordenadas relativas percentuais X/Y) e anotações à mão livre.
  * Controles do docente: avançar, retroceder, ir para a lâmina N, laser, caneta e limpar rabiscos.
  * Para discentes: palco em modo receptor estrito, escutando o WebSocket e atualizando a lâmina, o ponteiro (com animação suave) e os traços, sem interferência sobre a lâmina.
* **Modo Módulo de Ensino Espelhado (`MirroredModuleView`):**
  * Renderiza a tela de estudo do módulo (`TopicStudy`), com o terminal do docente em modo mestre e, para os estudantes, uma instância espelho **separada** do terminal de prática, de teclado bloqueado, que não grava progresso nem notas.
  * O espelho é movido pelo adaptador do terminal (SPEC-016) com o estado recebido do docente (P-N06).
* **Fila de Dúvidas e Caderno de Anotações (`LiveInteractionDrawer`):**
  * Botão discente "Levantar a mão"; lista ordenada ao docente com ações para abaixar a mão individual ou a de todos.
  * Bloco de anotações privativas: editor de texto plano que salva sozinho (debounce) pelo serviço REST.
* **Gerenciamento de Conexão e Hooks:**
  * Hook `useLiveClassroom`: ciclo de vida do WebSocket com reconexão automática e tratamento de perda de conectividade. Ao conectar ou reconectar, recebe o instantâneo do estado (RN-07).
  * Estilização por SCSS Modules e tokens semânticos de `_tokens.scss`, no **tema único escuro** (SPEC-015, `ARCHITECTURE.md` 4.2), com alvos de clique ergonômicos.

### 3.2. Backend (Go — Camada de Módulo/Service)

O módulo `classroom` estrutura-se sob Clean Architecture e DDD-lite:

* **Ciclo de vida da sala:**
  * **RN-01:** o Service valida a posse da turma pelo docente autenticado (ou o administrador) e cria um registro de sala ativa; a turma arquivada não abre sala. Existe no máximo **uma sala `ACTIVE` por turma**, garantida por índice único parcial; se já existe, o endpoint devolve a ativa em vez de duplicar.
  * **RN-02:** a sala pode ser ligada a uma aula agendada do dia da mesma turma (`class_session_id`, opcional); sem ela é avulsa.
  * **RN-03:** o encerramento grava o carimbo de término e fecha os canais de transmissão. Se o docente perde a conexão, a sala fica em espera por **15 minutos**; passado o prazo sem o docente voltar, é encerrada automaticamente.
* **Apresentações (RN-04):** o Handler recebe o PDF por multipart, valida o tamanho (25 MB) e o cabeçalho do arquivo, e o Service o grava no MinIO com prefixo seguro. O backend **não converte** páginas: quem renderiza é o navegador. A contagem de lâminas e a validade do documento vêm de P-N04. O acesso ao arquivo é por URL assinada de curta duração, pedida só por quem pode ver a sala (P-N05).
* **Tempo real (RN-05):** hub WebSocket próprio em memória, com rotinas de leitura e escrita separadas por conexão (`ARCHITECTURE.md`, 3.9), autenticado pelo cookie de sessão e ligado à turma e à sala ativa. Eventos nomeados `domain:action`. Limites: **até 100 conexões de estudantes por sala**; no máximo **20 eventos de cursor por segundo por emitente** (a mensagem que passa do limite é descartada). Toda mensagem do cliente é tratada como entrada não confiável e validada (tipo, tamanho e papel).
* **Instantâneo de estado (RN-07):** ao conectar ou reconectar, o servidor envia à conexão o estado corrente: modo ativo, lâmina atual, os traços recentes sobre a lâmina, o estado do terminal do docente, a fila de mãos levantadas e o total online. O estado canônico (modo, lâmina e módulo ativo) fica persistido na sala, em Postgres; traços e estado do terminal ficam em memória no hub e valem só durante a sala.
* **Isolamento e RBAC (RN-06):** só o docente emite mensagens de controle (lâmina, cursor, traços, modo, terminal e moderação da fila); mensagem de controle vinda de estudante é descartada com registro de infração. O estudante só envia "mão levantada", "cancelar a mão" e as próprias anotações. O docente **não** lê as anotações privadas dos estudantes.

---

## 4. Modelo de Dados (Data Model)

As tabelas ficam no schema `linux_lab`, com chave primária UUIDv7 e **exclusão lógica** (`deleted_at`), sem `ON DELETE CASCADE`. Termos conforme o glossário (seção 9).

* **Tabela `live_classroom_sessions` (`LiveClassroomSession`, a sala ao vivo):**
  * `id` (UUIDv7, PK); `class_id` (FK `classes`); `teacher_id` (FK `users`, o docente responsável); `class_session_id` (FK anulável `class_sessions`, a aula agendada, RN-02).
  * `title` (texto, obrigatório, de 1 a 120 caracteres); `deck_id` (FK anulável `slide_decks`); `mode` (`SLIDES` ou `MODULE`); `active_module_id` (FK anulável, módulo de ensino ativo); `active_slide` (inteiro, padrão 1).
  * `status` (`ACTIVE` ou `FINISHED`); `started_at` (obrigatório); `ended_at` (anulável); `created_at`, `updated_at`, `deleted_at`.
  * Índice único parcial sobre `class_id` onde `status = ACTIVE` e `deleted_at` é nulo (RN-01).
* **Tabela `slide_decks` (`SlideDeck`):**
  * `id`; `class_id` (FK `classes`); `uploaded_by` (FK `users`); `title`; `description`; `storage_key` (arquivo de origem no MinIO); `slide_count` (inteiro maior que zero); `created_at`, `updated_at`, `deleted_at`.
* **Tabela `live_hand_raises` (`HandRaise`):**
  * `id`; `session_id` (FK `live_classroom_sessions`); `student_id` (FK `users`); `status` (`PENDING`, `ANSWERED`, `LOWERED`); `requested_at` (ordem FIFO); `resolved_at`; `created_at`, `updated_at`, `deleted_at`.
* **Tabela `live_classroom_notes` (`LiveClassroomNote`):**
  * `id`; `session_id` (FK `live_classroom_sessions`); `student_id` (FK `users`); `content` (texto longo, até 20.000 caracteres); `created_at`, `updated_at`, `deleted_at`.
  * Unicidade composta entre sala e estudante, entre as não excluídas: um único caderno por estudante e sala.

---

## 5. Contrato de API (API Contract)

### 5.1. POST /api/v1/classes/{classId}/live/start

Inicializa a sala ao vivo da turma ou recupera a que já está em andamento.

* **Papéis autorizados:** `TEACHER` (proprietário da turma) e `ADMIN`.
* **Entrada:** `title` (obrigatório, 1 a 120 caracteres); `deckId` (opcional, de uma apresentação **da mesma turma**); `initialModuleId` (opcional); `classSessionId` (opcional, aula agendada da mesma turma).
* **Resposta (201 Created ou 200 OK se já havia sala):** identificador, turma, status `ACTIVE`, modo, lâmina ativa, aula agendada ligada (se houver) e carimbo de início.
* **Erros (RFC 7807):** 400 `invalid-title`; 400 `invalid-uuid`; 403 `forbidden`; 404 `class-not-found`; 404 `deck-not-found` (apresentação de outra turma ou inexistente); 404 `class-session-not-found`; 409 `class-archived`.

### 5.2. POST /api/v1/classes/{classId}/live/decks

Envia uma apresentação em PDF.

* **Papéis autorizados:** `TEACHER` (proprietário) e `ADMIN`.
* **Entrada (multipart):** `file` (PDF, até 25 MB); `title`.
* **Resposta (201 Created):** identificador, título, contagem de lâminas (P-N04) e carimbo de criação.
* **Erros:** 400 `unsupported-file-type`; 413 `file-too-large`; 403 `forbidden`; 409 `too-many-decks` (limite por turma, P-N05).

### 5.3. POST /api/v1/classes/{classId}/live/{sessionId}/end

Encerra a sala.

* **Papéis autorizados:** `TEACHER` (proprietário) e `ADMIN`.
* **Resposta (200 OK):** identificador, status `FINISHED`, horário final e duração em minutos.
* **Erros:** 403 `forbidden`; 404 `session-not-found` (inexistente ou já encerrada).

### 5.4. GET /api/v1/classes/{classId}/live/active

Consulta a sala em andamento, para ingresso.

* **Papéis autorizados:** `TEACHER`, `ADMIN` e `STUDENT` com matrícula ativa na turma.
* **Resposta (200 OK):** dados da sala, apresentação com a URL assinada de curta duração, modo, lâmina ativa, módulo ativo e total de estudantes online; sem sala ativa, a resposta diz que não há.
* **Erros:** 403 `forbidden` (estudante sem matrícula ativa); 404 `class-not-found`.

### 5.5. PUT /api/v1/classes/{classId}/live/{sessionId}/notes

Grava as anotações do estudante.

* **Papéis autorizados:** `STUDENT` com matrícula ativa.
* **Entrada:** `content` (até 20.000 caracteres).
* **Resposta (200 OK):** tamanho gravado e carimbo de alteração.
* **Erros:** 400 `content-too-long`; 403 `forbidden`; 404 `session-not-found`.

### 5.6. GET /api/v1/classes/{classId}/live/{sessionId}/notes

Lê as anotações do próprio estudante, durante e depois da aula.

* **Papéis autorizados:** `STUDENT` com matrícula ativa (só as suas).
* **Resposta (200 OK):** `content` e carimbo de alteração; vazio se ainda não escreveu.
* **Erros:** 403 `forbidden`; 404 `session-not-found`.

### 5.7. GET /api/v1/classes/{classId}/live

Lista as salas encerradas da turma, da mais recente para a mais antiga, para o estudante achar as aulas passadas.

* **Papéis autorizados:** `TEACHER`, `ADMIN` e `STUDENT` com matrícula ativa.
* **Resposta (200 OK):** por sala: identificador, título, início, término e se o estudante tem anotações.
* **Erros:** 403 `forbidden`; 404 `class-not-found`.

### 5.8. Protocolo WebSocket (`/api/v1/classes/{classId}/live/ws`)

Canal bidirecional sobre o hub em memória (RN-05):

* **Autenticação:** cookie de sessão (`linux_lab_session`) na conexão.
* **Do servidor, ao conectar:** `room:snapshot` com o estado corrente (RN-07).
* **Mensagens só do docente (para a sala):** `slide:change` (índice da lâmina); `cursor:move` (X e Y em percentual e estado do laser); `canvas:draw` (traçado ou limpeza); `mode:switch` (`SLIDES` ou `MODULE` e módulo ativo); `terminal:command` (o estado do terminal, P-N06); `hand:moderate` (abaixar uma mão ou todas).
* **Mensagens dos estudantes:** `hand:raise` e `hand:cancel`.
* **Do servidor:** `room:ended` quando a sala termina (pelo docente ou pelo prazo de espera).

---

## 6. Impacto e Riscos (Impact & Risks)

* **Sobrecarga por eventos de cursor.** O cliente estrangula a 50 ms (cerca de 20 por segundo) e o servidor descarta o excesso (RN-05); o espelho interpola o movimento com transição CSS.
* **Injeção de comandos pelo espelho.** O servidor descarta mensagem de terminal de estudante; o terminal do estudante é só leitura, movido pelo estado do docente.
* **PDF corrompido ou pesado.** Limite de 25 MB e de 100 lâminas; validação do cabeçalho no servidor; a contagem e a leitura do documento, no navegador (P-N04).
* **Queda do docente.** O estado canônico fica no Postgres e o instantâneo restaura os traços e o terminal (RN-07); 15 minutos de espera antes do encerramento (RN-03).
* **Sala esquecida aberta.** O encerramento automático por falta do docente (RN-03) evita sala `ACTIVE` para sempre.
* **Dependência nova no navegador** para ler o PDF (P-N03).

---

## 7. Critérios de Aceite (Acceptance Criteria)

* [ ] **CA-01** (evento): QUANDO o docente proprietário acionar o comando de inicializar a aula, O SISTEMA DEVE criar ou recuperar a sala ativa da turma e liberar o ambiente de apresentação síncrona.
* [ ] **CA-02** (indesejado): SE um discente ou docente não proprietário tentar inicializar ou encerrar a sala, ENTÃO O SISTEMA DEVE recusar com HTTP 403 (RFC 7807).
* [ ] **CA-03** (evento): QUANDO o docente enviar uma apresentação em PDF válida de até 25 MB, O SISTEMA DEVE persisti-la no MinIO e disponibilizá-la para projeção na sala.
* [ ] **CA-04** (evento): QUANDO o docente avançar ou retroceder uma lâmina, O SISTEMA DEVE replicar a troca para todos os estudantes conectados via WebSocket.
* [ ] **CA-05** (evento): QUANDO o docente movimentar o laser sobre a lâmina, O SISTEMA DEVE sincronizar a posição relativa para os discentes, com estrangulamento (20 por segundo) e movimento fluido.
* [ ] **CA-06** (evento): QUANDO um estudante levantar a mão, O SISTEMA DEVE registrar o pedido em ordem FIFO e exibi-lo no painel do docente.
* [ ] **CA-07** (evento): QUANDO o docente abaixar a mão de um estudante ou limpar a fila, O SISTEMA DEVE refletir a mudança para todos da sala sem recarregar a tela.
* [ ] **CA-08** (evento): QUANDO o docente comutar para o modo "Módulo de Ensino", O SISTEMA DEVE carregar o módulo para todos e espelhar o terminal do professor, em modo somente leitura para os estudantes.
* [ ] **CA-09** (evento): QUANDO um estudante digitar anotações durante a aula, O SISTEMA DEVE gravá-las sozinho, ligadas à sua conta e à sala.
* [ ] **CA-10** (evento): QUANDO o docente finalizar a aula, O SISTEMA DEVE registrar o encerramento, fechar os canais e avisar os estudantes da conclusão.
* [ ] **CA-11** (ubíquo): A sala DEVE usar só as variáveis semânticas de `_tokens.scss` no tema único escuro, com contraste WCAG AA, e a navegação de lâminas DEVE funcionar por teclado (setas e barra de espaço).
* [ ] **CA-12** (evento): QUANDO um estudante conecta ou reconecta no meio da aula, O SISTEMA DEVE enviar o instantâneo do estado (modo, lâmina, traços, terminal e fila) antes de qualquer outra mensagem.
* [ ] **CA-13** (estado): ENQUANTO a sala está ativa, O SISTEMA NÃO DEVE aceitar mais de 100 conexões de estudantes nem mais de 20 eventos de cursor por segundo por emitente, descartando o excesso.
* [ ] **CA-14** (evento): QUANDO o docente fica sem conexão por mais de 15 minutos, O SISTEMA DEVE encerrar a sala automaticamente e avisar os estudantes.
* [ ] **CA-15** (indesejado): SE a turma está arquivada, ENTÃO O SISTEMA DEVE recusar o início da sala com 409 `class-archived`; SE já existe sala ativa na turma, ENTÃO DEVE devolver a ativa.
* [ ] **CA-16** (evento): QUANDO um estudante matriculado consulta as suas anotações depois da aula, O SISTEMA DEVE devolvê-las; o docente NÃO DEVE conseguir lê-las.
* [ ] **CA-17** (evento): QUANDO a sala é iniciada ligada a uma aula agendada do dia da mesma turma, O SISTEMA DEVE guardar o vínculo (`class_session_id`); SE a aula é de outra turma, ENTÃO DEVE recusar com 404.
* [ ] **CA-18** (ubíquo): As tabelas da sala DEVEM usar exclusão lógica e o schema `linux_lab`, sem exclusão física em cascata.

---

## 8. Plano de Testes (Test Plan)

Escritos **antes** do código e rodados vermelhos primeiro (SPEC-038). Nomes dos testes:

### Backend

* **`classroom/domain`:** `TestSessionTitleLimits` (RN-01), `TestDeckPageLimits` (100 lâminas), `TestHandRaiseOrderIsFIFO` (CA-06), `TestNoteLimit` (CA-09, 20.000 caracteres).
* **`classroom/service`:** `TestStartRoomForTheOwner` e `TestStartRoomRefusedForOthers` (CA-01, CA-02); `TestStartReturnsTheActiveRoom` e `TestArchivedClassCannotStart` (CA-15); `TestStartLinkedToAClassSession` e `TestClassSessionOfAnotherClassIsRefused` (CA-17); `TestDeckBelongsToTheClass` (P-N05); `TestUploadRules` (CA-03); `TestHandRaiseQueueAndModeration` (CA-06, CA-07); `TestNotesAreIsolatedPerStudent` e `TestTeacherCannotReadNotes` (CA-09, CA-16); `TestEndRoom` (CA-10); `TestRoomEndsWhenTheTeacherIsGoneFor15Minutes` (CA-14); `TestSnapshotHasTheCurrentState` (CA-12).
* **`classroom/repository` (banco de teste):** `TestOnlyOneActiveRoomPerClass` (índice único parcial), `TestSoftDeleteKeepsNotesAndHandRaises` (CA-18), `TestOneNotebookPerStudentAndRoom`.
* **`classroom/handler` (HTTP e WebSocket, com `httptest`):** `TestRoutesAndProblems` (todas as rotas da seção 5 e seus erros RFC 7807), `TestStudentOnlyReadsHisNotes` (CA-16), `TestTeacherControlsAreBroadcast` (CA-04, CA-05), `TestStudentControlMessagesAreDropped` (CA-02, RN-06), `TestCursorRateIsLimited` e `TestConnectionLimitIs100` (CA-13), `TestSnapshotComesFirst` (CA-12), `TestRoomEndedIsSent` (CA-10, CA-14).

### Frontend

* **`SlidePresenter.test.tsx`:** `shows the active slide`, `moves with the arrows and the space bar` (CA-04, CA-11), `has the teacher controls only for the teacher`, `a student cannot change the slide or draw` (CA-05).
* **`MirroredModuleView.test.tsx`:** `the student terminal does not take the keyboard` e `replays what the teacher sends` (CA-08).
* **`LiveInteractionDrawer.test.tsx`:** `raises and cancels the hand`, `the teacher lowers one or all hands` (CA-06, CA-07).
* **`StudentNotesPanel.test.tsx`:** `saves by itself after a pause` e `shows the notes after the class` (CA-09, CA-16).
* **`useLiveClassroom.test.ts`:** `reconnects and applies the snapshot` (CA-12).
* **`LiveClassroom.test.tsx`:** `uses only the semantic tokens` (CA-11) e `shows the end of the class` (CA-10).
* **Cobertura:** acima de 80% no escopo, medida com `go test -cover` e com o Vitest em modo de cobertura.

### Teste manual e de usabilidade em campo

* Acessar a turma como docente no desktop, iniciar a aula e carregar um PDF.
* Abrir duas abas de estudante (uma em desktop e outra em visualização mobile), avançar as lâminas e desenhar com a caneta, vendo a atualização sincronizada.
* Alternar para o módulo, executar comandos no terminal e confirmar que os estudantes acompanham sem conseguir digitar.
* Levantar a mão como estudante, atender no painel do docente e encerrar a aula, vendo a saída amigável da sala.
* Fechar o navegador do docente e conferir o encerramento automático após 15 minutos.

---

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `AI_INSTRUCTIONS.md`, `ARCHITECTURE.md` (3.9, tempo real), `GLOSSARY.md`, SPEC-016 (adaptador `terminalWindow.ts`), SPEC-041 e SPEC-042 (turma, matrícula e aula agendada).
2. **Ordem de execução:**
   * Glossário: acrescentar os termos **Sala ao vivo** (`LiveClassroomSession`), **Apresentação** (`SlideDeck`), **Lâmina** (`Slide`), **Mão levantada** (`HandRaise`) e **Anotações da aula** (`LiveClassroomNote`), e usar "sala ao vivo" no lugar de "sessão".
   * Testes vermelhos da seção 8, commit `test(...)`.
   * Migração das quatro tabelas no schema `linux_lab` (soft delete, índice único parcial).
   * Backend: `classroom/domain`, `repository`, `service`, `handler` (REST e hub WebSocket) e composição em `cmd/api/main.go`.
   * Frontend: `classroomService.ts`, `useLiveClassroom.ts`, os componentes de `Classroom/*` e a página `app/classes/[id]/live/page.tsx`; mensagens em `messages/pt-BR.ts`.
3. **Arquivos e diretórios a criar ou alterar:** os citados acima, mais `specs/GLOSSARY.md`; qualquer outro exige justificativa na entrega.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, cobertura acima de 80%, lint e Stylelint limpos, nenhuma violação da `ARCHITECTURE.md`, status `Implementada`.

---

## 10. Pendências para aprovação

As pendências P-01 a P-14 da primeira revisão foram resolvidas pelo parecer do autor (14/10/2026) e estão incorporadas nas seções 2 a 9. Restam as abaixo, que nasceram dessas respostas e da leitura do código.

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| P-N01 | **Frequência e "aula realizada".** A resposta de P-14 diz que a sala ligada à aula do dia "preenche a frequência e marca a realização da aula". Hoje não existe frequência (presença) de estudantes no sistema, e a aula agendada (`ClassSession`, SPEC-042) só tem os estados `SCHEDULED` e `CANCELED`. Os dois seriam funcionalidade nova. | Nesta spec, a ligação só **guarda** `class_session_id` (RN-02). Frequência e o estado "realizada" ficam para uma spec própria, a escrever depois, que usará o vínculo. Confirmar com o autor. |
| P-N02 | **Mais de uma aba do docente.** A sala tem um docente de controle. O que acontece se ele abre a sala em duas abas, ou se o administrador entra também? As duas poderiam emitir controle ao mesmo tempo. | Uma única conexão de controle por sala: a mais nova assume o controle e a anterior passa a espelho, com aviso. |
| P-N03 | **Biblioteca de PDF no navegador.** P-06 decidiu renderizar no cliente com "biblioteca local", sem nomeá-la. É dependência nova (`AI_INSTRUCTIONS.md`, seção 7) e exige aprovação do Tech Lead. | Usar o `pdfjs-dist` (Apache-2.0), com o arquivo do leitor (*worker*) empacotado no projeto, sem CDN. Confirmar o nome e a versão. |
| P-N04 | **Contagem de lâminas e validação do PDF sem conversão no servidor.** Se o servidor não lê o PDF, ele não sabe a contagem de páginas, nem se o arquivo está corrompido ou protegido por senha, e não consegue impor o limite de 100 lâminas (seção 6). Ler o PDF no servidor pede uma biblioteca Go de PDF (outra dependência nova). | O servidor valida só o cabeçalho (`%PDF-`) e o tamanho. O navegador do docente lê o PDF ao enviar, recusa o corrompido, o protegido por senha e o de mais de 100 páginas, e informa `slideCount`; o servidor aceita a contagem dentro do intervalo de 1 a 100. Aceitar essa confiança, ou aprovar uma biblioteca Go. |
| P-N05 | **URLs assinadas e limite de apresentações.** P-11 vincula a validade da URL à "janela de duração da aula", mas a sala não tem duração fixa. Falta também um limite de apresentações por turma e a regra de exclusão de apresentação. | URL com validade de 15 minutos, renovada a cada pedido do estudante matriculado (o PDF é baixado uma vez, ao entrar na sala); até 20 apresentações por turma (409 `too-many-decks`); exclusão lógica da apresentação pelo docente, sem afetar salas encerradas. |
| P-N06 | **Como o espelho recebe o terminal.** P-07 decidiu transmitir "os comandos digitados". No código, o terminal oferece `TerminalWindow.run(step)`, que executa um comando passo a passo, e um gancho `onCommand(snapshot)` com a **máquina inteira serializada** depois de cada comando, mas esse gancho **não traz o texto digitado**; o texto digitado à mão pelo docente não tem um gancho público. O `engine/core` não pode ser alterado sem spec. | Enviar `terminal:command` com o instantâneo da máquina após cada comando do docente (já existe, e serve também a quem entra no meio) e reproduzir no espelho pela troca de máquina (`swapMachine`); medir o tamanho do instantâneo; enviar o texto só se um gancho existir sem alterar o `engine/core`. Se o autor exigir a repetição por comandos, a spec precisa autorizar a alteração do adaptador. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Autoria externa | Texto original trazido pelo Tech Lead |
| 14/10/2026 | Aruna Architect | Formato ajustado ao template (cabeçalho, ID SPEC-051, status Rascunho) e 14 pendências levantadas (P-01 a P-14) |
| 14/10/2026 | Aruna Architect | Parecer do autor incorporado: hub WebSocket próprio sem NATS (P-01); schema `linux_lab` (P-02); tema único escuro (P-03); exclusão lógica em todas as tabelas (P-04); termos `LiveClassroomSession`, `SlideDeck`, `Slide`, `HandRaise` e `LiveClassroomNote` (P-05); renderização do PDF no navegador (P-06); espelho por comandos (P-07, ver P-N06); instantâneo de estado (P-08); limites de 100 conexões, 20 eventos de cursor por segundo e 15 minutos de espera (P-09); `GET` das anotações e das salas encerradas (P-10); URLs assinadas (P-11, ver P-N05); caminho `/api/v1/classes/{classId}/live/ws` (P-12); lista nominal de testes (P-13); ligação opcional com a aula agendada (P-14, ver P-N01). Novas pendências P-N01 a P-N06 |
