14-10-26-spec-revisao-avaliacoes-telemetria-mcp.md

# Tech Spec / SDD: Revisão de Avaliações com Telemetria Analítica, Correção em Lote via MCP e Homologação Docente

**Data:** 14/10/2026

**Escopo:** Ambos

**Módulo:** `assessment`

**Contexto de Tela:** `/app/classes/:classId/assessments/:assessmentId/reviews` e `/app/classes/:classId/assessments/:assessmentId/submissions/:submissionId/review`

**Prioridade sugerida:** Alta

---

## 1. Contexto e Problema (Context & Problem Statement)

Atualmente, o processo de avaliação necessita de um fluxo consolidado de encerramento, análise pós-prova e auditoria pedagógica. Durante uma atividade avaliativa, dados de execução, tempos por questão, comandos no terminal virtual e ocorrências de segurança são acumulados. No entanto, a docente não dispõe de uma interface analítica para avaliar esses dados de forma agregada, comparar o desempenho individual dos estudantes ou identificar gargalos no material instrucional.

Adicionalmente, a correção manual item a item de turmas numerosas sobrecarrega o corpo docente. Embora a plataforma já possua suporte à sugestão de notas via MCP para questões descritivas isoladas, não existe um mecanismo de acionamento em lote para avaliar simultaneamente todas as submissões finalizadas de uma prova. Sem uma visão quantitativa (tempo despendido, uso de pesquisas externas, tentativas no terminal) e sem a possibilidade de homologação progressiva por estudante com histórico de auditoria, a validação das notas torna-se lenta, sujeita a inconsistências e desprovida de critérios claros para intervenções pedagógicas direcionadas.

---

## 2. Objetivos (Goals)

* Permitir que a docente filtre e visualize todas as tentativas finalizadas de uma avaliação em uma listagem com indicadores consolidados de telemetria (tempo total, tempo médio por questão, índice de incidentes de segurança e pontuação bruta preliminar).


* Disponibilizar um painel analítico individual com gráfico temporal comparativo de permanência por questão e classificação de proficiência do estudante baseada em tempo de atrito e histórico de comandos.


* Permitir que a docente visualize a nota bruta automática calculada na submissão e mantenha essa nota preservada no histórico mesmo após ajustes manuais.


* Permitir que a docente altere manualmente a pontuação e o status de acerto de qualquer tipo de questão (práticas, teóricas ou descritivas), viabilizando anulações ou compensações de gabarito com justificativa textual obrigatória.


* Integrar com o servidor MCP ferramentas de processamento em lote para avaliar todas as respostas descritivas pendentes da avaliação com um único acionamento.


* Permitir a homologação e liberação progressiva das notas definitivas por estudante, exibindo a nota final e o feedback docente no portal do discente.


* Assegurar que os gabaritos oficiais, correções detalhadas das alternativas e justificativas das questões só fiquem visíveis para o estudante após o encerramento formal de sua tentativa.



---

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

A experiência docente de correção divide-se entre a visão geral da avaliação e a tela de detalhe da submissão:

* **Painel Geral de Correções da Avaliação (`AssessmentReviewDashboard`):**
* Rota: `/app/classes/:classId/assessments/:assessmentId/reviews`.
* Cabeçalho com métricas agregadas da turma: média da nota bruta preliminar, tempo médio de conclusão, total de tentativas finalizadas e total de tentativas com nota já homologada.


* Ação de destaque no topo: botão de acionamento de correção em lote via MCP para todas as questões descritivas pendentes da prova, exibindo estado de progresso assíncrono.


* Tabela de estudantes contendo: nome, RA, carimbo de entrega, nota bruta preliminar, nota homologada (ou indicador "Pendente"), índice de incidentes (saída de aba, atalhos de cópia) e botão de ação para abrir a revisão individual.


* Filtro por status de correção: todas, pendentes de revisão e homologadas.


* **Tela de Revisão Individual e Telemetria Forense (`SubmissionDetailReview`):**
* Rota: `/app/classes/:classId/assessments/:assessmentId/submissions/:submissionId/review`.
* Seção superior com identificação do aluno, nota preliminar automática, campo numérico para a nota final homologada e botão de confirmação de homologação individual.


* Bloco de Métricas de Engajamento e Classificação:
* Gráfico em barras ou dispersão mapeando o tempo despendido em cada questão, destacando em cor de atenção as questões com tempo excessivo (mais de 20 minutos de atrito sem conclusão).


* Selo de diagnóstico heurístico sugerindo o nível de domínio do aluno no tópico (ex.: fluente, com hesitação ou necessita reforço conceitual).
* Resumo de telemetria comportamental: contagem de comandos executados no terminal, contagem de saídas de aba/janela e registros de tentativas de cópia/colagem.




* Palco de Reprodução de Sessão (`SessionPlayer`):
* Reprodutor visual sincronizado contendo o percurso do mouse normalizado sobre a tela do aluno, cliques, comandos digitados no terminal virtual e linha do tempo com marcadores visuais de incidentes.


* Controles de reprodução com velocidades dinâmicas (1x a 10x) e saltos temporais.




* Lista de Questões e Ajuste de Notas:
* Exibição de cada questão com o enunciado, a resposta dada pelo discente, o gabarito original e a pontuação obtida.


* Para questões práticas e teóricas: seletor de anulação ou modificação de nota com caixa de justificativa de revisão.


* Para questões descritivas: card com a sugestão enviada pela IA via MCP (nota e justificativa técnica), seletor de faixas de nota e caixas de anotação privada docente e anotação visível para o aluno.


* Botão individual "Salvar Correção da Questão" com feedback visual de persistência.




* **Visão Discente pós-avaliação (`AssessmentResultView`):**
* Rota: `/app/classes/:classId/assessments/:assessmentId/result`.
* O estudante visualiza sua nota bruta preliminar imediatamente após a submissão.


* Caso a docente já tenha homologado a tentativa, a nota final definitiva é exibida em destaque com as observações pedagógicas.


* Exibição completa das questões, respostas assinaladas, alternativas corretas e explicações/gabaritos.




* **Estilização e Conformidade:**
* Aplicação exclusiva de SCSS Modules sob co-location.


* Respeito integral aos tokens semânticos declarados em `_tokens.scss` sob tema escuro e claro.


* Proibição de cores hardcoded nos gráficos e painéis, utilizando CSS Custom Properties para indicar acertos, erros e advertências de tempo.



### 3.2. Backend (Go — Camada de Módulo/Service)

A lógica de negócios é encapsulada no módulo `assessment`:

* **Camada de Serviço (`service`):**
* `ListAssessmentSubmissions`: consulta tentativas encerradas ou submetidas da turma, agregando nota preliminar, status de homologação e totalizadores de incidentes de segurança para cada estudante.


* `GetSubmissionReviewData`: reúne a resolução de tela, blocos de telemetria de cursor, linha do tempo de eventos de atalho/foco, histórico cronológico de comandos no terminal e as respostas detalhadas com os respectivos itens da prova.


* `CalculateSubmissionAnalytics`: processa a série temporal de telemetria para calcular o tempo exato despendido em cada questão individual e computar a classificação preliminar de dificuldade do aluno.


* `OverrideItemGrade`: permite que a docente altere a pontuação de qualquer questão (objetiva, prática ou descritiva), forçando o preenchimento de justificativa textual e registrando evento de auditoria imutável.


* `HomologateStudentAttempt`: valida se a tentativa está finalizada, consolida a somatória das notas parciais e da pontuação manual, grava o identificador da docente homologadora, preenche a data de homologação e atualiza o status para liberado ao discente.


* `BatchGradeDescriptiveWithMCP`: localiza todas as respostas descritivas pendentes de correção da avaliação e despacha as ferramentas do MCP para processamento assíncrono das sugestões.




* **Ferramentas do Servidor MCP (`mcp`):**
* Expansão das ferramentas existentes para contemplar a listagem em lote de respostas descritivas vinculadas a uma avaliação específica (`list_assessment_pending_answers`) e registro de sugestões em bloco (`batch_suggest_grades`).


* As sugestões geradas permanecem na tabela correspondente como recomendação e nunca homologam notas automaticamente.




* **Controle Transacional e Auditoria:**
* Todas as alterações manuais em notas preliminares ou definitivas são envolvidas no padrão transacional `.WithTx(tx)`.


* Toda modificação de nota grava um registro append-only de auditoria contendo a nota anterior, a nova nota, a docente responsável e a justificativa formal.





---

## 4. Modelo de Dados (Data Model)

A modelagem de dados situa-se conceitualmente no schema `project-manager` do Postgres, com identificadores UUIDv7 gerados no hook de criação e exclusão lógica para integridade acadêmica:

* **Entidade `assessment_attempts` (campos afetados/revisados):**
* Chave primária UUIDv7.


* Chaves estrangeiras associando a avaliação e o usuário estudante.


* Coluna de nota bruta preliminar (`auto_score`, numérica decimal), preservada desde o momento da submissão automática.


* Coluna de nota final homologada (`final_score`, numérica decimal, anulável até a homologação).


* Indicador booleano de homologação concluída (`is_homologated`, padrão falso).


* Chave estrangeira referenciando o usuário docente responsável pela homologação (`homologated_by`, anulável).


* Carimbo temporal da homologação (`homologated_at`, anulável).


* Texto de parecer geral ou justificativa da homologação docente (`proctor_feedback`, anulável).


* Coluna textual com a classificação heurística de desempenho gerada pela telemetria (`proficiency_tag`, anulável).
* Carimbos de criação, atualização e exclusão lógica.




* **Entidade `assessment_responses` (campos afetados/revisados):**
* Chave primária UUIDv7.


* Chaves estrangeiras associando a tentativa e o item da avaliação.


* Coluna de pontuação bruta preliminar calculada pelo sistema.


* Coluna de pontuação revisada atribuída manualmente pelo docente.


* Indicador booleano de anulação do item na tentativa.


* Tempo acumulado despendido pelo aluno nesta questão específica (inteiro, em segundos).
* Justificativa textual da revisão docente para o item.


* Comentário pedagógico específico visível para o estudante (`student_note`, texto anulável).


* Anotação privada da docente para o item (`private_note`, texto anulável).


* Carimbos de criação, atualização e exclusão lógica.




* **Entidade `assessment_grade_audit_events` (nova entidade de auditoria):**
* Chave primária UUIDv7.


* Chave estrangeira referenciando a tentativa avaliativa.


* Chave estrangeira anulável referenciando a resposta do item específico.


* Chave estrangeira referenciando o usuário docente que executou a ação.


* Tipo de evento (enumeração lógica: `MANUAL_OVERRIDE`, `QUESTION_ANNULLED`, `FINAL_HOMOLOGATION`).


* Valor numérico da pontuação anterior.


* Valor numérico da nova pontuação atribuída.


* Justificativa textual formal obrigatória.


* Carimbo temporal da ocorrência (imutável, tabela append-only, sem suporte a atualização ou exclusão).





---

## 5. Contrato de API (API Contract)

### 5.1. Listagem de Submissões para Revisão Docente

`GET /api/v1/classes/:classId/assessments/:assessmentId/submissions`

* **Papéis autorizados:** `TEACHER` (proprietária da turma) e `ADMIN`.


* **Parâmetros de rota:** `classId` e `assessmentId` (UUIDs válidos).


* **Parâmetros de query (opcionais):** `status` (filtro por situação de homologação: `ALL`, `PENDING`, `HOMOLOGATED`), `search` (busca por nome ou RA).


* **Estrutura lógica do retorno de sucesso (HTTP 200 OK):**
* Coleção paginada de submissões contendo para cada estudante: identificador da tentativa, dados básicos do aluno (nome e RA), data/hora de envio, nota bruta preliminar, nota final homologada, status de homologação, total de violações de segurança interceptadas e tempo total de prova.




* **Erros (RFC 7807 via customerrors):**
* HTTP 400 Bad Request (`malformed-parameter`): parâmetros inválidos.


* HTTP 403 Forbidden (`forbidden`): usuário não autorizado a gerenciar a turma.


* HTTP 404 Not Found (`assessment-not-found`): avaliação ou turma inexistente.





---

### 5.2. Consulta de Detalhes da Submissão e Dados Analíticos

`GET /api/v1/classes/:classId/assessments/:assessmentId/submissions/:submissionId/review`

* **Papéis autorizados:** `TEACHER` e `ADMIN`.


* **Parâmetros de rota:** `classId`, `assessmentId` e `submissionId`.


* **Estrutura lógica do retorno de sucesso (HTTP 200 OK):**
* Objeto consolidado contendo: dados gerais da tentativa (notas preliminar e homologada, data de envio, homologador e feedback geral), resolução de tela do discente, resumo analítico de proficiência calculada, série temporal de permanência em segundos por questão, lista cronológica de incidentes de segurança (tipo, timestamp e questão ativa), histórico de comandos digitados no terminal e lista de respostas com gabarito, resposta do aluno, pontuação preliminar, pontuação revisada e sugestão da IA se aplicável.




* **Erros (RFC 7807 via customerrors):**
* HTTP 403 Forbidden (`forbidden`): docente de outra turma.


* HTTP 404 Not Found (`submission-not-found`): submissão não localizada.





---

### 5.3. Ajuste Manual da Nota de um Item da Avaliação

`PATCH /api/v1/classes/:classId/assessments/:assessmentId/submissions/:submissionId/responses/:responseId`

* **Papéis autorizados:** `TEACHER` e `ADMIN`.


* **Parâmetros de rota:** `classId`, `assessmentId`, `submissionId` e `responseId`.


* **Campos descritivos de entrada:**
* `score`: valor numérico decimal obrigatório representando a nova pontuação da questão.


* `isAnnulled`: booleano opcional indicando se a questão foi anulada.


* `justification`: texto obrigatório fundamentando a alteração.


* `studentNote`: texto opcional com apontamento didático visível para o discente.


* `privateNote`: texto opcional de anotação interna da docente.




* **Estrutura lógica do retorno de sucesso (HTTP 200 OK):**
* Objeto confirmando a pontuação atualizada do item, justificativa persistida, novo total preliminar recalculado da tentativa e carimbo de alteração.




* **Erros (RFC 7807 via customerrors):**
* HTTP 400 Bad Request (`justification-required`): ausência do texto de fundamentação.


* HTTP 400 Bad Request (`invalid-score`): pontuação superior ao peso máximo da questão.
* HTTP 403 Forbidden (`forbidden`): sem permissão de edição.


* HTTP 404 Not Found (`response-not-found`): item de resposta inexistente.



---

### 5.4. Homologação da Nota Definitiva da Tentativa

`POST /api/v1/classes/:classId/assessments/:assessmentId/submissions/:submissionId/homologate`

* **Papéis autorizados:** `TEACHER` e `ADMIN`.


* **Parâmetros de rota:** `classId`, `assessmentId` e `submissionId`.


* **Campos descritivos de entrada:**
* `finalScore`: valor numérico decimal opcional (caso a docente deseje sobrepor a somatória dos itens).


* `proctorFeedback`: texto opcional contendo parecer global da prova destinado ao estudante.


* `justification`: texto obrigatório caso a nota final divirja da soma dos itens.




* **Estrutura lógica do retorno de sucesso (HTTP 200 OK):**
* Objeto contendo o identificador da tentativa, nota final definitiva homologada, indicador de homologação marcado como verdadeiro e carimbo de liberação.




* **Erros (RFC 7807 via customerrors):**
* HTTP 400 Bad Request (`justification-required`): nota divergente da somatória sem justificativa.


* HTTP 403 Forbidden (`forbidden`): usuário não autorizado.


* HTTP 409 Conflict (`attempt-not-submitted`): tentativa ainda em andamento não pode ser homologada.





---

### 5.5. Consulta de Resultado pelo Estudante

`GET /api/v1/classes/:classId/assessments/:assessmentId/result`

* **Papéis autorizados:** `STUDENT` (com matrícula ativa na turma).


* **Parâmetros de rota:** `classId` e `assessmentId`.


* **Estrutura lógica do retorno de sucesso (HTTP 200 OK):**
* Objeto contendo: status da tentativa, nota bruta preliminar, nota final homologada (se homologada pelo professor), parecer geral do professor, e lista de itens com gabaritos detalhados, respostas do aluno e anotações didáticas liberadas.




* **Erros (RFC 7807 via customerrors):**
* HTTP 403 Forbidden (`attempt-in-progress`): tentativa ainda aberta impede a visualização dos gabaritos.


* HTTP 404 Not Found (`no-submission-found`): nenhuma tentativa registrada para o aluno.



---

### 5.6. Disparo de Correção em Lote via MCP

`POST /api/v1/classes/:classId/assessments/:assessmentId/mcp-grade-batch`

* **Papéis autorizados:** `TEACHER` e `ADMIN`.


* **Parâmetros de rota:** `classId` e `assessmentId`.


* **Campos de entrada no corpo:** nenhum corpo requerido.
* **Estrutura lógica do retorno de sucesso (HTTP 202 Accepted):**
* Objeto contendo identificador do processo assíncrono, quantidade de respostas descritivas enfileiradas e status de processamento.




* **Erros (RFC 7807 via customerrors):**
* HTTP 403 Forbidden (`forbidden`): sem permissão sobre a turma.


* HTTP 404 Not Found (`no-pending-answers`): não existem respostas descritivas aguardando correção na avaliação.





---

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| --- | --- |
| Vazamento de gabaritos enquanto outros alunos realizam a prova | A rota de resultado discente valida se a tentativa do aluno está estritamente finalizada antes de expor gabaritos e alternativas corretas.

 |
| Alteração arbitrária de notas sem conformidade acadêmica | O banco impõe o preenchimento de justificativa textual e registra um evento append-only de auditoria a cada alteração de nota.

 |
| Divergência entre a nota automática e a nota pós-revisão docente | O sistema persiste separadamente o valor bruto inicial (`auto_score`) e o valor final homologado (`final_score`), permitindo comparação histórica.

 |
| Sobrecarga no backend ao processar telemetria forense pesada para o Player | O endpoint de replay realiza consultas projetadas e compactadas por índices temporais, sem transitar dados desnecessários de outras tentativas. |
| Sugestão indevida de notas por falha em agentes MCP externos | As sugestões da IA permanecem isoladas na camada de recomendação, exigindo confirmação explícita da docente antes de compor a nota.

 |

---

## 7. Critérios de Aceite (Acceptance Criteria)

* [ ] **CA-01** (estado): O SISTEMA DEVE permitir que a docente acesse o painel de revisão e consulte todas as tentativas já finalizadas, mesmo que o prazo global da avaliação ainda não tenha expirado.


* [ ] **CA-02** (segurança): SE um discente com tentativa em andamento tentar acessar o endpoint de resultado, ENTÃO O SISTEMA DEVE bloquear a requisição com código HTTP 403 e NÃO DEVE expor gabaritos ou respostas corretas.


* [ ] **CA-03** (visibilidade): QUANDO o discente finalizar e submeter sua avaliação, O SISTEMA DEVE permitir que ele visualize imediatamente sua nota bruta preliminar.


* [ ] **CA-04** (visibilidade): ENQUANTO a tentativa não for homologada pela docente, O SISTEMA NÃO DEVE exibir ao discente pareceres privados ou notas definitivas alteradas.


* [ ] **CA-05** (interação): QUANDO a docente acionar o comando de correção em lote via MCP, O SISTEMA DEVE despachar as respostas descritivas pendentes para geração assíncrona de sugestões de nota sem alterar as notas vigentes de forma automática.


* [ ] **CA-06** (revisão): QUANDO a docente visualizar o detalhe de uma submissão, O SISTEMA DEVE renderizar o Player de Sessão com movimentação do mouse, comandos digitados no terminal e marcadores de incidentes com velocidades de 1x a 10x.


* [ ] **CA-07** (analítica): O SISTEMA DEVE exibir na revisão individual o gráfico comparativo de tempo despendido em cada questão e a indicação de questões que demandaram mais de 20 minutos de atrito.


* [ ] **CA-08** (auditoria): QUANDO a docente alterar a nota de qualquer questão (objetiva, prática ou descritiva), O SISTEMA DEVE exigir justificativa textual obrigatória e gravar evento de auditoria imutável contendo o valor anterior e o novo.


* [ ] **CA-09** (homologação): QUANDO a docente confirmar a homologação da tentativa de um estudante, O SISTEMA DEVE gravar a nota final definitiva, registrar o responsável e liberar a visualização no portal do discente.


* [ ] **CA-10** (segurança): SE um docente que não é proprietário da turma tentar revisar ou homologar notas, ENTÃO O SISTEMA DEVE recusar a chamada com código HTTP 403 (RFC 7807).


* [ ] **CA-11** (acessibilidade e tema): A interface de revisão docente e de resultado do aluno DEVE operar com paridade nos temas claro e escuro utilizando exclusivamente variáveis semânticas de `_tokens.scss`.



---

## 8. Plano de Testes (Test Plan)

### Backend

* **Testes Unitários de Service (`assessment/service`):**
* Listagem de submissões validando cálculo de totalizadores de incidentes e filtro por situação de homologação.


* Homologação de tentativa: conferência de bloqueio para tentativas em andamento e persistência de nota final.


* Ajuste manual de nota de questão objetiva e prática: validação de obrigatoriedade de justificativa e emissão de evento de auditoria no padrão transacional.


* Agregação de dados analíticos: cálculo exato do tempo despendido por item baseado nos carimbos de transição da telemetria.


* Bloqueio de consulta de gabarito para estudantes com tentativa em curso.




* **Testes de Integração de Handlers (`assessment/handler`):**
* Testes com roteador Gin e `httptest` cobrindo endpoints de listagem de submissões, consulta de replay analítico, alteração de nota de item e homologação.


* Validação de envelopes RFC 7807 para erros de validação, ausência de justificativa e autorização por papel RBAC.





### Frontend

* **Testes de Componente (Vitest e Testing Library):**
* Renderização de `AssessmentReviewDashboard` validando exibição da tabela de alunos, notas preliminares e disparo do botão MCP.


* Renderização de `SubmissionDetailReview` conferindo carregamento do player de reprodução, alteração de velocidade de 1x a 10x e gráfico de tempos por questão.


* Validação do formulário de ajuste de nota garantindo bloqueio do envio caso o campo de justificativa esteja vazio.


* Renderização de `AssessmentResultView` para o estudante, conferindo exibição de nota preliminar e bloqueio de gabarito caso a prova ainda não tenha sido entregue.


* Verificação de estilo atestando paridade nos modos claro e escuro sem uso de valores literais de cor.




* **Fluxo de Teste Manual / E2E:**
* Realizar uma avaliação com duas contas de estudante com comportamentos distintos (uma finalizando rapidamente e outra permanecendo mais de 20 minutos em uma questão com saídas de aba propositais).


* Autenticar como docente, abrir o painel de revisões e disparar a correção em lote de descritivas via MCP.


* Abrir a submissão do aluno com atrito, validar o gráfico de tempo e reproduzir a telemetria no Player em velocidade 5x.


* Alterar a pontuação de uma questão objetiva, preencher a justificativa e homologar a nota definitiva do estudante.


* Acessar com a conta do estudante e verificar a visualização da nota homologada com os gabaritos e explicações liberados.





---

## 9. Contexto Final da IA (AI Final Context Execution)

Para implementar esta especificação técnica, crie e altere os arquivos respeitando rigorosamente a seguinte estrutura e ordem de dependências:

1. **Backend — Migração de Banco de Dados:**
* Criar migration versionada em `backend/migrations/` ajustando as tabelas `assessment_attempts` e `assessment_responses` (colunas de nota preliminar, homologação, identificador docente e pareceres) e provisionando a tabela `assessment_grade_audit_events` no schema `project-manager`.




2. **Backend — Camadas de Domínio, Repositório e Serviço (`backend/internal/modules/assessment/`):**
* Atualizar entidades de tentativa e respostas em `domain/attempt.go` e `domain/response.go`.


* Implementar métodos de consulta analítica e persistência de auditoria em `repository/review_repository.go`.


* Implementar regras de negócio de revisão, homologação progressiva e consolidação de telemetria em `service/review_service.go`.


* Implementar testes de unidade das regras de revisão e auditoria em `service/review_service_test.go`.


* Implementar handlers REST em `handler/review_handler.go` e testes em `handler/review_handler_test.go`.


* Registrar rotas de revisão e injeções no composition root em `backend/cmd/api/main.go`.




3. **Backend — Extensão do Módulo MCP (`backend/internal/modules/mcp/`):**
* Implementar ferramentas de enfileiramento e correção em lote para avaliações em `service/assessment_batch.go` e registrar nas definições de ferramentas em `domain/catalog.go`.




4. **Frontend — Camada de Serviços e Integração:**
* Estender `frontend/src/services/assessmentService.ts` incluindo métodos tipados para listagem de submissões, obtenção de dados de replay, ajuste de notas, homologação e disparo do lote MCP.




5. **Frontend — Componentes Visuais e Telas:**
* Desenvolver componentes co-localizados sob `frontend/src/components/Assessment/`:
* `AssessmentReviewDashboard/` (tabela de submissões e métricas agregadas).


* `SubmissionAnalyticsChart/` (gráfico de permanência e identificação de atrito por questão).


* `ItemGradeOverrideModal/` (modal de ajuste manual de nota com justificativa).




* Implementar páginas sob `frontend/src/app/app/classes/[id]/assessments/`:
* `[assessmentId]/reviews/page.tsx` (dashboard geral de revisão docente).


* `[assessmentId]/result/page.tsx` (visão de resultado discente pós-prova).




* Atualizar a página de player docente em `[assessmentId]/submissions/[submissionId]/review/page.tsx` para incorporar a analítica e a homologação.


* Adicionar chaves e mensagens centralizadas em `frontend/src/messages/pt-BR.ts`.




6. **Testes e Qualidade:**
* Executar suíte completa de testes automatizados assegurando cobertura superior a 80%, Stylelint limpo e validação de todos os critérios de aceite.