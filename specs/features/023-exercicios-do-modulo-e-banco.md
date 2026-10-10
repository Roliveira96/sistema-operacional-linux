# SPEC-023: Exercícios do Módulo e Banco de Exercícios

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-023 |
| **Status** | Implementada |
| **Data de criação** | 10/10/2026 |
| **Última revisão** | 10/10/2026 (implementada) |
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
- **RN-11 (herança de cenário, TCC 3.x "Herança de Cenários e Isolamento entre Questões"):** um exercício disponível pode **continuar do anterior**. A máquina dele parte do snapshot do módulo, do snapshot dos exercícios disponíveis e da **receita** do exercício anterior (a solução gravada), e, se o anterior também continua do que veio antes, da dele, e assim por diante, na ordem da trilha. A máquina é sempre montada de novo a partir da receita (nunca é o estado de uma máquina em uso). As condições de finalização do exercício que continua falam só do que ele muda.
- **RN-10:** o "Testar o módulo" inclui os exercícios disponíveis e os de avaliação; um exercício sem solução gravada ou sem condições de finalização reprova o teste (SPEC-022).

## 4. Modelo de Dados (Data Model)

| Entidade | Alteração | Descrição |
| :--- | :--- | :--- |
| `questions` (`Question`) | Novas colunas de dicas e de autoria | `hints` (lista de dicas com texto e comando opcional) e `updated_by`, `created_by` (usuário). A dica única atual (`hint`) continua lida para o que veio da carga inicial |
| `questions` | Reuso do formato de solução e condições | `reference_solution` guarda a solução gravada; `validation_conditions` guarda as condições de finalização no catálogo do servidor (ver P-02) |
| `course_modules` | Duas colunas novas | `exercises_setup` e `assessment_setup`: snapshots no formato `Setup` da SPEC-021, ambos opcionais |
| `module_versions` | Conteúdo congelado inclui os dois snapshots | A versão publicada passa a congelar também `exercises_setup` e `assessment_setup` (ver P-04) |
| `questions` | Coluna nova | `continues_previous` (booleano, padrão falso): o exercício continua de onde o anterior da trilha terminou (RN-11); vale só para o exercício disponível |
| `module_exercise_items` | Sem mudança de schema | Continua sendo a trilha: um item por exercício disponível, com ordem e obrigatoriedade |

Relacionamentos, índices e unicidades da trilha ficam como na SPEC-010. A exclusão do exercício é lógica (como `Question` hoje); a remoção da trilha é física.

## 5. Contrato de API (API Contract)

Todos sob `/api/v1/teacher/modules/{id}`, para a docente dona do módulo ou administrador. Erros no formato RFC 7807, com os mesmos `type` da autoria de conteúdo (`validation-error`, `not-found`, `forbidden`, `not-authenticated`, `payload-too-large`) e `block-conflict` para o conflito de edição.

**`GET /exercises`**: lista os exercícios do banco.

| Campo da resposta | Tipo | Descrição |
| :--- | :--- | :--- |
| `items` | lista | Um item por exercício, com os campos de `GET /exercises/{exerciseId}` menos enunciado, solução e condições |
| `exercisesSetup` | objeto ou nulo | Snapshot dos exercícios disponíveis |
| `assessmentSetup` | objeto ou nulo | Snapshot do banco de avaliação |

**`POST /exercises`** e **`PUT /exercises/{exerciseId}`**: cria e salva.

| Campo do corpo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| `title` | texto | Sim | 1 a 200 caracteres |
| `difficulty` | texto | Sim | `EASY`, `MEDIUM` ou `HARD` |
| `statement` | HTML | Não | Sanitizado como o texto dos cards; até 20 mil caracteres |
| `hints` | lista | Não | Até 10; cada uma com `text` (obrigatório, até 1000) e `command` (opcional, até 500) |
| `solution` | objeto | Não | Snapshot no formato da SPEC-021, mesmos limites |
| `continuesPrevious` | booleano | Não | Continua do exercício anterior da trilha (RN-11); padrão falso |
| `conditions` | lista | Não | Até 100, no catálogo do servidor (SPEC-011 e 013) |
| `updatedAt` | instante | Em `PUT` | Detecta conflito; `force` ignora |

| Campo da resposta | Tipo | Descrição |
| :--- | :--- | :--- |
| `id`, `title`, `difficulty`, `statement`, `hints`, `solution`, `conditions` | | Como no corpo |
| `usage` | texto | `EXERCISE` (disponível) ou `ASSESSMENT` (reservado) |
| `status` | texto | `DRAFT` ou `PUBLISHED` |
| `position`, `mandatory` | inteiro, booleano | Na trilha; só se disponível |
| `createdAt`, `updatedAt`, `createdBy`, `updatedBy` | | Autoria (RN-08) |
| `legacy` | booleano | Veio da carga inicial, sem solução gravada (P-05) |

**`PUT /exercises/{exerciseId}/availability`**: corpo com `usage` (`EXERCISE` ou `ASSESSMENT`) e `status` (`DRAFT` ou `PUBLISHED`). Disponibilizar põe no fim da trilha (RN-03).

**`DELETE /exercises/{exerciseId}`**: remove (RN-09).

**`PUT /exercises/order`**: corpo com `items`, lista de `{exerciseId, mandatory}` na ordem desejada; precisa conter exatamente os disponíveis.

**`PUT /exercise-setups`**: corpo com `exercisesSetup` e `assessmentSetup`, cada um um snapshot ou nulo. Corpo até 6 MB.

Os endpoints do estudante (`/modules/{id}/scenario`, `/questions/{id}/scenario`, `/questions/{id}/check`, `/modules/{id}/progress`) continuam; a resposta de `/modules/{id}/exercises` (novo, autenticação opcional) traz só os exercícios disponíveis e publicados, em ordem, com enunciado, nível, dicas e condições, mais os dois snapshots necessários (módulo e dos exercícios disponíveis).

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
- [ ] **CA-11** (evento): QUANDO um exercício continua do anterior, O SISTEMA DEVE montar a máquina dele (na página da docente, no teste e na tela do estudante) com o snapshot do módulo, o dos exercícios disponíveis e a solução gravada dos exercícios da cadeia, nessa ordem (RN-11).
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

## 10. Pendências

Nenhuma em aberto. Decisões do Tech Lead de 10/10/2026 (D-01 a D-03) e aceitas por ele na aprovação (D-04 a D-10, as recomendações do rascunho):

| ID | Decisão |
| :--- | :--- |
| D-01 | O exercício do módulo e do banco é uma `Question` prática |
| D-02 | O banco é por módulo |
| D-03 | Um snapshot por conjunto (disponíveis e avaliação); nenhum por exercício |
| D-04 | A `Question` ganha uma lista de dicas; a dica única antiga é lida como a primeira da lista |
| D-05 | As condições de finalização derivadas na tela são traduzidas para o catálogo do servidor ao salvar: `DIR_EXISTS` → `DIRECTORY_EXISTS`, `FILE_EXISTS`, `PATH_ABSENT`, `FILE_CONTENT` igual → `CONTENT_EQUALS` e contém → `CONTENT_CONTAINS`, `MODE` → `PERMISSION_MODE`, `OWNER` → `OWNER` e `GROUP_OWNER`, `LINK` → `SYMLINK`, `USER_EXISTS`, `GROUP_EXISTS`, `USER_IN_GROUP`. O catálogo do servidor já tem todos, então não é preciso ampliá-lo |
| D-06 | O servidor entrega as camadas (snapshot do módulo e do conjunto) e o cliente as executa; a máquina serializada (`Scenario`) fica só para o que veio da carga inicial |
| D-07 | Os dois snapshots entram na versão publicada do módulo; os exercícios ficam fora (têm ciclo próprio de rascunho e publicado) |
| D-08 | Os exercícios da carga inicial aparecem no banco como somente leitura (`legacy`) com o aviso "grave a solução para poder testar", e viram editáveis ao gravar a solução |
| D-09 | Campos e erros dos endpoints: os da seção 5 |
| D-10 | Os termos novos entram no glossário: exercício do módulo, banco de exercícios do módulo, conjunto de exercícios |

### Ajustes de implementação (sem desvio de escopo)

| ID | Ajuste |
| :--- | :--- |
| A-01 | D-05: a tradução das condições para o catálogo do servidor é feita pelo **servidor** ao salvar (e não pela tela). A coluna `end_conditions` guarda as condições na forma de edição e `validation_conditions` guarda as do catálogo, para a docente reabrir o exercício sem perder nada |
| A-02 | D-08: o exercício da carga inicial pode ser editado na hora; a página mostra o aviso "veio da carga inicial e não tem a solução gravada" até a docente gravar a solução, em vez de ficar somente leitura |
| A-03 | Publicar exige pelo menos uma condição de finalização (RN-04): um exercício que ninguém consegue concluir não vai ao estudante |
| A-04 | O teste do módulo (RN-10) roda só os exercícios **publicados** de cada conjunto; os rascunhos são contados na cobertura e não rodam. O conjunto disponível entra também no módulo em sequência, ao final; o de avaliação roda sozinho, sobre o snapshot do módulo e o dele |
| A-05 | O resultado do teste do módulo passa a depender do banco (exercícios publicados e os dois snapshots): mexer neles o marca como "alterado desde o teste". Um módulo sem banco mantém a impressão digital que tinha |
| A-06 | Para o estudante, o exercício do módulo chega no formato que a tela de prática já lê (dicas como uma lista em HTML, solução como lista de comandos) e com a marca `layered`: a máquina é o cenário do tópico, com o snapshot do módulo e o dos exercícios disponíveis por cima, sem os snapshots dos cards (RN-07) |
| A-07 | A listagem de questões do estudante respeita a ordem da trilha |
| A-09 | RN-11: a questão pública do estudante traz `continues` e, para o exercício disponível, `solutionSetup` (a receita completa, com os arquivos), que a tela usa para montar a máquina da cadeia; a solução já era pública para quem pede "Ver como o professor fez" |
| A-08 | Os arquivos que uma solução escreveu não têm comando e por isso não aparecem em "Ver como o professor fez" do estudante |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 10/10/2026 | Implementador (Claude) | Criação do rascunho a partir do pedido do Tech Lead; decisões D-01 a D-03 tomadas por ele no mesmo dia; pendências P-01 a P-07 abertas |
| 10/10/2026 | Tech Lead | Aprovada, aceitas as recomendações de P-01 a P-07 (viram D-04 a D-10); seção 5 detalhada |
| 10/10/2026 | Implementador (Claude) | Implementada: migração 00016, banco de exercícios no backend (serviço, repositório, rotas, trilha, snapshots, autoria, versões), aba Exercícios do módulo e página do exercício, teste do módulo com o banco, entrega ao estudante com o cenário em camadas. Ajustes A-01 a A-08 |
| 10/10/2026 | Tech Lead | Pedido: exercícios em sequência (criar a pasta, depois o script dentro dela, depois rodar o script), como descrito no TCC (herança de cenários). Incluídos RN-11, CA-11, a coluna `continues_previous` e o ajuste A-09 |
