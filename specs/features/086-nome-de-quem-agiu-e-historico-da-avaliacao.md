# SPEC-086: Detalhe da Avaliação: Sempre Dizer Quem Agiu e Juntar as Habilitações Seguidas no Histórico

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-086 |
| **Status** | Aprovada |
| **Data de criação** | 22/10/2026 |
| **Última revisão** | 23/10/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `assessment` (frontend: o histórico e o resumo do detalhe; backend: o nome de quem agiu), com a busca de nomes do `classgroup` |
| **Contexto de tela** | `/app/classes/[id]/assessments/[assessmentId]`, na visão da docente e do administrador |
| **Prioridade** | Média |
| **Depende de** | SPEC-075 (RN-15, o histórico), SPEC-076 (RN-11, o evento `CLEARANCE_UPDATED`), SPEC-083 (o início da prova, "Prova iniciada às ... por ..."), SPEC-049 (a busca de nomes que o `assessment` usa) |
| **Substitui** | Nenhuma. Complementa a SPEC-075 RN-15 e a SPEC-076 RN-11 só na forma de mostrar |
| **Fontes canônicas** | O detalhe da avaliação "Teste" do ambiente de desenvolvimento, que o Tech Lead colou pedindo um ajuste: "Criada por" em branco e dez linhas iguais de "Habilitações atualizadas" |

---

## 1. Contexto e Problema (Context & Problem Statement)

O detalhe da avaliação mostra quem a criou e um histórico de quem fez o quê. Na avaliação "Teste" do desenvolvimento, duas coisas aparecem estranhas:

1. **Os nomes ficam em branco.** O fato "Criada por" vem vazio e cada linha do histórico sai como "Criada por  em 21/10/2026 às 18:37." (com um buraco no lugar do nome). A causa é que o usuário que agiu (o administrador do desenvolvimento) **existe, mas não tem nome cadastrado**: a busca de nomes que o `assessment` usa (a do `classgroup`) deixa de fora quem não tem nome, e a tela não tem o que mostrar. A tela da turma (SPEC-049) trata o nome ausente como "Usuário removido", o que também está errado para quem existe sem nome.
2. **Dez linhas iguais de "Habilitações atualizadas".** A docente habilitou 10 alunos, um a um, em 5 segundos (13:35:45 a 13:35:50), e cada clique gravou um evento, como manda a SPEC-076 RN-11 (uma ação, um evento). O histórico é de inclusão apenas (SPEC-075 RN-15): os eventos não se alteram nem se apagam. Mostrados um por linha, dez cliques viram dez linhas idênticas que escondem o que importa (a criação, a alteração, o reagendamento).

## 2. Objetivos (Goals)

- **Sempre dizer quem agiu**, em todo lugar do detalhe que nomeia alguém: o nome; sem nome, o **e-mail**; usuário removido, o texto "Usuário removido". Nunca um buraco em branco.
- **Juntar, na tela, as habilitações seguidas** do mesmo autor no mesmo dia numa linha só, com a quantidade e o primeiro e o último horário. Os eventos continuam todos guardados e a API continua devolvendo todos.

### 2.1. Fora de escopo (Non-Goals)

Toda IA implementadora deve tratar esta lista como proibição.

- **Mudar o que se grava**: continua um evento por ação (SPEC-076 RN-11), de inclusão apenas (SPEC-075 RN-15). Nada é apagado, somado nem reescrito no banco.
- **Juntar outros tipos de evento**: `UPDATED` (guarda os campos alterados), `RESCHEDULED` (guarda as datas e o motivo) e `CANCELED` (guarda o motivo) continuam uma linha cada.
- **Mostrar quais alunos foram habilitados** em cada ação, ou o valor do que mudou (continua só o nome do campo).
- **Paginar, filtrar ou ordenar** o histórico de outra forma; ele segue na ordem que o servidor dá.
- **Pedir ou cadastrar o nome** do usuário (perfil, cadastro): não é desta spec.
- **Mostrar nomes ou e-mails ao estudante**: a visão do estudante não traz quem criou nem quem agiu e continua assim (RN-03).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Tema único escuro, tokens semânticos, textos em `messages/pt-BR.ts`, contraste WCAG AA. Nenhum componente novo: muda o `AssessmentHistory` e o texto de quem aparece no detalhe.

**Quem** (RN-01 a RN-03)

- O nome vindo do servidor é mostrado como veio. Quando vem **vazio**, o servidor não achou o usuário (removido), e a tela mostra **"Usuário removido"**, o mesmo texto da tela da turma, no "Criada por", em cada linha do histórico e em "Prova iniciada às ... por ...".

**Habilitações seguidas** (RN-04, RN-05)

- No histórico, uma **sequência** é um grupo de eventos `CLEARANCE_UPDATED` **seguidos** na ordem do servidor, do **mesmo autor** e no **mesmo dia** (o dia de Brasília, como `formatMoment`). Cada sequência vira **uma linha**:
  - com **um só evento**, a linha é a de hoje: "Habilitações atualizadas por Fulana em 22/10/2026 às 13:35.";
  - com **dois ou mais**, nos minutos diferentes: "Habilitações atualizadas por Fulana em 22/10/2026: 10 ações, das 13:35 às 13:41.";
  - com **dois ou mais** no mesmo minuto: "Habilitações atualizadas por Fulana em 22/10/2026 às 13:35: 10 ações."
- Qualquer outro evento entre dois de habilitação, outro autor ou outro dia **interrompe** a sequência: a ordem e as demais linhas não mudam.

### 3.2. Backend (Go: `assessment` e `classgroup`)

- **RN-01 (quem agiu, o texto):** o nome que o `assessment` mostra de um usuário é o **nome dele**; se **não tem nome ou está em branco**, o **e-mail**; se o usuário **não existe ou foi removido**, nada (a tela mostra "Usuário removido"). Vale para `createdByName`, `updatedByName`, `startedByName` e `events[].actorName`, que saem da mesma busca (`Users.Names` do `assessment`).
- **RN-02 (a busca):** a busca de nomes do `classgroup` (`UserNames`, que o composition root entrega ao `assessment`) passa a devolver o nome ou, na falta, o e-mail, por uma consulta nova do repository do `classgroup` (D-03); o `FindUserName` (que dá o nome da docente da turma ao estudante) **não muda**. Segue sem ler usuário removido (`deleted_at`).
- **RN-03 (quem lê):** o e-mail só sai pelas rotas que já são da docente dona e do administrador (o detalhe e o resumo, SPEC-075 RN-15). A visão **pública** do estudante não traz nome nem e-mail de quem criou ou agiu, e isso é conferido por teste.
- **RN-04 (a API não esconde nada):** o `events` do detalhe continua com **todos** os eventos, um por ação, na mesma ordem; juntar é só da tela (RN-05).
- **RN-05 (juntar na tela):** a regra da seção 3.1 é do frontend: o contrato não ganha campo nem rota.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: nenhuma tabela, coluna ou valor de enumeração muda; só a leitura do nome passa a cair no e-mail.

## 5. Contrato de API (API Contract)

Nenhuma rota nova e nenhum campo novo. Muda só o **significado** de quatro campos que já existem, em `GET /api/v1/classes/:id/assessments/:assessmentId` e nas respostas que trazem o resumo da avaliação (RN-01):

| Campo | Antes | Depois |
| :--- | :--- | :--- |
| `createdByName`, `updatedByName`, `startedByName` | Vazio quando o usuário não tem nome | O nome; sem nome, o e-mail; vazio só quando o usuário foi removido |
| `events[].actorName` | O mesmo | O mesmo que acima |

## 6. Impacto e Riscos (Impact & Risks)

- **O e-mail é dado pessoal.** Hoje o nome só aparece quando existe; o e-mail passa a aparecer no lugar dele. **Mitigação:** só quem já lê o histórico o vê (a docente dona e o administrador, SPEC-075 RN-15), nunca o estudante (RN-03, CA-04); e o módulo `classroom` já mostra o e-mail na falta do nome.
- **A busca de nomes é compartilhada.** O histórico da turma (SPEC-049 RN-04) usa a mesma `UserNames` e passa a mostrar o e-mail no lugar de "Usuário removido" para quem existe sem nome (D-03). **Mitigação:** o `FindUserName` não muda; os testes do histórico da turma que dependiam do nome ausente são ajustados no commit vermelho, com o motivo na entrega.
- **Juntar esconde a granularidade na tela.** **Mitigação:** a API e o banco continuam completos (RN-04, CA-07); a linha diz quantas ações e de que horário a que horário.
- **Uma sequência pode juntar ações de horas diferentes no mesmo dia.** **Mitigação:** a linha mostra o primeiro e o último horário (D-02).
- **Impacto em outros módulos:** o `classgroup` ganha uma consulta nova e muda o que `UserNames` devolve; o composition root não muda de forma. **`legacy/`:** removida; sem impacto.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO o usuário que criou, alterou, iniciou ou agiu tem nome, O SISTEMA DEVE mostrar o nome dele em `createdByName`, `updatedByName`, `startedByName` e `events[].actorName` (RN-01).
- [ ] **CA-02** (evento): QUANDO o usuário não tem nome ou o nome está em branco, O SISTEMA DEVE devolver o e-mail dele nesses quatro campos, em vez de vazio (RN-01, RN-02).
- [ ] **CA-03** (estado): ENQUANTO o servidor devolve o nome vazio (usuário removido), A tela DEVE mostrar "Usuário removido" no "Criada por", em cada linha do histórico e em "Prova iniciada ...", e NÃO DEVE deixar um buraco em branco (RN-01).
- [ ] **CA-04** (ubíquo): A visão pública do estudante NÃO DEVE trazer nome nem e-mail de quem criou ou agiu (RN-03).
- [ ] **CA-05** (evento): QUANDO o histórico tem eventos `CLEARANCE_UPDATED` seguidos, do mesmo autor e do mesmo dia, A tela DEVE mostrá-los numa linha só, com a quantidade e o primeiro e o último horário (ou o horário único, no mesmo minuto), e um único evento DEVE continuar com a linha de hoje (RN-05).
- [ ] **CA-06** (indesejado): SE entre dois eventos de habilitação vem outro evento, outro autor ou outro dia, ENTÃO a tela DEVE interromper a sequência, sem mudar a ordem nem as demais linhas (RN-05).
- [ ] **CA-07** (ubíquo): A API DEVE continuar devolvendo um evento por ação, todos, na mesma ordem, e nada DEVE ser gravado, juntado ou apagado (RN-04).
- [ ] **CA-08** (ubíquo): Os textos novos DEVEM estar em `messages/pt-BR.ts`, a linha juntada DEVE ser lida por leitor de tela como qualquer outra linha do histórico e o contraste DEVE ser AA.

## 8. Plano de Testes (Test Plan)

Os testes são escritos **antes** do código e rodados vermelhos primeiro (SPEC-038). Nomes em inglês, como no código.

**Backend** (Go: `testing` e `testify`)

- `classgroup` (service e repository): `UserNames` devolve o nome, devolve o e-mail de quem tem nome em branco ou nulo e deixa de fora o usuário removido; o `FindUserName` segue como está (CA-01, CA-02)
- `assessment` (service e handler): o detalhe traz o e-mail no `createdByName`, no `actorName` e no `startedByName` de quem não tem nome, e vazio só para o removido; todos os eventos continuam na resposta, na ordem (CA-02, CA-07)
- Composition root (`cmd/api`): o adaptador do `assessment` entrega o nome ou o e-mail (CA-02)
- A visão pública do estudante não traz nome nem e-mail (CA-04)

**Frontend** (Vitest e Testing Library)

- `AssessmentHistory.test.tsx`: dez habilitações seguidas viram uma linha; o evento único mantém a linha atual; o mesmo minuto; sequência interrompida por outro evento, por outro autor e por outro dia; a ordem das demais linhas; o nome vazio vira "Usuário removido" (CA-03, CA-05, CA-06)
- Página do detalhe (`page.test.tsx`): "Criada por" e "Prova iniciada ... por" com nome vazio mostram "Usuário removido" (CA-03)
- `messages` (teste de pt-BR), Stylelint, ESLint e `tsc` limpos (CA-08)

**Manual** (roteiro)

1. Abrir o detalhe da avaliação "Teste" do desenvolvimento e conferir o e-mail do administrador no "Criada por" e nas linhas do histórico, sem buraco.
2. Conferir que as dez habilitações (todas no minuto 13:35) viram uma linha só, "Habilitações atualizadas por ... em 22/10/2026 às 13:35: 10 ações.", e que "Criada" e "Alterada" continuam em linhas próprias.
3. Conferir, pela API, que os dez eventos continuam todos lá.
4. Abrir a turma como estudante e conferir que nada de nome ou e-mail de quem agiu aparece.

**Cobertura:** meta acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md` e esta spec; a SPEC-075 (RN-15, o histórico), a SPEC-076 (RN-11) e a SPEC-049 (RN-04, a busca de nomes). Do código: `backend/internal/modules/assessment/service/read.go` e `service.go` (`Users.Names`), `backend/cmd/api/assessment_refs.go` (`assessmentClasses.Names`), `backend/internal/modules/classgroup/service/service.go` (`UserNames`) e `repository/repository.go` (`FindUserName`), `frontend/src/components/AssessmentHistory/AssessmentHistory.tsx` e `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/page.tsx`.
2. **Ordem de execução:** (a) testes do backend, vermelhos e commitados (`test(classgroup): ...`, `test(assessment): ...`); (b) a consulta com o e-mail no `classgroup` e o `UserNames`; (c) testes do frontend, vermelhos e commitados (`test(frontend): ...`); (d) o histórico juntando as habilitações e o "Usuário removido"; (e) roteiro manual; (f) status e histórico.
3. **Arquivos e diretórios a criar ou alterar:**
   - **Backend, alterados:** `backend/internal/modules/classgroup/service/service.go` e `repository/repository.go` (a consulta de nome ou e-mail e o `UserNames`) e os testes ao lado; testes do `assessment` e de `cmd/api`.
   - **Frontend, alterados:** `AssessmentHistory.tsx` e o teste, `.../assessments/[assessmentId]/page.tsx` e o teste, e `frontend/src/messages/pt-BR.ts`.
   - **Documentação:** esta spec.
   - **Não alterar:** o que se grava dos eventos, o `FindUserName`, o motor, `frontend/src/engine/core/` e qualquer arquivo fora desta lista sem justificativa no resumo da entrega.
4. **Definição de pronto:** todos os CA marcados, os testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, o roteiro manual feito, as pendências da seção 10 vazias e o status atualizado para `Implementada`.

## 10. Pendências para aprovação

Nenhuma. O Tech Lead decidiu em 23/10/2026, ao aprovar a spec, todas as pendências que ela tinha, com as recomendações como estavam. As decisões estão incorporadas às seções 3, 6, 7 e 8; esta tabela só as registra.

| ID | Decisão |
| :--- | :--- |
| D-01 | **O que mostrar no lugar do nome ausente.** O e-mail, só para a docente dona e o administrador (RN-03). |
| D-02 | **O critério para juntar as habilitações.** Seguidas, do mesmo autor e do mesmo dia, sem limite de minutos; a linha mostra o primeiro e o último horário. |
| D-03 | **O histórico da turma (SPEC-049).** Entra: `UserNames` passa a dar o nome ou o e-mail, e a tela da turma melhora sem mudar de código. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 22/10/2026 | Aruna Architect | Criação em `Rascunho`, a pedido do Tech Lead, que colou o detalhe da avaliação "Teste" do desenvolvimento e pediu um ajuste: "Criada por" e o histórico sem nome (o administrador do desenvolvimento não tem nome cadastrado e a busca do `classgroup` deixa de fora quem não tem) e dez linhas iguais de "Habilitações atualizadas" (uma por clique, entre 13:35:45 e 13:35:50, como manda a SPEC-076 RN-11). Conferida contra o `AssessmentHistory`, o `Users.Names` do `assessment`, o `UserNames` e o `FindUserName` do `classgroup`, o `UserNames` do `classroom` (que já cai no e-mail) e a resposta real da API do ambiente de desenvolvimento. Três pendências abertas (D-01 a D-03), todas com recomendação |
| 23/10/2026 | Tech Lead | Aprovada ("aprovo"), com as recomendações das três pendências aceitas como estavam na spec: D-01 a D-03. Status: `Aprovada` |
| 23/10/2026 | Aruna Architect | Seção 10 esvaziada: as três pendências viraram decisões D-01 a D-03, incorporadas ao texto |
