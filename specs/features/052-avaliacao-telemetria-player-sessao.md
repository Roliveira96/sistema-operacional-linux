14-10-26-spec-avaliacao-telemetria-player-sessao.md

# Tech Spec / SDD: Módulo de Avaliações com Telemetria Forense, Gravação e Reprodução de Sessão

**Data:** 14/10/2026

**Escopo:** Ambos

**Módulo:** `assessment`

**Contexto de Tela:** `/app/classes/:classId/assessments/:assessmentId/take` (aluno) e `/app/classes/:classId/assessments/:assessmentId/submissions/:submissionId/review` (docente)

**Prioridade sugerida:** Alta

---

## 1. Contexto e Problema (Context & Problem Statement)

Atualmente, o ecossistema permite o gerenciamento acadêmico de turmas, criação de módulos didáticos com exercícios práticos e teóricos e condução síncrona de aulas ao vivo. No entanto, não há um fluxo estruturado e seguro para a aplicação formal de exames, provas ou listas de exercícios avaliativas com prazos rígidos vinculados a uma turma.

A ausência de um módulo de avaliação estruturado impede a mensuração formal de desempenho acadêmico com integridade e transparência. Exames online sem acompanhamento e telemetria deixam o corpo docente desprovido de evidências forenses sobre a autenticidade da resolução, dificultando a identificação de condutas indevidas (como uso de atalhos de desenvolvedor, cópia/cola e evasão de foco de janela). Além disso, a falta de dados granulares impede que o docente identifique com precisão em quais questões específicas o estudante enfrentou maior tempo de atrito, bloqueio ou hesitação.

---

## 2. Objetivos (Goals)

* Permitir ao docente proprietário criar e gerenciar atividades/avaliações vinculadas à turma, definindo período de vigência global e duração máxima individual opcional cronometrada por tentativa.


* Permitir a seleção e composição de cadernos avaliativos contendo questões práticas e teóricas (verdadeiro/falso, escolha única, ligar colunas e descritivas), oriundas do banco de questões ou criadas no ato.


* Prover tela inicial obrigatória de apresentação de regras e aceite discente para desbloqueio do exame.
* Realizar submissão compulsória do estado da avaliação ao término do cronômetro individual ou da janela da atividade, incorporando tolerância técnica máxima de 1 minuto para absorção de latências de rede.
* Capturar telemetria comportamental contínua do estudante no cliente: dimensões de viewport/resolução, coordenadas de mouse com normalização percentual, teclas/comandos no terminal virtual, tempos de permanência por questão e eventos de segurança (atalhos de cópia/cola, atalhos de inspeção do navegador, perda de foco e mudança de visibilidade de aba).


* Transmitir a telemetria agregada via canal bidirecional síncrono WebSocket com persistência em lotes a cada 15 segundos no backend, mantendo contingência via envio assíncrono caso ocorra desconexão.


* Exibir alertas visuais imediatos ao discente na interface sempre que um evento de infração ou anomalia de segurança for interceptado.


* Calcular pontuação provisória automática ao submeter a tentativa, mantendo status pendente de homologação pelo docente, o qual poderá revisar e alterar a nota final de cada resposta e da prova.


* Disponibilizar ao docente um reprodutor visual temporal (Player de Sessão) na área de revisão, permitindo reproduzir a movimentação do mouse, cliques, digitação de comandos, alternâncias entre questões e marcadores visuais de incidentes em velocidades ajustáveis de 1x a 10x.



---

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

A experiência é segregada entre o fluxo discente de execução e o fluxo docente de supervisão e revisão:

* **Configuração da Atividade pelo Docente (`AssessmentForm`):**
* Formulário com dados cadastrais: título descritivo, instruções gerais, janela global (data/hora de início e término) e seletor booleano de duração individual cronometrada (em minutos).
* Seletor de composição de caderno: listagem do banco de questões com filtros por módulo, dificuldade e tipo, permitindo ordenação sequencial e adição de novas questões customizadas.


* Estado da atividade: alternador entre rascunho/inativo e ativo/publicado.


* **Fluxo do Estudante — Termo e Sala de Entrada (`AssessmentGate`):**
* Rota de abertura contendo apresentação das regras da prova, duração estimada, janela limite e regras de monitoramento.
* Botão de consentimento e confirmação que realiza o acionamento da tentativa no servidor e direciona à esteira de prova.


* **Fluxo do Estudante — Esteira de Realização (`AssessmentRunner`):**
* Barra superior de navegação: indicador do tempo restante (cronômetro regressivo com destaque visual quando restar menos de 5 minutos) e botão de entrega voluntária da prova.
* Painel lateral retrátil de navegação por questões: lista contendo a numeração dos itens (suportando até 100 itens), marcadores visuais de estado (questão pendente, questão preenchida e questão com terminal em execução) e indicador de tempo acumulado na questão atual.
* Palco central dinâmico: renderiza o componente correspondente ao tipo da questão atual (terminal virtual POSIX em modo interativo, formulário de verdadeiro/falso, escolha única com alternativas embaralhadas, ligar colunas com linhas SVG, ou caixa descritiva formatada com restrição a texto e comandos).


* Sistema de avisos visuais (*Toast Alert* flutuante): exibe notificações em tempo real sempre que for detectada cópia (`Ctrl+C`), colagem (`Ctrl+V`), clique com botão direito, perda de foco da janela (`blur`), ocultamento da página (`visibilitychange`) ou acionamento de atalhos restritos (como `F12`, `Ctrl+Shift+I`).




* **Mecanismo de Telemetria no Cliente (`useAssessmentTelemetry`):**
* Captura as dimensões da viewport do navegador no início e a cada evento de redimensionamento (`resize`).
* Coleta coordenadas de cursor e cliques normalizando os valores para proporções relativas percentuais (de 0.00% a 100.00%) com base na resolução de tela capturada, eliminando distorções de escala na reprodução docente.
* Agrupa as amostras de mouse, teclas no terminal virtual, transições entre questões e ocorrências de segurança em uma fila em memória.


* Dispara o envio dos lotes agregados a cada 15 segundos via canal WebSocket.


* Gerenciamento de expiração e tolerância: calcula a contagem regressiva baseada no relógio do servidor. Ao zerar o tempo da tentativa ou da janela global, bloqueia a interface de edição e despacha automaticamente o payload final de submissão com limite de tolerância de 1 minuto para resposta da rede. Caso o canal WebSocket caia, recorre ao envio de contingência via requisição REST padrão.




* **Painel de Revisão Docente e Player de Sessão (`SessionPlayer`):**
* Cabeçalho de revisão: notas parciais calculadas automaticamente para questões objetivas e práticas, lista de questões descritivas com campo para pontuação manual (faixas de 0% a 100% ou edição livre de nota) e botão de homologação da nota final.


* Palco do Player: espelho do layout visual com dimensões parametrizadas pela resolução do aluno, contendo um cursor visual animado que reproduz o percurso do mouse e os cliques efetuados.
* Linha do tempo interativa (*Timeline Scrubbing*): barra de progresso temporal exibindo a duração total da prova, com marcadores visuais coloridos indicando onde ocorreram transições de questão, execuções de comandos no terminal e incidentes de segurança interceptados (atalhos indevidos ou evasão de aba).


* Controles de reprodução: Play, Pause, navegação salto de 10 segundos, e seletor de velocidade dinâmica (1x, 2x, 3x, 5x e 10x).


* **Estilização e Conformidade:**
* Aplicação exclusiva de SCSS Modules e tokens semânticos declarados em `_tokens.scss` sob o tema único escuro.


* Alvos de clique de no mínimo 44 px e acessibilidade total via teclado para a navegação discente.





### 3.2. Backend (Go — Camada de Módulo/Service)

O módulo `assessment` estrutura-se sob os princípios de Clean Architecture e DDD-lite:

* **Camada de Domínio (`domain`):**
* Entidades: `Assessment` (configuração da atividade), `AssessmentItem` (questão associada à atividade com pontuação e ordem), `AssessmentAttempt` (sessão avaliativa individual do discente), `QuestionResponse` (registro de resposta dada a cada item), `TelemetryBatch` (bloco temporal de rastreamento) e `SecurityViolationEvent` (ocorrência indelével de infração).


* Enumerações de status da atividade (`DRAFT`, `PUBLISHED`, `ARCHIVED`), status da tentativa (`NOT_STARTED`, `IN_PROGRESS`, `SUBMITTED`, `TIME_EXPIRED`, `LOCKED_BY_PROCTOR`, `ANNULLED`) e origens de nota (`AUTO_GRADE`, `TEACHER_HOMOLOGATED`).


* Regra de tolerância: o servidor calcula o vencimento absoluto combinando o horário de início da tentativa com o tempo de duração da prova, acrescido de 1 minuto de margem técnica para confirmação do payload de entrega. Requisições recebidas após esse limiar técnico são marcadas compulsoriamente com o status de encerramento por tempo esgotado (`TIME_EXPIRED`).




* **Camada de Serviço (`service`):**
* `CreateAssessment` e `UpdateAssessment`: valida permissão docente sobre a turma, coerência das datas de janela temporal e integridade da lista de itens.


* `StartAttempt`: valida se a atividade está no período de vigência, se o discente possui matrícula ativa na turma e se já não existe tentativa prévia concluída. Registra o carimbo exato de início e emite o token da sessão de prova.


* `ProcessTelemetryBatch`: recebe o pacote periódico de telemetria via WebSocket ou endpoint de contingência REST, valida o identificador da tentativa, persiste as coordenadas e logs de eventos agregados e extrai violações de segurança para a tabela de incidentes indelével.


* `SubmitAttempt`: processa a entrega da avaliação, submete os snapshots de terminais das questões práticas ao motor de correção no servidor, afere as respostas de verdadeiro/falso, escolha única e ligar colunas, calcula a nota bruta provisória e deixa as questões descritivas com status pendente de avaliação.


* `UpdateGradesAndHomologate`: permite que o docente altere a pontuação de qualquer item, registre justificativa formal de revisão e homologue a nota definitiva da tentativa.


* `GetSessionReplayData`: consolida os pacotes temporais de telemetria, resolução de tela e eventos da linha do tempo para carregamento estruturado no Player do docente.


* **Camada de Transporte e WebSocket (`handler`):**
* Handlers REST mapeados sob `/api/v1/classes/:classId/assessments` utilizando Gin-Gonic com conversão de erros de domínio para RFC 7807 pelo pacote `customerrors`.


* Gateway WebSocket em memória operando no endpoint da tentativa, validando conexão autenticada e canalizando as rajadas de telemetria de 15 segundos com separação concorrente de leitura e escrita por conexão.





---

## 4. Modelo de Dados (Data Model)

Todas as entidades situam-se no schema `project-manager` do PostgreSQL, utilizando identificadores UUIDv7, controle temporal de auditoria e suporte a exclusão lógica conforme as diretrizes do ecossistema:

* **Tabela `assessments`:**
* Identificador único UUIDv7 como chave primária.
* Chave estrangeira referenciando a turma em `classes`.
* Chave estrangeira referenciando o docente criador em `users`.
* Título descritivo da avaliação (texto de 1 a 150 caracteres).
* Instruções gerais para a prova (texto longo formatado).
* Janela temporal: data/hora de abertura e data/hora de encerramento da atividade.
* Duração máxima cronometrada individual em minutos (inteiro anulável; nulo indica realização livre durante o período da janela).
* Status da atividade (enumeração: `DRAFT`, `PUBLISHED`, `ARCHIVED`).
* Carimbos temporais de auditoria e exclusão lógica.
* Índices: índice composto sobre turma e status da avaliação.


* **Tabela `assessment_items`:**
* Identificador único UUIDv7 como chave primária.
* Chave estrangeira referenciando a avaliação em `assessments`.
* Chave estrangeira referenciando a questão em `questions`.
* Posição ordinal na sequência da prova (inteiro maior que zero).
* Peso ou valor numérico de pontuação atribuído à questão.
* Carimbos de criação, atualização e exclusão lógica.
* Unicidade composta: uma questão não pode ser duplicada dentro da mesma avaliação.


* **Tabela `assessment_attempts`:**
* Identificador único UUIDv7 como chave primária.
* Chave estrangeira referenciando a avaliação em `assessments`.
* Chave estrangeira referenciando o estudante em `users`.
* Status da tentativa (enumeração: `NOT_STARTED`, `IN_PROGRESS`, `SUBMITTED`, `TIME_EXPIRED`, `LOCKED_BY_PROCTOR`, `ANNULLED`).
* Resolução/viewport inicial informada pelo cliente (largura e altura em pixels).
* Carimbo de data/hora de início efetivo da tentativa.
* Carimbo de data/hora de término ou entrega da tentativa.
* Nota provisória bruta calculada pelo sistema.
* Nota final definitiva homologada pelo docente.
* Justificativa textual formal de homologação/revisão docente.
* Chave estrangeira anulável referenciando o docente que homologou a nota final.
* Carimbos de auditoria e exclusão lógica.
* Unicidade composta: um único registro de tentativa por estudante e avaliação.


* **Tabela `assessment_responses`:**
* Identificador único UUIDv7 como chave primária.
* Chave estrangeira referenciando a tentativa em `assessment_attempts`.
* Chave estrangeira referenciando o item da avaliação em `assessment_items`.
* Payload estruturado com a resposta enviada (conteúdo descritivo, escolha selecionada, pares ligados ou snapshot serializado do terminal virtual).
* Tempo total acumulado despendido pelo discente nesta questão específica (em segundos).
* Pontuação preliminar obtida na correção automática.
* Pontuação final consolidada pelo docente.
* Carimbos de criação, alteração e exclusão lógica.


* **Tabela `assessment_telemetry_batches`:**
* Identificador único UUIDv7 como chave primária.
* Chave estrangeira referenciando a tentativa em `assessment_attempts`.
* Sequencial do lote (inteiro incremental).
* Intervalo temporal coberto pelo lote (carimbo inicial e carimbo final).
* Dados brutos compactados contendo a série cronológica de coordenadas normalizadas de cursor (X, Y percentuais), eventos de clique, foco e entradas de terminal.
* Carimbo de persistência.


* **Tabela `assessment_security_events`:**
* Identificador único UUIDv7 como chave primária.
* Chave estrangeira referenciando a tentativa em `assessment_attempts`.
* Chave estrangeira anulável referenciando a questão ativa no instante do evento.
* Tipo de incidente registrado (enumeração: `COPY_ATTEMPT`, `PASTE_ATTEMPT`, `DEVTOOLS_SHORTCUT`, `BLUR_WINDOW`, `TAB_HIDDEN`, `CONTEXT_MENU`).
* Carimbo temporal exato da ocorrência no servidor.
* Metadados descritivos da infração.



---

## 5. Contrato de API (API Contract)

### 5.1. Criação e Configuração de Avaliação

`POST /api/v1/classes/:classId/assessments`

* **Papéis autorizados:** `TEACHER` (proprietária da turma) e `ADMIN`.
* **Parâmetros de rota:** identificador UUID da turma (`classId`).
* **Campos descritivos de entrada:**
* `title`: texto, obrigatório, de 1 a 150 caracteres.
* `instructions`: texto formatado, opcional.
* `startDate`: timestamp ISO 8601 com fuso horário, obrigatório.
* `endDate`: timestamp ISO 8601 com fuso horário, obrigatório (deve ser posterior a `startDate`).
* `timeLimitMinutes`: inteiro, opcional (duração do cronômetro individual em minutos).
* `items`: lista de objetos contendo `questionId` (UUID) e `weight` (decimal positivo), mínimo de 1 item.


* **Estrutura de resposta de sucesso (HTTP 201 Created):**
* Objeto contendo os dados da atividade gerada: identificador, turma, título, status inicial (`DRAFT`), janela de datas, limite em minutos e total de questões vinculadas.


* **Erros (RFC 7807):**
* HTTP 400 Bad Request (`validation-error`): datas invertidas, lista de itens vazia ou peso inválido.
* HTTP 403 Forbidden (`forbidden`): usuário não é o docente responsável pela turma.
* HTTP 404 Not Found (`class-not-found`): turma inexistente ou inativa.



---

### 5.2. Início de Tentativa pelo Estudante

`POST /api/v1/classes/:classId/assessments/:assessmentId/start`

* **Papéis autorizados:** `STUDENT` (com matrícula ativa na turma).
* **Parâmetros de rota:** identificador da turma (`classId`) e da avaliação (`assessmentId`).
* **Campos descritivos de entrada:**
* `viewportWidth`: inteiro, obrigatório (largura da janela em pixels).
* `viewportHeight`: inteiro, obrigatório (altura da janela em pixels).
* `acceptedInstructions`: booleano, obrigatório (deve ser estritamente verdadeiro).


* **Estrutura de resposta de sucesso (HTTP 201 Created ou 200 OK):**
* Objeto contendo dados da tentativa ativa: identificador da tentativa, carimbo de início, carimbo limite absoluto de término calculado pelo servidor, lista de questões (sem gabaritos ou soluções de referência) e status da tentativa (`IN_PROGRESS`).


* **Erros (RFC 7807):**
* HTTP 400 Bad Request (`instructions-not-accepted`): consentimento não marcado.
* HTTP 403 Forbidden (`outside-assessment-window`): requisição fora da janela global da avaliação.
* HTTP 409 Conflict (`attempt-already-submitted`): o estudante já concluiu e enviou a avaliação.



---

### 5.3. Submissão e Finalização da Avaliação

`POST /api/v1/classes/:classId/assessments/:assessmentId/attempts/:attemptId/submit`

* **Papéis autorizados:** `STUDENT` (autor da tentativa).
* **Parâmetros de rota:** `classId`, `assessmentId` e `attemptId`.
* **Campos descritivos de entrada:**
* `responses`: lista de objetos contendo `itemId`, payload com a resposta dada e tempo acumulado despendido na questão em segundos.
* `finalTelemetry`: objeto opcional contendo os últimos eventos residuais de cursor e atalhos.


* **Estrutura de resposta de sucesso (HTTP 200 OK):**
* Objeto com a confirmação de entrega: status atualizado (`SUBMITTED` ou `TIME_EXPIRED`), nota bruta provisória calculada, indicador de nota pendente de homologação docente e carimbo de entrega.


* **Erros (RFC 7807):**
* HTTP 403 Forbidden (`forbidden`): tentativa pertencente a outro estudante.
* HTTP 408 Request Timeout (`time-limit-exceeded`): submissão recebida após o tempo limite acrescido do 1 minuto de margem técnica.
* HTTP 409 Conflict (`attempt-already-closed`): prova já entregue anteriormente.



---

### 5.4. Canal WebSocket de Telemetria e Contingência

`GET /api/v1/classes/:classId/assessments/:assessmentId/attempts/:attemptId/telemetry/ws`

`POST /api/v1/classes/:classId/assessments/:assessmentId/attempts/:attemptId/telemetry/batch` (Contingência REST)

* **Papéis autorizados:** `STUDENT` (autor da tentativa).
* **Conexão:** Upgrade HTTP para WebSocket mantido pelo Hub em memória, com chave de contingência via POST REST para recuperação de rede.
* **Estrutura do Lote de 15 Segundos (JSON conceitual do payload):**
* Identificador sequencial do lote.
* Carimbos temporais de início e fim da janela de 15 segundos.
* Lista de amostras de movimentação de cursor contendo instante de tempo relativo em milissegundos, coordenada X percentual e coordenada Y percentual.
* Lista de eventos de foco e atalhos (cópia, colagem, perda de foco, alteração de aba ou atalho de ferramentas).
* Lista de comandos executados no terminal durante a janela temporal.


* **Erros no envio de contingência REST (RFC 7807):**
* HTTP 400 Bad Request (`invalid-batch`): estrutura de lote inconsistente.
* HTTP 403 Forbidden (`forbidden`): tentativa encerrada ou pertencente a terceiro.



---

### 5.5. Consulta de Sessão para o Player Docente

`GET /api/v1/classes/:classId/assessments/:assessmentId/submissions/:attemptId/replay`

* **Papéis autorizados:** `TEACHER` (proprietária da turma) e `ADMIN`.
* **Parâmetros de rota:** `classId`, `assessmentId` e `attemptId`.
* **Estrutura de resposta de sucesso (HTTP 200 OK):**
* Objeto contendo metadados do estudante (nome e RA), resolução base da tela do aluno (largura e altura em pixels), duração total da sessão, lista consolidada cronológica de amostras de cursor e eventos de mouse, série temporal de eventos de segurança/infrações com o instante de ocorrência e índice da questão ativa, e série temporal de comandos executados no terminal.


* **Erros (RFC 7807):**
* HTTP 403 Forbidden (`forbidden`): usuário não é o docente da turma.
* HTTP 404 Not Found (`submission-not-found`): tentativa inexistente.



---

### 5.6. Revisão, Ajuste de Notas e Homologação

`PUT /api/v1/classes/:classId/assessments/:assessmentId/submissions/:attemptId/grade`

* **Papéis autorizados:** `TEACHER` (proprietária da turma) e `ADMIN`.
* **Parâmetros de rota:** `classId`, `assessmentId` e `attemptId`.
* **Campos descritivos de entrada:**
* `finalScore`: valor numérico decimal com a nota global homologada.
* `itemOverrides`: lista de objetos contendo `responseId` e a pontuação revisada atribuída pelo professor.
* `proctorNote`: texto obrigatório contendo a justificativa formal da revisão/homologação.


* **Estrutura de resposta de sucesso (HTTP 200 OK):**
* Objeto confirmando a nota final definitiva homologada, status atualizado e carimbo de homologação.


* **Erros (RFC 7807):**
* HTTP 400 Bad Request (`justification-required`): ausência de justificativa textual.
* HTTP 403 Forbidden (`forbidden`): usuário sem autorização sobre a turma.



---

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| --- | --- |
| Discrepância na reprodução do cursor docente devido a monitores de resoluções distintas | Normalização das coordenadas para base percentual relativa de 0.00% a 100.00% calculadas sobre a largura e altura capturadas da tela do aluno. |
| Perda de submissão do aluno por oscilação momentânea de conexão ao final da prova | Concessão de margem técnica estrita de 1 minuto no servidor além do tempo nominal da prova e mecanismo de fallback REST automático caso o canal WebSocket falhe. |
| Degradação de desempenho do banco de dados por excesso de pontos de cursor em provas longas | Agregação e compressão de pontos em pacotes periódicos de 15 segundos persistidos em bloco único, descartando microvariações inferiores a 50 milissegundos no cliente. |
| Falsa alegação de plágio ou infração por disparos involuntários de eventos de tela | Gravação da linha do tempo associada a cada evento forense com registro exato de timestamp e contexto visual no Player de reprodução para deliberação do docente. |
| Alteração arbitrária de nota sem registro institucional | Exigência mandatória de justificativa textual em qualquer ajuste manual de nota com auditoria append-only no schema do banco. |

---

## 7. Critérios de Aceite (Acceptance Criteria)

* [ ] **CA-01** (evento): QUANDO o docente publicar uma atividade avaliativa com janela de datas e duração cronometrada, O SISTEMA DEVE torná-la disponível para visualização discente apenas quando o relógio do servidor atingir o início da janela.
* [ ] **CA-02** (segurança): SE um discente com matrícula inativa ou usuário de outra turma tentar acessar a avaliação, ENTÃO O SISTEMA DEVE rejeitar a requisição com código HTTP 403 (RFC 7807).
* [ ] **CA-03** (evento): QUANDO o discente acionar a confirmação na tela de instruções, O SISTEMA DEVE registrar o carimbo oficial de início, calcular a data/hora final de entrega e iniciar o cronômetro no cliente.
* [ ] **CA-04** (ubíquo): O SISTEMA DEVE coletar coordenadas de mouse com normalização percentual baseada na resolução do aluno, eventos de atalho (cópia, colagem, ferramentas de desenvolvedor) e teclas digitadas no terminal.
* [ ] **CA-05** (evento): QUANDO o discente estiver realizando a prova, O SISTEMA DEVE transmitir os lotes de telemetria agrupados a cada 15 segundos via canal WebSocket com contingência automática via REST caso ocorra perda de conexão.
* [ ] **CA-06** (interação): QUANDO o discente executar atalhos de cópia, colagem, clique direito ou perder o foco da janela da prova, A INTERFACE DEVE exibir alerta visual flutuante imediato informando o registro da ocorrência.
* [ ] **CA-07** (tempo): QUANDO o cronômetro individual ou a janela da atividade expirar, O SISTEMA DEVE bloquear a edição e submeter compulsoriamente a prova, tolerando envio da rede até o limite máximo de 1 minuto após o tempo nominal.
* [ ] **CA-08** (correção): QUANDO a avaliação for submetida, O SISTEMA DEVE calcular a nota preliminar das questões objetivas e práticas e classificar a pontuação como provisória pendente de homologação docente.
* [ ] **CA-09** (revisão): QUANDO a docente acessar a revisão da tentativa, O SISTEMA DEVE disponibilizar o Player de Sessão com movimentação do mouse, histórico de comandos digitados no terminal e marcadores de infrações com opções de velocidade de 1x a 10x.
* [ ] **CA-10** (homologação): QUANDO a docente alterar a nota de qualquer questão ou a nota final da prova, O SISTEMA DEVE exigir justificativa textual obrigatória e registrar a autoria e os valores anteriores em histórico de auditoria.
* [ ] **CA-11** (acessibilidade e tema): A interface da avaliação e do player de sessão DEVE operar em tema único escuro utilizando variáveis semânticas de `_tokens.scss` e prover alvos de clique ergonômicos de no mínimo 44 px.

---

## 8. Plano de Testes (Test Plan)

### Backend

* **Testes Unitários de Service (`assessment/service`):**
* Criação de avaliação validando intervalo de datas, duração individual e associação correta dos itens do caderno de questões.
* Início de tentativa conferindo bloqueio fora da janela temporal e cálculo do timestamp de expiração no servidor.
* Validação da margem de tolerância: recebimento de submissão dentro do 1 minuto extra aceita com sucesso; submissão recebida após 1 minuto e 1 segundo rejeitada com encerramento forçado por tempo expirado.
* Cálculo de nota bruta para questões objetivas e práticas, e marcação de status pendente para itens descritivos.
* Validação de homologação de nota exigindo justificativa textual e persistência em auditoria.


* **Testes de Integração de Handlers e WebSocket (`assessment/handler`):**
* Testes com `httptest` cobrindo endpoints de criação, início de prova, envio de lotes de contingência REST, submissão final e consulta de replay.
* Teste de gateway WebSocket validando recepção de pacotes periódicos de telemetria a cada 15 segundos e descarte de conexões de usuários não autorizados.



### Frontend

* **Testes Automatizados de Componente (Vitest e Testing Library):**
* Renderização de `AssessmentGate` validando presença das instruções e bloqueio do início sem o aceite do termo.
* Teste do cronômetro em `AssessmentRunner` com relógio simulado, garantindo disparo do envio automático ao zerar o tempo.
* Interceptação de eventos no hook `useAssessmentTelemetry`: verificação de disparo de alertas visuais ao acionar atalhos de cópia/cola ou evento de `blur`.
* Teste do componente `SessionPlayer`: validação de controles de reprodução (Play, Pause, velocidades 1x a 10x) e renderização dos marcadores de infração na linha do tempo.
* Conformidade de tema único escuro e ausência de cores hardcoded nos módulos SCSS.


* **Fluxo de Teste Manual e E2E:**
* Docente cria uma avaliação com duração de 30 minutos contendo 5 questões variadas.
* Estudante acessa a avaliação, aceita os termos e realiza a resolução alternando entre as questões e acionando intencionalmente atalhos de cópia e troca de aba para verificar os alertas.
* Aguardar a expiração do tempo para validar o bloqueio e a submissão automática da tentativa.
* Docente abre a área de revisão, carrega o Player de Sessão, altera a velocidade para 5x e valida a reprodução visual do percurso do mouse e os alertas na linha do tempo.
* Docente altera a nota final atribuída, informa a justificativa e conclui a homologação da nota.



---

## 9. Contexto Final da IA (AI Final Context Execution)

Para implementar esta especificação técnica no repositório, execute a criação e alteração dos arquivos respeitando a seguinte ordem de dependências:

1. **Backend — Migração de Banco de Dados:**
* Criar migração versionada em `backend/migrations/` provisionando as tabelas `assessments`, `assessment_items`, `assessment_attempts`, `assessment_responses`, `assessment_telemetry_batches` e `assessment_security_events` no schema `project-manager`.


2. **Backend — Domínio, Repositório e Serviço (`backend/internal/modules/assessment/`):**
* Implementar entidades de domínio e constantes em `domain/`.
* Implementar interfaces de persistência e repositórios GORM em `repository/`.
* Implementar regras de negócio, cálculo de tempo de tolerância, motor de correção e homologação em `service/`.
* Implementar testes de unidade cobrindo regras de negócio e validações em `service/service_test.go`.
* Implementar handlers HTTP Gin e gateway WebSocket em `handler/`.
* Registrar rotas e dependências no composition root em `backend/cmd/api/main.go`.


3. **Frontend — Serviços e Hooks:**
* Criar cliente de API e comunicação de telemetria em `frontend/src/services/assessmentService.ts`.
* Criar hook de captura e envio em `frontend/src/hooks/useAssessmentTelemetry.ts`.


4. **Frontend — Componentes e Telas:**
* Desenvolver componentes sob `frontend/src/components/Assessment/`:
* `AssessmentForm/` (configuração docente)
* `AssessmentGate/` (sala de entrada e aceite discente)
* `AssessmentRunner/` (esteira de prova e navegação de itens)
* `SessionPlayer/` (player de reprodução de sessão e linha do tempo docente)


* Implementar páginas sob `frontend/src/app/app/classes/[id]/assessments/`:
* `page.tsx` (listagem de avaliações da turma)
* `new/page.tsx` (criação)
* `[assessmentId]/take/page.tsx` (realização discente)
* `[assessmentId]/submissions/[submissionId]/review/page.tsx` (revisão e player docente)


* Centralizar todas as mensagens de interface em `frontend/src/messages/pt-BR.ts`.


5. **Testes e Validação:**
* Executar suíte completa de testes automatizados assegurando cobertura superior a 80%, Stylelint limpo e validação integral dos critérios de aceite (CA-01 a CA-11).