# SPEC-089: Início de Toda Prova pela Docente, Também na Online

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-089 |
| **Status** | Aprovada |
| **Data de criação** | 03/11/2026 |
| **Última revisão** | 03/11/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `assessment` (backend: o início da prova e a decisão de acesso; frontend: o detalhe, o aviso da lista, o diálogo de início e o aviso de acesso do estudante) |
| **Contexto de tela** | `/app/classes/[id]/assessments/[assessmentId]` (o botão e o estado), a aba *Avaliações* da turma (o aviso da linha) e o aviso de acesso do estudante no detalhe da avaliação |
| **Prioridade** | Alta |
| **Depende de** | SPEC-083 (inteira), SPEC-075 (RN-10, RN-14, RN-15), SPEC-076 (RN-01, RN-02, RN-08) |
| **Substitui** | Nenhuma. Sobrepõe, na SPEC-083, a restrição do início à prova presencial: RN-01, RN-05, o erro 400 da seção 5, a coluna `started_at` da seção 4, o objetivo "a avaliação `ONLINE` não muda" da seção 2 e os CA-03, CA-06 e CA-11 |
| **Fontes canônicas** | Pedido do Tech Lead de 03/11/2026: "o professor tem que dar o start à prova, ou seja, mesmo agendada, o professor deve dar o início à prova", confirmado como regra para toda prova, também a online |

---

## 1. Contexto e Problema (Context & Problem Statement)

A SPEC-083 criou o ato de **iniciar a prova**, mas só para a prova **presencial**. A prova **online** continua abrindo sozinha pelo relógio no horário marcado: quando `startsAt` chega, todo aluno elegível entra, sem a docente ter feito nada. No teste de 03/11/2026, a prova online "Prova de teste — 03/11/2026" abriu às 14:00 sem nenhum botão de início para a docente.

O Tech Lead quer que o início seja sempre da docente: o horário marcado diz **a partir de quando** a prova pode começar, e a docente decide **o momento** em que ela começa, seja a prova presencial ou online.

## 2. Objetivos (Goals)

- **Toda prova** (`type` igual a `EXAM`), presencial ou online, só deixa os alunos entrarem depois que a docente dona da turma ou o administrador a **inicia**, com as mesmas regras da SPEC-083: só a partir do horário marcado e até o término, uma vez só, sem desfazer, com o evento `STARTED` no histórico.
- Na prova online, depois do início, todo aluno elegível entra: a prova online não tem habilitação (SPEC-076 RN-02).
- O detalhe, o aviso da lista e o diálogo de início valem para a prova online como já valem para a presencial, com textos que não falam de habilitação quando ela não existe.
- O estudante de uma prova online não iniciada vê o motivo certo: a docente ainda não iniciou a prova.

### 2.1. Fora de escopo (Non-Goals)

Toda IA implementadora deve tratar esta lista como proibição.

- A **atividade** (`ASSIGNMENT`) continua abrindo sozinha pelo relógio (D-01).
- A entrada do aluno na prova, a tentativa, o cronômetro individual, a telemetria e a correção.
- Habilitação na prova online: continua proibida (SPEC-076 RN-02).
- Desfazer o início, encerrar antes do término e iniciar antes do horário marcado (SPEC-083 D-01 e D-05).
- Tempo real e o cockpit da docente (SPEC-083 D-04).
- Mudar a fase calculada pelo relógio (`UPCOMING`, `RUNNING`, `ENDED`) e o congelamento da composição (SPEC-075 RN-10).
- O simulador da prova (SPEC-081, 084, 085, 087): ele é da docente e não depende do início.
- Qualquer mudança em `frontend/src/engine/core/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Tema único escuro, tokens semânticos, textos em `messages/pt-BR.ts`, navegação completa por teclado, contraste WCAG AA e alvos de toque de no mínimo 44 px.

**O detalhe da avaliação** (docente dona e administrador): o botão *Iniciar a prova*, o desabilitado com a razão em fase `UPCOMING`, a frase "Prova iniciada às HH:MM por <nome>." e a frase "A prova terminou sem ser iniciada." passam a aparecer em **toda prova** `SCHEDULED`, presencial ou online, exatamente como a SPEC-083 descreve para a presencial. Atividade e avaliação cancelada: nada disto aparece. O botão *Habilitações* e os contadores continuam só na presencial com a exigência ligada.

**O diálogo de início** muda o texto pela situação da prova:

| Situação | Texto do diálogo |
| :--- | :--- |
| Presencial com a exigência de habilitação | Como hoje: "Iniciar a prova agora? Os alunos só entram depois de habilitados por você. O início não pode ser desfeito." |
| Online, ou presencial sem a exigência | "Iniciar a prova agora? Todos os alunos da prova poderão entrar a partir deste momento. O início não pode ser desfeito." |

**A aba *Avaliações* da turma:** o aviso "<título>: a prova já pode ser iniciada." com o botão *Iniciar a prova* (SPEC-083 CA-12) passa a aparecer também na prova online em fase `RUNNING` e não iniciada. O aviso de habilitação continua só na presencial.

**O aviso de acesso do estudante**, com o motivo `NOT_STARTED`:

| Situação | Texto |
| :--- | :--- |
| Presencial com a exigência de habilitação | Como hoje: "A docente ainda não iniciou a prova. Aguarde: ela libera a entrada de cada aluno." |
| Online, ou presencial sem a exigência | "A docente ainda não iniciou a prova. Aguarde: você entra assim que ela iniciar." |

### 3.2. Backend (Go: módulo `assessment`)

- **RN-01 (iniciar a prova):** substitui a SPEC-083 RN-01 só na modalidade. A avaliação deve ser uma **prova** (`EXAM`), presencial ou online; numa atividade, 400 `invalid-assessment`. O resto da SPEC-083 RN-01, RN-02 e RN-03 (papéis, fase `RUNNING`, ordem das recusas, `started_at` e `started_by` pelo relógio do servidor, evento `STARTED` na mesma transação, 409 no segundo início) fica como está.
- **RN-02 (decisão de acesso):** substitui a condição da SPEC-083 RN-05. Numa **prova** em fase `RUNNING` que a docente ainda não iniciou, o aluno elegível recebe `NOT_STARTED`, presencial ou online. A ordem dos motivos não muda: `NOT_ELIGIBLE`, `CANCELED`, `NOT_OPEN_YET`, `ENDED`, `NOT_STARTED`, `NOT_CLEARED`. Na prova online iniciada, o aluno elegível recebe `ALLOWED`. A atividade nunca recebe `NOT_STARTED`.
- **RN-03 (resumo da avaliação):** o resumo para a docente e o administrador traz `startedAt`, `startedBy` e `startedByName` também na prova online iniciada. Os formatos público, do calendário e do estudante não mudam (SPEC-083 RN-07).
- **RN-04 (avaliações já gravadas):** a migração não inicia nenhuma prova. As provas online em andamento passam a esperar o início da docente; as encerradas ficam encerradas (D-02).

## 4. Modelo de Dados (Data Model)

**`assessments`** (alterada, migração nova): sem coluna nova. Muda só a restrição da coluna `started_at` criada pela SPEC-083.

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `started_at` | timestamptz | Não | Só pode estar preenchido quando `type` é `EXAM` (antes: só quando `modality` é `IN_PERSON`) | O instante em que a docente iniciou a prova (RN-01) |

A restrição `assessments_started_in_person` sai e entra uma restrição nova, de nome `assessments_started_exam`, com a regra acima. A descida da migração apaga o início das provas online antes de devolver a restrição antiga, para que ela possa ser criada de novo.

## 5. Contrato de API (API Contract)

Nenhuma rota nova. Rotas existentes que mudam:

| Rota | Mudança |
| :--- | :--- |
| `POST /api/v1/classes/:id/assessments/:assessmentId/start` | Passa a aceitar a prova online. O 400 `invalid-assessment` fica só para a atividade (RN-01) |
| `GET /api/v1/classes/:id/assessments/:assessmentId/my-access` | O `reason` igual a `NOT_STARTED` passa a vir também na prova online não iniciada (RN-02); as chaves da resposta não mudam |
| `GET /api/v1/classes/:id/assessments` e `GET .../:assessmentId` (visão da docente) | `startedAt`, `startedBy` e `startedByName` também na prova online iniciada (RN-03) |

## 6. Impacto e Riscos (Impact & Risks)

- **A docente esquece de iniciar a prova online.** Hoje ela abre sozinha; depois desta spec, ninguém entra. **Mitigação:** o aviso "a prova já pode ser iniciada" na lista e o motivo claro para o aluno, como na presencial.
- **A docente não está no laboratório durante a prova online.** Se a prova online for feita em casa num horário longo, alguém precisa iniciá-la. **Mitigação:** decisão do Tech Lead; quem quer abertura automática usa a atividade (D-01).
- **Provas online em andamento no momento da migração** passam a esperar o início. **Mitigação:** ainda não existe a tentativa, então nenhum aluno é interrompido no meio da prova; a RN-04.
- **Código das SPEC-083 e 076 que muda:** a condição de `Start`, a de `AccessOf`, a regra `canStart` do frontend, o diálogo e o aviso do estudante. **Mitigação:** os testes dessas specs que afirmam "online não tem início" mudam, com o motivo registrado na entrega.
- **Colisão de número de migração.** **Mitigação:** conferir o próximo número livre imediatamente antes de criar (hoje seria 00046).
- **Impacto em outros módulos:** nenhum; o calendário e as telas do estudante leem o formato público, que não muda. **`legacy/`:** removida; sem impacto.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente dona ou o administrador inicia uma prova **online** em andamento, O servidor DEVE gravar `started_at` e `started_by`, devolver o resumo com `startedAt`, `startedBy` e `startedByName`, e gravar o evento `STARTED` na mesma transação (RN-01, RN-03).
- [ ] **CA-02** (indesejado): SE a avaliação é uma **atividade**, ENTÃO O início DEVE ser recusado com 400 `invalid-assessment`; as demais recusas da SPEC-083 CA-02 e CA-03 DEVEM valer também para a prova online (RN-01).
- [ ] **CA-03** (estado): ENQUANTO uma prova online em fase `RUNNING` não foi iniciada, `AccessOf` DEVE responder `NOT_STARTED` ao aluno elegível; depois do início, DEVE responder `ALLOWED`; numa atividade em andamento, NÃO DEVE responder `NOT_STARTED` (RN-02).
- [ ] **CA-04** (ubíquo): A migração NÃO DEVE iniciar nenhuma prova, DEVE aceitar `started_at` numa prova online e DEVE recusá-lo numa atividade; a descida DEVE apagar o início das provas online e devolver a restrição antiga (RN-04, seção 4).
- [ ] **CA-05** (estado): ENQUANTO a prova online está em fase `RUNNING` e não foi iniciada, O detalhe DEVE mostrar o botão *Iniciar a prova* e o diálogo com o texto da prova sem habilitação; em fase `UPCOMING`, o botão desabilitado com a razão; iniciada, "Prova iniciada às HH:MM por <nome>."; numa atividade ou avaliação cancelada, nada disso.
- [ ] **CA-06** (estado): ENQUANTO uma prova online em fase `RUNNING` não foi iniciada, A linha da lista DEVE mostrar o aviso "a prova já pode ser iniciada" com o botão *Iniciar a prova*, e NÃO DEVE mostrar o aviso de habilitação.
- [ ] **CA-07** (estado): ENQUANTO o motivo do acesso é `NOT_STARTED` numa prova online ou presencial sem a exigência, O aviso do estudante DEVE dizer "Aguarde: você entra assim que ela iniciar."; na presencial com a exigência, DEVE ficar como hoje.
- [ ] **CA-08** (ubíquo): Os textos novos DEVEM estar em `messages/pt-BR.ts`, e o diálogo DEVE manter navegação por teclado, contraste AA e alvos de 44 px.

## 8. Plano de Testes (Test Plan)

Os testes são escritos **antes** do código e rodados vermelhos primeiro (SPEC-038). Nomes em inglês, como no código.

**Backend** (Go: `testing` e `testify`)

- Service (`start_test.go`): `TestStart_OnlineExam_RecordsStartAndEvent` (CA-01), `TestStart_Assignment_IsInvalid` e as recusas de cancelada, encerrada, ainda não aberta e já iniciada numa prova online (CA-02)
- Service (`AccessOf`): `TestAccessOf_OnlineExamNotStarted_IsNotStarted`, `TestAccessOf_OnlineExamStarted_IsAllowed`, `TestAccessOf_RunningAssignment_IsNeverNotStarted` (CA-03)
- Handler (roteador Gin real com `httptest`): o início de uma prova online responde 200 com os campos, o de uma atividade responde 400 (CA-01, CA-02)
- Repository (PostgreSQL real, `testcontainers-go`): `TestMigration00046_UpAndDown`: sobe sem iniciar nenhuma prova, aceita `started_at` na prova online, recusa na atividade, e desce apagando o início das online (CA-04)

**Frontend** (Vitest e Testing Library)

- `lib/assessment.test.ts` (ajustado): `canStart` verdadeiro para prova online em andamento e não iniciada, falso para atividade (CA-05, CA-06)
- `[assessmentId]/page.test.tsx` (ajustado): o botão, o desabilitado e o estado de iniciada numa prova online; a ausência na atividade e na cancelada (CA-05)
- `AssessmentStartDialog.test.tsx` (ajustado): os dois textos do diálogo (CA-05, CA-08)
- `AssessmentList.test.tsx` (ajustado): o aviso de iniciar na prova online, sem o aviso de habilitação (CA-06)
- `AssessmentAccessNotice.test.tsx` (ajustado): os dois textos do motivo `NOT_STARTED` (CA-07)
- Stylelint, ESLint e `tsc` limpos (CA-08)

**Manual** (roteiro)

1. Agendar uma prova online para daqui a alguns minutos; antes do horário, conferir o botão desabilitado com a razão.
2. Como estudante, no horário, conferir "A docente ainda não iniciou a prova. Aguarde: você entra assim que ela iniciar."
3. Como docente, conferir o aviso na lista, abrir o diálogo com o texto sem habilitação e iniciar; conferir "Prova iniciada às … por …" e o evento no histórico.
4. Como estudante, conferir que o aviso de espera sumiu.
5. Conferir que uma atividade não tem o botão e abre sozinha no horário.

**Cobertura:** meta acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5): `domain`, `service`, `handler` e `repository` do `assessment` e os componentes e a `lib` do frontend desta spec.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, esta spec e a SPEC-083 inteira. Do código: `backend/internal/modules/assessment/service/start.go`, `service/read.go` (`AccessOf`), `backend/migrations/00045_assessment_start.sql`, `frontend/src/lib/assessment.ts`, `frontend/src/components/AssessmentStartDialog/`, `frontend/src/components/AssessmentList/`, `frontend/src/components/AssessmentAccessNotice/` e `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/page.tsx`.
2. **Ordem de execução:** (a) testes do backend, vermelhos e commitados (`test(assessment): ...`); (b) a migração, `start.go` e `read.go`; (c) testes do frontend, vermelhos e commitados (`test(frontend): ...`); (d) `lib/assessment.ts`, o detalhe, o diálogo, o aviso do estudante e as mensagens; (e) roteiro manual; (f) status e histórico.
3. **Arquivos e diretórios a criar ou alterar:**
   - **Backend, novo:** a migração do próximo número livre em `backend/migrations/` (a troca da restrição) e o teste dela.
   - **Backend, alterados:** `service/start.go`, `service/read.go` e os testes ao lado, `handler/handler_test.go` (ou o teste da rota de início).
   - **Frontend, alterados:** `frontend/src/lib/assessment.ts` e o teste, `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/page.tsx` e o teste, `frontend/src/components/AssessmentStartDialog/` e o teste, `frontend/src/components/AssessmentList/` (testes), `frontend/src/components/AssessmentAccessNotice/` e o teste, e `frontend/src/messages/pt-BR.ts`.
   - **Documentação:** esta spec e uma linha no histórico da SPEC-083 apontando para esta.
   - **Não alterar:** `frontend/src/engine/core/` e qualquer arquivo fora desta lista sem justificativa no resumo da entrega.
4. **Definição de pronto:** todos os CA marcados, os testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, o roteiro manual feito e o status atualizado para `Implementada`.

## 10. Pendências para aprovação

Nenhuma. O Tech Lead decidiu em 03/11/2026, ao aprovar a spec, as três pendências com as recomendações como estavam. As decisões estão incorporadas às seções 2, 3 e 6; esta tabela só as registra.

| ID | Decisão |
| :--- | :--- |
| D-01 | **A atividade não precisa de início.** Só a prova (`EXAM`) exige o início; a atividade continua abrindo sozinha no horário. |
| D-02 | **As provas online já gravadas e em andamento passam a esperar o início**, como a SPEC-083 D-02; a migração não inicia nenhuma prova. |
| D-03 | **Os textos sem habilitação** da seção 3.1 valem para a prova online e para a presencial sem a exigência, corrigindo o texto atual desta. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 03/11/2026 | Aruna Architect | Criação em `Rascunho`, a pedido do Tech Lead, a partir do pedido de 03/11/2026 de que toda prova, mesmo agendada, só comece quando a docente a iniciar. Conferida contra a SPEC-083, a SPEC-076 e o código de `Start`, `AccessOf`, `canStart`, do diálogo e do aviso do estudante. Três pendências abertas (P-01 a P-03), todas com recomendação |
| 03/11/2026 | Tech Lead | Aprovada ("aprovo"), com as recomendações das três pendências aceitas como estavam: D-01 a D-03. Status: `Aprovada` |
| 03/11/2026 | Aruna Architect | Seção 10 esvaziada: as três pendências viraram decisões D-01 a D-03 |
