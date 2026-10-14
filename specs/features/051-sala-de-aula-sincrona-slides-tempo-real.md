# SPEC-051: Sala de Aula Síncrona, Apresentador de Slides e Espelhamento em Tempo Real

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-051 |
| **Status** | Aprovada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (aprovada pelo Tech Lead) |
| **Autor** | Autoria externa, trazida pelo Tech Lead (texto original); formato, revisão e decisões por Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classroom` (novo módulo de domínio no backend) e `frontend/src/components/Classroom/` |
| **Contexto de tela** | `/app/classes/:classId/live` (sala ao vivo) e seção "Aula ao vivo" na página da turma (`/app/classes/:classId`) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-004 (infraestrutura local com MinIO), SPEC-009, SPEC-041 e SPEC-049 (turmas, matrícula e auditoria), SPEC-014, SPEC-016 e SPEC-020 (prática, tela de estudo e terminal), SPEC-042 (agenda da turma) |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Spec trazida pelo Tech Lead em 14/10/2026 (arquivo `14-10-26-spec-sala-de-aula-sincrona-slides-tempo-real.md`), em duas versões, e as decisões do Tech Lead de 14/10/2026 sobre o ciclo de vida da sala, a sala única por turma, a fluidez do movimento e a digitação espelhada |

> **Estado:** Aprovada pelo Tech Lead em 14/10/2026, com a seção 10 vazia. Pode ser implementada, seguindo o fluxo da seção 4 do `AI_INSTRUCTIONS.md` (testes vermelhos primeiro).

---

## 1. Contexto e Problema (Context & Problem Statement)

Atualmente, o ecossistema dispõe de gestão acadêmica de turmas, agenda letiva e catálogo de módulos instrucionais com terminal virtual individualizado. No entanto, durante o momento síncrono da aula, não existe um ambiente integrado de condução pedagógica. O docente depende de ferramentas externas para expor apresentações visuais e demonstrar comandos, gerando dispersão de foco e perda de contexto instrucional.

A ausência de uma sala síncrona na plataforma impede que o docente compartilhe seus slides de aula com controle centralizado de navegação e que alterne de maneira imediata para o módulo de ensino da turma com espelhamento determinístico de comandos e do cursor do mouse. Sem esse mecanismo, os acadêmicos não conseguem acompanhar em tempo real as explicações práticas no terminal e ficam privados de canais interativos organizados de manifestação de dúvidas (como fila de mãos levantadas e caderno síncrono de anotações). Transmissões pesadas de vídeo e áudio contínuas sobrecarregam a largura de banda e excluem discentes em redes oscilantes, tornando indispensável uma solução síncrona orientada a dados e estados leves no navegador.

---

## 2. Objetivos (Goals)

* Permitir que o docente proprietário da turma (ou administrador) **inicie e encerre a aula quando quiser, em qualquer horário**, a partir da página da turma, com vínculo relacional opcional à aula agendada da turma.
* Manter **uma só aula ativa por turma**: a aula continua aberta até o docente encerrá-la, e ele pode sair e voltar à mesma aula quantas vezes quiser.
* Mostrar, na página da turma, a aula em andamento e o histórico das aulas anteriores com seus detalhes.
* Disponibilizar upload e armazenamento de apresentações em PDF no MinIO, consumidas pelo navegador via URLs pré-assinadas renováveis e renderizadas localmente página a página.
* Sincronizar em tempo real via WebSocket, de forma **fluida (cerca de 30 quadros por segundo)**, o ponteiro do docente, os traços sobre a lâmina e a **digitação no terminal**, além da lâmina ativa e dos comandos executados.
* Permitir a alternância entre o modo de lâminas e o modo de módulo de ensino, espelhando para os estudantes, em leitura estrita e com teclado travado, o que o docente digita, executa e vê no terminal.
* Implementar fila cronológica de pedidos de fala (mãos levantadas), com moderação do docente.
* Prover caderno individual de anotações privativas do estudante durante a aula, persistido e consultável depois.
* Garantir reconexão resiliente, com entrega do estado consolidado a quem entra com a aula em andamento.

### 2.1. Fora de escopo (Non-Goals)

* Áudio e vídeo.
* Frequência (presença/chamada) e o estado "aula realizada" da agenda: o vínculo com a aula agendada é só relacional.
* Conversão de páginas do PDF no servidor: as lâminas são renderizadas no navegador.
* Broker de mensagens externo (NATS ou outro).
* Reabrir uma aula já encerrada pelo docente: encerrar é definitivo; uma nova aula é outra sala.

---

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Seção "Aula ao vivo" na página da turma (`/app/classes/:classId`, aba Visão geral):**

* **Sem aula ativa:** o docente vê o formulário **Iniciar aula** (título obrigatório, apresentação opcional e aula agendada opcional) e o estudante vê "Nenhuma aula em andamento".
* **Com aula ativa:** título e horário de início. O estudante vê **Entrar na aula**; o docente vê **Voltar para a aula** e **Encerrar aula**.
* **Aulas anteriores:** lista das aulas encerradas (título, data, duração); o estudante abre as próprias anotações de cada uma.

**Sala ao vivo (`/app/classes/:classId/live`):**

* **Casca da Sala (`LiveClassroom`):**
  * Gerencia a área central de projeção, a barra superior de status e as gavetas laterais de interação.
  * Exibe indicador de aula ativa (com cronômetro), seletor de modo ("Lâminas" e "Módulo de Ensino"), indicador de discentes conectados, botão do caderno de anotações e botão de ação ("Encerrar Aula" para docente; "Sair da Sala" para discente).
  * Painel lateral retrátil com a fila de dúvidas ("Mãos Levantadas") e o bloco de anotações do estudante.
  * Trata o papel do usuário: o docente tem controles de apresentação, desenho e moderação; o discente tem visualização passiva e ações de participação.
* **Projetor de Lâminas (`SlidePresenter`):**
  * Renderiza o PDF página a página com a biblioteca local `pdfjs-dist` (nas dependências do projeto, sem CDN).
  * Camada de sobreposição (*canvas overlay*) captura o movimento do mouse do docente e os traços, emitindo coordenadas normalizadas em percentual de 0 a 100, **a cada 33 ms (cerca de 30 quadros por segundo)**.
  * Para discentes: palco em modo receptor estrito. O ponteiro e os traços recebidos são **interpolados entre os quadros** por transição CSS, para o movimento ficar fluido; sem interferência sobre a lâmina.
  * Controles do docente: avançar, retroceder, ir para a lâmina N, laser, caneta e limpar traços. Atalhos de teclado (setas e barra de espaço) exclusivos do docente.
* **Espelhamento de Módulo e Terminal (`MirroredModuleView`):**
  * Renderiza a tela de estudo do módulo (`TopicStudy`).
  * Na visão do docente, o terminal funciona normalmente. O adaptador do terminal passa a informar (a) a **linha em digitação**, a cada tecla, e (b) a cada comando concluído, a **linha, a saída e o estado serializado** da máquina (P-O1).
  * Na visão do estudante, uma instância espelho do terminal, **bloqueada contra foco e teclado**, **mostra o docente digitando** (a linha em digitação, a cerca de 30 quadros por segundo) e, ao fim do comando, imprime a linha e a saída e aplica o estado. O espelho não grava progresso nem notas.
  * Senhas digitadas no terminal nunca são transmitidas (o terminal não as exibe e o adaptador só lê o que está na tela).
* **Fila de Dúvidas e Caderno de Anotações (`LiveInteractionDrawer`):**
  * Botão discente "Levantar a mão"; lista FIFO ao docente, com ações para abaixar a mão individual ou coletivamente.
  * Bloco de anotações privativas: editor de texto plano que salva sozinho (debounce) pela API REST.
* **Gerenciamento de Estado e Rede (`useLiveClassroom`):**
  * Conexão WebSocket com o Hub, reconexão automática e recepção do estado consolidado ao conectar (`live:snapshot`).
  * Se o docente abre a sala em uma segunda aba, a conexão mais nova assume o controle e a anterior passa a modo passivo (`live:control:revoked`).
  * Renovação automática da URL assinada do PDF antes de ela vencer.
  * Tema único escuro, tokens semânticos de `_tokens.scss` e alvos de toque de no mínimo 44 px.

### 3.2. Backend (Go — Camada de Módulo/Service)

O módulo `classroom` estrutura-se sob Clean Architecture e DDD-lite:

* **Camada de Domínio (`domain`):**
  * Entidades da sala (`LiveClassroomSession`), das apresentações (`SlideDeck`), dos itens da fila de dúvidas (`LiveHandRaise`) e das anotações (`LiveClassroomNote`).
  * Constantes de status (`ACTIVE`, `FINISHED`), modos (`SLIDES`, `MODULE`), status de intervenção (`PENDING`, `ANSWERED`, `LOWERED`) e limites.
* **Camada de Serviço (`service`):**
  * **RN-01 (iniciar a qualquer hora, uma aula ativa por turma):** `StartSession` valida que o solicitante é o docente dono da turma ou administrador, recusa turma arquivada e **não depende do horário da agenda**. Se a turma já tem aula ativa, devolve essa mesma aula (reabertura), ignorando o título enviado; só cria nova se não há ativa. A unicidade é garantida pelo banco (índice único parcial), e a corrida entre dois inícios devolve a aula que venceu.
  * **RN-02 (encerrar e reabrir):** `EndSession` grava o término, desliga a transmissão e manda o Hub desconectar os clientes. Enquanto o docente não encerra, a aula permanece `ACTIVE`: ele pode sair e voltar à mesma aula. Encerrar é definitivo.
  * **RN-03 (rede de segurança):** se a aula fica **12 horas** sem o docente conectado, o serviço a encerra, para não bloquear a turma por esquecimento.
  * `UploadSlideDeck`: valida o tamanho (25 MB), o cabeçalho de PDF e a contagem de lâminas informada pelo navegador (de 1 a 100), o limite de **20 apresentações por turma**, grava no MinIO sob prefixo da turma e persiste. URLs pré-assinadas de **15 minutos**.
  * `GetActiveSession`: devolve o estado consolidado da aula (RN-07).
  * `ListSessions`: lista as aulas da turma, a ativa primeiro e depois as encerradas, da mais recente para a mais antiga, com os detalhes (título, início, término, duração, aula agendada ligada e, para o estudante, se tem anotações).
  * `SaveStudentNote` e `GetStudentNote`: gravam e leem o texto privativo do estudante matriculado.
  * **RN-04 (validação dos vínculos):** `deckId` e `classSessionId` precisam ser da mesma turma, e `initialModuleId` precisa existir; senão, 404.
* **Camada de Transporte e WebSocket (`handler`):**
  * Handlers REST em Gin, com erros RFC 7807 pelo pacote `platform/problem`.
  * Handler de WebSocket sobre o **Hub próprio em memória**, em `backend/internal/platform/hub/` (`ARCHITECTURE.md`, 3.2 e 3.9), com leitura e escrita separadas por conexão e autenticação pelo cookie de sessão.
  * **RN-05 (limites no servidor, entrada não confiável):** no máximo **100 conexões de estudantes por sala**; no máximo **35 eventos por segundo por emitente** (ponteiro, traços e digitação), com descarte do excedente; tamanho máximo por mensagem: 1 KiB para o ponteiro, 4 KiB para a digitação, 16 KiB para os traços e 1 MiB para o estado do terminal (valores a conferir depois de medir o tamanho do estado, P-O1). O estudante recebe o ponteiro e a digitação agrupados: no máximo o último valor a cada 30 ms.
  * **RN-06 (papéis):** só o docente dono (ou administrador) emite mensagens de controle; as de estudante são descartadas com registro de auditoria. O docente não lê as anotações privadas.
  * **RN-07 (estado consolidado):** ao conectar ou reconectar, o servidor envia `live:snapshot` como primeira mensagem, com modo, lâmina, módulo ativo, traços recentes da lâmina, linha em digitação, últimos 200 comandos e saídas do terminal, estado serializado da máquina, fila de mãos levantadas e total online. O estado canônico (modo, lâmina e módulo) fica no Postgres; traços, digitação e o histórico do terminal ficam em memória no Hub e valem durante a aula.

---

## 4. Modelo de Dados (Data Model)

Todas as entidades pertencem ao schema `linux_lab` do PostgreSQL e usam UUIDv7 como chave primária, auditoria com data de criação e atualização e exclusão lógica:

* **Tabela `live_classroom_sessions`:**
  * `id` (UUIDv7, PK); `class_id` (FK `classes`); `teacher_id` (FK `users`).
  * `class_session_id` (FK anulável `class_sessions`): vínculo relacional estrito, sem inferência de presença ou chamada.
  * `deck_id` (FK anulável `slide_decks`); `active_module_id` (FK anulável `course_modules`).
  * `title` (texto, obrigatório, de 1 a 120 caracteres); `display_mode` (`SLIDES` ou `MODULE`); `current_slide` (inteiro, padrão 1); `status` (`ACTIVE` ou `FINISHED`).
  * `started_at` (obrigatório); `ended_at` (anulável); `created_at`, `updated_at`, `deleted_at`.
  * **Índice único parcial** sobre `class_id` onde `status = ACTIVE` e `deleted_at` é nulo (RN-01), e índice sobre `(class_id, started_at)` para a lista de aulas.
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

### 5.1. Início (ou reabertura) da aula

`POST /api/v1/classes/:id/live/start`

* **Papéis autorizados:** `TEACHER` (dono da turma) e `ADMIN`.
* **Entrada:** `title` (obrigatório, 1 a 120 caracteres); `classSessionId` (opcional); `deckId` (opcional); `initialModuleId` (opcional).
* **Resposta (201 Created se criou; 200 OK se já havia aula ativa e é a mesma):** `id`, `classId`, `title`, `classSessionId`, `status` (`ACTIVE`), `displayMode`, `currentSlide` e `startedAt`.
* **Erros (RFC 7807):** 400 `validation-error` (título ausente ou inválido); 403 `forbidden`; 404 `class-not-found`; 404 `deck-not-found`; 404 `class-session-not-found`; 404 `module-not-found`; 409 `class-archived`.

### 5.2. Encerramento da aula

`POST /api/v1/classes/:id/live/sessions/:sessionId/end`

* **Papéis autorizados:** `TEACHER` (dono) e `ADMIN`. Sem corpo.
* **Resposta (200 OK):** `id`, `status` (`FINISHED`) e `endedAt`.
* **Erros:** 403 `forbidden`; 404 `session-not-found` (inexistente, de outra turma ou já encerrada).

### 5.3. Upload de apresentação

`POST /api/v1/classes/:id/live/decks`

* **Papéis autorizados:** `TEACHER` (dono) e `ADMIN`.
* **Entrada (multipart):** `file` (PDF, até 25 MB); `title` (de 1 a 120 caracteres); `pageCount` (inteiro de 1 a 100, informado pelo navegador, que lê o PDF antes de enviar).
* **Resposta (201 Created):** `id`, `title`, `pageCount`, `downloadUrl` (assinada, 15 minutos) e `createdAt`.
* **Erros:** 400 `invalid-pdf` (o arquivo não começa com o cabeçalho de PDF, ou `pageCount` fora de 1 a 100; o arquivo corrompido ou com senha é recusado no navegador, antes do envio); 403 `forbidden`; 409 `deck-limit-exceeded`; 413 `file-too-large`.

### 5.4. Aula ativa e estado inicial

`GET /api/v1/classes/:id/live/active`

* **Papéis autorizados:** `TEACHER`, `ADMIN` e `STUDENT` com matrícula `ACTIVE`.
* **Resposta (200 OK):** com aula em curso: `session`, `displayMode`, `currentSlide`, `activeModuleId`, `activeDeck` (com `downloadUrl` renovada, 15 minutos), `recentDrawings`, `terminal` (linha em digitação, últimos comandos com saída e estado serializado), `handRaises` (fila) e `onlineCount`; sem aula: `hasActiveSession: false`.
* **Erros:** 401 `not-authenticated`; 403 `forbidden`; 404 `class-not-found`.

### 5.5. Lista de aulas da turma

`GET /api/v1/classes/:id/live/sessions`

* **Papéis autorizados:** `TEACHER`, `ADMIN` e `STUDENT` com matrícula `ACTIVE`.
* **Resposta (200 OK):** as 50 aulas mais recentes, a ativa primeiro: `id`, `title`, `status`, `startedAt`, `endedAt`, `durationMinutes`, `classSessionId` e, para o estudante, `hasNotes`.
* **Erros:** 403 `forbidden`; 404 `class-not-found`.

### 5.6. Gravação das anotações do estudante

`PUT /api/v1/classes/:id/live/sessions/:sessionId/notes`

* **Papéis autorizados:** `STUDENT` com matrícula `ACTIVE`.
* **Entrada:** `content` (obrigatório, até 20.000 caracteres).
* **Resposta (200 OK):** `sessionId`, `savedLength` e `updatedAt`.
* **Erros:** 400 `content-too-long`; 403 `forbidden`; 404 `session-not-found`.

### 5.7. Consulta das anotações depois da aula

`GET /api/v1/classes/:id/live/sessions/:sessionId/notes`

* **Papéis autorizados:** `STUDENT` (autor das anotações).
* **Resposta (200 OK):** `sessionId`, `content` e `updatedAt`.
* **Erros:** 403 `forbidden`; 404 `notes-not-found`; 404 `session-not-found`.

### 5.8. Protocolo de tempo real (WebSocket)

`GET /api/v1/classes/:id/live/ws`

* **Papéis autorizados:** `TEACHER`, `ADMIN` e `STUDENT` com matrícula `ACTIVE`. Upgrade HTTP sobre o Hub em memória.
* **Mensagens só do docente (para a sala):**
  * `live:slide:change` (índice da lâmina); `live:cursor:move` (X e Y em percentual); `live:canvas:draw` (traçado ou limpeza); `live:mode:switch` (`SLIDES` ou `MODULE` e o módulo).
  * `live:terminal:input`: a linha em digitação e o terminal (de 1 a 3) a cada tecla, agrupada em até 30 quadros por segundo.
  * `live:terminal:sync`: ao concluir um comando, o terminal, a linha, a saída e o estado serializado da máquina.
  * `live:hand:moderate` (estudante atendido ou baixa geral).
* **Mensagens dos estudantes:** `live:hand:raise` e `live:hand:lower`.
* **Mensagens do servidor:** `live:snapshot` (primeira mensagem de cada conexão, RN-07); `live:ended` (a aula foi encerrada, pelo docente ou pela rede de segurança); `live:control:revoked` (outra aba do docente assumiu o controle); `live:presence` (total online); `live:hand:queue` (fila atualizada).

---

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| :--- | :--- |
| Volume de mensagens de ponteiro e digitação (100 estudantes a 30 quadros por segundo) | Limite de 35 eventos por segundo por emitente no servidor, descarte do excedente, e envio aos estudantes agrupado no último valor a cada 30 ms; interpolação visual no receptor. A carga é medida no teste de carga da implementação. |
| Injeção de comandos, teclas ou controle por discentes | O Hub valida o papel da conexão e descarta, com auditoria, tudo que não venha do docente dono ou do administrador. O terminal do estudante é só leitura. |
| Vazamento de senha pela digitação espelhada | O adaptador só lê o que o terminal mostra na tela, e o terminal não exibe senhas; nenhuma mensagem de digitação é enviada enquanto o terminal pede senha. |
| Docente fecha o navegador ou perde a conexão | A aula continua aberta; ao voltar, o docente reentra na mesma aula e recebe o estado consolidado. A rede de segurança encerra a aula após 12 horas sem o docente. |
| Docente em várias abas | A conexão mais recente assume o controle e as anteriores recebem `live:control:revoked` e passam a modo passivo. |
| Dois inícios simultâneos da aula | O índice único parcial garante uma só aula ativa por turma; o segundo início recebe a aula existente. |
| Expiração das URLs de slides em aulas longas | URLs de 15 minutos; o frontend pede a renovação antes do vencimento. |
| Envio descontrolado de arquivos | No máximo 20 apresentações por turma e 25 MB por PDF. |
| Alteração no adaptador do terminal quebrar o motor | A alteração só acrescenta avisos (sem mudar o comportamento) e é coberta pelos testes de conformidade do motor (SPEC-030) e pelos testes do adaptador. |

---

## 7. Critérios de Aceite (Acceptance Criteria)

* [ ] **CA-01** (evento): QUANDO o docente dono da turma acionar "Iniciar aula", em qualquer dia e horário, O SISTEMA DEVE criar a aula com status `ACTIVE` no schema `linux_lab`, ligando opcionalmente a aula agendada sem interferir em registros de frequência.
* [ ] **CA-02** (indesejado): SE um discente ou docente de outra turma tentar iniciar ou encerrar a aula, ENTÃO O SISTEMA DEVE responder 403 `forbidden` (RFC 7807).
* [ ] **CA-03** (evento): QUANDO o docente enviar um PDF de até 25 MB e até 100 páginas, O SISTEMA DEVE gravar o arquivo no MinIO, registrar o `slide_decks` e devolver a URL assinada com validade de 15 minutos.
* [ ] **CA-04** (indesejado): SE a turma já tiver 20 apresentações, ENTÃO O SISTEMA DEVE recusar o envio com 409 `deck-limit-exceeded`.
* [ ] **CA-05** (evento): QUANDO o docente alterar a lâmina ativa, O SISTEMA DEVE transmitir o índice pelo WebSocket e atualizar as telas de todos os estudantes conectados.
* [ ] **CA-06** (evento): QUANDO o docente movimentar o mouse ou a caneta sobre a lâmina, O SISTEMA DEVE transmitir as coordenadas a cerca de 30 quadros por segundo e mostrar o ponteiro e os traços aos estudantes com movimento fluido, interpolado entre os quadros.
* [ ] **CA-07** (evento): QUANDO o docente estiver no modo "Módulo de Ensino", O SISTEMA DEVE mostrar aos estudantes, em um terminal bloqueado contra teclado, o que o docente digita (a cerca de 30 quadros por segundo) e, ao concluir cada comando, a linha, a saída e o estado da máquina.
* [ ] **CA-08** (evento): QUANDO um estudante levantar a mão, O SISTEMA DEVE colocá-lo na fila por ordem cronológica (FIFO) e exibi-lo no painel de moderação do docente.
* [ ] **CA-09** (evento): QUANDO o docente baixar a mão de um estudante ou limpar a fila, O SISTEMA DEVE atualizar o status do pedido e sincronizar a visão de todos os participantes.
* [ ] **CA-10** (evento): QUANDO um estudante digitar anotações no seu caderno, O SISTEMA DEVE gravar o conteúdo pela API REST, ligado à aula e ao estudante, permitindo a leitura posterior pelo próprio autor.
* [ ] **CA-11** (estado): ENQUANTO o docente conectar em uma nova aba, O SISTEMA DEVE dar o controle à conexão mais recente e avisar a anterior (`live:control:revoked`), que passa a modo passivo.
* [ ] **CA-12** (evento): QUANDO o docente encerrar a aula, O SISTEMA DEVE gravar o término, enviar `live:ended` à sala e fechar as conexões WebSocket.
* [ ] **CA-13** (ubíquo): A interface da sala DEVE operar só no tema único escuro, com tokens semânticos de `_tokens.scss` e alvos de toque de no mínimo 44 px.
* [ ] **CA-14** (evento): QUANDO um participante conecta ou reconecta com a aula em andamento, O SISTEMA DEVE enviar `live:snapshot` como primeira mensagem, com modo, lâmina, módulo, traços recentes, terminal (linha em digitação, histórico recente e estado), fila e total online.
* [ ] **CA-15** (evento): QUANDO o docente fica 12 horas sem conexão com a aula ativa, O SISTEMA DEVE encerrá-la e avisar os estudantes; ENQUANTO isso não acontece, a aula permanece aberta, e o docente pode sair e voltar à mesma aula.
* [ ] **CA-16** (indesejado): SE a turma está arquivada, ENTÃO O SISTEMA DEVE recusar o início da aula com 409 `class-archived`.
* [ ] **CA-17** (indesejado): SE a turma já tem aula ativa, ENTÃO O SISTEMA DEVE devolver essa aula (200 OK) em vez de criar outra, inclusive em inícios simultâneos.
* [ ] **CA-18** (evento): QUANDO qualquer participante abre a página da turma, O SISTEMA DEVE mostrar a seção "Aula ao vivo" com a aula ativa (e o botão de entrar, voltar ou encerrar conforme o papel) e a lista das aulas anteriores com título, data e duração.
* [ ] **CA-19** (indesejado): SE uma conexão passa de 35 eventos por segundo, ou envia mensagem maior que o limite do seu tipo, ou a sala já tem 100 estudantes conectados, ENTÃO O SISTEMA DEVE descartar o excesso ou recusar a conexão.
* [ ] **CA-20** (indesejado): SE `deckId`, `classSessionId` ou `initialModuleId` não existe ou é de outra turma, ENTÃO O SISTEMA DEVE recusar o início com 404 (`deck-not-found`, `class-session-not-found` ou `module-not-found`).

---

## 8. Plano de Testes (Test Plan)

Escritos antes da implementação e rodados vermelhos primeiro (SPEC-038).

### Backend (`classroom` e `platform/hub`)

* **`domain`:** invariantes de status e modos; limites do título, do nome da apresentação e das páginas do PDF (CA-03).
* **`service`:**
  * `TestStartSession_OwnerAndAdminAllowed` e `TestStartSession_AnyTimeOfDay` (CA-01); `TestStartSession_RejectsNonOwner` (CA-02); `TestStartSession_ArchivedClass` (CA-16).
  * `TestStartSession_ReturnsTheActiveOne` e `TestStartSession_Concurrent` (CA-17).
  * `TestStartSession_RejectsForeignLinks` (CA-20).
  * `TestUploadDeck_SuccessAndMaxLimit` (CA-03, CA-04).
  * `TestEndSession_UpdatesTimestampAndClosesRoom` (CA-12); `TestTeacherCanLeaveAndComeBack` e `TestSafetyNetEndsAfter12Hours` (CA-15).
  * `TestActiveSession_ReturnsSnapshot` (CA-14); `TestListSessions_ActiveFirstAndDetails` (CA-18).
  * `TestStudentNotes_SaveAndRetrieve` (CA-10).
* **`repository` (banco de teste):** `TestOnlyOneActiveSessionPerClass` (CA-17), `TestSoftDeleteKeepsNotesAndHandRaises`.
* **`handler` (`httptest`):** rotas REST com envelopes RFC 7807 e os status 200, 201, 400, 403, 404, 409 e 413 (CA-02 a CA-04, CA-10, CA-16, CA-18, CA-20).
* **`platform/hub`:** difusão de `live:slide:change` (CA-05), `live:cursor:move` (CA-06), `live:terminal:input` e `live:terminal:sync` (CA-07); descarte de mensagem de controle de estudante (CA-02); fila FIFO e moderação (CA-08, CA-09); segunda conexão do docente assumindo o controle (CA-11); `live:ended` (CA-12); `live:snapshot` primeiro (CA-14); limites de 35 eventos por segundo, de tamanho e de 100 conexões (CA-19); agrupamento a cada 30 ms.

### Frontend (Vitest e Testing Library)

* `LiveClassroom.test.tsx` (CA-12, CA-13); `SlidePresenter.test.tsx` (CA-05, CA-06, com estrangulamento de 33 ms e interpolação); `MirroredModuleView.test.tsx` (CA-07: terminal bloqueado, digitação, linha e saída); `LiveInteractionDrawer.test.tsx` (CA-08, CA-09); `StudentNotesPanel.test.tsx` (CA-10); `useLiveClassroom.test.ts` (CA-11, CA-14 e a renovação da URL).
* `LiveClassPanel.test.tsx` e o teste da página da turma: a seção "Aula ao vivo" para docente e estudante e a lista de aulas anteriores (CA-18).
* `classroomService.test.ts`: chamadas REST tipadas.
* `engine/terminalWindow.test.ts`: o adaptador informa a linha em digitação e, por comando, a linha, a saída e o estado; o modo espelho imprime sem executar nem aceitar teclado; senha não é transmitida; os testes de conformidade do motor (SPEC-030) continuam passando (CA-07).
* **Cobertura:** acima de 80% no escopo (`go test -cover` e Vitest em modo de cobertura).

### Teste manual

* Iniciar a aula como docente, sair, voltar e conferir que é a mesma; iniciar de novo e conferir que não cria outra.
* Carregar um PDF; em abas de estudante, conferir a troca das lâminas e a fluidez do ponteiro e da caneta.
* Alternar para o módulo, digitar no terminal e conferir que o estudante vê a digitação, o comando e a saída; digitar uma senha (`su`) e conferir que nada dela aparece.
* Levantar a mão e moderar; digitar anotações como estudante e consultá-las depois do encerramento.
* Conferir, na página da turma, a aula em andamento e as aulas anteriores.

---

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/ARCHITECTURE.md` (monólito modular, Hub WebSocket em memória, schema `linux_lab`, tema único escuro); `specs/GLOSSARY.md`; SPEC-009, 014, 016, 020, 030, 041, 042 e 049; `frontend/src/engine/terminalWindow.ts`.
2. **Ordem de implementação:**
   * Termos novos no `specs/GLOSSARY.md`: **Sala ao vivo** (`LiveClassroomSession`), **Apresentação** (`SlideDeck`), **Lâmina** (`Slide`), **Mão levantada** (`LiveHandRaise`) e **Anotações da aula** (`LiveClassroomNote`).
   * Testes vermelhos de serviço, repositório, hub e adaptador; commit `test(...)`.
   * Migração versionada `backend/migrations/00030_classroom.sql` com as quatro tabelas, exclusão lógica e o índice único parcial.
   * Pacote `backend/internal/platform/hub/` e, em `backend/internal/modules/classroom/`, `domain`, `repository`, `service` e `handler`; rotas e injeção em `backend/cmd/api/main.go`.
   * Adaptador do terminal (`engine/terminalWindow.ts`), conforme P-Q1.
   * Frontend: `pdfjs-dist` no `package.json`, `classroomService.ts`, `useLiveClassroom.ts`, testes vermelhos dos componentes, os componentes de `Classroom/*`, a seção "Aula ao vivo" da página da turma, a página `app/classes/[id]/live/page.tsx` e as mensagens em `messages/pt-BR.ts`.
   * Testes com cobertura acima de 80%, ESLint e Stylelint limpos e status final `Implementada`.
3. **Arquivos a criar ou alterar:**
   * Backend: `backend/migrations/00030_classroom.sql`; `backend/internal/platform/hub/hub.go` e `hub_test.go`; `backend/internal/modules/classroom/domain/{session,deck,interaction,note}.go`; `.../repository/repository.go`; `.../service/service.go` e `service_test.go`; `.../handler/handler.go` e `handler_test.go`; `backend/cmd/api/main.go`.
   * Frontend: `frontend/package.json`; `frontend/src/engine/terminalWindow.ts` e `terminalWindow.test.ts`; `frontend/src/services/classroomService.ts` e `classroomService.test.ts`; `frontend/src/hooks/useLiveClassroom.ts`; `frontend/src/components/Classroom/{LiveClassroom,SlidePresenter,MirroredModuleView,LiveInteractionDrawer,StudentNotesPanel,LiveClassPanel}/` (componente, `.module.scss` e teste de cada um); `frontend/src/app/app/classes/[id]/live/page.tsx` e `page.module.scss`; `frontend/src/app/app/classes/[id]/page.tsx` e seu teste; `frontend/src/messages/pt-BR.ts`.
   * `specs/GLOSSARY.md`.

---

## 10. Pendências para aprovação

Nenhuma. As decisões do Tech Lead de 14/10/2026 estão incorporadas, e a P-Q1 foi confirmada com a aprovação: o adaptador do terminal lê a digitação por fora do `engine/core` e, se não bastar, esta spec autoriza um aviso mínimo, só de notificação, em `engine/core/terminal/`, coberto pelos testes de conformidade (SPEC-030). "Reabrir" significa voltar à mesma aula enquanto ela está ativa; uma aula encerrada fica encerrada.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Autoria externa | Texto original trazido pelo Tech Lead |
| 14/10/2026 | Aruna Architect | Formato ajustado ao template; pendências P-01 a P-14 |
| 14/10/2026 | Aruna Architect | Parecer do autor sobre P-01 a P-14 incorporado; pendências P-N01 a P-N06 |
| 14/10/2026 | Aruna Architect | Segunda versão do autor aplicada; correções de conformidade (migração `00030`, `platform/problem`, hub em `platform/hub/`); CA-14 a CA-16; pendências P-O1 a P-O5 |
| 14/10/2026 | Aruna Architect | Decisões do Tech Lead aplicadas: iniciar e encerrar a aula a qualquer hora, sair e voltar à mesma aula, com rede de segurança de 12 horas (no lugar dos 15 minutos); uma aula ativa por turma, com índice único parcial e a seção "Aula ao vivo" na página da turma; fluidez de cerca de 30 quadros por segundo (teto de 35 por segundo no servidor) para o ponteiro, os traços e a digitação espelhada; adaptador do terminal informa a linha, a saída e o estado (P-O1); `GET .../live/sessions` (P-O2); mensagens do servidor `live:snapshot`, `live:ended`, `live:control:revoked`, `live:presence` e `live:hand:queue` (P-O3); validação dos vínculos com 404 (P-O4); limites e tamanhos de mensagem no servidor (P-O5). CA-01, CA-06, CA-07, CA-12, CA-14 e CA-15 reescritos e CA-17 a CA-20 acrescentados. Nova confirmação P-Q1 |
| 14/10/2026 | Aruna Architect | Aprovada pelo Tech Lead; P-Q1 confirmada; "reabrir" esclarecido (voltar à mesma aula ativa); status Aprovada |
