# SPEC-080: Lista de Avaliações da Turma: Menos Colunas, Ações Agrupadas e Seções por Situação

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-080 |
| **Status** | Rascunho |
| **Data de criação** | 21/10/2026 |
| **Última revisão** | 21/10/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend |
| **Módulo** | `assessment` (frontend: `AssessmentList` e a página da lista) |
| **Contexto de tela** | `/app/classes/[id]/assessments`, na visão da docente e do administrador |
| **Prioridade** | Média |
| **Depende de** | SPEC-075 (seção 3.1 e CA-23), SPEC-076 (aviso de habilitação na linha, RN-13) |
| **Substitui** | Nenhuma. Sobrepõe a descrição das colunas e das ações da lista na seção 3.1 da SPEC-075 |
| **Fontes canônicas** | Pedido do Tech Lead de 21/10/2026: a tela da lista de avaliações precisa de um tratamento de UX/UI |

---

## 1. Contexto e Problema (Context & Problem Statement)

A lista de avaliações da turma, na visão da docente, é uma tabela de **nove colunas** (tipo, modalidade, título, período, situação, nota máxima, composição, elegíveis e ações) com **cinco botões** em cada linha (*Ver*, *Editar*, *Pré-visualizar*, *Reagendar* e *Cancelar*). Vendo o código e a estrutura (a tela em si não foi vista; a extensão do Chrome não estava conectada):

- A tabela não cabe numa janela comum e rola na horizontal; os cinco botões ocupam uma coluna inteira e têm o mesmo peso visual, de modo que o *Cancelar*, que não se desfaz, parece tão inofensivo quanto o *Ver*.
- O título não é um link: para abrir a avaliação é preciso achar o botão *Ver* da linha.
- Tudo está numa lista só, do início mais recente para o mais antigo. O que vem aí, o que está acontecendo agora e o que já passou ficam misturados, e a docente procura a próxima prova no meio de provas antigas.
- Duas avaliações iguais ficam em duas linhas iguais, sem nada que as distinga (o defeito que criou duplicatas por um clique foi corrigido à parte, mas a lista não ajuda a perceber uma duplicata).
- Colunas como *Composição* e *Elegíveis* são detalhes da avaliação, e já aparecem na tela de detalhe.

## 2. Objetivos (Goals)

- A linha de cada avaliação mostra o essencial em **cinco colunas**: *Avaliação* (título como link e, abaixo, tipo, modalidade e nota máxima), *Período*, *Situação*, *Alunos* e *Ações*.
- As ações ficam em dois níveis: o título leva ao detalhe, *Editar* fica à vista e as demais (*Pré-visualizar*, *Reagendar* e *Cancelar*) entram num menu *Mais ações*, com o *Cancelar* por último e em destaque de perigo.
- As avaliações são agrupadas em **seções por situação**, com o que importa agora no topo.
- Em tela estreita, cada avaliação vira um cartão, sem rolagem lateral.

### 2.1. Fora de escopo (Non-Goals)

Toda IA implementadora deve tratar esta lista como proibição.

- A visão do **estudante** da mesma página (os cartões dele ficam como estão).
- Filtros, busca, ordenação escolhida pela docente e paginação da lista.
- Mudar quais ações existem, quando cada uma fica disponível ou as regras de fase (SPEC-075 RN-10, RN-11, RN-12).
- O aviso de habilitação da linha e seus botões (SPEC-076): continuam como estão.
- Qualquer mudança no servidor ou nos contratos de API.
- Qualquer mudança em `frontend/src/engine/core/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Tema único escuro, tokens semânticos, textos em `messages/pt-BR.ts`, navegação completa por teclado, contraste WCAG AA e alvos de toque de no mínimo 44 px. Os estados carregando, vazio e erro continuam como estão.

**Seções por situação**

- Quatro seções, cada uma com título e a contagem entre parênteses: *Em andamento* (`RUNNING`), *Agendadas* (`UPCOMING`), *Encerradas* (`ENDED`) e *Canceladas* (status `CANCELED`, qualquer fase). Uma seção sem avaliações não aparece.
- A ordem das seções é essa. Dentro de *Em andamento* e *Agendadas*, a que começa primeiro vem primeiro; dentro de *Encerradas* e *Canceladas*, a mais recente vem primeiro.
- O botão *Nova avaliação* continua no topo da página.

**A linha**

- Coluna *Avaliação*: o título é um link para o detalhe (cancelada, riscado) e, abaixo, em texto menor, tipo, modalidade e nota máxima, separados por ponto ("Prova · Presencial · 10,00 pontos"). Quando há alunos aguardando habilitação, a etiqueta "N aguardando" fica aqui, ao lado da modalidade.
- Coluna *Período*: como hoje.
- Coluna *Situação*: a etiqueta de situação, como hoje.
- Coluna *Alunos*: a quantidade de alunos elegíveis, com o cabeçalho *Alunos*.
- Coluna *Ações*: o botão *Editar* e o menu *Mais ações*. *Composição* sai da lista (continua no detalhe).
- **Menu *Mais ações*:** abre com Enter, Espaço ou seta para baixo, anda com as setas, fecha com Escape ou ao escolher (o componente de menu de ações que a plataforma já tem). Itens, nesta ordem: *Pré-visualizar*, *Reagendar* e, separado e em perigo, *Cancelar*. O nome do botão para leitor de tela é "Mais ações de <título>".
- **Ações que a fase não permite** (SPEC-075 CA-23): continuam visíveis, desabilitadas, com a razão em texto abaixo do título ("Cancelada: só leitura", "Encerrada: não pode ser reagendada").
- O aviso de habilitação (SPEC-076) continua numa linha abaixo da avaliação, com *Habilitar todos* e *Ver habilitações*.

**Tela estreita** (abaixo de 48 rem)

- Cada avaliação é um cartão: título e etiqueta de situação em cima, período e alunos abaixo, e as ações na base. Não há rolagem lateral.

### 3.2. Backend (Go: módulo `assessment`)

Não se aplica nesta spec: só o frontend muda.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: nenhuma tabela, coluna ou valor de enumeração muda.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: nenhuma rota ou campo muda.

## 6. Impacto e Riscos (Impact & Risks)

- **Testes da SPEC-075 e da SPEC-076 que mudam.** Os da lista procuram cinco botões por linha e nove colunas; os do aviso procuram a linha de aviso. **Mitigação:** ajustados no commit vermelho, com o motivo registrado na entrega; o aviso e seus botões não mudam.
- **Ações dentro de um menu ficam um clique mais longe.** **Mitigação:** só ficam no menu as de uso raro (pré-visualizar, reagendar, cancelar); *Editar* e o link do título, as de uso comum, ficam à vista (P-01).
- **O componente de menu de ações existente não conhece ação desabilitada.** **Mitigação:** ele ganha o campo de item desabilitado, com teste, sem mudar o que já faz (arquivo fora da lista da SPEC-075, justificado na seção 9).
- **Agrupar por situação muda a ordem em que a docente vê as avaliações.** **Mitigação:** a ordem dentro de cada seção é a que serve a cada uma (a próxima primeiro; a mais recente primeiro nas passadas), registrada na seção 3.1 (P-02).
- **Impacto em outros módulos:** nenhum. **`legacy/`:** removida; sem impacto.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (estado): ENQUANTO há avaliações, A lista DEVE agrupá-las em seções *Em andamento*, *Agendadas*, *Encerradas* e *Canceladas*, nessa ordem, cada uma com título e contagem, e DEVE omitir a seção que não tem avaliação.
- [ ] **CA-02** (estado): ENQUANTO uma seção é *Em andamento* ou *Agendadas*, A avaliação que começa primeiro DEVE vir primeiro; ENQUANTO é *Encerradas* ou *Canceladas*, a mais recente DEVE vir primeiro.
- [ ] **CA-03** (estado): CADA linha DEVE mostrar as colunas *Avaliação*, *Período*, *Situação*, *Alunos* e *Ações*, com o título como link para o detalhe (riscado se cancelada) e, abaixo dele, tipo, modalidade e nota máxima; a coluna de composição NÃO DEVE existir.
- [ ] **CA-04** (evento): QUANDO a docente abre o menu *Mais ações* de uma linha, ELA DEVE ver *Pré-visualizar*, *Reagendar* e *Cancelar* (este por último, em perigo); o menu DEVE abrir com Enter, Espaço ou seta para baixo, andar com as setas e fechar com Escape ou ao escolher, devolvendo o foco ao botão.
- [ ] **CA-05** (estado): ENQUANTO a fase ou o status não permite uma ação, A ação DEVE aparecer desabilitada, no botão ou no menu, e a razão DEVE estar em texto na linha, ligada ao botão (SPEC-075 CA-23).
- [ ] **CA-06** (ubíquo): O aviso de habilitação da SPEC-076 (RN-13) DEVE continuar como está, com as etiquetas e os botões *Habilitar todos* e *Ver habilitações*.
- [ ] **CA-07** (estado): ENQUANTO a janela tem menos de 48 rem, CADA avaliação DEVE aparecer como um cartão, sem rolagem lateral.
- [ ] **CA-08** (ubíquo): Os textos novos DEVEM estar em `messages/pt-BR.ts`; a lista DEVE ter navegação por teclado, contraste AA, alvos de 44 px e nenhuma cor fora dos tokens.
- [ ] **CA-09** (ubíquo): Stylelint, ESLint e `tsc` limpos; cobertura acima de 80% no escopo.

## 8. Plano de Testes (Test Plan)

Os testes são escritos **antes** do código e rodados vermelhos primeiro (SPEC-038). Nomes em inglês, como no código.

**Frontend** (Vitest e Testing Library)

- `AssessmentList.sections.test.tsx`: as quatro seções, a ordem, a contagem, a seção vazia omitida e a ordem dentro de cada uma (CA-01, CA-02)
- `AssessmentList.test.tsx` (ajustado): as colunas, o título como link, a linha secundária e a ausência da composição (CA-03); o *Editar* à vista e as demais ações no menu, as razões das desabilitadas (CA-04, CA-05)
- `AssessmentList.menu.test.tsx`: abrir, andar, fechar, devolver o foco e os itens desabilitados (CA-04, CA-05)
- `ActionMenu.test.tsx` (ajustado): o item desabilitado, sem mudar o que o menu já fazia (CA-05)
- `AssessmentList.clearanceWarning.test.tsx` (SPEC-076, só se precisar de ajuste): o aviso e seus botões (CA-06)
- `assessments/page.test.tsx` (ajustado): a página entrega a lista agrupada e os botões ligados às rotas (CA-01, CA-03)
- Stylelint, ESLint e `tsc` limpos (CA-08, CA-09)

**Manual** (roteiro)

1. Com avaliações em andamento, agendadas, encerradas e canceladas, conferir as quatro seções, a ordem e a contagem.
2. Abrir o menu *Mais ações* só com o teclado, escolher *Reagendar* e conferir o diálogo; conferir o *Cancelar* em perigo.
3. Numa janela estreita, conferir os cartões, sem rolagem lateral.
4. Conferir a aparência e o contraste (WCAG AA) da lista, do menu e dos cartões no tema escuro (CA-07, CA-08).

**Cobertura:** meta acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5), com o Vitest em modo de cobertura.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md` e esta spec; a SPEC-075 (seção 3.1, CA-23) e a SPEC-076 (RN-13). Do código: `frontend/src/components/AssessmentList`, `frontend/src/app/app/classes/[id]/assessments/page.tsx`, `frontend/src/components/ContentTab/ActionMenu.tsx` e `frontend/src/lib/assessment.ts`.
2. **Ordem de execução:** (a) testes vermelhos, rodados e commitados (`test(frontend): ...`); (b) o item desabilitado no `ActionMenu`; (c) a lista (seções, linha, menu, cartões), mensagens e estilos; (d) roteiro manual; (e) status e histórico.
3. **Arquivos e diretórios a criar ou alterar:**
   - **Frontend, alterados:** `frontend/src/components/AssessmentList/AssessmentList.tsx` e `.module.scss`; `frontend/src/components/ContentTab/ActionMenu.tsx` (e o estilo que ele usa, em `ContentTab.module.scss`, só para o item desabilitado e o separador do perigo); `frontend/src/app/app/classes/[id]/assessments/page.tsx` (só se a ligação das ações pedir); `frontend/src/lib/assessment.ts` (o agrupamento e a ordem por situação); `frontend/src/messages/pt-BR.ts`; e os testes da seção 8.
   - **Frontend, novos:** `AssessmentList.sections.test.tsx` e `AssessmentList.menu.test.tsx`.
   - **Documentação:** esta spec.
   - **Não alterar:** `frontend/src/engine/core/` e qualquer arquivo fora desta lista sem justificativa no resumo da entrega.
4. **Definição de pronto:** todos os CA marcados, os testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, o roteiro manual feito, as pendências da seção 10 vazias e o status atualizado para `Implementada`.

## 10. Pendências para aprovação

Uma spec só pode ser aprovada com esta tabela vazia.

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| P-01 | **Quais ações ficam à vista.** Hoje são cinco botões. | À vista: o título (leva ao detalhe) e *Editar*. No menu *Mais ações*: *Pré-visualizar*, *Reagendar* e *Cancelar*. |
| P-02 | **Agrupar por situação.** Hoje é uma lista só, do início mais recente para o mais antigo. | Quatro seções (*Em andamento*, *Agendadas*, *Encerradas*, *Canceladas*), com a próxima prova primeiro nas que vêm e a mais recente primeiro nas que passaram. |
| P-03 | **Tela estreita.** | Cartões abaixo de 48 rem, em vez de rolagem lateral. |
| P-04 | **Mostrar quando a avaliação foi criada**, para distinguir duas parecidas. Exige o campo `createdAt` no resumo da avaliação (hoje só o detalhe tem o histórico), ou seja, uma mudança de servidor. | Não incluir nesta spec: a duplicata já não se cria, e o título, o período e a nota distinguem as demais. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 21/10/2026 | Aruna Architect | Criação em `Rascunho`, a pedido do Tech Lead, a partir do pedido de 21/10/2026 de UX/UI para a tela da lista de avaliações, conferida contra o código da lista, as SPEC-075 e 076 e o componente de menu de ações que a plataforma já tem. Quatro pendências abertas (P-01 a P-04), todas com recomendação |
