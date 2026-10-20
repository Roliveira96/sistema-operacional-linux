# SPEC-076: Modalidade da Avaliação e Habilitação dos Alunos para a Prova Presencial

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-076 |
| **Status** | Rascunho |
| **Data de criação** | 20/10/2026 |
| **Última revisão** | 20/10/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `assessment` |
| **Contexto de tela** | `/app/classes/[id]/assessments` (formulário e lista), `/app/classes/[id]/assessments/[assessmentId]/clearances` (nova) e o detalhe da avaliação do estudante |
| **Prioridade** | Alta |
| **Depende de** | SPEC-075 (avaliação, decisão de acesso `AccessOf`, eventos e congelamento), SPEC-041 (estudantes da turma), SPEC-042 (agenda e calendário) |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | `docs/arquitetura/transicao-backend.md`: seção 3.1 (`JanelaAplicacao`, com o aluno específico), seção 4.3 (token e início da avaliação) e seção 6.4.1 (bloqueio, encerramento e anulação); a Tech Spec trazida pelo Tech Lead em 20/10/2026 ("Modos de Aplicação, Homologação de Elegibilidade, Cockpit de Projeção e Intervenção em Avaliações") |

---

## 1. Contexto e Problema (Context & Problem Statement)

A SPEC-075 deixa a docente agendar uma avaliação e dizer, na hora de agendar, para quem ela vale (a turma toda ou alunos escolhidos). Isso não resolve o que acontece no laboratório. Numa prova **presencial**, a docente só sabe quem está apto a fazê-la minutos antes de abrir o acesso: o aluno reprovado por frequência está na turma e foi incluído no agendamento, mas não deve fazer a prova. E esse aluno precisa saber **por que** não entra, em vez de topar com um erro.

Além disso, a plataforma não distingue hoje uma avaliação aplicada no laboratório de uma aplicada a distância, e essa diferença decide regras: só a presencial pede a conferência da docente antes de liberar a prova.

Esta spec cobre a **modalidade** da avaliação e a **habilitação** dos alunos para a prova presencial. A tela de projeção para o telão do laboratório, o cockpit da docente e a intervenção sobre a prova de um aluno dependem da tentativa, da sessão de prova, do token de sala e da fila de ajuda, que ainda não têm spec; ficam registrados na seção 2.2 para a spec das tentativas e do cockpit.

## 2. Objetivos (Goals)

- A avaliação passa a ter modalidade, `IN_PERSON` (presencial) ou `ONLINE`, com padrão pelo tipo: a prova (`EXAM`) é presencial, a atividade (`ASSIGNMENT`) é online.
- Numa avaliação presencial a docente pode exigir a **habilitação** dos alunos (padrão: exigir). Com a exigência ligada, o aluno só pode entrar na prova depois de habilitado.
- A docente habilita todos os que aguardam com um comando, ou decide aluno a aluno: habilitar, ou recusar com um motivo opcional que o aluno recusado lê.
- O estudante vê o próprio estado (habilitado, aguardando, recusado e o motivo) e nunca o de outro estudante.
- A decisão de acesso `AccessOf` (SPEC-075 RN-14) passa a considerar a habilitação, para a spec das tentativas não reimplementar a regra.
- A docente é avisada quando a prova presencial está para começar, ou já começou, com alunos ainda aguardando, e habilita todos com um clique.
- Fica registrado quem habilitou ou recusou cada aluno, quando e por quê, e cada ação da docente entra no histórico da avaliação.

### 2.1. Fora de escopo (Non-Goals)

Toda IA implementadora deve tratar esta lista como proibição.

- Tudo o que está na seção 2.2: projeção, cockpit, espelho do terminal, pedido de ajuda e bloqueio ou encerramento da prova de um aluno.
- Iniciar a prova pelo estudante, o token de sala e a tentativa (spec das tentativas). Nesta spec **não existe** campo de token nem botão de iniciar.
- Habilitação em avaliação `ONLINE` ou em atividade.
- Guardar o histórico completo de cada decisão sobre cada aluno: fica o último estado de cada aluno e um evento por ação (P-07).
- Avisar o aluno da decisão por e-mail ou por outro meio.
- Voltar um aluno decidido para "aguardando". Muda-se de habilitado para recusado e de recusado para habilitado, nunca para aguardando.
- Mostrar a modalidade no calendário do estudante: o `AssessmentPublic` da SPEC-075 não muda; a modalidade chega ao estudante só pela consulta do próprio acesso (P-08).
- Janela de aplicação por avaliação (repescagem do mesmo exame com habilitação própria). Segunda chamada continua sendo outra avaliação (SPEC-075 D-02).
- Qualquer mudança em `frontend/src/engine/core/`.

### 2.2. Requisitos recebidos que ficam para a spec das tentativas e do cockpit (não implementar aqui)

A Tech Spec original traz, além do que está nos objetivos, os itens abaixo. Eles dependem de entidades que ainda não existem (sessão de prova, token, fila de ajuda, canal do cockpit) e são registrados aqui só para não se perderem. Nada desta seção é implementado pela SPEC-076.

1. **Projeção em sala:** uma rota própria, em tela cheia e de alto contraste, para o telão do laboratório, com cronômetro regressivo pelo relógio do servidor, contagem de alunos presentes e de provas entregues e a fila de pedidos de ajuda com destaque pulsante e som opcional. Não mostra notas parciais, infrações, comandos do terminal nem mensagens privadas. Canal só de leitura e agregado, sem o espelhamento do terminal.
2. **Eventos de tempo real:** `cockpit:projection-sync` (tempo restante, presentes, entregues e a fila de ajuda ativa) e o uso de `help:request` e `help:cancel` pela projeção e pelo cockpit.
3. **Cockpit privado da docente:** cards dos alunos, espelho do terminal com a digitação ao vivo, a árvore do sistema de arquivos virtual e o histórico de comandos, mensagens privadas e os botões de intervenção.
4. **Intervenção por infração:** interromper a prova de um aluno em flagrante de desvio (ex.: cola), com motivo obrigatório, derrubada da conexão, o evento `session:blocked` ao aluno com o motivo e o registro na linha do tempo de auditoria.
5. **Aceite próprio da projeção:** o conteúdo do evento de projeção nunca carrega notas nem dados de auditoria forense (teste de integração).

Dúvidas que a spec futura precisa decidir (não bloqueiam a SPEC-076):

- O "bloquear por infração" da Tech Spec (rota de bloqueio, status `BLOQUEADO_DOCENTE`, derrubada da conexão) corresponde a qual das três ações do canônico 6.4.1: bloqueio cautelar e reversível, encerramento com a nota calculada normalmente, ou anulação depois da prova, que é nota zero? E qual é a lista final de status da tentativa (conflito 1 do glossário)?
- A projeção é uma segunda janela da docente já logada (padrão da janela de apresentação, SPEC-055) ou um endereço aberto sem login?
- A projeção identifica quem pediu ajuda pelo nome ou pela estação? O sistema não tem o conceito de estação.
- O telão mostra o token de sala?
- O cockpit e a projeção reaproveitam o hub e as peças da aula ao vivo (janela de apresentação SPEC-055, mão levantada SPEC-058 e SPEC-062, observação do terminal SPEC-065 e SPEC-071) ou usam os canais próprios do canônico 6.1?
- A avaliação `ONLINE` exige token de sala?

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Tema único escuro, tokens semânticos, textos em `messages/pt-BR.ts`, navegação completa por teclado, contraste WCAG AA e alvos de toque de no mínimo 44 px. Toda chamada de rede fica em `services/assessmentService.ts`.

**Docente e administrador**

- **Formulário da avaliação** (SPEC-075, aba *Dados*): o campo *Modalidade* (Presencial ou Online) e a caixa *Exigir habilitação dos alunos*, esta só com a modalidade presencial. Os padrões seguem o tipo: prova, presencial com habilitação exigida; atividade, online, com a opção Presencial desabilitada e o motivo escrito ao lado. A partir do início da avaliação os dois campos ficam desabilitados com o aviso do congelamento.
- **Lista da turma** (SPEC-075): a coluna de modalidade e, para a avaliação presencial com habilitação exigida, a contagem de alunos que aguardam. Quando há alunos aguardando e a avaliação começa em até 30 minutos, ou já começou e não terminou, a linha ganha um aviso em destaque ("N alunos ainda não foram habilitados") com o botão *Habilitar todos* e o link *Ver habilitações*.
- **Tela de habilitações** (`/app/classes/[id]/assessments/[assessmentId]/clearances`): uma tabela com nome, RA, estado (aguardando, habilitado, recusado), motivo e quem decidiu e quando; os contadores dos três estados; o botão *Habilitar todos os que aguardam*; por linha, *Habilitar* e *Recusar*. *Recusar* abre um diálogo com o motivo opcional de até 300 caracteres e, como dica, a frase padrão que o aluno lerá se o motivo ficar em branco. Estados: carregando, vazio ("Nenhum aluno elegível") e erro com nova tentativa. Com a avaliação encerrada, cancelada ou sem a exigência, a tela só lê e diz o porquê.

**Estudante**

- No detalhe da avaliação (SPEC-075), quando ela é presencial e exige habilitação, um bloco com o estado: *Habilitado*; *Aguardando a habilitação da professora*; ou *Recusado*, um banner fixo de bloqueio com o motivo informado ou, sem motivo, a frase padrão "Sua matrícula não foi habilitada para esta avaliação presencial." O bloco usa a mesma reconsulta da SPEC-075 (30 s com a aba visível e ao voltar à aba), de modo que a decisão da docente aparece sem recarregar a página. Não há campo de token nem botão de iniciar.

### 3.2. Backend (Go: módulo `assessment`)

As regras entram no módulo `assessment` da SPEC-075. Datas e relógio seguem a SPEC-075 (relógio do servidor, `America/Sao_Paulo`).

- **RN-01 (modalidade):** a avaliação tem a modalidade `IN_PERSON` ou `ONLINE`. Sem informar, vale `IN_PERSON` para `EXAM` e `ONLINE` para `ASSIGNMENT`. Uma `ASSIGNMENT` só pode ser `ONLINE`; se vier presencial, 400 `invalid-assessment`.
- **RN-02 (exigir habilitação):** a avaliação tem `requires_clearance`. Só uma avaliação `IN_PERSON` pode exigir; em `ONLINE` o campo é sempre falso, e ligá-lo é 400 `invalid-assessment`. Sem informar, vale verdadeiro para `IN_PERSON` e falso para `ONLINE`. A docente pode desligar a exigência de uma prova presencial.
- **RN-03 (congelamento):** a `modality` e o `requires_clearance` entram na lista do congelamento da SPEC-075 RN-10: a partir de `startsAt` a troca é recusada com `assessment-frozen`. As decisões de habilitação **não** congelam: a docente continua decidindo com a prova em andamento, para o aluno que chega atrasado (RN-06).
- **RN-04 (estados da habilitação):** o estado de um aluno é `PENDING` (aguardando), `APPROVED` (habilitado) ou `REJECTED` (recusado). `PENDING` **não é guardado**: é a ausência de decisão. Só `APPROVED` e `REJECTED` têm linha (P-06).
- **RN-05 (quem entra na lista):** os alunos **elegíveis** da avaliação, pela SPEC-075 RN-08 (matrícula `ACTIVE` e, em `SELECTED`, estar na lista). Quem passa a ser elegível depois, ou chega por matrícula nova, aparece aguardando. A decisão de quem deixa de ser elegível é ignorada (e a linha fica guardada).
- **RN-06 (decidir):** a docente dona e o administrador decidem, com a avaliação `SCHEDULED`, com a exigência ligada e antes do término (em `UPCOMING` ou `RUNNING`). Há duas ações: `APPROVE_ALL`, que habilita todos os elegíveis que **aguardam** e não mexe em quem já foi recusado (P-04); e `UPDATE`, com uma lista de alunos, cada um com o novo estado (`APPROVED` ou `REJECTED`) e, na recusa, o motivo opcional de até 300 caracteres em texto puro. Motivo em branco é guardado vazio. Motivo com `APPROVED` é recusado. Aluno que não é elegível, repetido na lista ou lista vazia em `UPDATE` são recusados. Tudo ou nada (RN-12).
- **RN-07 (depois que o aluno começou):** a decisão sobre um aluno que já iniciou a tentativa é recusada com `clearance-locked`; daí em diante a intervenção é a da spec das tentativas. Como a tentativa ainda não existe, o `assessment` declara a interface `AttemptCheck` e o composition root liga uma implementação que responde "ninguém começou" até a spec das tentativas.
- **RN-08 (decisão de acesso):** `AccessOf` (SPEC-075 RN-14) ganha o resultado `NOT_CLEARED`: com a exigência ligada, o aluno que não está `APPROVED` (aguardando ou recusado) recebe `NOT_CLEARED` em vez de `ALLOWED`. A ordem dos motivos fica `NOT_ELIGIBLE`, `CANCELED`, `NOT_OPEN_YET`, `ENDED` e, por último, `NOT_CLEARED`. Sem a exigência, nada muda.
- **RN-09 (consulta do próprio acesso):** o estudante elegível consulta o próprio acesso e recebe se pode entrar, o motivo (o resultado de `AccessOf`), a modalidade, se há exigência e, havendo, o próprio estado de habilitação com o motivo da recusa. Quem não é elegível recebe 404 `assessment-not-found`.
- **RN-10 (privacidade):** o estado de um aluno nunca chega a outro. A lista de habilitações, os contadores e o motivo das recusas são só da docente dona e do administrador. O estudante recebe só o próprio estado.
- **RN-11 (auditoria):** cada linha guarda quem decidiu, quando e o motivo da recusa. Cada ação (um `APPROVE_ALL` ou um `UPDATE`) grava um evento `CLEARANCE_UPDATED` no histórico da avaliação (SPEC-075 RN-15), com autor e instante, e o nome de campo `clearances` em `changed_fields`. Quem decidiu por último vale; a decisão anterior sobre o mesmo aluno não fica guardada (P-07).
- **RN-12 (transação):** uma ação de habilitação grava todas as linhas e o evento numa transação só.
- **RN-13 (aviso e contadores):** o resumo da avaliação para a docente traz os contadores de aguardando, habilitados e recusados dos elegíveis. O aviso de "alunos ainda não habilitados" é decidido pela tela: avaliação presencial com exigência, `SCHEDULED`, aguardando maior que zero e, em `UPCOMING`, início em até 30 minutos, ou `RUNNING`.

## 4. Modelo de Dados (Data Model)

Migração nova com o próximo número livre depois da da SPEC-075 (conferir em `origin/projeto-tcc2` antes de criar; hoje seria `00042_assessment_clearances.sql`). Tabelas e colunas em inglês, schema `linux_lab`, chave UUIDv7.

**`assessments`** (colunas novas)

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `modality` | text | Sim | `IN_PERSON` ou `ONLINE`; `ASSIGNMENT` só `ONLINE` | Modalidade (RN-01). As avaliações já gravadas recebem `IN_PERSON` se prova e `ONLINE` se atividade |
| `requires_clearance` | boolean | Sim | só pode ser verdadeiro com `IN_PERSON` | Exige a habilitação (RN-02). As avaliações já gravadas recebem falso |

**`assessment_clearances`** (decisão da docente sobre um aluno)

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | Sim | PK | |
| `assessment_id` | uuid | Sim | FK `assessments` | |
| `student_id` | uuid | Sim | FK `users` | O aluno decidido |
| `status` | text | Sim | `APPROVED` ou `REJECTED` | RN-04 |
| `rejection_reason` | text | Não | até 300 caracteres; só com `REJECTED` | RN-06 |
| `cleared_by` | uuid | Sim | FK `users` | Quem decidiu (RN-11) |
| `cleared_at` | timestamptz | Sim | | Quando decidiu |
| `created_at`, `updated_at` | timestamptz | Sim | | Auditoria |

**Relacionamentos:** `assessment_clearances` N:1 `assessments` e N:1 `users`.

**Índices e unicidades:** unicidade `(assessment_id, student_id)`.

**`assessment_events`** (SPEC-075): o valor `CLEARANCE_UPDATED` entra nos valores permitidos de `kind`.

**Enumerações:** `modality`: `IN_PERSON` (presencial), `ONLINE`. Estado de habilitação: `PENDING` (derivado, não guardado), `APPROVED` (habilitado), `REJECTED` (recusado). Resultado novo de `AccessOf`: `NOT_CLEARED`. Ação de habilitação: `APPROVE_ALL`, `UPDATE`.

**Exclusão:** as linhas de habilitação acompanham a avaliação (sem exclusão lógica própria e sem rota para apagar). Os eventos continuam só de inclusão (SPEC-075).

## 5. Contrato de API (API Contract)

Erros RFC 7807 com os slugs abaixo e os comuns do projeto (`malformed-request`, `invalid-uuid`, `not-authenticated`, `forbidden`, `class-not-found`, `assessment-not-found`). Campos em `camelCase`. Valor ilegível no corpo (estado que não existe, id que não é UUID) é 400 `malformed-request`. Todas as rotas exigem sessão.

**`GET /api/v1/classes/:id/assessments/:assessmentId/clearances`**: lista os elegíveis com o estado de habilitação (RN-05, RN-10).

- **Papéis autorizados:** docente dona da turma, administrador.
- **Resposta de sucesso:** 200 com:

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `requiresClearance` | booleano | Sim | Se a avaliação exige a habilitação |
| `items` | lista | Sim | Um item por aluno elegível, ordenado por nome |
| `items[].studentId` | uuid | Sim | |
| `items[].name` | texto | Sim | |
| `items[].academicId` | texto | Sim | O RA |
| `items[].status` | texto | Sim | `PENDING`, `APPROVED` ou `REJECTED` |
| `items[].rejectionReason` | texto | Não | Só com `REJECTED` e motivo informado |
| `items[].clearedAt` | data e hora | Não | Só decididos |
| `items[].clearedByName` | texto | Não | Só decididos |
| `counts` | `pending`, `approved`, `rejected` | Sim | Os contadores dos elegíveis |
| `serverNow` | data e hora | Sim | Relógio do servidor |

- **Erros:** 404 `assessment-not-found`.

**`POST /api/v1/classes/:id/assessments/:assessmentId/clearances`**: decide a habilitação (RN-06, RN-07, RN-11, RN-12).

- **Papéis autorizados:** docente dona da turma, administrador.
- **Corpo da requisição:**

| Campo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| `action` | texto | Sim | `APPROVE_ALL` ou `UPDATE` |
| `students` | lista | Só em `UPDATE` | Não vazia, sem aluno repetido; ignorada em `APPROVE_ALL` |
| `students[].studentId` | uuid | Sim | Aluno elegível |
| `students[].status` | texto | Sim | `APPROVED` ou `REJECTED` |
| `students[].rejectionReason` | texto | Não | Até 300 caracteres, só com `REJECTED`; em branco vale vazio |

- **Resposta de sucesso:** 200, com o mesmo formato da listagem já com as decisões aplicadas.
- **Erros (RFC 7807):**

| HTTP | `type` | Quando ocorre |
| :--- | :--- | :--- |
| 400 | `invalid-clearance` | Ação desconhecida, lista vazia ou com aluno repetido, motivo com `APPROVED` ou acima de 300 caracteres |
| 400 | `student-not-in-class` | Aluno que não é elegível da avaliação |
| 409 | `clearance-not-required` | A avaliação é `ONLINE` ou não exige a habilitação |
| 409 | `clearance-locked` | O aluno já iniciou a tentativa (RN-07) |
| 409 | `assessment-ended` | A avaliação terminou |
| 409 | `assessment-canceled` | A avaliação foi cancelada |

**`GET /api/v1/classes/:id/assessments/:assessmentId/my-access`**: o acesso do estudante à avaliação (RN-08, RN-09, RN-10).

- **Papéis autorizados:** estudante com matrícula `ACTIVE` e elegível. Docente e administrador recebem 403 `forbidden`.
- **Resposta de sucesso:** 200 com:

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `allowed` | booleano | Sim | Verdadeiro só quando o resultado é `ALLOWED` |
| `reason` | texto | Sim | `ALLOWED`, `CANCELED`, `NOT_OPEN_YET`, `ENDED` ou `NOT_CLEARED` |
| `modality` | texto | Sim | `IN_PERSON` ou `ONLINE` |
| `requiresClearance` | booleano | Sim | |
| `clearance` | `status` e, só se recusado e com motivo, `rejectionReason` | Só com a exigência | O estado do próprio aluno |
| `serverNow` | data e hora | Sim | Relógio do servidor |

- **Erros:** 404 `assessment-not-found` (inclusive para quem não é elegível).

**Rotas existentes que mudam:** `POST /api/v1/classes/:id/assessments` e `PATCH /api/v1/classes/:id/assessments/:assessmentId` (SPEC-075) aceitam `modality` e `requiresClearance`, com os erros 400 `invalid-assessment` (RN-01, RN-02) e 409 `assessment-frozen` (RN-03). O resumo da avaliação para a docente (`AssessmentSummary`) ganha `modality`, `requiresClearance` e `clearanceCounts` (`pending`, `approved`, `rejected`). O `AssessmentPublic` **não** muda.

## 6. Impacto e Riscos (Impact & Risks)

- **Aluno apto barrado por esquecimento da docente.** Com a exigência ligada, quem não foi habilitado não entra. **Mitigação:** o aviso em destaque na lista (RN-13), o botão *Habilitar todos* num clique, e a docente poder decidir com a prova já em andamento (RN-06).
- **Vazamento do estado de um aluno para outro.** **Mitigação:** a lista só é da docente dona e do administrador; o estudante recebe só o próprio estado, e um teste de handler confere as chaves exatas da resposta do estudante (RN-10).
- **Mudar a decisão de quem já está fazendo a prova.** **Mitigação:** a decisão é recusada depois que a tentativa começou (RN-07); a intervenção sobre a prova em andamento é da spec das tentativas.
- **Código da SPEC-075 que muda.** Esta spec altera `AccessOf` (resultado novo), os dados de criação e de alteração, a lista do congelamento, o resumo da docente e os valores de `kind` dos eventos. **Mitigação:** a SPEC-076 só é implementada depois da SPEC-075 estar verde e mesclada, e os testes da 075 que mudam são ajustados com o motivo registrado.
- **Avaliações já gravadas.** **Mitigação:** a migração dá a cada uma a modalidade pelo tipo e a exigência falsa, de modo que nada passa a exigir habilitação sozinho.
- **Colisão de número de migração.** **Mitigação:** conferir o próximo número livre em `origin/projeto-tcc2` imediatamente antes de criar.
- **Impacto em outros módulos:** nenhum além do `assessment` e do `frontend`. Nenhuma tabela de outro módulo muda.
- **Desempenho:** a lista de habilitações lê os elegíveis da turma (dezenas de alunos) e as linhas da avaliação, em duas consultas.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (ubíquo): A avaliação DEVE ter modalidade `IN_PERSON` ou `ONLINE`; sem informar, DEVE valer `IN_PERSON` para `EXAM` e `ONLINE` para `ASSIGNMENT` (RN-01).
- [ ] **CA-02** (indesejado): SE uma `ASSIGNMENT` vem como `IN_PERSON`, ENTÃO O SISTEMA DEVE responder 400 `invalid-assessment` e não gravar nada (RN-01).
- [ ] **CA-03** (estado): ENQUANTO a avaliação é `IN_PERSON`, `requires_clearance` PODE ser ligado ou desligado e, sem informar, DEVE valer verdadeiro; ENQUANTO é `ONLINE`, DEVE ser sempre falso, e ligá-lo DEVE dar 400 `invalid-assessment` (RN-02).
- [ ] **CA-04** (estado): ENQUANTO `agora >= startsAt`, O SISTEMA DEVE recusar com 409 `assessment-frozen` a troca de `modality` e de `requires_clearance`, e DEVE continuar aceitando as decisões de habilitação (RN-03, RN-06).
- [ ] **CA-05** (evento): QUANDO a docente lista as habilitações, O SISTEMA DEVE devolver os alunos elegíveis por nome, com o estado, os contadores e o `serverNow`; quem não tem decisão DEVE vir `PENDING`, e quem entrou na turma depois DEVE vir também (RN-04, RN-05).
- [ ] **CA-06** (evento): QUANDO a docente aciona `APPROVE_ALL`, O SISTEMA DEVE habilitar todos os elegíveis que aguardam, manter os recusados como estão, gravar quem e quando e registrar o evento `CLEARANCE_UPDATED` (RN-06, RN-11).
- [ ] **CA-07** (evento): QUANDO a docente aciona `UPDATE`, O SISTEMA DEVE gravar o estado de cada aluno da lista, com o motivo opcional na recusa (em branco é guardado vazio), e responder a lista já atualizada; SE o motivo vem com `APPROVED` ou passa de 300 caracteres, ENTÃO DEVE responder 400 `invalid-clearance` (RN-06).
- [ ] **CA-08** (indesejado): SE a lista de `UPDATE` está vazia, repete um aluno, traz uma ação desconhecida ou um aluno que não é elegível, ENTÃO O SISTEMA DEVE recusar com 400 `invalid-clearance` ou `student-not-in-class` e não gravar nenhuma linha (RN-06, RN-12).
- [ ] **CA-09** (indesejado): SE a avaliação é `ONLINE` ou não exige a habilitação, ENTÃO O SISTEMA DEVE responder 409 `clearance-not-required` ao decidir; SE terminou ou foi cancelada, ENTÃO 409 `assessment-ended` ou `assessment-canceled` (RN-06).
- [ ] **CA-10** (indesejado): SE o aluno já iniciou a tentativa, ENTÃO O SISTEMA DEVE recusar a decisão sobre ele com 409 `clearance-locked` e não alterar nenhum aluno da mesma ação (RN-07, RN-12).
- [ ] **CA-11** (evento): QUANDO a spec das tentativas pergunta `AccessOf` de uma avaliação que exige a habilitação, O SISTEMA DEVE responder `ALLOWED` só para quem está `APPROVED` e `NOT_CLEARED` para quem aguarda ou foi recusado (na fase `RUNNING`); sem a exigência, o resultado DEVE ser o de antes (RN-08).
- [ ] **CA-12** (evento): QUANDO o estudante elegível consulta o próprio acesso, O SISTEMA DEVE devolver se pode entrar, o motivo, a modalidade, a exigência e o próprio estado com o motivo da recusa; SE não é elegível, ENTÃO DEVE responder 404 `assessment-not-found`; SE é docente ou administrador, ENTÃO 403 (RN-09).
- [ ] **CA-13** (ubíquo): O estado de habilitação de um aluno NÃO DEVE aparecer em nenhuma resposta a outro aluno; as rotas de lista e de decisão DEVEM recusar o estudante com 403, e as chaves da resposta de `my-access` DEVEM ser exatamente as da seção 5 (RN-10).
- [ ] **CA-14** (ubíquo): Cada linha DEVE guardar quem decidiu, quando e o motivo; cada ação DEVE gerar um evento `CLEARANCE_UPDATED`; e uma ação DEVE gravar todas as linhas e o evento numa transação só (RN-11, RN-12).
- [ ] **CA-15** (estado): ENQUANTO a avaliação é presencial, exige a habilitação, está `SCHEDULED` e há alunos aguardando, a lista DEVE mostrar o aviso com *Habilitar todos* quando faltam 30 minutos ou menos para o início, ou quando está em andamento (RN-13).
- [ ] **CA-16** (evento): QUANDO a docente abre a tela de habilitações, ELA DEVE ver a tabela, os contadores, *Habilitar todos os que aguardam* e, por linha, *Habilitar* e *Recusar* (com o diálogo do motivo opcional); com a avaliação encerrada, cancelada ou sem a exigência, a tela DEVE só ler e dizer o porquê.
- [ ] **CA-17** (estado): ENQUANTO o estudante vê o detalhe de uma avaliação presencial que exige a habilitação, ELE DEVE ver o estado: habilitado, aguardando, ou o banner fixo de recusa com o motivo (ou a frase padrão, sem motivo); a tela DEVE refazer a consulta em até 30 s com a aba visível; não DEVE haver campo de token nem botão de iniciar.
- [ ] **CA-18** (evento): QUANDO a docente cria ou edita a avaliação, O FORMULÁRIO DEVE oferecer a modalidade e a exigência com os padrões do tipo, desabilitar o presencial para a atividade e desabilitar os dois campos com o aviso quando a avaliação está congelada.
- [ ] **CA-19** (ubíquo): Os textos DEVEM estar em `messages/pt-BR.ts`; as telas DEVEM ter navegação por teclado, contraste AA, alvos de 44 px e nenhuma cor fora dos tokens.
- [ ] **CA-20** (ubíquo): Stylelint, ESLint, `tsc`, `go vet` e `gofmt` limpos; cobertura acima de 80% no escopo; a migração nova sobe e desce sem erro.

## 8. Plano de Testes (Test Plan)

Os testes são escritos **antes** do código e rodados vermelhos primeiro (SPEC-038); o commit `test(...)` vem antes do `feat(...)`. Nomes em inglês, como no código.

**Backend, `assessment/domain`** (unidade)

- `TestModality_DefaultsByTypeAndAssignmentIsOnlyOnline` (CA-01, CA-02)
- `TestRequiresClearance_OnlyInPersonAndDefaultsOn` (CA-03)
- `TestFrozen_CoversModalityAndRequiresClearance` (CA-04)
- `TestClearance_ValidatesStatusAndReason`: estado, motivo com `APPROVED` e limite de 300 (CA-07, CA-08)

**Backend, `assessment/service`** (unidade, com repositórios e portas de teste escritos à mão)

- `TestCreate_ModalityAndRequirementFollowTheType` (CA-01, CA-02, CA-03)
- `TestUpdate_ModalityAndRequirementAreFrozenFromTheStart` (CA-04)
- `TestClearances_ListsEligibleStudentsWithPendingForWhoHasNoDecision` (CA-05)
- `TestClearances_ApproveAllApprovesOnlyWhoWaitsAndKeepsTheRejected` (CA-06)
- `TestClearances_UpdateStoresStatusAndOptionalReason` (CA-07)
- `TestClearances_RefusesBadListsStudentsOutsideAndNothingIsWritten` (CA-08, CA-14)
- `TestClearances_RefusedWhenNotRequiredEndedOrCanceled` (CA-09)
- `TestClearances_RefusedForAStudentWhoStartedTheAttempt`, com `AttemptCheck` de teste (CA-10)
- `TestAccessOf_ClearanceDecisionTable`: aguardando, habilitado, recusado, sem exigência e a ordem dos motivos (CA-11)
- `TestMyAccess_ReturnsTheOwnStateAndReason` (CA-12)
- `TestMyAccess_NotEligibleIsNotFoundAndStaffIsForbidden` (CA-12, CA-13)
- `TestClearances_WriteWhoWhenAndOneEventPerAction` (CA-14)
- `TestClearances_AuthorizationOnlyOwnerTeacherAndAdmin` (CA-13)

**Backend, `assessment/handler`** (`httptest` contra o roteador Gin real)

- `TestHandler_MyAccessHasExactlyTheStudentKeys` (CA-12, CA-13)
- `TestHandler_ClearancesParseTheBodyAndAnswerTheList` (CA-05, CA-06, CA-07)
- `TestHandler_ClearanceStatusCodesAndProblemTypes`: um caso por `type` da seção 5 (CA-08, CA-09, CA-10)
- `TestHandler_ClearanceRolesAndAuthentication`: 401, 403 e 404 (CA-13)
- `TestHandler_CreateAndUpdateAcceptModalityAndRequirement` (CA-01, CA-03, CA-04)

**Backend, `assessment/repository`** (integração com PostgreSQL via `testcontainers-go`)

- `TestRepository_ModalityConstraints` (CA-01, CA-02, CA-03)
- `TestRepository_OneClearancePerStudentAndAssessment` (CA-14)
- `TestRepository_ClearanceBatchIsAtomicWithItsEvent` (CA-14)
- `TestRepository_ClearanceCountsAndListByAssessment` (CA-05)
- `TestMigration00042_UpAndDown`, com as avaliações antigas recebendo a modalidade pelo tipo e a exigência falsa (o número real conferido na hora) (CA-20)

**Frontend** (Vitest e Testing Library)

- `assessmentService.test.ts`: as três rotas novas, o corpo e os erros tipados (CA-05, CA-12)
- `AssessmentForm.modality.test.tsx`: padrões por tipo, presencial desabilitado na atividade e campos desabilitados no congelamento (CA-18)
- `AssessmentList.clearanceWarning.test.tsx`: o aviso e o *Habilitar todos* nos limites de 30 minutos, em andamento e sem pendentes (CA-15)
- `ClearancesPage.test.tsx`: tabela, contadores, habilitar todos, habilitar e recusar com o diálogo do motivo, e a tela só de leitura (CA-16)
- `AssessmentAccessNotice.test.tsx`: habilitado, aguardando, recusado com motivo e sem motivo, a reconsulta de 30 s e a ausência de token e de botão de iniciar (CA-17)
- `AssessmentForm.a11y.test.tsx` e o Stylelint (CA-19, CA-20)

**Manual** (roteiro)

1. Criar uma prova presencial para daqui a 10 minutos e abrir a tela de habilitações: todos aguardando, com o aviso na lista.
2. Recusar um aluno com o motivo "Reprovado por faltas" e habilitar os demais com *Habilitar todos os que aguardam*; conferir que o recusado continua recusado.
3. Com o aluno recusado logado, abrir a avaliação: conferir o banner com o motivo; recusar outro sem motivo e conferir a frase padrão.
4. Abrir a rede do navegador do aluno e conferir que nenhuma resposta traz o estado de outro aluno (CA-13).
5. Conferir a aparência e o contraste (WCAG AA) do banner e do diálogo no tema escuro (CA-19).

**Cobertura:** meta acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5), com `go test -cover` em `domain`, `service` e `handler` do `assessment` e com o Vitest em modo de cobertura.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md` (seções 4, 4.1 e 4.2), esta spec inteira e a SPEC-075 inteira (RN-08, RN-10, RN-14 e RN-15 são as que esta spec estende). Do código: o módulo `backend/internal/modules/assessment` (já implementado pela SPEC-075), `backend/migrations/` (último número) e `frontend/src/components/Assessment*`. A seção 2.2 é só contexto: não implementar nada dela.
2. **Ordem de execução:** (a) confirmar que a SPEC-075 está `Implementada` e mesclada; (b) termos novos no `GLOSSARY.md`; (c) testes vermelhos do backend, rodados e commitados; (d) migração, `domain`, `repository`; (e) `service` (inclusive `AttemptCheck` e o ajuste de `AccessOf`); (f) `handler`; (g) testes vermelhos do frontend e commit; (h) `assessmentService`, tela de habilitações, formulário, aviso da lista e bloco do estudante; (i) roteiro manual; (j) status e histórico.
3. **Arquivos e diretórios a criar ou alterar:**
   - **Backend, novos:** `backend/migrations/<próximo número livre>_assessment_clearances.sql`; arquivos novos de `clearance` em `backend/internal/modules/assessment/{domain,service,repository,handler}` e os testes.
   - **Backend, alterados:** `assessment/domain` (modalidade, exigência, congelamento, valor `CLEARANCE_UPDATED`), `assessment/service` (criação, alteração, `AccessOf`, resumo), `assessment/repository`, `assessment/handler` (criação, alteração e resumo) e os testes da SPEC-075 que mudam; `backend/cmd/api/main.go` (composition root: `AttemptCheck`).
   - **Frontend, novos:** `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/clearances/**` e os componentes de habilitação (tabela, diálogo de recusa, aviso, bloco do estudante) com os testes.
   - **Frontend, alterados:** `frontend/src/services/assessmentService.ts`, `frontend/src/components/Assessment*` (formulário, lista e detalhe do estudante) e `frontend/src/messages/pt-BR.ts`.
   - **Documentação:** `specs/GLOSSARY.md`; esta spec.
   - **Não alterar:** `frontend/src/engine/core/` e qualquer arquivo fora desta lista sem justificativa no resumo da entrega.
4. **Definição de pronto:** todos os CA marcados, os testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, o roteiro manual feito, as pendências da seção 10 vazias e o status atualizado para `Implementada`.

## 10. Pendências para aprovação

Cada pendência traz uma recomendação. A spec foi escrita **seguindo as recomendações**; se alguma for decidida de outro jeito, a seção indicada muda. **Uma spec só pode ser aprovada com esta tabela vazia.**

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| P-01 | **Escopo.** A Tech Spec mistura duas entregas: a modalidade e a habilitação dos alunos (A) e a projeção, o cockpit e a intervenção sobre a prova (B). A B depende de sessão de prova, token, fila de ajuda e canal do cockpit, que só existem no rascunho 052, e ainda tem uma dúvida de fundo (a primeira da seção 2.2) sobre o que "bloquear" significa. | Esta spec entrega só a A. A B fica registrada na seção 2.2, sem perder nada, e vira spec própria depois da spec das tentativas. |
| P-02 | **Nomes.** A Tech Spec usa `PRESENCIAL`/`REMOTA`, "homologação" e rotas e tabelas em português. O glossário já tem a modalidade da aula como `IN_PERSON` e `ONLINE` (e proíbe `REMOTE`), e "homologação" já é a de **nota** (`GradeApproval`). Todo código e toda rota são em inglês, sob `/classes/:id/assessments/...`. | Modalidade `IN_PERSON` e `ONLINE`. Para a decisão da docente sobre quem entra na prova, o termo "habilitação" (`clearance`, tabela `assessment_clearances`, estados `PENDING`, `APPROVED`, `REJECTED`), deixando "homologação" só para a nota. Rotas em inglês, como na SPEC-075. |
| P-03 | **Modalidade e tipo.** A Tech Spec dá `PRESENCIAL` como padrão para tudo e não diz o que fazer com a atividade (prazo de dias, sem token). | `ASSIGNMENT` só pode ser `ONLINE`; `EXAM` pode ser as duas; sem informar, a prova é presencial e a atividade é online (RN-01). |
| P-04 | **A exigência de habilitação.** A Tech Spec guarda o campo `exige_homologacao_presencial` mas não diz se a docente pode desligá-lo, nem o que "aprovar todos" faz com quem já foi recusado, nem até quando se decide. | A docente pode desligar a exigência de uma prova presencial. "Habilitar todos" habilita só quem aguarda e deixa o recusado como está (para não desfazer sem querer uma recusa). Decide-se até o término da avaliação e, depois que o aluno começou a tentativa, não mais (RN-06, RN-07). |
| P-05 | **Congelar a modalidade.** A SPEC-075 RN-10 não lista a modalidade nem a exigência entre o que congela no início. | Congelam a partir do início, como o tipo; as decisões de habilitação não congelam (RN-03). Isso acrescenta dois campos à lista da SPEC-075 RN-10. |
| P-06 | **Estado "aguardando".** A Tech Spec guarda o estado `PENDENTE` como linha da tabela. | `PENDING` é derivado (quem não tem decisão), sem linha, e não se volta a ele depois de decidir (RN-04, seção 2.1). |
| P-07 | **Histórico das decisões.** A Tech Spec guarda quem e quando por aluno, e a SPEC-075 já tem o histórico da avaliação. | Cada linha guarda o último estado, quem, quando e o motivo; cada ação grava um evento `CLEARANCE_UPDATED` no histórico da avaliação. A decisão anterior sobre o mesmo aluno não fica guardada (RN-11). |
| P-08 | **Modalidade para o estudante.** A SPEC-075 tem uma lista exata de campos públicos, que os testes conferem. | A modalidade chega ao estudante só pela consulta do próprio acesso; o `AssessmentPublic` não muda. Mostrá-la no calendário fica para depois. |
| P-09 | **Onde o estudante vê a recusa.** A Tech Spec fala da "tela de validação do token", que ainda não existe. | No detalhe da avaliação da SPEC-075, com um bloco de estado e, na recusa, o banner fixo com o motivo; a tela do token, quando existir, usa a mesma consulta `my-access` (3.1). |
| P-10 | **Motivo da recusa e frase padrão.** A Tech Spec diz "opcional ou padrão" sem fixar a frase nem o limite. | Motivo de até 300 caracteres em texto puro; sem motivo, o aluno lê "Sua matrícula não foi habilitada para esta avaliação presencial." (texto de interface, no arquivo de mensagens). |
| P-11 | **O aviso de "prestes a iniciar".** A Tech Spec não diz quanto é "prestes". | 30 minutos antes do início, e durante a prova, se houver quem aguarde (RN-13). |
| P-12 | **Notificar o aluno.** A Tech Spec não pede aviso por e-mail da decisão. | Sem aviso ao aluno nesta spec (SPEC-075 D-06): ele vê o estado ao abrir a avaliação. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 20/10/2026 | Aruna Architect | Criação em `Rascunho`, a pedido do Tech Lead, a partir da Tech Spec que ele trouxe em 20/10/2026, conferida contra o canônico (3.1, 4.3 e 6.4.1), o glossário, a SPEC-075 e o que já existe de aula ao vivo. A projeção, o cockpit e a intervenção ficam na seção 2.2 para a spec das tentativas. Doze pendências abertas (P-01 a P-12), todas com recomendação |
