# SPEC-083: Início da Prova Presencial pela Docente e Habilitação dos Alunos Durante a Prova

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-083 |
| **Status** | Aprovada |
| **Data de criação** | 22/10/2026 |
| **Última revisão** | 22/10/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `assessment` (backend: o início da prova, a decisão de acesso e a decisão de habilitação; frontend: o detalhe, a lista, as habilitações e o aviso de acesso do estudante) |
| **Contexto de tela** | `/app/classes/[id]/assessments/[assessmentId]` (o botão e o estado), a aba *Avaliações* da turma (o aviso da linha), `/app/classes/[id]/assessments/[assessmentId]/clearances` e o aviso de acesso do estudante no detalhe da avaliação |
| **Prioridade** | Alta |
| **Depende de** | SPEC-075 (RN-10, RN-11, RN-14, RN-15), SPEC-076 (RN-02, RN-06, RN-08, RN-09, RN-11, RN-13), SPEC-080 (o aviso na linha da lista), SPEC-082 (a lista como aba da turma) |
| **Substitui** | Nenhuma. Sobrepõe, na SPEC-076, o momento em que a docente decide a habilitação (RN-06), a ordem dos motivos da decisão de acesso (RN-08) e o aviso de "prestes a iniciar" (RN-13 e D-11); e, na SPEC-075, a ordem dos motivos da RN-14 |
| **Fontes canônicas** | Pedido do Tech Lead de 22/10/2026: numa prova presencial a docente clica em *Iniciar a prova* e é nesse momento que ela vai habilitando os alunos a entrar e a fazer a prova, e não antes de a prova acontecer |

---

## 1. Contexto e Problema (Context & Problem Statement)

Hoje a habilitação dos alunos (SPEC-076) é decidida **antes** da prova: a lista de habilitações abre assim que a avaliação é agendada, um aviso aparece na lista 30 minutos antes do início, e a prova abre sozinha pelo relógio no horário marcado. Não existe o ato de **iniciar** a prova. Isso não é o que acontece no laboratório: a docente chega, os alunos se sentam, ela inicia a prova e, conforme confere quem está na sala, vai deixando cada aluno entrar. Habilitar de véspera, ou "no horário marcado" sem a docente ter iniciado nada, tira dela o controle do momento em que a prova começa de fato.

## 2. Objetivos (Goals)

- Numa avaliação **presencial**, a docente (dona da turma) ou o administrador **inicia a prova**: o início fica registrado, com quem e quando, e entra no histórico da avaliação.
- **Antes do início**, ninguém entra e nenhuma habilitação é decidida; a lista de habilitações pode ser vista, mas não alterada.
- **Depois do início** e até o término, a docente habilita os alunos, um a um ou todos de uma vez, como a SPEC-076 já define.
- O estudante vê o motivo certo enquanto espera: "a docente ainda não iniciou a prova".
- O aviso da lista passa a acompanhar o novo fluxo: avisa que a prova já pode ser iniciada e, depois do início, os alunos que ainda aguardam.
- A avaliação `ONLINE` e a atividade não mudam.

### 2.1. Fora de escopo (Non-Goals)

Toda IA implementadora deve tratar esta lista como proibição.

- A **entrada do aluno na prova**, a tentativa, o token de sala, o cronômetro individual, a telemetria e a correção (spec das tentativas). Esta spec só decide **se** o aluno pode entrar; não existe tela de resolução.
- **Desfazer** o início da prova e **encerrar** a prova antes do término marcado (D-05).
- **Tempo real**: a lista de habilitações não se atualiza sozinha; a docente a atualiza com um botão. O canal em tempo real e o pedido de entrada feito pelo aluno ficam para o cockpit (D-04).
- Iniciar a prova **antes do horário marcado** ou depois do término (D-01).
- Mudar a **fase** da avaliação: `UPCOMING`, `RUNNING` e `ENDED` continuam calculadas pelo relógio do servidor e nunca guardadas (SPEC-075 RN-10). O início da docente é um fato à parte, dentro da fase `RUNNING`.
- Mudar o congelamento da avaliação (SPEC-075 RN-10): continua pelo início marcado.
- A projeção em sala e o cockpit da docente (SPEC-076, seção 2.2).
- Avisar o estudante por e-mail ou outro meio.
- Qualquer mudança em `frontend/src/engine/core/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Tema único escuro, tokens semânticos, textos em `messages/pt-BR.ts`, navegação completa por teclado, contraste WCAG AA e alvos de toque de no mínimo 44 px.

**O detalhe da avaliação** (docente dona e administrador), numa avaliação **presencial** e `SCHEDULED`:

- Em fase `RUNNING` e **ainda não iniciada**: o botão primário **Iniciar a prova**, ao lado de *Editar* e do restante. Ao acioná-lo abre um diálogo: "Iniciar a prova agora? Os alunos só entram depois de habilitados por você. O início não pode ser desfeito.", com os botões *Iniciar a prova* e *Voltar*. Confirmado, a página passa ao estado de iniciada.
- Em fase `UPCOMING`: o botão aparece desabilitado e a razão em texto, ligada a ele: "A prova pode ser iniciada a partir de 23/10/2026, 09:00." (D-01).
- **Iniciada:** no lugar do botão, a frase "Prova iniciada às 09:07 por Profa. Sediane." e o botão *Habilitações* com os contadores, como hoje.
- Em fase `ENDED` sem ter sido iniciada: a frase "A prova terminou sem ser iniciada."
- Avaliação `ONLINE`, atividade ou cancelada: nada disto aparece.

**A aba *Avaliações* da turma** (a linha, o aviso da SPEC-080 CA-06 e da SPEC-076 RN-13):

- Presencial, em fase `RUNNING`, ainda **não iniciada**: o aviso "A prova já pode ser iniciada." com o botão *Iniciar a prova*, que abre o mesmo diálogo do detalhe (D-06).
- Presencial **iniciada**, com a exigência ligada e alunos aguardando: o aviso atual ("N alunos ainda não foram habilitados") com *Habilitar todos* e *Ver habilitações*.
- O aviso de "30 minutos antes do início" **sai** (D-07): antes do início da prova pela docente não há o que habilitar.

**A página de habilitações** (`.../clearances`):

- **Antes do início:** a lista e os contadores aparecem, só para ver; o aviso "A habilitação começa quando você inicia a prova." fica no alto, e todos os botões de decisão (*Habilitar todos*, *Habilitar*, *Recusar*) ficam desabilitados, com esse aviso como razão ligada a eles. Há um link para o detalhe, onde está o *Iniciar a prova*.
- **Depois do início:** como a SPEC-076 definiu.
- Nos dois casos, o botão *Atualizar* lê a lista de novo (D-04).

**O aviso de acesso do estudante** (detalhe da avaliação, SPEC-076 D-09):

- Com o motivo `NOT_STARTED`: "A docente ainda não iniciou a prova. Aguarde: ela libera a entrada de cada aluno." O estado de habilitação do próprio aluno (aguardando, habilitado, recusado) só aparece depois do início.
- Com os outros motivos, como hoje.

### 3.2. Backend (Go: módulo `assessment`)

- **RN-01 (iniciar a prova):** só a docente dona da turma e o administrador. A avaliação deve ser `IN_PERSON` (em `ONLINE` ou atividade, 400 `invalid-assessment`), `SCHEDULED` e estar em fase `RUNNING` pelo relógio do servidor. Grava `started_at` (o relógio do servidor) e `started_by`. Iniciar de novo é 409 `assessment-already-started`; o início não se desfaz.
- **RN-02 (quando se inicia):** antes de `startsAt`, 409 `assessment-not-open-yet`; depois do término, 409 `assessment-ended`; cancelada, 409 `assessment-canceled`. A ordem de verificação é: cancelada, encerrada, ainda não aberta, já iniciada (D-01).
- **RN-03 (histórico):** o início grava o evento `STARTED` no histórico da avaliação (SPEC-075 RN-15), com autor e instante, na mesma transação que grava `started_at` e `started_by`.
- **RN-04 (a habilitação só depois do início):** a decisão de habilitação (`APPROVE_ALL` e `UPDATE`, SPEC-076 RN-06) numa avaliação presencial exige que a prova tenha sido iniciada; antes disso é 409 `assessment-not-started`. As demais regras da RN-06 e da RN-07 (avaliação `SCHEDULED`, exigência ligada, antes do término, aluno que ainda não começou a tentativa) ficam como estão. **Ler** a lista de habilitações continua permitido antes do início.
- **RN-05 (decisão de acesso):** `AccessOf` (SPEC-075 RN-14, SPEC-076 RN-08) ganha o resultado `NOT_STARTED`: numa avaliação presencial em fase `RUNNING` que a docente ainda não iniciou, o aluno elegível recebe `NOT_STARTED`. A ordem dos motivos passa a ser: `NOT_ELIGIBLE`, `CANCELED`, `NOT_OPEN_YET`, `ENDED`, `NOT_STARTED` e, por último, `NOT_CLEARED`. Só é `ALLOWED` quem passa por todos. A avaliação presencial **sem** a exigência de habilitação também precisa de início (D-03).
- **RN-06 (o próprio acesso do estudante):** `my-access` devolve `NOT_STARTED` no `reason` quando é o caso. O estado de habilitação do aluno continua vindo na resposta, como na SPEC-076; é a tela que o mostra só depois do início.
- **RN-07 (resumo da avaliação):** o resumo para a docente e o administrador ganha `startedAt`, `startedBy` e `startedByName`, ausentes enquanto a prova não foi iniciada. O formato público (`AssessmentPublic`), o do calendário e o do estudante **não** mudam (SPEC-076 D-08).
- **RN-08 (reagendar e cancelar):** continuam como na SPEC-075 RN-11 e RN-12. Depois de iniciada, só se pode prorrogar o término, como já valia em fase `RUNNING`, e cancelar continua permitido.
- **RN-09 (avaliações já gravadas):** a migração não inicia nenhuma prova. As presenciais encerradas ficam encerradas; as presenciais em andamento passam a esperar o início da docente; as decisões de habilitação já gravadas ficam e valem depois do início (D-02).

## 4. Modelo de Dados (Data Model)

**`assessments`** (alterada, migração nova)

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `started_at` | timestamptz | Não | Só pode estar preenchido em `IN_PERSON` | O instante, pelo relógio do servidor, em que a docente iniciou a prova (RN-01); nulo enquanto não iniciada |
| `started_by` | uuid | Não | Referência ao usuário; preenchido junto com `started_at` | Quem iniciou a prova |

**Eventos do histórico** (valor novo, sem tabela nova): o `kind` dos eventos ganha o valor `STARTED` (RN-03), com autor e instante.

## 5. Contrato de API (API Contract)

**`POST /api/v1/classes/:id/assessments/:assessmentId/start`**: inicia a prova presencial (RN-01, RN-02, RN-03).

- **Papéis autorizados:** docente dona da turma e administrador.
- **Parâmetros de rota:** `id` da turma e `assessmentId`.
- **Corpo da requisição:** não há.
- **Resposta de sucesso** (`200`): o resumo da avaliação para a docente, com `startedAt`, `startedBy` e `startedByName` preenchidos, e o `serverNow`, como as outras ações sobre a avaliação.
- **Erros (RFC 7807):**

| HTTP | `type` (slug do problema) | Quando ocorre |
| :--- | :--- | :--- |
| 400 | `invalid-assessment` | A avaliação é `ONLINE` ou uma atividade |
| 403 | `forbidden` | Quem pede não é a docente dona nem o administrador |
| 404 | `assessment-not-found` | A avaliação ou a turma não existe para quem pede |
| 409 | `assessment-canceled` | A avaliação foi cancelada |
| 409 | `assessment-ended` | A avaliação já terminou |
| 409 | `assessment-not-open-yet` | O horário de início marcado ainda não chegou |
| 409 | `assessment-already-started` | A prova já foi iniciada |

**Rotas existentes que mudam:**

| Rota | Mudança |
| :--- | :--- |
| `POST /api/v1/classes/:id/assessments/:assessmentId/clearances` | Novo erro 409 `assessment-not-started`: a prova presencial ainda não foi iniciada (RN-04) |
| `GET /api/v1/classes/:id/assessments/:assessmentId/my-access` | O campo `reason` ganha o valor `NOT_STARTED` (RN-05, RN-06); as chaves da resposta não mudam |
| `GET /api/v1/classes/:id/assessments` e `GET .../:assessmentId` (visão da docente) | O resumo ganha `startedAt`, `startedBy` e `startedByName`, só quando a prova foi iniciada (RN-07) |
| `GET /api/v1/classes/:id/assessments/:assessmentId/clearances` | Não muda; continua respondendo antes do início |

## 6. Impacto e Riscos (Impact & Risks)

- **A docente esquece de iniciar a prova.** Com a fase em andamento pelo relógio e a prova sem início, ninguém entra. **Mitigação:** o aviso "A prova já pode ser iniciada." na lista, com o botão ali mesmo, e o motivo claro para o aluno que espera.
- **A habilitação de véspera deixa de existir.** Quem preparava a lista antes não pode mais. **Mitigação:** decisão do Tech Lead; a lista continua legível antes do início, e *Habilitar todos* é um clique depois dele.
- **Sem tempo real, a docente não vê quem chega.** **Mitigação:** a lista traz todos os elegíveis desde o início e o botão *Atualizar*; o canal em tempo real vem com o cockpit (D-04).
- **O cartão do estudante diz "Em andamento" antes de a docente iniciar.** A fase pública é a do relógio (SPEC-076 D-08). **Mitigação:** o aviso de acesso do detalhe diz que a docente ainda não iniciou; mudar o formato público fica fora desta spec.
- **Código das SPEC-075 e 076 que muda.** Esta spec altera `AccessOf` (motivo novo e a ordem), a regra de decidir, o resumo da docente, os valores de `kind` dos eventos e o aviso da lista. **Mitigação:** os testes dessas specs que mudam são ajustados, com o motivo registrado na entrega.
- **Avaliações já gravadas.** **Mitigação:** a RN-09; nenhuma prova é iniciada pela migração e nenhuma decisão antiga se perde.
- **Colisão de número de migração.** **Mitigação:** conferir o próximo número livre imediatamente antes de criar.
- **Impacto em outros módulos:** o `schedule` (calendário) e as telas do estudante leem o formato público, que não muda. **`legacy/`:** removida; sem impacto.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (evento): QUANDO a docente dona ou o administrador inicia uma prova presencial em andamento, O servidor DEVE gravar `started_at` pelo seu relógio e `started_by`, devolver o resumo com `startedAt`, `startedBy` e `startedByName`, e gravar o evento `STARTED` no histórico na mesma transação (RN-01, RN-03).
- [x] **CA-02** (indesejado): SE a prova já foi iniciada, ENTÃO O servidor DEVE recusar o novo início com 409 `assessment-already-started`, sem mudar `started_at` nem gravar outro evento (RN-01).
- [x] **CA-03** (indesejado): SE a avaliação é cancelada, encerrada ou ainda não abriu, ENTÃO O início DEVE ser recusado com 409 `assessment-canceled`, `assessment-ended` ou `assessment-not-open-yet`, nessa ordem de verificação; SE é `ONLINE` ou atividade, ENTÃO 400 `invalid-assessment`; SE quem pede não é a docente dona nem o administrador, ENTÃO 403 `forbidden` (RN-01, RN-02).
- [x] **CA-04** (indesejado): SE a prova presencial não foi iniciada, ENTÃO A decisão de habilitação (`APPROVE_ALL` e `UPDATE`) DEVE ser recusada com 409 `assessment-not-started`, e a leitura da lista de habilitações DEVE continuar respondendo (RN-04).
- [x] **CA-05** (estado): ENQUANTO a prova presencial está iniciada e não terminou, A decisão de habilitação DEVE funcionar como a SPEC-076 define, inclusive as recusas que ela já tem (RN-04).
- [x] **CA-06** (estado): ENQUANTO uma avaliação presencial em fase `RUNNING` não foi iniciada, `AccessOf` DEVE responder `NOT_STARTED` ao aluno elegível, depois de `NOT_OPEN_YET` e `ENDED` e antes de `NOT_CLEARED`, e DEVE responder `ALLOWED` só ao aluno que passa por todos os motivos, inclusive numa avaliação presencial sem a exigência de habilitação (RN-05).
- [x] **CA-07** (evento): QUANDO o estudante consulta o próprio acesso a uma prova presencial não iniciada, `my-access` DEVE devolver `reason` igual a `NOT_STARTED` e `allowed` falso, com as mesmas chaves de antes (RN-06).
- [x] **CA-08** (ubíquo): O resumo para o estudante, o formato público e o do calendário NÃO DEVEM trazer `startedAt`, `startedBy` nem `startedByName` (RN-07).
- [x] **CA-09** (estado): ENQUANTO a avaliação presencial está em fase `RUNNING` e não foi iniciada, O detalhe DEVE mostrar o botão *Iniciar a prova* à docente e ao administrador, com o diálogo de confirmação; confirmado, DEVE chamar o início e mostrar "Prova iniciada às HH:MM por <nome>".
- [x] **CA-10** (estado): ENQUANTO a avaliação presencial está em fase `UPCOMING`, O botão DEVE aparecer desabilitado com a razão "A prova pode ser iniciada a partir de <data e hora>", e, em fase `ENDED` sem início, o detalhe DEVE dizer que a prova terminou sem ser iniciada.
- [x] **CA-11** (estado): ENQUANTO a avaliação é `ONLINE`, atividade ou cancelada, O detalhe NÃO DEVE mostrar o botão *Iniciar a prova* nem as frases de início.
- [x] **CA-12** (estado): ENQUANTO uma avaliação presencial em fase `RUNNING` não foi iniciada, A linha da lista DEVE mostrar o aviso "A prova já pode ser iniciada." com o botão *Iniciar a prova*, que abre o mesmo diálogo; e, iniciada e com alunos aguardando, o aviso de habilitação da SPEC-076 com *Habilitar todos* e *Ver habilitações*; o aviso de 30 minutos antes NÃO DEVE existir mais.
- [x] **CA-13** (estado): ENQUANTO a prova não foi iniciada, A página de habilitações DEVE mostrar a lista e os contadores, o aviso "A habilitação começa quando você inicia a prova." e os botões de decisão desabilitados com esse aviso como razão; depois do início, DEVE funcionar como hoje; nos dois casos, o botão *Atualizar* DEVE ler a lista de novo.
- [x] **CA-14** (estado): ENQUANTO o motivo do acesso é `NOT_STARTED`, O aviso de acesso do estudante DEVE dizer que a docente ainda não iniciou a prova e NÃO DEVE mostrar o estado de habilitação dele; com os outros motivos, DEVE ficar como hoje.
- [x] **CA-15** (ubíquo): As avaliações já gravadas NÃO DEVEM ter a prova iniciada pela migração, e as decisões de habilitação já gravadas DEVEM ser mantidas (RN-09).
- [x] **CA-16** (ubíquo): Os textos novos DEVEM estar em `messages/pt-BR.ts`; as telas DEVEM ter navegação por teclado (inclusive o diálogo), contraste AA, alvos de 44 px e nenhuma cor fora dos tokens.

## 8. Plano de Testes (Test Plan)

Os testes são escritos **antes** do código e rodados vermelhos primeiro (SPEC-038). Nomes em inglês, como no código.

**Backend** (Go: `testing` e `testify`)

- Domain: o motivo `NOT_STARTED` e a regra de quando a prova pode ser iniciada pela fase (CA-03, CA-06)
- Service (`start`): iniciar grava o início e o evento na mesma transação, o segundo início é recusado, e as recusas por cancelada, encerrada, ainda não aberta, online e atividade, na ordem certa (CA-01 a CA-03)
- Service (`clearance`): a decisão é recusada antes do início e funciona depois; a leitura da lista funciona antes (CA-04, CA-05)
- Service (`AccessOf` e `MyAccess`): a ordem dos motivos com `NOT_STARTED`, `ALLOWED` sem a exigência só depois do início, e as chaves de `my-access` (CA-06, CA-07)
- Handler (roteador Gin real com `httptest`): a rota de início, os papéis, os erros RFC 7807, o resumo com os campos novos só para a docente e o administrador (CA-01 a CA-03, CA-08)
- Repository (PostgreSQL real, `testcontainers-go`): gravar e ler `started_at` e `started_by`, e a migração que não inicia nenhuma prova nem apaga decisão (CA-15)

**Frontend** (Vitest e Testing Library)

- `[assessmentId]/page.test.tsx` (ajustado): o botão, o diálogo, o estado de iniciada, o desabilitado com a razão, o encerrado sem início, e a ausência em online, atividade e cancelada (CA-09 a CA-11)
- `AssessmentList.clearanceWarning.test.tsx` (ajustado) e `ClassAssessments.test.tsx` (ajustado): o aviso de iniciar, o aviso de habilitação só depois do início e o fim do aviso de 30 minutos (CA-12)
- `clearances/page.test.tsx` (ajustado): antes do início, só leitura com o aviso e os botões desabilitados; depois, como hoje; o *Atualizar* (CA-13)
- `AssessmentAccessNotice.test.tsx` (ajustado): o motivo `NOT_STARTED` sem o estado de habilitação (CA-14)
- `lib/assessment.test.ts` e `assessmentService.test.ts` (ajustados): as regras do aviso e a chamada de início (CA-12)
- Stylelint, ESLint e `tsc` limpos (CA-16)

**Manual** (roteiro)

1. Agendar uma prova presencial para daqui a alguns minutos e conferir, antes do horário, o botão desabilitado com a razão e as habilitações só para ver.
2. No horário, conferir o aviso na lista, abrir o diálogo e iniciar; conferir "Prova iniciada às … por …", o evento no histórico e que o segundo início não é possível.
3. Habilitar um aluno e depois todos; conferir que antes do início nada disso era possível.
4. Como estudante, conferir "A docente ainda não iniciou a prova" antes e o estado de habilitação depois.
5. Conferir que uma atividade e uma avaliação online não têm o botão.
6. Conferir a aparência e o contraste (WCAG AA) do botão, do diálogo e dos avisos no tema escuro.

**Cobertura:** meta acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5): `domain`, `service` e `handler` do `assessment` e os componentes e o serviço do frontend desta spec.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md` e esta spec; a SPEC-075 (RN-10, RN-11, RN-14, RN-15), a SPEC-076 inteira, a SPEC-080 (CA-06) e a SPEC-082. Do código: `backend/internal/modules/assessment/` (domain, service, handler, repository), `backend/migrations/`, `frontend/src/components/AssessmentList`, `frontend/src/components/ClassAssessments`, `frontend/src/components/AssessmentAccessNotice` e `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/` (o detalhe e as habilitações).
2. **Ordem de execução:** (a) testes do backend, vermelhos e commitados (`test(assessment): ...`); (b) a migração, o domínio, o repository, o service e o handler; (c) testes do frontend, vermelhos e commitados (`test(frontend): ...`); (d) o serviço, o diálogo, o detalhe, o aviso da lista, as habilitações, o aviso do estudante e as mensagens; (e) roteiro manual; (f) status e histórico.
3. **Arquivos e diretórios a criar ou alterar:**
   - **Backend, novos:** a migração do próximo número livre em `backend/migrations/` (as duas colunas de `assessments`) e `backend/internal/modules/assessment/service/start.go` com o teste ao lado.
   - **Backend, alterados:** `domain/assessment.go` e `domain/errors.go` (os campos, o motivo `NOT_STARTED` e os erros novos), `service/service.go` e `service/read.go` (o resumo e a ordem dos motivos), `service/clearance.go` (a regra de decidir e o `my-access`), `repository/repository.go`, `handler/handler.go`, `handler/dto.go` e `handler/clearance.go` (a rota, os campos e os erros), e os testes ao lado de cada um.
   - **Frontend, novos:** `frontend/src/components/AssessmentStartDialog/` (o diálogo, o estilo e o teste).
   - **Frontend, alterados:** `frontend/src/services/assessmentService.ts` e o teste, `frontend/src/lib/assessment.ts` e o teste (a regra do aviso), `frontend/src/components/AssessmentList/AssessmentList.tsx` e os testes do aviso, `frontend/src/components/ClassAssessments/ClassAssessments.tsx` e o teste, `frontend/src/components/AssessmentAccessNotice/` e o teste, `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/page.tsx` e o teste, `.../clearances/page.tsx` e o teste, e `frontend/src/messages/pt-BR.ts`.
   - **Documentação:** esta spec e `specs/GLOSSARY.md` (seção 4.4).
   - **Não alterar:** `frontend/src/engine/core/` e qualquer arquivo fora desta lista sem justificativa no resumo da entrega.
4. **Definição de pronto:** todos os CA marcados, os testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, o roteiro manual feito, as pendências da seção 10 vazias e o status atualizado para `Implementada`.

## 10. Pendências para aprovação

Nenhuma. O Tech Lead decidiu em 22/10/2026, ao aprovar a spec, todas as pendências que ela tinha, com as recomendações como estavam. As decisões estão incorporadas às seções 2, 3, 5, 6, 7 e 8; esta tabela só as registra.

| ID | Decisão |
| :--- | :--- |
| D-01 | **Quando a docente pode iniciar.** Só a partir do horário marcado (fase `RUNNING`) e até o término; quem quer começar mais cedo reagenda. |
| D-02 | **As provas presenciais já gravadas.** Nenhuma é iniciada pela migração: as em andamento esperam a docente iniciar e as encerradas ficam encerradas; as decisões de habilitação já gravadas ficam e valem depois do início. |
| D-03 | **Prova presencial sem a exigência de habilitação.** Também precisa ser iniciada; sem a exigência, todos os elegíveis entram assim que a docente inicia. |
| D-04 | **Tempo real e pedido de entrada.** Sem tempo real e sem pedido de entrada nesta spec: todos os elegíveis aparecem aguardando desde o início e a docente usa *Atualizar*; o canal ao vivo e o pedido de entrada nascem com a tentativa e o cockpit. |
| D-05 | **Desfazer e encerrar.** Não nesta spec: o início não se desfaz e encerrar antes do término depende da tentativa. |
| D-06 | **Onde fica o botão.** No detalhe e no aviso da linha da lista, com o mesmo diálogo. |
| D-07 | **O aviso de 30 minutos antes.** Sai. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 22/10/2026 | Aruna Architect | Criação em `Rascunho`, a pedido do Tech Lead, a partir do pedido de 22/10/2026 de que, na prova presencial, a docente inicie a prova e habilite os alunos a partir daí, e não antes. Conferida contra as SPEC-075 e 076, o código da decisão de acesso e da habilitação e os rascunhos da tentativa. Sete pendências abertas (D-01 a D-07), todas com recomendação |
| 22/10/2026 | Tech Lead | Aprovada ("aprovo"), com as recomendações das sete pendências aceitas como estavam na spec: D-01 a D-07. Status: `Aprovada` |
| 22/10/2026 | Aruna Architect | Seção 10 esvaziada: as sete pendências viraram decisões D-01 a D-07, incorporadas ao texto |
| 22/10/2026 | Implementador | Implementada, menos o roteiro manual com o início de verdade, por isso o status continua `Aprovada`. **Feito:** CA-01 a CA-16. Backend: a migração 00045 (as colunas `started_at` e `started_by`, as duas restrições e o valor `STARTED` entre os tipos de evento), `Start` no service, a rota `POST .../start`, o motivo `NOT_STARTED` na decisão de acesso, a habilitação recusada antes do início (`assessment-not-started`) e o resumo com `startedAt`, `startedBy` e `startedByName`. Frontend: o botão e o diálogo no detalhe, o aviso de início na aba da turma, a página de habilitações só para ver antes do início (com o *Atualizar*), o aviso do estudante e as regras do aviso da lista. Commits: `test(assessment)`, o ajuste dos testes antigos e `feat(assessment)` no backend; `test(frontend)` e `feat(frontend)` no frontend. **Medido:** os testes novos falharam antes (o `Start` e o motivo não existiam, a decisão antes do início era aceita; no frontend, o diálogo e a regra não existiam); depois, `go test` de `assessment` (domain, service, handler, repository com PostgreSQL real) e de `cmd/api` verdes, cobertura de 84,3% no service, 84,8% no handler e 97,1% no domain; no frontend, 281 arquivos e 3.313 testes passam (1 pulado que já existia; a pasta `engine` não roda por desenho), `tsc`, ESLint e Stylelint limpos. **À mão** (Chrome sem janela, tema escuro, contra o backend de desenvolvimento já com a migração aplicada): antes do horário, o detalhe mostra o botão desligado com "A prova pode ser iniciada a partir de 22/10/2026, 18:34.", a página de habilitações mostra o aviso e os botões desligados, e o axe-core não achou violação de contraste no detalhe. **Aberto:** o roteiro manual com o início de verdade (itens 2 a 4), porque a prova do desenvolvedor só abre às 18:34 de 22/10/2026 e não criei prova de teste no banco dele; o início, as habilitações depois dele e o aviso do aluno só foram vistos em teste automatizado. **Desvios:** nenhum de requisito. O texto do aviso da lista ficou "<título>: a prova já pode ser iniciada.", no mesmo molde do aviso de habilitação; a regra de quando a prova pode ser iniciada ficou no service e não no domínio (a seção 8 previa um teste de domínio, que não existe porque não há função de domínio nova). **Testes alterados depois do vermelho:** os testes da SPEC-075 e da SPEC-076 que decidiam a habilitação sem a prova iniciada ou liam `ALLOWED` numa prova presencial passaram a iniciar a prova antes (requisito novo, em commit próprio antes do código); no teste de composição de `cmd/api`, a decisão passou a ser recusada porque a prova é de amanhã; `TestMigration00041_UpAndDown` desce e sobe também a migração 00045; no teste da lista, os dois casos que usavam uma prova começada com data futura passaram a usar uma prova ainda distante, por erro da fixture; e o parâmetro de relógio do aviso saiu de `needsClearanceWarning` e da lista, por já não ter uso |
