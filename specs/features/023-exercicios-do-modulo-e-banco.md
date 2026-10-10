# SPEC-023: Exercícios do Módulo e Banco de Exercícios

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-023 |
| **Status** | Implementada |
| **Data de criação** | 10/10/2026 |
| **Última revisão** | 10/10/2026 (revisões 2 e 3 implementadas) |
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

### Ajustes de implementação das revisões 2 e 3 (sem desvio de escopo)

| ID | Ajuste |
| :--- | :--- |
| A-10 | Migração 00018: `in_assessment`, `exclusive_assessment` e `depends_on` na questão; `continues_previous` migrado para `depends_on` (o anterior da trilha) e removido; `bank_setup` substitui os dois snapshots (os dois antigos são unidos, o de prática primeiro). Restrições no banco: exclusivo exige avaliação e não vai à prática; ninguém depende de si mesmo; o ciclo é barrado pelo serviço |
| A-11 | Rotas: `PUT /exercises/:id/links` (prática, avaliação, exclusivo e estado) substitui `/availability`; `PUT /exercise-setup` (`bankSetup`) substitui `/exercise-setups`; `POST` aceita `dependsOn` e `links`; a listagem devolve `bankSetup` |
| A-12 | D-20: o estudante recebe `chainSetups` (as soluções dos antecessores, do mais antigo ao mais novo) resolvido no servidor; `continues` e `solutionSetup` foram removidos da questão pública. A versão do módulo congela `bankSetup` |
| A-13 | O banco de exercícios sempre mostra todos os exercícios; "Remover do bloco" só desfaz o vínculo, e apagar do banco é uma ação do menu do banco, com o aviso de que o progresso dos alunos vai junto. Sair da avaliação desmarca "exclusivo"; marcar "exclusivo" tira o exercício da prática |
| A-14 | "Criar nova questão" abre a página do exercício com `?link=practice` ou `?link=assessment`: ao salvar, o exercício nasce no banco já vinculado ao bloco de onde veio. No cabeçalho do banco, a mesma ação cria sem vínculo |
| A-15 | A busca de dependências do teste só considera como suspeito um exercício que não crie ciclo com os já declarados; o teste e o teste do módulo põem o antecessor sempre antes do dependente, mesmo que ele esteja só na avaliação |
| A-16 | O motor do terminal não tem link físico nem `tar -C`, então os exercícios carregados usam só o que ele sabe fazer; a carga dos 50 exercícios de História do Linux foi gerada rodando cada solução no terminal de verdade e passando o banco inteiro pelo Testar Banco (semente 2026: sem conflito, sem dependência a confirmar) |
| A-17 | Carga: `go run ./cmd/seed-exercises -module <id> -file seeds/historia-do-linux-exercicios.json` cria, vincula e publica os exercícios pelo serviço, como a docente dona do módulo, e pode ser repetida sem duplicar (compara o título) |

---

## 11. Revisão 2: banco central de exercícios e snapshot único

Pedido do Tech Lead de 10/10/2026. **Esta revisão substitui, onde conflitar, os itens indicados da versão implementada (revisão 1); o código só muda depois da aprovação.**

### 11.1. Banco central e vinculação

- O **Banco de exercícios do módulo** é a única fonte da verdade: criar, editar e remover um exercício só acontece nele. Os blocos "Disponíveis no módulo" e "Reservados para avaliação" deixam de criar exercícios: são **listas de vinculação** de exercícios do banco.
- Um exercício do banco tem **vínculos**: `Prática` (aparece na trilha do estudante, RN-03) e `Avaliação` (reservado para provas), e a marca `Exclusivo da avaliação`. O mesmo exercício pode ter os dois vínculos, a não ser que seja exclusivo: um exercício exclusivo não pode estar na prática. Sem nenhum vínculo, é "Não vinculado".
- O banco lista **todos** os exercícios, com a etiqueta do que cada um é: Disponível no módulo, Reservado para avaliação, Exclusivo da avaliação ou Não vinculado, e com filtro por vínculo, nível e publicação.
- Em cada bloco, **"Adicionar do Banco"** abre uma seleção (com filtro) dos exercícios que ainda não estão no bloco, e **"Remover do bloco"** desvincula sem apagar do banco. Se a docente quiser um exercício que ainda não existe, o "Adicionar do Banco" oferece **"Criar nova questão"**: abre o formulário do banco, salva nele e já vincula ao bloco de onde veio.
- Editar um exercício altera o registro do banco, e vale para todos os blocos em que ele está.

### 11.2. Snapshot único (substitui RN-06, RN-07 e D-03)

- O módulo tem **um** snapshot da base de exercícios (`bank_setup`), no lugar dos dois (`exercises_setup` e `assessment_setup`). Ele é gravado no terminal sobre o snapshot do módulo e vale para **todos** os exercícios do banco, na prática e na avaliação.
- A máquina de qualquer exercício parte do snapshot do módulo, do snapshot do banco e, se o exercício continua do anterior (RN-11), da receita da cadeia. Não há snapshot por bloco nem por exercício.
- A avaliação usa esse mesmo snapshot e só **filtra** quais exercícios participam: os vinculados à `Avaliação`. O congelamento do banco no momento em que uma prova é aplicada pertence à spec de avaliação (já existe o congelamento por versão do módulo, SPEC-021, que passa a incluir o `bank_setup`).

### 11.3. Efeitos nos itens da revisão 1

| Item | Efeito |
| :--- | :--- |
| RN-03 | A trilha continua sendo o vínculo `Prática`; o vínculo `Avaliação` é novo. Disponibilizar e reservar viram vincular e desvincular, sem tirar o exercício do banco |
| RN-04 | Só chega ao estudante o exercício publicado e com vínculo `Prática` |
| RN-10 | O teste do módulo roda o snapshot único e, sobre ele, os exercícios publicados com vínculo `Prática` em sequência e os com vínculo `Avaliação` cada um sobre uma máquina nova |
| CA-03, CA-04 | CA-03 passa a ser vincular e desvincular; CA-04 passa a gravar um único snapshot |
| Modelo de dados | `questions` ganha `in_assessment` e `exclusive_assessment` (booleanos); `usage` deixa de decidir a prática (a trilha decide) e fica só para a carga inicial; `course_modules` troca `exercises_setup` e `assessment_setup` por `bank_setup` (os dois atuais se fundem na migração: o de prática vence; o de avaliação vira um aviso na revisão da docente) |
| API | `PUT /exercises/{id}/links` (corpo: `practice`, `assessment`, `exclusive`); `POST /exercises` aceita os vínculos iniciais; `PUT /exercise-setup` (um só); a listagem traz os vínculos de cada exercício |

### 11.4. Decisões da revisão 2 (aprovadas pelo Tech Lead em 10/10/2026, as recomendações do rascunho)

| ID | Decisão |
| :--- | :--- |
| D-11 | O "snapshot do banco" é o **ambiente** (comandos e arquivos que preparam a máquina). O congelamento do conteúdo do banco na aplicação de uma prova fica para a spec de avaliação |
| D-12 | O exercício "exclusivo da avaliação" bloqueia só a prática do próprio módulo (o banco é por módulo, D-02) |
| D-13 | A migração marca `in_assessment` nos exercícios de uso `ASSESSMENT`; os modelos de avaliação passam a ler `in_assessment` em vez de `usage` |
| D-14 | Os dois snapshots atuais se fundem num só (`bank_setup`): o de prática vence; se só existir o de avaliação, ele é usado |

---

## 12. Revisão 3: Testar Banco de Exercícios e dependências entre exercícios

Pedido do Tech Lead de 10/10/2026, sobre a revisão 2 (banco central e snapshot único). Também só vale depois da aprovação.

### 12.1. O botão e o preparo

- A aba Exercícios ganha o botão **"Testar Banco de Exercícios"**. Ele roda uma esteira de validação sobre o banco todo (os exercícios publicados, com qualquer vínculo) e mostra o progresso e, no fim, o relatório.
- Antes de qualquer bateria, o ambiente é consolidado: carrega e executa o **snapshot do módulo** e, depois, o **snapshot do banco** (11.2). Só quando os dois terminam sem conflito as baterias começam; um conflito aqui encerra o teste com o motivo.

### 12.2. As três baterias

| Fase | Como roda | Para que serve |
| :--- | :--- | :--- |
| 1. Ordem linear | Os exercícios em sequência, do primeiro ao último, na mesma máquina, como a trilha | Confirma que o fluxo planejado roda sem falhas |
| 2. Ordem reversa | Do último ao primeiro | Revela dependências de estado que um exercício herdou de outro sem avisar |
| 3. Rodadas sorteadas | Sorteios de exercícios, cada rodada numa máquina nova, para simular uma prova sorteada | Mostra como o banco se comporta numa prova |

- **Amostragem das rodadas:** com mais de 10 exercícios, 5 rodadas; com até 10, o número de rodadas cai proporcionalmente, para não repetir sorteios (ver P-12). A semente do sorteio aparece no relatório, para repetir a rodada.

### 12.3. Dependências entre exercícios (substitui RN-11)

- A docente registra explicitamente que o exercício B **depende** do exercício A (ver P-13). Isso generaliza o "continua do anterior": o antecessor deixa de ser sempre o anterior da trilha. A máquina de B parte do snapshot do módulo, do snapshot do banco e da receita da cadeia (a solução de A, e a dos antecessores de A), na ordem.
- **Detecção:** quando um exercício falha na ordem reversa ou numa rodada sorteada, o sistema procura quem o resolve: refaz o exercício em máquina nova, depois da solução de cada outro exercício, e o primeiro que o faz passar é o suspeito. O relatório avisa: "O exercício [X] possui dependência do exercício [Y]", com o botão **Confirmar vínculo** (o sistema sugere, a docente decide; ver P-14).
- **Sorteio seguro:** um exercício que tem antecessor nunca é sorteado sozinho: o sorteio traz o antecessor (e os dele) na ordem certa e avisa que puxou o bloco encadeado (ver P-15). Vale para as rodadas do teste e para a prova sorteada.

### 12.4. Relatório final

Um sumário (modal) com: o estado geral (sucesso ou falhas); a lista dos exercícios que conflitam ou não se resolvem isolados; e a lista ou grafo das dependências, as confirmadas e as sugeridas, cada uma com o botão de confirmar ou descartar.

### 12.5. Critérios de aceite da revisão 3

- [ ] **CA-12** (evento): QUANDO a docente aciona "Testar Banco de Exercícios", O SISTEMA DEVE montar o snapshot do módulo e o do banco e, só então, rodar as três baterias.
- [ ] **CA-13** (evento): QUANDO o banco tem mais de 10 exercícios, O SISTEMA DEVE fazer 5 rodadas sorteadas, e com até 10, um número proporcionalmente menor (P-12).
- [ ] **CA-14** (indesejado): SE um exercício falha na ordem reversa ou sorteada e passa depois da solução de outro, ENTÃO O SISTEMA DEVE avisar que ele depende desse outro, e deixar a docente confirmar o vínculo.
- [ ] **CA-15** (estado): ENQUANTO um exercício tem antecessor, O SISTEMA NÃO DEVE sorteá-lo sem o antecessor: DEVE puxar a cadeia na ordem e avisar.
- [ ] **CA-16** (evento): QUANDO o teste termina, O SISTEMA DEVE mostrar o relatório com o estado geral, os conflitos e as dependências.

### 12.6. Decisões da revisão 3 (aprovadas pelo Tech Lead em 10/10/2026, as recomendações do rascunho)

| ID | Decisão |
| :--- | :--- |
| D-15 | Cada rodada sorteada traz metade do banco (arredondada para cima); as rodadas são `max(1, metade do número de exercícios)`, no máximo 5 |
| D-16 | Um exercício depende de **um** antecessor (forma uma cadeia); vários antecessores ficam para uma spec futura. A coluna `continues_previous` é trocada por `depends_on`, com a migração dos que já continuam do anterior |
| D-17 | O sistema só sugere a dependência encontrada; a docente a confirma ou descarta no relatório |
| D-18 | O sorteio de um exercício com antecessor puxa a cadeia na ordem e avisa, sem bloquear |
| D-19 | A esteira roda no navegador da docente, com o mesmo motor dos outros testes; a semente do sorteio vai no relatório |
| D-20 | Para o estudante, o servidor entrega a receita da cadeia de cada exercício da prática (`chainSetups`), já resolvida a partir de `depends_on`, em vez de o cliente deduzi-la da trilha |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 10/10/2026 | Implementador (Claude) | Criação do rascunho a partir do pedido do Tech Lead; decisões D-01 a D-03 tomadas por ele no mesmo dia; pendências P-01 a P-07 abertas |
| 10/10/2026 | Tech Lead | Aprovada, aceitas as recomendações de P-01 a P-07 (viram D-04 a D-10); seção 5 detalhada |
| 10/10/2026 | Implementador (Claude) | Implementada: migração 00016, banco de exercícios no backend (serviço, repositório, rotas, trilha, snapshots, autoria, versões), aba Exercícios do módulo e página do exercício, teste do módulo com o banco, entrega ao estudante com o cenário em camadas. Ajustes A-01 a A-08 |
| 10/10/2026 | Tech Lead | Pedido: exercícios em sequência (criar a pasta, depois o script dentro dela, depois rodar o script), como descrito no TCC (herança de cenários). Incluídos RN-11, CA-11, a coluna `continues_previous` e o ajuste A-09 |
| 10/10/2026 | Tech Lead | Pedido de revisão 2: banco central de exercícios com blocos de vinculação (adicionar do banco, remover do bloco, criar já vinculando, exclusivo da avaliação) e snapshot único da base de exercícios. Spec volta a Rascunho com as pendências P-08 a P-11 |
| 10/10/2026 | Tech Lead | Pedido de revisão 3: "Testar Banco de Exercícios" (preparo por snapshots, ordem linear, reversa e sorteada), dependências explícitas entre exercícios e sorteio seguro. Pendências P-12 a P-16 |
| 10/10/2026 | Tech Lead | Aprovadas as revisões 2 e 3, aceitas as recomendações de P-08 a P-16 (viram D-11 a D-19); acrescentada a decisão D-20 |
| 10/10/2026 | Implementador (Claude) | Implementadas as revisões 2 e 3: migração 00018, vínculos e dependências no backend, aba Exercícios como banco central com blocos de vínculo, snapshot único, Testar Banco de Exercícios com relatório, e carga dos 50 exercícios de História do Linux. Ajustes A-10 a A-17 |
