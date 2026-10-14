# SPEC-044: Formulário da Turma em Abas e Aula de 60 Minutos

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-044 |
| **Status** | Aprovada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (prévia do calendário aprovada) |
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
5. Na aba Horários, o docente vê **como as aulas ficam no calendário**, de acordo com os horários que marcou e com as datas de início e fim da turma, antes de salvar.

### 2.1. Fora de escopo (Non-Goals)

- Mudar campos, validações, textos de erro ou contrato de API do formulário.
- Salvar cada aba separadamente ou criar rotas por aba.
- Mudar o limite de 1 a 8 aulas por encontro.
- Gravar ou editar aulas pela prévia, ou mostrar feriados e eventos nela.
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

#### 3.1.2. Prévia do calendário na aba Horários

Abaixo do editor de encontros, a aba Horários mostra um calendário mensal com as aulas que os encontros marcados vão gerar (SPEC-042, RN-01):

- vai da **data de início** à **data de fim** da turma, informadas na aba Informações; o calendário abre no mês do início e permite ir e voltar entre os meses da vigência, sem sair dela (os botões de mês anterior e seguinte ficam desabilitados nos limites);
- cada dia da vigência que cai num dia da semana com encontro mostra um marcador com o horário e a quantidade de aulas, na cor da turma;
- atualiza na hora, sem salvar, quando o docente liga ou desliga um dia, muda horário ou quantidade de aulas, ou muda as datas;
- é só leitura: não cria, não edita e não apaga aula;
- sem datas válidas (vazias ou início depois do fim), mostra uma mensagem pedindo as datas na aba Informações; sem encontros, mostra a mensagem de que ainda não há horários;
- feriados e recessos não entram na prévia (ver P-03);
- no celular, o calendário ocupa a largura da tela e os marcadores continuam legíveis; cores só dos tokens, nos temas claro e escuro.

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
