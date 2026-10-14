# SPEC-044: Formulário da Turma em Abas e Aula de 60 Minutos

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-044 |
| **Status** | Implementada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (calendário real na configuração, Opção A) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend |
| **Módulo** | `ClassForm`, `MeetingsEditor`, `lib/calendar` |
| **Contexto de tela** | `/app/classes/new` e `/app/classes/{id}/settings` |
| **Prioridade** | Média |
| **Depende de** | SPEC-009, SPEC-041, SPEC-042, SPEC-043 |
| **Substitui** | Nenhuma (altera a regra de 50 minutos por aula da seção 3.1.1 da SPEC-042) |
| **Fontes canônicas** | Pedido do Tech Lead em 14/10/2026: o formulário da turma em abas (informações da turma e horários) e a aula com 60 minutos por padrão |

---

## 1. Contexto e Problema (Context & Problem Statement)

O formulário da turma (`ClassForm`, SPEC-041) reúne em uma só página longa quatro grupos: identificação, vigência e encontros, conteúdo e ingresso. O editor de encontros (SPEC-042) é o trecho mais alto e mais denso, e empurra para baixo o conteúdo e o ingresso. O docente rola muito, perde a noção do que já preencheu e, no celular, a tela fica pesada.

Além disso, a sugestão da quantidade de aulas de um encontro divide a duração por 50 minutos. O Tech Lead decidiu que a aula passa a ter **60 minutos** por padrão, o que simplifica o ajuste das horas no sistema (um encontro de 2 horas são 2 aulas).

## 2. Objetivos (Goals)

1. O `ClassForm` passa a exibir seus grupos em **abas**, uma por vez, na criação e na edição da turma.
2. As informações da turma e os horários ficam em abas separadas.
3. A sugestão de aulas por encontro usa 60 minutos por aula.
4. O botão de salvar continua único e salva todas as abas de uma vez.
5. Na aba Horários, o docente vê **como as aulas ficam no calendário**, de acordo com os horários que marcou e com as datas de início e fim da turma, com os feriados.
6. Na tela de configuração de uma turma salva, o docente cancela, ajusta e inclui aulas direto nesse calendário.

### 2.1. Fora de escopo (Non-Goals)

- Mudar campos, validações, textos de erro ou contrato de API do formulário.
- Salvar cada aba separadamente ou criar rotas por aba.
- Mudar o limite de 1 a 8 aulas por encontro.
- Editar eventos e períodos especiais na tela de configuração.
- Cancelar, ajustar ou incluir aula antes de a turma existir.
- Endpoint novo no backend: tudo usa a API da SPEC-042.
- Recalcular a quantidade de aulas de turmas já salvas.
- Alterar o backend ou `frontend/src/engine/core/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

#### 3.1.1. Abas do formulário

Uma lista de abas acima do formulário, no padrão WAI-ARIA de abas (`tablist`, `tab`, `tabpanel`), com as abas e o conteúdo de cada uma:

| Aba | Conteúdo (grupos atuais) |
| :--- | :--- |
| Informações | Identificação (nome, código, semestre, resumo), vigência (início e fim) e cor da turma |
| Horários | Encontros semanais, descrição livre de horários (sem encontros) e a opção de sala virtual |
| Conteúdo | Ementa e diretrizes institucionais |
| Ingresso | Link de convite e suas datas |

Regras de interface:

- Abre na aba "Informações".
- Todas as abas ficam montadas (as inativas apenas ocultas), de modo que nenhum valor digitado se perde ao trocar de aba.
- Cada aba mostra um indicador de erro quando um campo seu tem problema.
- QUANDO o envio falha na validação, a aba do primeiro campo com erro é aberta e o campo recebe o foco (mantém a ordem de foco da SPEC-041).
- O mesmo vale para erros de encontros e para problemas devolvidos pelo servidor, que levam à aba do campo.
- Setas esquerda e direita trocam de aba; Home e End vão à primeira e à última.
- No celular, a lista de abas rola na horizontal, com alvos de toque de no mínimo 44 px (SPEC-043).
- Cores só dos tokens semânticos de `_tokens.scss`; tema claro e escuro.

#### 3.1.2. Calendário na aba Horários

Abaixo do editor de encontros, a aba Horários mostra um calendário mensal. Ele tem dois modos, conforme a turma já exista:

**Turma nova (`/app/classes/new`): prévia só de leitura.**

- Vai da **data de início** à **data de fim** informadas na aba Informações; abre no mês do início e navega só dentro da vigência (botões de mês desabilitados nos limites).
- Cada dia da vigência cujo dia da semana tem encontro mostra um marcador com horário e quantidade de aulas, na cor da turma.
- Atualiza na hora, sem salvar, ao mexer nos encontros ou nas datas.
- Mostra os **feriados e recessos** do servidor nos dias em que caem (nome do feriado no dia). Uma aula que cai num feriado continua marcada, como na SPEC-042 (RN-03).
- Sem datas válidas ou sem encontros, mostra a mensagem correspondente.
- Não permite cancelar, ajustar nem incluir aula: as aulas só existem depois de criar a turma.

**Turma salva (`/app/classes/{id}/settings`): calendário real da turma.**

- É o calendário da agenda (SPEC-042), com feriados, recessos, aulas e seus estados.
- Ao selecionar um dia, o docente pode, como na agenda: **cancelar a aula** (informando o motivo), **ajustar a aula** (horário, quantidade de aulas, modalidade, sala ou link) ou **reverter** um ajuste; e **incluir uma aula avulsa** no dia (SPEC-042, RN-04 e RN-05).
- Os eventos e os períodos especiais não são editados aqui, só na agenda da turma: os botões que dependem deles não aparecem.
- As aulas vêm do servidor; por isso, mudar os encontros no editor só aparece no calendário depois de **aplicar os horários**: um botão "Aplicar horários ao calendário", abaixo do editor, salva os encontros da turma (SPEC-042, RN-01 e RN-02) e recarrega o calendário. Um aviso ao lado do botão explica isso quando há mudança ainda não aplicada.
- Cores só dos tokens, nos temas claro e escuro; no celular, usa a largura da tela.

#### 3.1.3. Aula de 60 minutos

A função que sugere a quantidade de aulas de um encontro passa a dividir a duração por 60 minutos, mantendo o mínimo de 1 e o máximo de 8. Exemplos: 08:00 às 10:00 sugere 2 aulas; 08:20 às 10:00 sugere 1 aula; 19:00 às 22:00 sugere 3 aulas. O texto de ajuda que cita a duração da aula, se houver, passa a dizer 60 minutos. O docente continua podendo ajustar a quantidade à mão. A regra vale nos dois sentidos: ao mudar a quantidade de aulas, o horário de fim passa a ser o início mais 60 minutos por aula (limitado a 23:59); ao mudar início ou fim, a quantidade é sugerida como acima. Os horários padrão de um encontro novo seguem a mesma regra (08:20 com 2 aulas termina às 10:20).

### 3.2. Backend (Go — Camada de Módulo/Service)

Não se aplica nesta spec: a duração da aula é só uma sugestão do formulário, e o servidor continua recebendo a quantidade de aulas informada.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: não há mudança de schema.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: nenhum endpoint muda.

## 6. Impacto e Riscos (Impact & Risks)

- **Erro em aba oculta passa despercebido.** Mitigação: indicador de erro na aba e abertura automática da aba com o primeiro erro (CA-04).
- **Testes existentes do `ClassForm`** assumem todos os campos visíveis ao mesmo tempo. Mitigação: com todas as abas montadas e só ocultas, os campos continuam no DOM; os testes que dependem de visibilidade são ajustados e o motivo registrado na entrega.
- **Mudança de 50 para 60 minutos** altera o teste de `suggestLessons` e a sugestão em turmas novas. Turmas salvas não mudam.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (ubíquo): O `ClassForm` DEVE exibir as abas Informações, Horários, Conteúdo e Ingresso, com a aba Informações aberta ao carregar, na criação e na edição.
- [ ] **CA-02** (evento): QUANDO o usuário seleciona uma aba, O SISTEMA DEVE mostrar apenas o painel dessa aba, sem perder valores já digitados nas outras.
- [ ] **CA-03** (ubíquo): As abas DEVEM seguir o padrão WAI-ARIA, com navegação por setas, Home e End e alvos de toque de no mínimo 44 px.
- [ ] **CA-04** (indesejado): SE o envio falha na validação, ENTÃO O SISTEMA DEVE abrir a aba do primeiro campo com erro, focar o campo e marcar com indicador de erro cada aba que tem problema.
- [ ] **CA-05** (indesejado): SE o servidor devolve um problema ligado a um campo, ENTÃO O SISTEMA DEVE abrir a aba desse campo e mostrar o erro junto dele.
- [ ] **CA-06** (evento): QUANDO o usuário clica em salvar, O SISTEMA DEVE enviar os dados de todas as abas em uma única requisição, como antes.
- [ ] **CA-07** (ubíquo): A sugestão de aulas de um encontro DEVE ser a duração dividida por 60 minutos, entre 1 e 8 aulas.
- [ ] **CA-09** (estado): ENQUANTO houver datas de início e fim válidas e ao menos um encontro, a aba Horários DEVE mostrar um calendário mensal com um marcador (horário e aulas) em cada dia da vigência cujo dia da semana tem encontro.
- [ ] **CA-10** (evento): QUANDO o docente muda um encontro ou uma das datas, O SISTEMA DEVE atualizar a prévia sem salvar a turma.
- [ ] **CA-11** (ubíquo): A prévia NÃO DEVE mostrar dias fora da vigência nem permitir navegar para meses fora dela.
- [ ] **CA-12** (estado): ENQUANTO as datas forem inválidas ou não houver encontros, a prévia DEVE mostrar a mensagem correspondente em vez do calendário.
- [ ] **CA-15** (estado): ENQUANTO a turma é nova, a prévia DEVE mostrar o nome dos feriados e recessos nos dias em que caem, mantendo o marcador da aula que cai neles.
- [ ] **CA-16** (estado): ENQUANTO a turma é salva, a aba Horários DEVE mostrar o calendário real da turma, com feriados, em vez da prévia.
- [ ] **CA-17** (evento): QUANDO o docente seleciona um dia com aula no calendário da turma salva e escolhe alterar, O SISTEMA DEVE abrir o formulário da aula, no qual pode cancelá-la com motivo, ajustá-la ou revertê-la, e recarregar o calendário.
- [ ] **CA-18** (evento): QUANDO o docente seleciona um dia e escolhe incluir aula avulsa, O SISTEMA DEVE abrir o formulário, criar a aula nesse dia e recarregar o calendário.
- [ ] **CA-19** (evento): QUANDO o docente aciona "Aplicar horários ao calendário", O SISTEMA DEVE salvar os encontros da turma e recarregar o calendário; SE houver mudança não aplicada, ENTÃO DEVE avisar que o calendário ainda mostra os horários salvos.
- [ ] **CA-20** (ubíquo): O calendário da turma salva, na tela de configuração, NÃO DEVE mostrar botões de evento nem de período especial.
- [ ] **CA-21** (estado): ENQUANTO um dia é feriado ou recesso, a célula desse dia, na prévia e no calendário da turma, DEVE ser destacada em vermelho (cor `danger` dos tokens), e o nome do feriado DEVE ficar contido na célula, sem alargar a grade nem quebrar o formulário.
- [ ] **CA-13** (evento): QUANDO o docente muda a quantidade de aulas de um encontro, O SISTEMA DEVE ajustar o horário de fim para início mais 60 minutos por aula, sem passar das 23:59.
- [ ] **CA-14** (ubíquo): Os horários padrão de um encontro novo DEVEM respeitar a regra de 60 minutos por aula (início 08:20 com 2 aulas termina às 10:20; o horário adicionado depois começa 20 minutos após o fim do anterior).
- [ ] **CA-08** (ubíquo): Stylelint e ESLint DEVEM ficar sem erros e as cores DEVEM vir dos tokens semânticos, nos temas claro e escuro.

## 8. Plano de Testes (Test Plan)

Escritos antes do código e rodados vermelhos primeiro (SPEC-038).

- **Frontend, `lib/calendar.test.ts`:** sugestão de aulas com 60 minutos (2 horas dá 2; 1h40 dá 1; 3 horas dá 3; limites 1 e 8). Cobre CA-07.
- **Frontend, `ClassForm.test.tsx`:**
  - mostra as quatro abas e abre em Informações. Cobre CA-01.
  - trocar de aba mostra só o painel dela e preserva o que foi digitado. Cobre CA-02.
  - setas, Home e End movem a seleção; papéis e atributos ARIA corretos. Cobre CA-03.
  - envio com nome vazio na aba Horários ativa abre Informações e foca o nome; aba com erro recebe o indicador. Cobre CA-04.
  - erro de encontro sobreposto abre a aba Horários. Cobre CA-04.
  - problema `class-conflict` do servidor abre a aba Informações e mostra o erro no código. Cobre CA-05.
  - salvar envia, em uma chamada, valores das quatro abas. Cobre CA-06.
- **Frontend, páginas `new` e `settings`:** continuam criando e salvando a turma. Cobre CA-06.
- **Frontend, `ClassForm.test.tsx` e componente da prévia:**
  - com datas 2026-10-05 a 2026-10-31 e encontro na segunda, a prévia marca 5, 12, 19 e 26 de outubro com horário e aulas. Cobre CA-09.
  - mudar o horário ou ligar outro dia atualiza os marcadores sem chamar `onSubmit`. Cobre CA-10.
  - dias fora da vigência não têm marcador e os botões de mês ficam desabilitados nos limites da vigência. Cobre CA-11.
  - sem datas, início depois do fim, ou sem encontros, mostra a mensagem. Cobre CA-12.
  - na turma nova, o nome do feriado aparece no dia e a aula do mesmo dia segue marcada. Cobre CA-15.
- **Frontend, `ClassSessionsCalendar.test.tsx` e `ClassForm.test.tsx` (turma salva):**
  - com `classId`, a aba Horários mostra o calendário real (feriados) e não a prévia. Cobre CA-16.
  - alterar uma aula: cancelar com motivo, ajustar horário, e recarregar. Cobre CA-17.
  - incluir aula avulsa no dia selecionado. Cobre CA-18.
  - "Aplicar horários ao calendário" salva os encontros e recarrega; aviso de mudança não aplicada. Cobre CA-19.
  - não há botões de evento nem de período. Cobre CA-20.
- **Frontend (CA-21):** a célula de feriado recebe a marca `data-on-holiday` na prévia e no `ClassCalendar`. O destaque vermelho e a contenção do nome são estilo, conferidos no roteiro manual.
- **Manual:** conferir as abas em 360 px de largura e nos dois temas; rodar `npm run lint`. Cobre CA-03 e CA-08.
- **Cobertura:** acima de 80% no escopo da spec.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-041 (seção do formulário), SPEC-042 (seção 3.1.1), SPEC-043; os arquivos listados abaixo.
2. **Ordem de execução:** (1) testes da seção 8, vermelhos, commit `test(frontend)`; (2) `suggestLessons` com 60 minutos; (3) abas no `ClassForm`; (4) ajustar textos em `messages/pt-BR.ts`; (5) conferir lint e cobertura.
3. **Arquivos a criar ou alterar:** `frontend/src/components/ClassForm/ClassForm.tsx`, `ClassForm.module.scss`, `ClassForm.test.tsx`; `frontend/src/lib/calendar.ts` e seu teste; `frontend/src/messages/pt-BR.ts`; testes das páginas `new` e `settings` se precisarem de ajuste; seção 3.1.1 da SPEC-042 recebe nota de remissão para esta spec. As abas ficam dentro do `ClassForm`, sem componente genérico (decisão do Tech Lead).
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 verdes, lint limpo, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma. Decisões do Tech Lead em 14/10/2026: quatro abas; abas dentro do `ClassForm`; prévia mensal que não desconta feriados nem recessos.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação (Rascunho) |
| 14/10/2026 | Aruna Architect | Decisões do Tech Lead incorporadas (quatro abas, dentro do `ClassForm`); pendências P-01 e P-02 resolvidas; status Aprovada |
| 14/10/2026 | Aruna Architect | Novo requisito do Tech Lead: prévia do calendário na aba Horários (3.1.2, CA-09 a CA-12); renumera a aula de 60 minutos para 3.1.3; volta a Rascunho com P-03 e P-04 |
| 14/10/2026 | Aruna Architect | Tech Lead mandou implementar a prévia; P-03 (não descontar feriados) e P-04 (mensal) resolvidas com as recomendações; status Aprovada |
| 14/10/2026 | Implementador | Implementada: abas, prévia do calendário, regra de 60 minutos nos dois sentidos (CA-13, CA-14) e correção do salvamento dos horários (SPEC-042) |
| 14/10/2026 | Aruna Architect | Tech Lead escolheu a Opção A: turma nova com prévia (agora com feriados) e turma salva com o calendário real (cancelar, ajustar, incluir aula avulsa); CA-15 a CA-20; volta a Aprovada |
| 14/10/2026 | Implementador | Implementada a Opção A: feriados na prévia, calendário real na configuração (cancelar, ajustar, incluir aula avulsa) e botão Aplicar horários; testes alterados depois do vermelho: seleção de situação por rádio em `ClassSessionsCalendar.test.tsx` e o teste da tela de configuração, que passou a esperar o calendário real (CA-16) |
| 14/10/2026 | Aruna Architect | Pedido do Tech Lead: dia de feriado em vermelho nos dois calendários e nome contido na célula (CA-21) |
| 14/10/2026 | Implementador | CA-21 implementado: célula de feriado em vermelho nos dois calendários e grade com colunas de largura fixa (`minmax(0, 1fr)`), que impede o nome do feriado de alargar a grade |
