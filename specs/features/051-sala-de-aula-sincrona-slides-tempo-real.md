14-10-26-spec-sala-de-aula-sincrona-slides-tempo-real.md

# Tech Spec / SDD: Sala de Aula Síncrona, Apresentador de Slides e Espelhamento em Tempo Real

**Data:** 14/10/2026
**Escopo:** Ambos
**Módulo:** `classroom` (novo módulo de domínio no backend) e `frontend/src/components/Classroom/`
**Contexto de Tela (se aplicável):** `/app/classes/:classId/live` (visão da sala ao vivo para docente e discentes)
**Prioridade sugerida:** Alta

---

## 1. Contexto e Problema (Context & Problem Statement)

Atualmente, o ecossistema dispõe de gestão acadêmica de turmas, agenda letiva e catálogo de módulos instrucionais com terminal virtual individualizado. No entanto, durante o momento síncrono da aula, não existe um ambiente integrado de condução pedagógica. O docente depende de ferramentas externas para expor apresentações visuais e demonstrar comandos, gerando dispersão de foco e perda de contexto instrucional.

A ausência de uma sala síncrona na plataforma impede que o docente compartilhe seus slides de aula com controle centralizado de navegação e que alterne de maneira imediata para o módulo de ensino da turma com espelhamento determinístico de comandos e do cursor do mouse. Sem esse mecanismo, os acadêmicos não conseguem acompanhar em tempo real as explicações práticas no terminal e ficam privados de canais interativos organizados de manifestação de dúvidas (como fila de mãos levantadas e caderno síncrono de anotações).

---

## 2. Objetivos (Goals)

* Permitir que o docente proprietário da turma inicialize e encerre sessões síncronas de aula a qualquer momento do dia a partir da página da turma.
* Disponibilizar upload e armazenamento de apresentações em PDF no MinIO, convertendo as páginas em lâminas estáticas e gerando um deck navegável em tela cheia.
* Sincronizar em tempo real via WebSocket (NATS no backend) o estado da apresentação para todos os discentes conectados à sala: lâmina ativa, ponteiro virtual/cursor do docente e anotações visuais sobre o slide.
* Permitir a alternância fluida entre o modo "Apresentação de Slides" e o modo "Módulo de Ensino", espelhando fielmente para os estudantes o conteúdo visual e a digitação/saídas do terminal do professor em modo somente leitura para os alunos.
* Implementar fila ordenada de pedidos de fala ("Levantar a mão") para discentes, permitindo moderação direta pelo docente (deferir, abaixar ou limpar fila).
* Prover caderno individual de anotações privativas do estudante durante a sessão, persistido e consultável após a aula.
* Manter streaming pesado de áudio/vídeo explicitamente fora de escopo nesta fase, viabilizando uma solução leve, resiliente a oscilações de rede e orientada a dados síncronos de tela e cursor.

---

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

A experiência síncrona organiza-se sob a rota dedicada `/app/classes/:classId/live`, desenhada para visualização imersiva:

* **Casca da Sala Síncrona (`LiveClassroom`):**
* Barra superior de controle exibindo indicador de sessão ativa (com contador cronômetro síncrono), seletor de modo ("Slides" vs. "Módulo de Ensino"), indicador de discentes conectados, botão de alternância do caderno de anotações e botão de ação ("Encerrar Aula" para docente; "Sair da Sala" para discente).
* Painel lateral retrátil contendo a fila de dúvidas ("Mãos Levantadas") e o bloco de anotações do acadêmico.
* Área central de palco adaptativa, alternando entre o projetor de lâminas e a visão espelhada de módulos.


* **Projetor de Lâminas (`SlidePresenter`):**
* Renderizador do slide atual a partir de imagens convertidas no MinIO ou canvas de PDF vetorial via biblioteca local sem dependências externas de CDN.
* Camada de sobreposição (*canvas overlay*) capturando eventos do docente para desenhar o cursor laser virtual (coordenadas relativas percentuais X/Y) e anotações à mão livre (*drawing paths*).
* Controles do docente: avançar, retroceder, ir para slide N, ativar laser, caneta de anotação e limpar rabiscos.
* Para discentes: palco em modo receptor estrito, escutando mensagens WebSocket e atualizando o slide, a posição do ponteiro do docente com animação suave e os traços de caneta sem permitir interferência discente sobre o slide.


* **Modo Módulo de Ensino Espelhado (`MirroredModuleView`):**
* Renderiza a estrutura da tela de estudo do módulo (`TopicStudy`), instanciando o motor do terminal em modo mestre para o docente e em modo escravo/espelho para os estudantes.
* Toda tecla ou comando processado no terminal do docente gera um broadcast dos deltas de saída ou do buffer de tela para os discentes, mantendo os terminais discentes travados contra entrada de teclado.


* **Fila de Dúvidas e Caderno de Anotações (`LiveInteractionDrawer`):**
* Componente de mão levantada: botão discente "Levantar a mão" que emite evento para a sala. Lista ordenada exibida ao docente com ações para abaixar a mão individual ou coletivamente.
* Bloco de anotações privativas do estudante: editor de texto plano integrado salvando alterações automaticamente via debounce no serviço REST da aula.


* **Gerenciamento de Conexão e Hooks:**
* Hook `useLiveClassroom`: gerencia o ciclo de vida da conexão WebSocket com reconexão automática e tratamento de perda de conectividade.
* Estilização estrita via SCSS Modules e tokens semânticos de `_tokens.scss`, garantindo paridade nos modos claro e escuro e alvos de clique ergonômicos.



### 3.2. Backend (Go — Camada de Módulo/Service)

O módulo `classroom` no backend Go estrutura-se sob os princípios de Clean Architecture e DDD-lite:

* **Ciclo de Vida da Sessão da Aula:**
* O Service valida a posse da turma pelo docente autenticado ou perfil de administrador e permite inicializar a sessão criando um registro ativo de sala.
* Caso já exista uma sessão aberta para a mesma turma, o endpoint reaproveita o contexto ativo em vez de gerar duplicação.
* O encerramento da aula atualiza o carimbo de término e encerra compulsoriamente os canais de transmissão WebSocket da sala.


* **Processamento de Apresentações e Slides:**
* O Handler recebe o arquivo PDF via formulário multipart, validando tamanho e formato MIME.
* O Service orquestra a conversão das páginas do documento em imagens otimizadas no padrão AVIF ou armazenamento estruturado no MinIO com prefixo seguro, registrando a contagem de lâminas e gerando as URLs públicas assinadas correspondentes.


* **Comunicação em Tempo Real e Broadcast (NATS):**
* Handlers de WebSocket autenticados via token de sessão, associando a conexão ao ID da turma e da sessão ativa.
* Assinatura e publicação em tópicos orientados por turma e sessão no NATS.
* Tipos de mensagens síncronas tratadas no gateway WebSocket:
* Mudança de lâmina ativa (número do slide).
* Coordenadas do ponteiro/mouse do docente (valores percentuais X, Y normalizados de 0 a 100).
* Traços e anotações vetoriais sobre a lâmina.
* Alternância de contexto de tela (modo de apresentação de slides versus modo de módulo de ensino e ID do bloco ativo).
* Stream de buffer do terminal do docente durante demonstrações no módulo.
* Eventos de moderação: solicitação de fala de estudante (mão levantada), concessão e baixa de fila.




* **Isolamento de Segurança e RBAC:**
* Docentes têm exclusividade sobre comandos de broadcast de slides, coordenadas de cursor e controle de terminal. Mensagens de controle originadas por conexões com papel de estudante são descartadas com log de infração.
* Discentes só podem publicar mensagens do tipo "mão levantada" e requisições individuais de anotação privativa.



---

## 4. Modelo de Dados (Data Model)

A modelagem de dados situa-se no schema `project-manager`:

* **Tabela `live_sessions`:**
* Identificador único UUIDv7 como chave primária.
* Chave estrangeira `class_id` referenciando a tabela `classes`.
* Chave estrangeira `teacher_id` referenciando `users(id)` (docente responsável).
* Título ou tema descritivo da aula (texto, obrigatório).
* Chave estrangeira anulável referenciando a apresentação vinculada (`deck_id`).
* Modo ativo da sala (enumeração: `SLIDES`, `MODULE`).
* Chave estrangeira anulável referenciando o módulo de ensino ativo (`active_module_id`).
* Slide ativo no momento (inteiro, padrão 1).
* Status da sessão (enumeração: `ACTIVE`, `FINISHED`).
* Carimbos temporais: início da sessão (obrigatório), término da sessão (anulável) e controle de auditoria (`created_at`, `updated_at`, `deleted_at`).
* Índices: índice composto sobre turma e status ativo, garantindo consulta imediata da sala em curso.


* **Tabela `slide_decks`:**
* Identificador único UUIDv7 como chave primária.
* Chave estrangeira `class_id` referenciando `classes(id)`.
* Chave estrangeira `uploaded_by` referenciando `users(id)`.
* Título original do arquivo e descrição sumária.
* Caminho/chave de armazenamento do arquivo de origem no MinIO.
* Total de lâminas/páginas processadas (inteiro, maior que zero).
* Chave de prefixo no MinIO das imagens de cada slide.
* Carimbos de criação, alteração e exclusão lógica.


* **Tabela `live_hand_raises`:**
* Identificador único UUIDv7 como chave primária.
* Chave estrangeira `session_id` referenciando `live_sessions(id) ON DELETE CASCADE`.
* Chave estrangeira `student_id` referenciando `users(id)`.
* Status da solicitação (enumeração: `PENDING`, `ANSWERED`, `LOWERED`).
* Carimbo temporal da solicitação (usado para ordenação estrita FIFO na fila docente).
* Carimbo de atendimento ou baixa.


* **Tabela `student_live_notes`:**
* Identificador único UUIDv7 como chave primária.
* Chave estrangeira `session_id` referenciando `live_sessions(id) ON DELETE CASCADE`.
* Chave estrangeira `student_id` referenciando `users(id)`.
* Conteúdo textual das anotações privativas (texto longo).
* Carimbos de criação e atualização contínua.
* Unicidade composta: um único caderno de anotações por estudante e sessão ativa.



---

## 5. Contrato de API (API Contract)

### 5.1. POST /api/v1/classes/{classId}/live/start

Inicializa a sessão síncrona da turma ou recupera a sessão já em andamento.

* **Papéis autorizados:** `TEACHER` (proprietário da turma) e `ADMIN`.
* **Parâmetros de rota:** identificador UUIDv7 da turma (`classId`).
* **Campos descritivos de entrada:**
* `title`: texto, obrigatório (1 a 120 caracteres).
* `deckId`: UUIDv7, opcional (apresentação previamente enviada).
* `initialModuleId`: UUIDv7, opcional (caso inicie direto no módulo de ensino).


* **Estrutura lógica de resposta (HTTP 201 Created / 200 OK):**
* Objeto contendo identificador da sessão, turma, status da sala (`ACTIVE`), modo inicial, slide ativo e carimbo de inicialização.


* **Erros (RFC 7807):**
* HTTP 400 Bad Request (`validation-error`): título ausente ou inválido.
* HTTP 403 Forbidden (`forbidden`): usuário não é o docente responsável pela turma.
* HTTP 404 Not Found (`class-not-found`): turma inexistente ou inativa.



---

### 5.2. POST /api/v1/classes/{classId}/live/decks

Realiza upload de apresentação em PDF para uso na aula síncrona.

* **Papéis autorizados:** `TEACHER` (proprietário da turma) e `ADMIN`.
* **Parâmetros de rota:** identificador UUIDv7 da turma (`classId`).
* **Entrada via multipart/form-data:**
* `file`: binário em formato PDF (tamanho máximo de 25 MB).
* `title`: texto descritivo da apresentação.


* **Estrutura lógica de resposta (HTTP 201 Created):**
* Identificador do deck, total de lâminas extraídas, lista indexada das URLs de cada slide e carimbo de criação.


* **Erros (RFC 7807):**
* HTTP 400 Bad Request (`unsupported-file-type`): arquivo não é um PDF válido.
* HTTP 413 Payload Too Large (`file-too-large`): tamanho superior a 25 MB.
* HTTP 403 Forbidden (`forbidden`): sem autorização sobre a turma.



---

### 5.3. POST /api/v1/classes/{classId}/live/{sessionId}/end

Encerra a aula síncrona e finaliza as conexões ativas.

* **Papéis autorizados:** `TEACHER` (proprietário) e `ADMIN`.
* **Parâmetros de rota:** `classId` e `sessionId`.
* **Entrada:** Nenhuma entrada via corpo.
* **Estrutura lógica de resposta (HTTP 200 OK):**
* Identificador da sessão, status alterado para `FINISHED`, horário final consolidado e total de minutos de duração.


* **Erros (RFC 7807):**
* HTTP 403 Forbidden (`forbidden`): não é o proprietário.
* HTTP 404 Not Found (`session-not-found`): sessão inexistente ou já finalizada.



---

### 5.4. GET /api/v1/classes/{classId}/live/active

Consulta os dados da sessão síncrona em andamento para ingresso de estudantes e docentes.

* **Papéis autorizados:** `TEACHER`, `ADMIN` e `STUDENT` (com matrícula ativa na turma).
* **Parâmetros de rota:** `classId`.
* **Estrutura lógica de resposta (HTTP 200 OK):**
* Dados da sessão ativa, deck associado com lista de slides, modo corrente, slide ativo, identificador do módulo caso esteja em modo módulo e total de estudantes online. Caso não haja aula ativa, retorna status sem sessão em andamento.


* **Erros (RFC 7807):**
* HTTP 403 Forbidden (`forbidden`): discente sem vínculo ativo com a turma.
* HTTP 404 Not Found (`class-not-found`): turma inexistente.



---

### 5.5. PUT /api/v1/classes/{classId}/live/{sessionId}/notes

Grava ou atualiza as anotações individuais do estudante conectado.

* **Papéis autorizados:** `STUDENT` (com matrícula ativa na turma).
* **Parâmetros de rota:** `classId` e `sessionId`.
* **Campos descritivos de entrada:**
* `content`: texto livre, até 20.000 caracteres.


* **Estrutura lógica de resposta (HTTP 200 OK):**
* Confirmação de persistência, tamanho gravado e carimbo de alteração.


* **Erros (RFC 7807):**
* HTTP 400 Bad Request (`content-too-long`): excede o limite permitido.
* HTTP 403 Forbidden (`forbidden`): sem matrícula ativa.



---

### 5.6. Protocolo WebSocket (`/ws/classes/{classId}/live`)

Canal bidirecional síncrono mantido sobre NATS:

* **Autenticação:** validada na conexão inicial via cookie de sessão seguro (`linux_lab_session`).
* **Mensagens emitidas exclusivamente pelo Docente (Broadcast para a Sala):**
* `slide:change`: índice numérico da lâmina ativa.
* `cursor:move`: percentual horizontal e vertical (X e Y) do cursor e estado do laser.
* `canvas:draw`: coordenadas vetoriais para traçado ou limpeza do slide.
* `mode:switch`: alternância de visualização (`SLIDES` ou `MODULE`) e ID do módulo didático.
* `terminal:stream`: chunk textual do terminal espelhado para os discentes.
* `hand:moderate`: ação do docente sobre a fila de mãos levantadas (abaixar mão de estudante específico ou de todos).


* **Mensagens emitidas por Discentes (Encaminhadas ao Docente / Sala):**
* `hand:raise`: evento informando intenção de fala do estudante conectado.
* `hand:cancel`: retirada voluntária da intenção de fala pelo próprio estudante.



---

## 6. Impacto e Riscos (Impact & Risks)

* **Risco de Sobrecarga de Rede por Eventos Contínuos de Cursor do Mouse:**
* O envio de coordenadas de mouse a cada pixel percorrido pode saturar o canal WebSocket e sobrecarregar o broker NATS.
* *Mitigação:* O cliente frontend aplicará estrangulamento (*throttling*) fixo nas emissões de cursor para o intervalo de 50 milissegundos (aproximadamente 20 frames por segundo), interpolando o movimento visualmente no lado discente através de transições suaves CSS (`transition: transform`).


* **Risco de Injeção de Comandos Não Autorizados via Terminal Espelhado:**
* Alunos mal-intencionados tentarem injetar entradas no canal de terminal durante o espelhamento do módulo.
* *Mitigação:* O backend rejeitará imediatamente qualquer mensagem de terminal originada de conexões associadas ao papel `STUDENT`, aplicando o terminal dos estudantes puramente em modo *read-only* acoplado ao stream do docente.


* **Risco de Arquivos PDF Corrompidos ou Pesados no Upload:**
* O upload de apresentações pesadas travar o processo de extração de páginas no servidor.
* *Mitigação:* Limite rígido de 25 MB e 100 páginas por documento, executando a validação sintática do arquivo no backend antes de despachar a extração e retornando erro RFC 7807 imediato caso o documento esteja danificado ou protegido por senha.


* **Risco de Desconexão Inesperada e Perda de Estado da Aula:**
* Oscilações de conexão no terminal do professor interromperem a experiência dos estudantes.
* *Mitigação:* O estado canônico da aula (modo ativo, slide corrente e tema) reside persistido na entidade `live_sessions` do banco Postgres, permitindo que o professor e os alunos reconectem e restaurem o mesmo instante da apresentação instantaneamente.



---

## 7. Critérios de Aceite (Acceptance Criteria)

* [ ] **CA-01** (evento): QUANDO o docente proprietário acionar o comando de inicializar a aula, O SISTEMA DEVE criar ou recuperar a sessão ativa da turma e liberar o ambiente de apresentação síncrona.
* [ ] **CA-02** (segurança): SE um discente ou docente não proprietário tentar inicializar ou encerrar a sessão da aula, ENTÃO O SISTEMA DEVE recusar com código HTTP 403 (RFC 7807).
* [ ] **CA-03** (evento): QUANDO o docente enviar uma apresentação em PDF válida de até 25 MB, O SISTEMA DEVE persistir o documento no MinIO, gerar a contagem de slides e disponibilizá-lo para projeção na sala.
* [ ] **CA-04** (sincronização): QUANDO o docente avançar ou retroceder um slide na apresentação, O SISTEMA DEVE replicar a troca de lâmina instantaneamente via WebSocket para todos os estudantes conectados à sessão.
* [ ] **CA-05** (sincronização): QUANDO o docente movimentar o cursor laser sobre o slide, O SISTEMA DEVE sincronizar a posição relativa para os discentes com estrangulamento de eventos e movimentação fluida.
* [ ] **CA-06** (interação): QUANDO um estudante acionar a opção de levantar a mão, O SISTEMA DEVE registrar a solicitação em ordem cronológica FIFO e exibi-la imediatamente no painel de moderação do docente.
* [ ] **CA-07** (moderação): QUANDO o docente abaixar a mão de um estudante ou limpar a fila, O SISTEMA DEVE refletir a alteração para todos os integrantes da sala sem recarregar a tela.
* [ ] **CA-08** (modo alternado): QUANDO o docente comutar a aula para o modo "Módulo de Ensino", O SISTEMA DEVE carregar o módulo didático correspondente para todos os alunos e espelhar o terminal do professor em modo estritamente somente leitura para os acadêmicos.
* [ ] **CA-09** (persistência): QUANDO um estudante digitar anotações em seu caderno pessoal durante a aula, O SISTEMA DEVE persistir o conteúdo de forma automática vinculando-o à sua conta e à sessão da turma.
* [ ] **CA-10** (encerramento): QUANDO o docente finalizar a aula síncrona, O SISTEMA DEVE registrar o carimbo de encerramento, fechar os canais de broadcast WebSocket e notificar visualmente os estudantes da conclusão da sessão.
* [ ] **CA-11** (acessibilidade e tema): QUANDO a sala síncrona for renderizada em tema claro ou escuro, A INTERFACE DEVE aplicar estritamente as variáveis semânticas de `_tokens.scss`, garantindo contraste adequado WCAG AA e navegação de slides operável por teclado (setas direcionais e barra de espaço).

---

## 8. Plano de Testes (Test Plan)

### Backend

* **Testes Unitários de Service (`classroom/service`):**
* Validação de inicialização de sessão para docente autorizado e rejeição para usuário sem vínculo proprietário com a turma (cobre CA-01 e CA-02).
* Validação de regras de upload e extração de deck de slides, conferindo rejeição de formatos não suportados e arquivos acima de 25 MB (cobre CA-03).
* Gestão da fila de mãos levantadas assegurando ordenação estrita por tempo de entrada (FIFO) e limpeza por moderação docente (cobre CA-06 e CA-07).
* Persistência e atualização contínua de anotações individuais de estudantes com isolamento estrito entre usuários (cobre CA-09).
* Encerramento de sessão com atualização de timestamp e invalidação de novos broadcasts (cobre CA-10).


* **Testes de Integração de Handlers e WebSocket (`classroom/handler`):**
* Testes com `httptest` validando rotas REST de início, encerramento, upload e consulta de aula ativa com envelopes RFC 7807.
* Teste de gateway WebSocket simulando conexões simultâneas de professor e estudantes: disparo de `slide:change` e `cursor:move` conferindo broadcast fiel para alunos e descarte de tentativas de entrada discente em canais de controle.



### Frontend

* **Testes Automatizados de Componente (Vitest e Testing Library):**
* Renderização do componente `SlidePresenter` validando exibição da lâmina ativa, navegação por teclado (setas esquerda e direita) e presença dos botões de controle docente (cobre CA-04 e CA-11).
* Teste do receptor discente garantindo que cliques ou toques sobre o slide e terminal não emitam eventos de mutação e permaneçam desabilitados (cobre CA-05 e CA-08).
* Teste do componente de fila de dúvidas conferindo disparo do evento de levantar a mão e feedback visual de atendimento (cobre CA-06 e CA-07).
* Teste de alternância entre tema claro e tema escuro verificando ausência de cores hardcoded e aplicação das propriedades semânticas (cobre CA-11).


* **Teste Manual e de Usabilidade em Campo:**
* Acessar a turma como docente pelo navegador desktop, iniciar a aula e carregar uma apresentação PDF.
* Acessar a mesma sala síncrona em duas abas de estudante (uma em desktop e outra em visualização mobile).
* Avançar os slides e desenhar com a caneta virtual, constatando atualização imediata e sincronizada nas abas dos alunos.
* Alternar a visualização para o módulo instrucional e executar comandos no terminal, confirmando que os acadêmicos acompanham as saídas sem conseguir digitar no console.
* Levantar a mão como estudante, atender no painel docente e encerrar a aula validando a desconexão amigável da sala.



---

## 9. Contexto Final da IA (AI Final Context Execution)

Para implementar esta especificação, execute as alterações e criações no backend e frontend na seguinte ordem arquitetural:

1. **Backend — Migração de Banco de Dados:**
* Criar migração versionada provisionando as tabelas `live_sessions`, `slide_decks`, `live_hand_raises` e `student_live_notes` no schema `project-manager`.


2. **Backend — Camadas de Domínio, Repositório e Serviço (`backend/internal/modules/classroom/`):**
* Implementar entidades de domínio e validações de sessão em `domain/`.
* Implementar interfaces e persistência via GORM em `repository/`.
* Implementar lógica de controle síncrono, autorização de turma e integração NATS em `service/`.
* Implementar handlers HTTP Gin e gateway WebSocket em `handler/`.
* Configurar injeção de dependências no composition root em `backend/cmd/api/main.go`.


3. **Frontend — Camada de Serviços e Integração:**
* Criar `frontend/src/services/classroomService.ts` com métodos tipados para API REST e cliente WebSocket.
* Criar hook `frontend/src/hooks/useLiveClassroom.ts` gerenciando o estado síncrono da sala.


4. **Frontend — Componentes Visuais e Telas:**
* Desenvolver componentes co-localizados:
* `frontend/src/components/Classroom/LiveClassroom/`
* `frontend/src/components/Classroom/SlidePresenter/`
* `frontend/src/components/Classroom/MirroredModuleView/`
* `frontend/src/components/Classroom/LiveInteractionDrawer/`
* `frontend/src/components/Classroom/StudentNotesPanel/`


* Implementar a página da sala síncrona em `frontend/src/app/app/classes/[id]/live/page.tsx` com seu respectivo `.module.scss`.
* Centralizar todas as mensagens de interface em `frontend/src/messages/pt-BR.ts`.


5. **Testes e Validação:**
* Escrever testes automatizados no backend e frontend cobrindo todos os critérios de aceite (CA-01 a CA-11) assegurando cobertura superior a 80%, sem pendências em linter ou Stylelint.