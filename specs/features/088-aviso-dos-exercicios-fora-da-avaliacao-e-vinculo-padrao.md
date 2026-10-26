# SPEC-088: Questões da Avaliação: o Aviso dos Exercícios que Não Entram na Prova e o Vínculo Padrão do Exercício Novo

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-088 |
| **Status** | Aprovada |
| **Data de criação** | 26/10/2026 |
| **Última revisão** | 26/10/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `assessment` (backend: a contagem dos exercícios fora da prova na leitura das questões elegíveis; frontend: o formulário da avaliação), `mcp` (backend: o vínculo padrão de `create_module_exercise`) e o banco de questões do módulo (frontend: o exercício novo e a ação de vincular todos) |
| **Contexto de tela** | `/app/classes/[id]/assessments/new` e `/app/classes/[id]/assessments/[assessmentId]/edit` (o formulário da avaliação), `/app/modules/[id]/exercises/new` (o exercício novo) e `/app/modules/[id]/edit?tab=exercises` (o banco de questões do módulo) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-075 (RN-05, as questões elegíveis e a rota `assessment-questions`), SPEC-023 (os vínculos do exercício), SPEC-024 (o servidor MCP), SPEC-079 (a escolha das questões) |
| **Substitui** | Nenhuma. Sobrepõe, na SPEC-023, o vínculo com que um exercício novo nasce (seção 3.1 e RN-03: hoje só o do bloco de origem, ou nenhum) e, na SPEC-024, o padrão do campo `links` de `create_module_exercise` |
| **Fontes canônicas** | Pedido do Tech Lead de 26/10/2026: os professores reclamam que criaram vários exercícios nos módulos para usar nas provas, mas na prova só acham alguns. Decisão dele na mesma data: avisar no formulário da avaliação quais não entram e por quê, e mudar o padrão do exercício novo para prática + avaliação |

---

## 1. Contexto e Problema (Context & Problem Statement)

Um exercício do banco do módulo só entra numa avaliação quando está **publicado** e tem o vínculo **Avaliação** (SPEC-075 RN-05, sobre os vínculos da SPEC-023). As duas coisas são escolhas separadas da docente no banco de questões do módulo: o exercício nasce em rascunho e, quando criado pelo botão do banco, **sem nenhum vínculo**; criado pelo bloco *Disponíveis no módulo*, nasce **só na prática**; e pelo MCP, sem o campo `links`, nasce sem vínculo. Nada no formulário da avaliação diz isso: a docente escolhe o módulo, vê poucas questões (ou nenhuma) e não sabe por quê.

Os números do banco de desenvolvimento, em 26/10/2026, mostram o tamanho do problema. No módulo "História do Linux", de 69 exercícios, **5** entram numa prova (publicados e vinculados à avaliação), **47** estão publicados mas vinculados só à prática, e **22** estão em rascunho. Nos outros módulos é parecido: fora "Simulados de Certificação", quase nenhum exercício tem o vínculo Avaliação. Os professores "criaram vários exercícios que podem ser usados nas provas" e, na prova, "só acham alguns".

A regra de elegibilidade está certa e fica como está: o vínculo *Avaliação* e a marca *Exclusivo da avaliação* existem para a docente reservar questões de prova e esconder algumas da prática. O que falta é (1) a avaliação **dizer** quantos exercícios do módulo ficaram de fora e por quê, com o caminho para resolver, (2) o exercício novo **nascer** com os dois vínculos, que é o que a maioria espera, e (3) um jeito de vincular **de uma vez** os que já existem.

## 2. Objetivos (Goals)

- O servidor passa a dizer, junto com as questões elegíveis de um módulo, **quantos** exercícios do banco ficaram de fora e **por quê**: ainda não publicados, ou publicados sem o vínculo *Avaliação*.
- O formulário da avaliação (criar e editar) mostra esse **aviso** assim que o módulo é escolhido, nas duas composições, com o link para o banco de questões do módulo; e um **alerta** quando nenhum exercício do módulo pode entrar.
- O exercício novo criado **pelo banco** ou pelo bloco *Disponíveis no módulo* nasce com os vínculos **Prática e Avaliação**; o criado pelo bloco *Reservados para avaliação* continua só com *Avaliação*. Continua nascendo em rascunho.
- A ferramenta `create_module_exercise` do MCP, chamada **sem** `links`, cria o exercício com Prática e Avaliação, e a descrição da ferramenta diz isso.
- O bloco *Reservados para avaliação* do banco ganha a ação **Adicionar todos os publicados**, que vincula à avaliação, de uma vez, os exercícios publicados que ainda não têm o vínculo.

### 2.1. Fora de escopo (Non-Goals)

Toda IA implementadora deve tratar esta lista como proibição.

- **Mudar a regra de elegibilidade** (SPEC-075 RN-05): continua publicado + vínculo *Avaliação*. A prova não passa a aceitar rascunho nem exercício só da prática.
- **Publicar** um exercício a partir do formulário da avaliação, ou vincular de lá: o aviso leva ao banco; quem vincula e publica é o banco (SPEC-023).
- Mexer nos vínculos dos **exercícios que já existem** sem a docente pedir: a spec só muda o padrão do exercício novo; o que já está só na prática é vinculado pela docente no banco, um a um ou pela ação *Adicionar todos os publicados* (D-03).
- **Publicar** os rascunhos pela ação de vincular todos: ela só vincula os publicados; publicar continua um a um, porque cada tipo tem o que precisa para ser publicado (SPEC-035 RN-04).
- Mudar o padrão da operação `SET_LINKS` de `update_module_exercise`, da marca *Exclusivo* ou do status: o exercício novo continua `DRAFT`, e só a docente publica, no app (SPEC-024).
- Listar, no formulário da avaliação, **quais** exercícios ficaram de fora, com título: só as contagens (D-01).
- Mudar a pré-visualização, o simulador, o sorteio ou o estoque por nível.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Tema único escuro, tokens semânticos, textos em `messages/pt-BR.ts` e `messages/authoring.pt-BR.ts`, navegação completa por teclado, contraste WCAG AA e alvos de toque de no mínimo 44 px.

**O aviso no formulário da avaliação** (D-01)

- Assim que o módulo é escolhido (na criação e na edição), o formulário lê as questões elegíveis do módulo, como já faz para o estoque do sorteio, agora nas **duas composições**, e guarda as contagens dos que ficaram de fora.
- Com pelo menos um exercício de fora, logo abaixo da escolha do módulo e antes da composição aparece o aviso, como nota (`role="note"`): "Deste módulo, N exercícios não podem entrar na prova: X publicados sem o vínculo Avaliação e Y ainda não publicados. Vincule e publique no banco de questões do módulo." As partes com zero somem da frase ("N exercícios não podem entrar na prova: Y ainda não publicados."). Ao lado, o link **Abrir o banco de questões do módulo**, que abre `/app/modules/[id]/edit?tab=exercises` **em aba nova**, sem acesso à aba de origem, para a docente não perder o que já preencheu; o link diz que abre em nova aba.
- Quando o módulo **não tem nenhum exercício elegível**, o aviso vira um alerta (`role="alert"`): "Nenhum exercício deste módulo pode entrar na prova." seguido das contagens e do mesmo link. O bloqueio do envio continua o que a SPEC-075 e a SPEC-079 já definem.
- Sem exercícios de fora, não há aviso. Na avaliação **congelada** (SPEC-075), o formulário é só de leitura e o aviso não aparece.
- Enquanto a leitura falha, o formulário segue como hoje (o estoque do sorteio já tolera a falha); o aviso só aparece com a resposta.

**O vínculo padrão do exercício novo** (D-02)

- Na tela do exercício novo (`/app/modules/[id]/exercises/new`), ao salvar pela primeira vez:
  - criado pelo botão *+ Novo exercício* do banco (sem bloco) ou pelo bloco *Disponíveis no módulo*: vínculos **Prática e Avaliação**;
  - criado pelo bloco *Reservados para avaliação*: só **Avaliação**, como hoje.
- A mensagem de salvo da tela passa a dizer onde o exercício ficou: "Exercício salvo e vinculado à prática e à avaliação." ou "Exercício salvo e reservado para avaliação.", para a docente saber que pode tirar o vínculo que não quer no banco. O exercício continua em rascunho, e o banco continua mostrando as etiquetas de vínculo.

**Vincular todos de uma vez** (D-03)

- No bloco *Reservados para avaliação* do banco, ao lado de *Adicionar do Banco*, a ação **Adicionar todos os publicados**, que vincula à avaliação, um a um pela rota de vínculos que já existe, todos os exercícios publicados que ainda não têm o vínculo, depois de uma confirmação com a contagem ("Vincular 47 exercícios publicados à avaliação?"). O que falhar é dito ao fim ("3 não puderam ser vinculados"), e o resto fica vinculado. Sem exercício para vincular, a ação fica desabilitada. Os rascunhos não entram: a ação não publica nada.

**Acesso à rede.** O formulário usa a rota de questões elegíveis que já existe (pelo serviço de avaliações), que ganha as contagens; a tela do exercício usa a criação que já existe, só com outros vínculos; a ação *Adicionar todos os publicados* usa a rota de vínculos que já existe. Nenhuma rota nova.

### 3.2. Backend (Go: módulos `assessment` e `mcp`)

- **RN-01 (a contagem dos que ficam de fora):** a leitura das questões elegíveis de um módulo (SPEC-075 RN-05 e RN-07, rota `assessment-questions`) passa a trazer, além de `items`, `total` e `stock`, o bloco `excluded` com duas contagens dos exercícios do banco do módulo que **não** são elegíveis: `unpublished`, os que não estão publicados (rascunho ou arquivado), seja qual for o vínculo; e `unlinked`, os publicados sem o vínculo *Avaliação*. Um exercício conta **uma vez**: o não publicado conta em `unpublished` mesmo sem vínculo. Os excluídos do banco (apagados) não contam. As contagens valem para o módulo inteiro e **não dependem dos filtros** da página (nível, tipo, busca), como o estoque.
- **RN-02 (só números):** o bloco `excluded` traz só as contagens: nenhum título, enunciado, nível ou identificador dos exercícios de fora.
- **RN-03 (quem lê e o que não muda):** a rota continua da docente dona da turma e do administrador, com o módulo atribuído à turma (SPEC-075 RN-05); `items`, `total` e `stock` não mudam de nome, tipo nem valor; a elegibilidade não muda.
- **RN-04 (o padrão do MCP):** `create_module_exercise` chamada **sem** o campo `links` cria o exercício com `practice` e `assessment` ligados e `exclusive` desligado; chamada **com** `links`, usa o que veio, como hoje (inclusive um `links` só com `false`). O exercício continua `DRAFT` (SPEC-024). A descrição da ferramenta e a do campo `links` no catálogo dizem o padrão.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: nenhuma tabela, coluna ou valor de enumeração muda. As contagens são calculadas na leitura, a partir do banco do módulo; o vínculo padrão e a ação de vincular todos usam as colunas `usage`, `in_assessment` e `exclusive_assessment` que já existem.

## 5. Contrato de API (API Contract)

**`GET /api/v1/classes/:id/assessment-questions`**: as questões elegíveis de um módulo para a avaliação, com o estoque por nível, agora também com a contagem dos exercícios de fora. Rota existente (SPEC-075); só acrescenta um campo.

- **Papéis autorizados:** `TEACHER` (a docente dona da turma) e `ADMIN`, como hoje.
- **Parâmetros de rota e de query:** os mesmos de hoje (`id` da turma; `moduleId`, `difficulty`, `kind`, `q`, `page`, `pageSize`).
- **Corpo da requisição:** não há.
- **Resposta de sucesso** (`200`): `items`, `total` e `stock` não mudam. Acrescenta:

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `excluded` | objeto | Sim | As contagens dos exercícios do banco do módulo que não entram na avaliação (RN-01, RN-02) |
| `excluded.unpublished` | inteiro | Sim | Os não publicados (rascunho ou arquivado), seja qual for o vínculo |
| `excluded.unlinked` | inteiro | Sim | Os publicados sem o vínculo *Avaliação* |

- **Erros (RFC 7807):** os mesmos de hoje (autenticação, papel sem permissão, turma não encontrada, `module-not-assigned`, parâmetro malformado). Esta spec não cria `type` novo.

**Ferramenta MCP `create_module_exercise`** (SPEC-024): o campo `links` passa a ter padrão quando ausente: `practice` e `assessment` ligados, `exclusive` desligado (RN-04). O resto da ferramenta não muda.

## 6. Impacto e Riscos (Impact & Risks)

- **A docente da turma pode não ser a dona do módulo** (módulo público de outra docente, SPEC-078). O link do aviso leva ao banco, e a página do módulo recusa quem não pode editá-lo, como hoje. **Mitigação:** o aviso diz o que falta (vincular e publicar) mesmo para quem não pode fazê-lo, e a docente pede à dona; a spec não abre o banco a quem não é dona.
- **Uma leitura a mais por módulo escolhido, na composição manual.** **Mitigação:** é a mesma leitura leve do estoque (`pageSize` 1), uma vez por módulo escolhido.
- **O padrão novo põe o exercício novo também na trilha da prática** (vínculo *Prática* põe no fim da trilha, SPEC-023 RN-03), o que a docente que só queria uma questão de prova pode não esperar. **Mitigação:** o exercício nasce em rascunho e nunca chega ao aluno antes de publicado (SPEC-023 RN-04); a mensagem de salvo diz os vínculos; o bloco *Reservados para avaliação* continua criando só com *Avaliação*; a etiqueta no banco mostra os vínculos.
- **Agentes de IA que chamam o MCP sem `links` passam a criar exercícios nos dois vínculos.** **Mitigação:** é o que a docente espera e o exercício continua em rascunho; quem quiser outro vínculo passa `links`; a descrição da ferramenta diz o padrão.
- **A ação de vincular todos (D-03) faz muitas chamadas.** **Mitigação:** uma por exercício, em sequência, com o resultado ao fim; sem rota nova; só os publicados sem o vínculo; a confirmação diz a contagem antes.
- **Testes que mudam.** O teste da tela do exercício que espera a criação sem vínculo, e o do formulário que lê o estoque só no sorteio. **Mitigação:** ajustados no commit vermelho, com o motivo registrado na entrega.
- **Impacto em outros módulos:** o `assessment` conta os exercícios de fora pelo banco do módulo que o adaptador do composition root já lê; o `content` não muda de contrato. **`legacy/`:** removida; sem impacto.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (evento): QUANDO a docente dona ou o administrador pede as questões elegíveis de um módulo atribuído à turma, A resposta DEVE manter `items`, `total` e `stock` sem mudança e trazer `excluded.unpublished` (os não publicados, seja qual for o vínculo) e `excluded.unlinked` (os publicados sem o vínculo *Avaliação*), contando cada exercício uma vez, sem os apagados e sem depender dos filtros (RN-01, RN-03).
- [x] **CA-02** (ubíquo): O bloco `excluded` NÃO DEVE trazer título, enunciado, nível nem identificador de exercício; e a elegibilidade NÃO DEVE mudar (RN-02, RN-03).
- [x] **CA-03** (estado): ENQUANTO o formulário da avaliação tem um módulo escolhido com exercícios de fora e a avaliação não está congelada, O formulário DEVE mostrar, nas duas composições, o aviso com as contagens (omitindo as que são zero) e o link *Abrir o banco de questões do módulo* em aba nova; sem exercício de fora, NÃO DEVE mostrar aviso (D-01).
- [x] **CA-04** (estado): ENQUANTO o módulo escolhido não tem nenhum exercício elegível, O formulário DEVE mostrar o alerta "Nenhum exercício deste módulo pode entrar na prova." com as contagens e o link (D-01).
- [x] **CA-05** (evento): QUANDO `create_module_exercise` é chamada sem `links`, O exercício DEVE nascer `DRAFT` com `practice` e `assessment` ligados e `exclusive` desligado; QUANDO é chamada com `links`, DEVE usar o que veio; e a descrição da ferramenta DEVE dizer o padrão (RN-04).
- [x] **CA-06** (evento): QUANDO a docente salva pela primeira vez um exercício criado pelo botão do banco ou pelo bloco *Disponíveis no módulo*, Ele DEVE nascer com Prática e Avaliação; criado pelo bloco *Reservados para avaliação*, só com Avaliação; em todos os casos em rascunho, e a mensagem de salvo DEVE dizer os vínculos (D-02).
- [x] **CA-07** (evento): QUANDO a docente aciona *Adicionar todos os publicados* no bloco *Reservados para avaliação* e confirma, Todos os exercícios publicados sem o vínculo *Avaliação* DEVEM ganhá-lo, um a um, sem publicar nenhum rascunho, e o resultado DEVE ser dito ao fim, com as falhas; sem exercício para vincular, a ação DEVE ficar desabilitada (D-03).
- [x] **CA-08** (ubíquo): Os textos novos DEVEM estar nos arquivos de mensagens; o aviso, o alerta, o link e a ação DEVEM ter navegação por teclado, contraste AA, alvos de 44 px e nenhuma cor fora dos tokens.

## 8. Plano de Testes (Test Plan)

Os testes são escritos **antes** do código e rodados vermelhos primeiro (SPEC-038). Nomes em inglês, como no código.

**Backend** (Go: `testing` e `testify`)

- Composition root (`cmd/api`, o adaptador das questões): as contagens de um banco com publicados vinculados, publicados sem o vínculo, rascunhos com e sem vínculo, um arquivado e um apagado; as contagens iguais com e sem filtro (CA-01, CA-02)
- Handler do `assessment` (roteador Gin real com `httptest`): o formato com `excluded`, os campos antigos intactos, as recusas de hoje (CA-01, CA-03 da SPEC-075 mantido)
- Service do `mcp`: `CreateModuleExercise` sem `links` cria com Prática e Avaliação e `DRAFT`; com `links` usa o que veio; o catálogo descreve o padrão (CA-05)

**Frontend** (Vitest e Testing Library)

- `AssessmentForm.test.tsx` (ajustado): o aviso com as duas contagens, com só uma delas, o link em aba nova, nenhum aviso sem exercício de fora, o alerta sem elegível, nas duas composições, e nenhum aviso na avaliação congelada (CA-03, CA-04)
- `assessmentService.test.ts` (ajustado): a leitura do bloco `excluded` (CA-01)
- `ModuleExerciseScreen.test.tsx` (ajustado): a criação pelo banco e pelo bloco da prática manda os dois vínculos; pelo bloco da avaliação, só o dela; a mensagem de salvo (CA-06)
- `ModuleExercisesTab.test.tsx` (ajustado): a ação, a confirmação com a contagem, as chamadas uma a uma só dos publicados sem o vínculo, o resultado com falhas, a ação desabilitada (CA-07)
- Stylelint, ESLint e `tsc` limpos (CA-08)

**Manual** (roteiro)

1. Na turma de teste, abrir *Nova avaliação*, escolher o módulo "História do Linux" e conferir o aviso com as contagens do banco de desenvolvimento (publicados sem vínculo e não publicados) e o link que abre o banco em aba nova; trocar a composição e conferir que o aviso continua.
2. No banco, vincular à avaliação dois exercícios publicados e publicar um rascunho; voltar ao formulário, escolher o módulo de novo e conferir as contagens menores.
3. Criar um exercício pelo botão do banco e outro pelo bloco *Disponíveis no módulo*: conferir as etiquetas "Disponível no módulo" e "Reservado para avaliação" nos dois; criar pelo bloco *Reservados para avaliação* e conferir só a etiqueta da avaliação.
4. Pelo MCP, criar um exercício sem `links` e conferir no banco as duas etiquetas e o rascunho.
5. Escolher um módulo sem nenhum exercício elegível e conferir o alerta.
6. *Adicionar todos os publicados* no bloco da avaliação, confirmar e conferir que os publicados ganharam o vínculo e os rascunhos ficaram como estavam; voltar ao formulário da avaliação e conferir que só a contagem dos não publicados sobrou.
7. Conferir a aparência e o contraste (WCAG AA) do aviso e do alerta no tema escuro, e a navegação só com o teclado.

**Cobertura:** meta acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5): `handler` do `assessment`, `service` do `mcp`, e o formulário, a tela do exercício, a aba do banco e o serviço do frontend.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md` e esta spec; a SPEC-075 (RN-05, RN-07 e a rota `assessment-questions`), a SPEC-023 (seção 3.1, os vínculos, RN-03 e RN-04), a SPEC-024 (as ferramentas do MCP) e a SPEC-079. Do código: `backend/cmd/api/assessment_refs.go` (`eligibleOf`, `Pool`), `backend/internal/modules/assessment/service/service.go` (`QuestionPage`) e `handler/dto.go` (`questionsResponse`), `backend/internal/modules/mcp/service/exercises.go` (`LinksInput`, `CreateModuleExercise`) e `mcp/domain/catalog.go` (`linksSchema`, `exerciseDoc`), `frontend/src/components/AssessmentForm/AssessmentForm.tsx` (a leitura do estoque), `frontend/src/components/ModuleExercises/ModuleExerciseScreen.tsx` (o salvar do exercício novo) e `ModuleExercisesTab.tsx` (os blocos, *Adicionar do Banco* e `relink`), `frontend/src/services/assessmentService.ts` e `moduleExerciseService.ts`.
2. **Ordem de execução:** (a) os testes do backend, vermelhos e commitados (`test(assessment): ...`, `test(mcp): ...`); (b) as contagens no adaptador e no DTO, e o padrão do MCP com a descrição; (c) os testes do frontend, vermelhos e commitados (`test(frontend): ...`); (d) o aviso no formulário, o vínculo padrão na tela do exercício e a ação *Adicionar todos os publicados*; (e) estilos e mensagens; (f) roteiro manual; (g) status e histórico.
3. **Arquivos e diretórios a criar ou alterar:**
   - **Backend, alterados:** `backend/cmd/api/assessment_refs.go` e seu teste (as contagens), `backend/internal/modules/assessment/service/service.go` (`QuestionPage` ganha as contagens) e `handler/dto.go` com `handler_test.go` (o campo), `backend/internal/modules/mcp/service/exercises.go` e seu teste (o padrão de `links`), `backend/internal/modules/mcp/domain/catalog.go` (a descrição).
   - **Frontend, alterados:** `frontend/src/components/AssessmentForm/AssessmentForm.tsx`, `.module.scss` e `AssessmentForm.test.tsx`; `frontend/src/services/assessmentService.ts` e o teste (o tipo); `frontend/src/components/ModuleExercises/ModuleExerciseScreen.tsx` e o teste; `ModuleExercisesTab.tsx`, `.module.scss` e o teste (a ação); `frontend/src/messages/pt-BR.ts` e `authoring.pt-BR.ts`.
   - **Documentação:** esta spec e `specs/GLOSSARY.md` (seção 4.1). As notas de sobreposição no histórico das SPEC-023 e 024 já estão registradas.
   - **Não alterar:** a regra de elegibilidade, o `content/service` (a criação e os vínculos ficam como estão), `frontend/src/engine/` e qualquer arquivo fora desta lista sem justificativa no resumo da entrega.
4. **Definição de pronto:** todos os CA marcados, os testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, o roteiro manual feito, as pendências da seção 10 vazias e o status atualizado para `Implementada`.

## 10. Pendências para aprovação

Nenhuma. O Tech Lead decidiu em 26/10/2026, ao aprovar a spec, todas as pendências que ela tinha, com as recomendações como estavam, e antes dela, ao pedi-la, as escolhas da primeira linha. As decisões estão incorporadas às seções 2, 3, 6, 7 e 8; esta tabela só as registra.

| ID | Decisão |
| :--- | :--- |
| Escolhas do pedido | **Aviso e padrão novo.** O formulário da avaliação avisa quantos exercícios do módulo não entram e por quê; e o exercício novo nasce com prática + avaliação. |
| D-01 | **O que o aviso mostra.** Só as duas contagens e o link para o banco de questões do módulo, em aba nova; nenhuma lista de títulos, e nenhum conteúdo de exercício pela rota da avaliação. |
| D-02 | **O vínculo do exercício criado pelo bloco *Reservados para avaliação*.** Continua só *Avaliação*; os dois vínculos valem para o botão do banco e para o bloco *Disponíveis no módulo*, e para o MCP sem `links`. |
| D-03 | **Vincular de uma vez os que já existem.** A ação *Adicionar todos os publicados* no bloco *Reservados para avaliação*, só no frontend, pela rota de vínculos que já existe, com confirmação e resultado; só os publicados sem o vínculo, sem publicar nada. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 26/10/2026 | Aruna Architect | Criação em `Rascunho`, a pedido do Tech Lead, a partir da reclamação dos professores de 26/10/2026 de que os exercícios criados nos módulos não aparecem na prova; conferida contra a SPEC-075 RN-05, a SPEC-023 (vínculos), a SPEC-024 (o MCP), o código da elegibilidade (`assessment_refs.go`), a tela do exercício e o banco de desenvolvimento (69 exercícios no módulo "História do Linux": 5 elegíveis, 47 só na prática, 22 em rascunho). O Tech Lead decidiu antes da escrita: o aviso no formulário da avaliação e o padrão prática + avaliação do exercício novo. Três pendências abertas (P-01 a P-03), todas com recomendação |
| 26/10/2026 | Tech Lead | Aprovada ("aprovo"), com as recomendações das três pendências aceitas como estavam na spec: D-01 a D-03. Status: `Aprovada` |
| 26/10/2026 | Aruna Architect | Seção 10 esvaziada: as três pendências viraram decisões D-01 a D-03, incorporadas ao texto (a ação *Adicionar todos os publicados* deixou de ser condicional nas seções 2, 3, 6, 7, 8 e 9); notas de sobreposição registradas no histórico das SPEC-023 e 024 |
| 26/10/2026 | Implementador | Implementada, menos o roteiro manual da seção 8 (o Chrome ficou desconectado na sessão), por isso o status continua `Aprovada`. **Feito:** CA-01 a CA-08. Backend: o bloco `excluded` na leitura das questões elegíveis (`bankOf` no adaptador do composition root, o tipo `Excluded` no service e o campo no DTO) e o padrão `practice` + `assessment` de `create_module_exercise` sem `links` (o campo virou ponteiro; a descrição da ferramenta e a do campo dizem o padrão). Frontend: o aviso e o alerta no formulário da avaliação (`ExcludedNotice`, nas duas composições, não na congelada, com o link do banco em aba nova), o exercício novo com os dois vínculos (só *Avaliação* pelo bloco da avaliação) e a mensagem de salvo dizendo onde ele ficou, e *Adicionar todos os publicados* no bloco *Reservados para avaliação*, com a confirmação e o resultado. Commits: `test(assessment)`, `test(mcp)`, `feat(assessment)` e `feat(mcp)` em `feat/spec-088-backend`; `test(frontend)` (vermelho), `test(frontend)` (correção do próprio teste) e `feat(frontend)` em `feat/spec-088-frontend`. **Medido:** os testes novos falharam antes do código (o tipo `Excluded` e o campo não existiam; o MCP criava sem vínculo; a ferramenta não dizia o padrão; o formulário não tinha o aviso; a tela criava sem vínculo ou só na prática; o banco não tinha a ação); depois, `go test` de `cmd/api`, `assessment/...` e `mcp/...` verdes, com 84,8% no handler e 84,6% no service do `assessment`, 96,3% no service e 90,6% no domain do `mcp`; no frontend, 138 testes dos arquivos da spec e 97 dos vizinhos passam, `tsc`, ESLint e Stylelint limpos, e cobertura de 97,4% das linhas e 90,3% dos ramos no escopo (formulário, banco, tela do exercício e serviço). **Aberto:** o roteiro manual da seção 8. **Desvios:** o teste do serviço de avaliações não mudou, porque o serviço só repassa o bloco `excluded` (o tipo é conferido pelo `tsc` e o uso pelos testes do formulário). **Testes alterados depois do vermelho:** os testes do MCP que davam `links` por valor passaram a dar por ponteiro (mudança de tipo, no commit `feat(mcp)`); o teste do aviso sem exercícios de fora passou a olhar o próprio mock, e não o padrão do `setup` (erro do próprio teste, em commit próprio); o teste da tela do exercício criado pelo bloco da prática passou a esperar os dois vínculos (requisito novo, no commit vermelho) |
