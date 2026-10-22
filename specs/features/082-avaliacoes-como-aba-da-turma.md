# SPEC-082: Avaliações como Aba da Página da Turma, Fora do Topo

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-082 |
| **Status** | Aprovada |
| **Data de criação** | 22/10/2026 |
| **Última revisão** | 22/10/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend |
| **Módulo** | `assessment` (frontend: a lista de avaliações da turma) e `classgroup` (frontend: a página da turma) |
| **Contexto de tela** | `/app/classes/[id]` (a nova aba *Avaliações* e o topo) e `/app/classes/[id]/assessments` (que passa a só redirecionar), na visão da docente, do administrador e do estudante |
| **Prioridade** | Média |
| **Depende de** | SPEC-041 (seção 3.1.1, a página da turma), SPEC-075 (seção 3.1), SPEC-076 (aviso de habilitação na linha), SPEC-080 (a lista em seções) |
| **Substitui** | Nenhuma. Sobrepõe, na SPEC-075, o lugar da lista (a página própria `/assessments`) e, na SPEC-041, a lista de abas e os botões do topo |
| **Fontes canônicas** | Pedido do Tech Lead de 22/10/2026: as avaliações da turma devem aparecer na página da turma, junto das abas *Visão geral*, *Agenda* e *Estudantes*, e o botão do topo deve sair |

---

## 1. Contexto e Problema (Context & Problem Statement)

A página da turma tem três abas (*Visão geral*, *Agenda* e, para a docente, *Estudantes*) e, no topo, um botão *Avaliações* ao lado de *Configurações*. O botão leva a uma **página à parte** (`/app/classes/[id]/assessments`), com o próprio título e um link *Voltar para a turma*. Por isso:

- As avaliações são a única parte da turma que fica fora das abas: quem está na turma muda de aba para ver a agenda ou os estudantes, mas sai da página para ver as avaliações e depois precisa voltar.
- O botão do topo tem o mesmo peso de *Configurações*, que é uma ação rara, e a docente procura as avaliações (de uso comum) num lugar que não é o das outras partes da turma.
- A página à parte repete o que a turma já tem (o título, o caminho de volta), e cada passo de ida e volta custa um carregamento.

## 2. Objetivos (Goals)

- A página da turma ganha a aba **Avaliações**, que mostra as avaliações da turma no próprio lugar, sem sair da página.
- O botão *Avaliações* do topo **sai**; *Configurações* continua.
- O endereço antigo `/app/classes/[id]/assessments` não quebra: leva à aba.
- Quem está numa avaliação (detalhe, nova avaliação) volta para a aba, e não para a página à parte.

### 2.1. Fora de escopo (Non-Goals)

Toda IA implementadora deve tratar esta lista como proibição.

- Mudar o que a lista faz ou mostra: as seções, as colunas, as ações, o menu *Mais ações*, o aviso de habilitação, os diálogos de reagendar e cancelar e os cartões do estudante ficam como as SPEC-075, 076 e 080 os definiram.
- As páginas de uma avaliação (detalhe, nova, edição, habilitações, simulador): continuam em `/app/classes/[id]/assessments/...`; só o caminho de volta delas muda.
- Contador (número) na aba (D-03), filtros, busca e paginação.
- O calendário e a aba *Agenda*.
- Qualquer mudança no servidor ou nos contratos de API.
- Qualquer mudança em `frontend/src/engine/core/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Tema único escuro, tokens semânticos, textos em `messages/pt-BR.ts` (a aba usa o texto *Avaliações* que já existe), navegação completa por teclado, contraste WCAG AA e alvos de toque de no mínimo 44 px.

**A aba**

- A barra de abas da página da turma passa a ser *Visão geral*, *Agenda*, **Avaliações** e, só para a docente e o administrador, *Estudantes* (D-01). A aba *Avaliações* aparece também para o estudante, que já via as avaliações dele.
- A aba é escolhida e lembrada pelo endereço, como as outras: `?tab=assessments`. Voltar do navegador e recarregar mantêm a aba.
- **Docente e administrador:** o conteúdo da aba é a lista da SPEC-080, com tudo o que ela já tem: o botão *Nova avaliação*, as seções por situação, a linha com *Editar* e o menu *Mais ações*, o aviso de habilitação e os diálogos de reagendar e cancelar.
- **Estudante:** os cartões das avaliações a que ele tem direito, como hoje.
- Os estados carregando, vazio e erro (com *Tentar de novo*) ficam como estão, dentro da aba.
- A lista só é lida **quando a aba abre**: abrir a página da turma em outra aba não faz a leitura (D-03).
- A aba não repete o título "Avaliações" nem o link *Voltar para a turma*: o nome da aba é o título, e a turma já está em volta.

**O topo**

- O botão *Avaliações* sai do topo, para todos. *Configurações* (só da docente e do administrador) fica como está.

**O endereço antigo e os caminhos de volta** (D-02)

- Abrir `/app/classes/[id]/assessments` leva a `/app/classes/[id]?tab=assessments`, sem mostrar nada no meio.
- O *Voltar para as avaliações* do detalhe da avaliação e da página de nova avaliação, e o *Cancelar* do formulário de nova avaliação, levam direto a `/app/classes/[id]?tab=assessments`, sem passar pelo redirecionamento.

**Tela estreita** (abaixo de 48 rem)

- A barra de abas passa a rolar de lado dentro dela mesma quando as quatro abas não cabem, sem criar rolagem lateral na página, e a aba escolhida fica à vista.

### 3.2. Backend (Go)

Não se aplica nesta spec: só o frontend muda.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: nenhuma tabela, coluna ou valor de enumeração muda.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: nenhuma rota ou campo muda.

## 6. Impacto e Riscos (Impact & Risks)

- **Testes das SPEC-075, 076 e 080 que mudam de lugar.** Os testes da página `/assessments` (a lista, as ações, os diálogos, os cartões, o aviso de habilitação) passam a testar o componente da aba; o teste da página à parte vira o teste do redirecionamento, e o teste do botão do topo vira o teste da aba. **Mitigação:** os casos são movidos, não apagados, com o motivo registrado na entrega.
- **A página da turma é grande e já carrega o calendário.** A aba *Avaliações* não pode atrasar a abertura da página. **Mitigação:** a lista só é lida quando a aba abre (CA-03).
- **Quatro abas numa janela estreita.** **Mitigação:** a barra rola por conta própria (CA-07).
- **Links e favoritos antigos para `/assessments`.** **Mitigação:** o redirecionamento (CA-05).
- **Impacto em outros módulos:** nenhum. **`legacy/`:** removida; sem impacto.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (estado): A página da turma DEVE mostrar a aba *Avaliações* para a docente, o administrador e o estudante, depois da aba *Agenda* e, para quem vê *Estudantes*, antes dela.
- [x] **CA-02** (evento): QUANDO a pessoa abre a aba *Avaliações* (ou o endereço com `?tab=assessments`), A página DEVE mostrar a lista da SPEC-080 com tudo o que ela já faz para a docente e o administrador, e os cartões de hoje para o estudante.
- [x] **CA-03** (estado): ENQUANTO a aba *Avaliações* não está aberta, A página da turma NÃO DEVE ler as avaliações.
- [x] **CA-04** (ubíquo): O topo da página da turma NÃO DEVE ter o botão *Avaliações*, para ninguém; *Configurações* DEVE continuar para a docente e o administrador.
- [x] **CA-05** (evento): QUANDO alguém abre `/app/classes/[id]/assessments`, O endereço DEVE levar a `/app/classes/[id]?tab=assessments`.
- [x] **CA-06** (ubíquo): O *Voltar para as avaliações* do detalhe da avaliação e da página de nova avaliação, e o *Cancelar* do formulário de nova avaliação, DEVEM levar a `/app/classes/[id]?tab=assessments`.
- [x] **CA-07** (estado): ENQUANTO a janela tem menos de 48 rem, A barra de abas DEVE rolar de lado dentro dela mesma, sem rolagem lateral na página.
- [x] **CA-08** (ubíquo): O que a lista faz (SPEC-075 CA-23 e CA-26, SPEC-076 RN-13 e SPEC-080 CA-01 a CA-06) DEVE continuar igual dentro da aba.
- [ ] **CA-09** (ubíquo): A aba DEVE ter navegação por teclado, contraste AA, alvos de 44 px e nenhuma cor fora dos tokens.

## 8. Plano de Testes (Test Plan)

Os testes são escritos **antes** do código e rodados vermelhos primeiro (SPEC-038). Nomes em inglês, como no código.

**Frontend** (Vitest e Testing Library)

- `ClassAssessments.test.tsx` (novo, com os casos da página `/assessments` movidos para cá): a lista da docente e do administrador, as ações, os diálogos de reagendar e cancelar, o aviso de habilitação, os cartões do estudante, o vazio e o erro com *Tentar de novo*, sem título nem *Voltar para a turma* (CA-02, CA-08)
- `[id]/page.test.tsx` (ajustado): a aba *Avaliações* para os três papéis, na ordem certa; abrir a aba pelo clique e pelo endereço; a lista só é lida com a aba aberta; o botão *Avaliações* do topo não existe e *Configurações* continua (CA-01 a CA-04)
- `assessments/page.test.tsx` (reescrito): o redirecionamento de `/assessments` para `?tab=assessments` (CA-05)
- `assessments/new/page.test.tsx` e `assessments/[assessmentId]/page.test.tsx` (ajustados): os links de volta e o *Cancelar* levam à aba (CA-06)
- Stylelint, ESLint e `tsc` limpos (CA-09)

**Manual** (roteiro)

1. Abrir uma turma, conferir a ordem das abas e que o topo só tem *Configurações*; abrir *Avaliações* e conferir a lista, a ação *Nova avaliação* e o menu *Mais ações*.
2. Abrir uma avaliação, voltar pelo *Voltar para as avaliações* e conferir que cai na aba; recarregar a página e conferir que a aba continua.
3. Abrir o endereço antigo `/assessments` e conferir que cai na aba.
4. Como estudante, conferir a aba e os cartões.
5. Numa janela estreita, conferir que a barra de abas rola de lado e que a página não rola; conferir o contraste (WCAG AA) da aba ativa no tema escuro.

**Cobertura:** meta acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5), com o Vitest em modo de cobertura.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md` e esta spec; a SPEC-041 (seção 3.1.1), a SPEC-075 (seção 3.1), a SPEC-076 (RN-13) e a SPEC-080. Do código: `frontend/src/app/app/classes/[id]/page.tsx` e `page.module.scss`, `frontend/src/app/app/classes/[id]/assessments/page.tsx` e seus testes, e `frontend/src/components/AssessmentList`.
2. **Ordem de execução:** (a) testes vermelhos, rodados e commitados (`test(frontend): ...`); (b) o componente da aba, tirando dele o conteúdo da página `/assessments`; (c) a aba e o topo na página da turma, o redirecionamento e os links de volta; (d) estilos da barra de abas; (e) roteiro manual; (f) status e histórico.
3. **Arquivos e diretórios a criar ou alterar:**
   - **Frontend, novos:** `frontend/src/components/ClassAssessments/` (`ClassAssessments.tsx`, o estilo `.module.scss` e `ClassAssessments.test.tsx`).
   - **Frontend, alterados:** `frontend/src/app/app/classes/[id]/page.tsx`, `page.module.scss` e `page.test.tsx` (a aba, o topo e a barra de abas); `frontend/src/app/app/classes/[id]/assessments/page.tsx` e `page.test.tsx` (o redirecionamento); `frontend/src/app/app/classes/[id]/assessments/page.module.scss` (só para tirar o que ficar sem uso); `frontend/src/app/app/classes/[id]/assessments/new/page.tsx` e o teste, e `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/page.tsx` e o teste (os links de volta).
   - **Documentação:** esta spec.
   - **Não alterar:** `AssessmentList` e os diálogos (só são usados), `frontend/src/engine/core/` e qualquer arquivo fora desta lista sem justificativa no resumo da entrega.
4. **Definição de pronto:** todos os CA marcados, os testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, o roteiro manual feito, as pendências da seção 10 vazias e o status atualizado para `Implementada`.

## 10. Pendências para aprovação

Nenhuma. O Tech Lead decidiu em 22/10/2026, ao aprovar a spec, todas as pendências que ela tinha, com as recomendações como estavam. As decisões estão incorporadas às seções 2, 3, 6, 7 e 8; esta tabela só as registra.

| ID | Decisão |
| :--- | :--- |
| D-01 | **Onde fica a aba.** Depois de *Agenda* e antes de *Estudantes*: *Visão geral*, *Agenda*, *Avaliações*, *Estudantes*. |
| D-02 | **O endereço antigo.** `/app/classes/[id]/assessments` continua como redirecionamento para `?tab=assessments`; os links de volta vão direto à aba. |
| D-03 | **Contador na aba.** Sem número na aba. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 22/10/2026 | Aruna Architect | Criação em `Rascunho`, a pedido do Tech Lead, a partir do pedido de 22/10/2026 de mostrar as avaliações da turma como aba da página da turma e tirar o botão do topo, conferida contra a página da turma (SPEC-041), a página das avaliações e seus testes. Três pendências abertas (D-01 a D-03), todas com recomendação |
| 22/10/2026 | Tech Lead | Aprovada ("aprovo"), com as recomendações das três pendências aceitas como estavam na spec: D-01 a D-03. Status: `Aprovada` |
| 22/10/2026 | Aruna Architect | Seção 10 esvaziada: as três pendências viraram decisões D-01 a D-03, incorporadas ao texto |
| 22/10/2026 | Implementador | Implementada, menos o CA-09, por isso o status continua `Aprovada`. **Feito:** CA-01 a CA-08. O componente `ClassAssessments` (o conteúdo da antiga página), a aba na página da turma depois de *Agenda*, o botão do topo removido, `/assessments` como redirecionamento do servidor e os links de volta (detalhe, nova avaliação e o *Cancelar* do formulário) apontando para a aba; a barra de abas rola por conta própria. Commits: `test(frontend)` vermelho e `feat(frontend)`. **Medido:** os testes novos falharam antes (o componente e a aba não existiam, o redirecionamento não acontecia e os links de volta iam para a página à parte); depois, 280 arquivos e 3.286 testes passam (1 pulado que já existia; a pasta `engine` não roda por desenho), `tsc`, ESLint e Stylelint limpos. À mão, num Chrome sem janela e no tema escuro: a ordem das abas, só *Configurações* no topo, a lista na aba, o axe-core sem violação de contraste, o endereço antigo caindo na aba, o link de volta do detalhe e, a 400 px, a barra rolando (575 px de conteúdo em 368 px) sem rolagem lateral na página. **Aberto:** o CA-09, pelos alvos de 44 px: as abas e os botões medem 44 px, mas o título da avaliação (o link da lista) mede 17 px de altura, a mesma pendência do CA-08 da SPEC-080. **Testes alterados depois do vermelho:** um da SPEC-041 (`shows only the presentation of the class to an enrolled student`) passou a esperar a aba *Avaliações* do estudante, por mudança de requisito desta spec; e na nova página de avaliação o teste do *Cancelar* passou a esperar o formulário com `findByRole`, por erro do próprio teste. **Desvios:** nenhum |
