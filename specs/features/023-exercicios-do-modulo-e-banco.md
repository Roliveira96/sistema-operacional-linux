# SPEC-023: Exercícios do Módulo e Banco de Exercícios

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-023 |
| **Status** | Rascunho |
| **Data de criação** | 10/10/2026 |
| **Última revisão** | 10/10/2026 |
| **Autor** | Implementador (Claude), a pedido do Tech Lead |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `content` (questões e cenários) e `coursemodule` (trilha e snapshots do módulo); aba Exercícios da edição do módulo, tela de estudo e prática |
| **Contexto de tela** | `/app/modules/[id]/edit?tab=exercises`, página de cada exercício do módulo, `/app/modules/[id]` (prática) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-010, SPEC-011, SPEC-013, SPEC-014, SPEC-021, SPEC-022 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead de 10/10/2026 (exercícios do módulo, banco de exercícios e snapshots próprios) |

---

## 1. Contexto e Problema (Context & Problem Statement)

O módulo tem hoje três lugares onde há "exercício": os **exercícios do card** (SPEC-022, sem nota, conferidos na tela do estudante), a **trilha de exercícios práticos** da aba Exercícios da edição do módulo (SPEC-010, só a ordem e a obrigatoriedade de questões que vieram da carga inicial) e as **questões de avaliação** (`Question` com uso `ASSESSMENT`, SPEC-011). A docente não consegue criar nem editar nenhuma dessas questões pela interface: a aba Exercícios só mostra "Exercício #<id>" e deixa mudar a ordem. Também não há onde preparar o **ambiente** (snapshot) específico dos exercícios do módulo nem dos exercícios guardados para avaliação.

A docente quer, na aba Exercícios do módulo, um **banco de exercícios**: criar exercícios parecidos com os do card (solução gravada no terminal e condições de finalização), **disponibilizar** alguns ao estudante como prática do módulo e **reservar** outros para quando houver avaliação, cada conjunto com o seu ambiente.

## 2. Objetivos (Goals)

- A aba Exercícios do módulo passa a ser o **banco de exercícios do módulo**: a docente cria, edita, ordena e remove exercícios, cada um numa página própria (como o exercício do card).
- Cada exercício do banco é uma `Question` prática. Ele está **disponível no módulo** (uso `EXERCISE`, aparece na trilha do estudante) ou **reservado para avaliação** (uso `ASSESSMENT`, o estudante não o vê na prática).
- A docente move um exercício entre os dois conjuntos com uma ação ("Disponibilizar no módulo" e "Reservar para avaliação").
- O módulo ganha **dois snapshots** (SPEC-021), gravados no terminal sobre o snapshot do módulo: o dos **exercícios disponíveis** e o do **banco de avaliação**. Nunca há snapshot por exercício.
- Cada exercício tem título, enunciado, dificuldade, dicas, **solução gravada** e **condições de finalização**, no mesmo modelo do exercício do card.
- O "Testar o módulo" também roda os exercícios do módulo: o conjunto disponível sobre o seu snapshot e o conjunto de avaliação sobre o seu, cada um com solução e conferência do fim.
- A trilha obrigatória e a ordem dos exercícios disponíveis continuam como na SPEC-010.

### 2.1. Fora de escopo (Non-Goals)

- Banco do professor compartilhado entre módulos, cópia de exercício entre módulos e importação/exportação do banco (ficam para uma spec futura).
- Montar, agendar ou aplicar uma avaliação com os exercícios reservados (`AssessmentTemplate` e tentativas ficam nas specs de avaliação).
- Questões teóricas (escolha, verdadeiro/falso, dissertativa) no banco: esta spec trata só das práticas (`PRACTICAL`).
- Snapshot por exercício.
- Alterar o exercício do card (SPEC-022).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- A aba Exercícios da edição do módulo tem **dois conjuntos**: "Disponíveis no módulo" (a trilha, em ordem, com marca de obrigatório) e "Reservados para avaliação". Cada conjunto mostra o **resumo do seu ambiente** com o botão de gravar no terminal e uma lista de exercícios (título, nível, dicas, se tem solução e condições, e a descrição resumida). Cada linha abre a página do exercício e tem um menu de ações (abrir, disponibilizar ou reservar, remover).
- A **página do exercício do módulo** reaproveita o formulário do exercício do card (`ExerciseForm`): título, nível, enunciado, dicas, solução gravada no terminal e condições de finalização. O terminal parte da máquina com o snapshot do módulo e o do conjunto a que o exercício pertence.
- Ícone "i" com explicação didática em cada parte nova, como no resto da edição do módulo.
- O estudante vê, na prática do módulo, só os exercícios disponíveis, em ordem, com dicas sob demanda e a conferência de como terminam (SPEC-022).

### 3.2. Backend (Go — Camada de Módulo/Service)

- **RN-01:** o banco do módulo é o conjunto de `Question` práticas do módulo; o uso (`EXERCISE` ou `ASSESSMENT`) diz o conjunto.
- **RN-02:** só a docente dona do módulo (ou o administrador) cria, altera, move e remove exercícios do banco.
- **RN-03:** disponibilizar um exercício o põe no fim da trilha (`module_exercise_items`) com uso `EXERCISE`; reservá-lo o tira da trilha e muda o uso para `ASSESSMENT`. A ordem dos demais não muda.
- **RN-04:** um exercício só vai ao estudante se estiver publicado e disponível; rascunho e reservado nunca são entregues na prática.
- **RN-05:** o exercício guarda a solução gravada, as condições de finalização e as dicas no mesmo formato do exercício do card, com os mesmos limites (SPEC-022).
- **RN-06:** o módulo guarda dois snapshots (exercícios disponíveis e banco de avaliação) no formato da SPEC-021, com os mesmos limites de tamanho dos arquivos. Cada um só vale para o seu conjunto.
- **RN-07:** o cenário inicial do estudante num exercício disponível é o snapshot do módulo seguido do snapshot dos exercícios disponíveis; num exercício de avaliação, o do módulo seguido do snapshot do banco de avaliação.
- **RN-08:** salvar exercício e snapshots registra quem alterou e quando (como a autoria dos blocos, SPEC-019).
- **RN-09:** remover um exercício com progresso de estudante pede confirmação e apaga o progresso dele (como a remoção de card).
- **RN-10:** o "Testar o módulo" inclui os exercícios disponíveis e os de avaliação; um exercício sem solução gravada ou sem condições de finalização reprova o teste (SPEC-022).

## 4. Modelo de Dados (Data Model)

| Entidade | Alteração | Descrição |
| :--- | :--- | :--- |
| `questions` (`Question`) | Novas colunas de dicas e de autoria | `hints` (lista de dicas com texto e comando opcional) e `updated_by`, `created_by` (usuário). A dica única atual (`hint`) continua lida para o que veio da carga inicial |
| `questions` | Reuso do formato de solução e condições | `reference_solution` guarda a solução gravada; `validation_conditions` guarda as condições de finalização no catálogo do servidor (ver P-02) |
| `course_modules` | Duas colunas novas | `exercises_setup` e `assessment_setup`: snapshots no formato `Setup` da SPEC-021, ambos opcionais |
| `module_versions` | Conteúdo congelado inclui os dois snapshots | A versão publicada passa a congelar também `exercises_setup` e `assessment_setup` (ver P-04) |
| `module_exercise_items` | Sem mudança de schema | Continua sendo a trilha: um item por exercício disponível, com ordem e obrigatoriedade |

Relacionamentos, índices e unicidades da trilha ficam como na SPEC-010. A exclusão do exercício é lógica (como `Question` hoje); a remoção da trilha é física.

## 5. Contrato de API (API Contract)

Endpoints novos, todos sob `/api/v1/teacher/modules/{id}`, para a docente dona do módulo ou administrador (detalhes de campos e erros a fechar na aprovação, ver P-06):

| Endpoint | Função |
| :--- | :--- |
| `GET /exercises` | Lista os exercícios do banco, nos dois conjuntos, com resumo e autoria |
| `POST /exercises` | Cria um exercício (rascunho, reservado para avaliação por padrão) |
| `GET /exercises/{exerciseId}` | Lê um exercício completo |
| `PUT /exercises/{exerciseId}` | Salva o exercício (título, enunciado, nível, dicas, solução, condições), com detecção de conflito por `updatedAt` |
| `PUT /exercises/{exerciseId}/availability` | Disponibiliza ou reserva, e publica ou volta a rascunho |
| `DELETE /exercises/{exerciseId}` | Remove o exercício |
| `PUT /exercises/order` | Reordena os disponíveis e marca obrigatórios (substitui o de hoje) |
| `PUT /exercise-setups` | Salva os dois snapshots do módulo |

Os endpoints de leitura do estudante (`/modules/{id}/scenario`, `/questions/{id}/scenario`, `/questions/{id}/check`, `/modules/{id}/progress`) continuam, com o cenário composto como na RN-07.

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| :--- | :--- |
| As questões que já existem (carga inicial) não têm solução gravada nem dicas no novo formato | Aparecem no banco como somente leitura até a docente gravar a solução; o teste do módulo as sinaliza como "não dá para testar" em vez de ignorá-las |
| Dois catálogos de condições (servidor, SPEC-011 e 013; tela, SPEC-022) podem divergir | Pendência P-02; o teste automático compara a conferência do cliente com a do servidor |
| Gravar dois snapshots sobre o do módulo pode conflitar com os comandos dele | O gravador usa as mesmas regras de conflito da SPEC-021 |
| Exercício de avaliação vazando ao estudante | RN-04 e teste de que só os disponíveis e publicados saem na prática |
| Mudança na aba Exercícios atual (ordem e obrigatoriedade) | A ordem e a obrigatoriedade permanecem; só ganham as ações novas |

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (ubíquo): A aba Exercícios do módulo DEVE listar os exercícios em dois conjuntos, disponíveis (em ordem) e reservados para avaliação.
- [ ] **CA-02** (evento): QUANDO a docente cria um exercício, O SISTEMA DEVE abrir a página dele, reaproveitando o formulário do exercício do card.
- [ ] **CA-03** (evento): QUANDO a docente disponibiliza ou reserva um exercício, O SISTEMA DEVE mudar o conjunto e a trilha sem alterar a ordem dos demais (RN-03).
- [ ] **CA-04** (evento): QUANDO a docente grava o snapshot de um conjunto, O SISTEMA DEVE montar a máquina com o snapshot do módulo e liberar o terminal, e guardar o resultado só nesse conjunto (RN-06).
- [ ] **CA-05** (estado): ENQUANTO um exercício está reservado ou em rascunho, O SISTEMA NÃO DEVE entregá-lo ao estudante na prática (RN-04).
- [ ] **CA-06** (evento): QUANDO o estudante abre um exercício disponível, O SISTEMA DEVE montar a máquina com o snapshot do módulo e o dos exercícios disponíveis (RN-07).
- [ ] **CA-07** (evento): QUANDO a docente testa o módulo, O SISTEMA DEVE rodar a solução e conferir o fim de cada exercício dos dois conjuntos, e reprovar o que não puder ser testado (RN-10).
- [ ] **CA-08** (indesejado): SE outra pessoa alterou o exercício depois que a docente o abriu, ENTÃO O SISTEMA DEVE avisar do conflito e oferecer salvar mesmo assim.
- [ ] **CA-09** (ubíquo): O SISTEMA DEVE mostrar, em cada exercício, quando foi criado e atualizado e por quem (RN-08).
- [ ] **CA-10** (evento): QUANDO a docente remove um exercício, O SISTEMA DEVE pedir confirmação e avisar que o progresso dos estudantes nele é apagado (RN-09).

## 8. Plano de Testes (Test Plan)

- **Backend:** regras RN-01 a RN-10 em testes de service; repository com PostgreSQL real (uso, trilha, snapshots, autoria, versão congelando os snapshots); handler com autorização por papel e conflito.
- **Frontend:** aba com os dois conjuntos, página do exercício, gravação dos dois snapshots, mover entre conjuntos, testes do módulo com os exercícios, dois temas.
- **Manual:** criar exercícios, disponibilizar um e reservar outro, gravar os dois ambientes, abrir como estudante e conferir que só o disponível aparece, e testar o módulo.
- **Cobertura:** acima de 80% no escopo da spec.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-010, 011, 013, 014, 021, 022; no código, `content/domain/entities.go`, `coursemodule/domain/exercise_item.go`, `frontend/src/components/ExerciseForm`, `ExerciseOrderList`, `CardBuilder/SetupEditor.tsx`.
2. **Ordem de execução:** (1) migração e domínio; (2) service e repository do banco; (3) handlers; (4) serviço do frontend e modelo; (5) aba e página do exercício; (6) gravação dos snapshots; (7) prática do estudante com o cenário composto; (8) teste do módulo; (9) glossário e esta spec.
3. **Arquivos a criar ou alterar:** a definir na aprovação, depois de resolvidas as pendências.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

Decisões já tomadas pelo Tech Lead em 10/10/2026: o exercício é uma `Question` (D-01); o banco é por módulo (D-02); há um snapshot por conjunto, e nenhum por exercício (D-03).

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| P-01 | O que `Question` guarda hoje como dica é um texto único; o exercício do card tem uma lista de dicas com comando opcional | Acrescentar a lista de dicas à `Question` e ler a dica única antiga como a primeira da lista |
| P-02 | As condições de finalização da tela (SPEC-022: `DIR_EXISTS`, `FILE_CONTENT`, `OWNER`, etc.) e o catálogo de condições do servidor (SPEC-011 e 013) são diferentes | Mapear cada condição derivada para o catálogo do servidor e, para o que não tiver equivalente, ampliar o catálogo por revisão (como a SPEC-013), com um teste que compara os dois avaliadores |
| P-03 | O cenário de hoje é uma máquina inteira serializada (`Scenario`), e os snapshots da SPEC-021 são comandos e arquivos executados no cliente | O servidor devolve a composição de camadas (módulo + conjunto) e o cliente a executa; a máquina serializada fica só para o que veio da carga inicial |
| P-04 | A versão publicada (SPEC-021) congela blocos e o snapshot do módulo; os dois snapshots e os exercícios devem entrar? | Os dois snapshots entram na versão; os exercícios continuam fora (têm ciclo de publicação próprio: rascunho e publicado) |
| P-05 | Os exercícios da carga inicial (190 publicados) aparecem como? | Somente leitura, com o aviso "grave a solução para poder testar", e viram editáveis ao gravar a solução |
| P-06 | Campos e erros de cada endpoint da seção 5 | Detalhar na revisão desta spec, no formato do template, antes de aprovar |
| P-07 | Termos novos para o glossário: exercício do módulo, banco de exercícios do módulo, conjunto de exercícios (disponíveis e de avaliação) | Incluir no `GLOSSARY.md`, ligando "banco de exercícios do módulo" ao `QuestionBank` já proposto |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 10/10/2026 | Implementador (Claude) | Criação do rascunho a partir do pedido do Tech Lead; decisões D-01 a D-03 tomadas por ele no mesmo dia; pendências P-01 a P-07 abertas |
