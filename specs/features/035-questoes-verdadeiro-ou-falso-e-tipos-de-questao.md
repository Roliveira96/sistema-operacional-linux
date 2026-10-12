# SPEC-035: Questões de Verdadeiro ou Falso e Tipos de Questão no Banco

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-035 |
| **Status** | Rascunho |
| **Data de criação** | 11/10/2026 |
| **Última revisão** | 11/10/2026 |
| **Autor** | Implementador (Claude), a pedido do Tech Lead |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `content` (questões, banco do módulo, correção) e `practice` (progresso); aba Exercícios da edição do módulo, página da questão e tela de estudo |
| **Contexto de tela** | `/app/modules/[id]/edit?tab=exercises`, página da questão do banco, aba "Desafios" de `/app/modules/[id]` e `/materials/[id]` |
| **Prioridade** | Alta |
| **Depende de** | SPEC-011, SPEC-012, SPEC-014, SPEC-016, SPEC-019, SPEC-023, SPEC-025 |
| **Substitui** | Item "Questões teóricas (escolha, verdadeiro/falso, dissertativa) no banco" do Fora de escopo da SPEC-023 |
| **Fontes canônicas** | Pedido do Tech Lead de 11/10/2026, a partir do retorno das docentes; `docs/arquitetura/transicao-backend.md` (questão teórica: escolha única, múltipla seleção, booleana ou dissertativa, com terminal bloqueado) |

---

## 1. Contexto e Problema (Context & Problem Statement)

As docentes avaliaram a plataforma e apontaram que o **banco de exercícios do módulo** (SPEC-023) só aceita questões do tipo **comando Linux** (`PRACTICAL`): a docente grava a solução no terminal, define as condições de finalização e o estudante resolve no terminal. Não há como cadastrar uma questão conceitual simples, como "O comando `rm -r` remove diretórios não vazios. Verdadeiro ou falso?".

O schema já prevê outros tipos em `questions.kind` (`THEORETICAL_SINGLE`, `THEORETICAL_MULTIPLE`, `THEORETICAL_BOOLEAN`, `DISCURSIVE`, SPEC-011), e a carga inicial trouxe 30 questões de escolha única para os simulados, mas nenhuma tela cria, edita, entrega ou corrige uma questão que não seja prática.

O Tech Lead pediu:

- poder criar questões de **verdadeiro ou falso** no banco;
- deixar o banco preparado para **outros tipos**, que virão em specs seguintes;
- a questão tem **título**, **descrição** (que pode ter imagens) e **dicas**, como as práticas;
- no **exercício**, o estudante vê o resultado **na hora** em que clica na resposta, porque não vale nota;
- na **avaliação**, o estudante **não** vê o resultado na hora: pode ter clicado errado sem querer, então a resposta só é corrigida quando ele **finaliza a prova**.

## 2. Objetivos (Goals)

- O banco de exercícios do módulo passa a guardar questões de **mais de um tipo**. Nesta spec: **Comando Linux** (o `PRACTICAL` que já existe) e **Verdadeiro ou falso** (`THEORETICAL_BOOLEAN`).
- A docente escolhe o tipo ao criar a questão; o formulário mostra só os campos daquele tipo.
- A questão de verdadeiro ou falso tem título, nível, descrição com imagens, dicas, a resposta correta e uma justificativa opcional.
- O estudante responde a questão de verdadeiro ou falso na aba "Desafios", na ordem da trilha, junto com as práticas, e vê o resultado na hora.
- Fica definida a **regra de retorno por contexto**, que vale para todo tipo de questão que não é corrigido pelo terminal: imediato no exercício, só no fim na avaliação.
- O código passa a tratar cada tipo de questão por um contrato único (validar, entregar sem gabarito, corrigir), para que um tipo novo entre sem mexer nos demais.

### 2.1. Fora de escopo (Non-Goals)

- Os outros tipos teóricos (escolha única, múltipla seleção, dissertativa e "julgue os itens"): cada um terá spec própria, sobre o contrato desta.
- Aplicação de provas: tela da prova, tentativa, cronômetro, código de sala, gravação das respostas durante a prova e nota (spec de avaliação). Esta spec só define a regra que ela DEVE seguir (RN-07) e entrega a correção do tipo no servidor.
- Questões de verdadeiro ou falso nos **exercícios do card** (SPEC-022): continuam só práticos.
- Edição pela interface das 30 questões de escolha única da carga inicial.
- Banco compartilhado entre módulos (continua por módulo, SPEC-023 D-02).
- Edição de imagem no navegador (SPEC-025 já exclui).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Banco de exercícios (aba Exercícios da edição do módulo):**

- Rótulo da aba e do banco passam a falar em **questões** (ver P-11): "Banco de questões do módulo".
- Cada linha mostra a etiqueta do tipo ("Comando Linux" ou "Verdadeiro ou falso"), ao lado das etiquetas de vínculo que já existem.
- O filtro do banco ganha **tipo**, além de vínculo, nível e publicação.
- "Criar nova questão" (no cabeçalho do banco e no "Adicionar do Banco" dos blocos) pergunta primeiro o tipo, num seletor com os tipos disponíveis e uma linha de explicação de cada um. Depois abre a página da questão daquele tipo, mantendo o `?link=` da SPEC-023 A-14.
- O "Testar Banco de Exercícios" lista as questões de verdadeiro ou falso no relatório como "não usa o terminal" e confere só se estão completas (RN-09).

**Página da questão de verdadeiro ou falso** (mesmo layout da página do exercício do módulo, sem as partes de terminal):

| Campo | Comportamento |
| :--- | :--- |
| Título | Obrigatório |
| Nível | Fácil, médio ou difícil |
| Descrição | `RichTextEditor` com um botão novo de **inserir imagem**, que envia o arquivo pela rota da SPEC-025 e insere a imagem no texto, com texto alternativo |
| Dicas | O mesmo editor de dicas das práticas (texto e comando opcional), até 10 |
| Resposta correta | Duas opções, "Verdadeiro" e "Falso"; nenhuma marcada ao criar |
| Justificativa | Texto rico opcional, mostrado ao estudante depois que ele responde (P-03) |

Não aparecem solução gravada, condições de finalização, ambiente nem "depende de". O ícone "i" explica cada campo, como no resto da edição.

**Estudante, aba "Desafios":**

- A questão de verdadeiro ou falso aparece na posição dela na trilha, com o mesmo círculo de status. No lugar de "Iniciar", mostra a descrição e dois botões grandes, **Verdadeiro** e **Falso**, operáveis por teclado.
- Ao clicar, o frontend envia a resposta ao servidor e mostra na hora: acertou ou errou, qual era a resposta correta e a justificativa, se houver (RN-06).
- Depois de responder, os botões ficam travados, com a escolha e o resultado destacados, e aparece **"Responder de novo"**, que limpa a tela para outra tentativa (P-02).
- As dicas abrem sob demanda, como nas práticas.
- A questão de verdadeiro ou falso não depende da máquina: não entra na conferência automática depois de cada comando, e "Reset Máquina" não a afeta.
- Visitantes veem a questão e podem clicar, mas o resultado pede login, como a conferência das práticas (SPEC-014 CA-07).

**Componente de resposta:** um componente único de resposta de verdadeiro ou falso, com dois modos:

- **exercício:** envia ao clicar e mostra o resultado;
- **avaliação:** só marca a escolha, permite trocar quantas vezes quiser e não mostra resultado (RN-07).

Esta spec usa só o modo exercício na tela; o modo avaliação é entregue e testado para a spec de avaliação reaproveitá-lo.

Textos em `frontend/src/messages/`, tokens da SPEC-015, nenhum valor de cor fixo.

### 3.2. Backend (Go — Camada de Módulo/Service)

Módulo `content` (banco e correção) e `practice` (progresso), sem módulo novo.

- **RN-01 (tipos do banco):** o banco do módulo aceita os tipos `PRACTICAL` e `THEORETICAL_BOOLEAN`. Os demais valores de `kind` continuam no schema, mas são recusados na criação pelo banco até terem spec própria.
- **RN-02 (contrato do tipo):** cada tipo de questão implementa, no domínio, um contrato com três responsabilidades: validar os campos de autoria do tipo, montar a versão pública da questão (sem gabarito) e corrigir uma resposta. O service escolhe o contrato pelo `kind`; um tipo novo é um contrato novo registrado, sem `if` por tipo espalhado pelo service.
- **RN-03 (campos por tipo):** a questão de verdadeiro ou falso exige `title` e `difficulty`; aceita `statement`, `hints` e `explanation`; guarda a resposta correta em `answer_key`. Ela recusa `solution`, `conditions` e `dependsOn` (erro de validação). A prática continua com as regras da SPEC-023.
- **RN-04 (publicar):** publicar uma questão de verdadeiro ou falso exige descrição não vazia e resposta correta definida, assim como a prática exige pelo menos uma condição (SPEC-023 A-03).
- **RN-05 (vínculos):** a questão de verdadeiro ou falso tem os mesmos vínculos da prática (`practice`, `assessment`, `exclusive`) e entra na trilha da mesma forma. Ela não participa de dependências: não pode ter antecessor nem ser antecessora.
- **RN-06 (retorno no exercício):** a rota de conferência recebe a resposta do estudante a uma questão de verdadeiro ou falso vinculada à prática e publicada, corrige no servidor e devolve se acertou, a resposta correta e a justificativa. O gabarito só sai **depois** da resposta e só nessa rota.
- **RN-07 (retorno na avaliação):** em avaliação, nenhuma rota devolve acerto, resposta correta ou justificativa de questão não terminal antes de o estudante finalizar a tentativa (ou de ela ser encerrada). Até lá, a última escolha gravada substitui as anteriores. A correção acontece no servidor, na finalização. **Esta regra é obrigatória para a spec de avaliação**, que vai implementá-la.
- **RN-08 (progresso):** cada resposta de estudante autenticado conta uma tentativa em `exercise_progress`; a primeira resposta certa grava `completed_at`, que respostas posteriores não apagam (mesma regra da SPEC-014 RN-03).
- **RN-09 (teste do banco e do módulo):** as baterias do "Testar Banco de Exercícios" e o "Testar o módulo" rodam só as práticas. A questão de verdadeiro ou falso é conferida apenas quanto a estar completa (RN-04); se não estiver, aparece como falha no relatório.
- **RN-10 (sem gabarito para o estudante):** a lista de questões do estudante (`/modules/{id}/exercises`) traz o `kind` de cada uma e, para verdadeiro ou falso, nunca traz `answer_key` nem `explanation` (SPEC-012 RN-02).
- **RN-11 (imagens da descrição):** as imagens são enviadas pela rota da SPEC-025 e entram no HTML da descrição; o sanitizador aceita só `<img>` com o endereço no formato gerado pelo sistema (SPEC-025 A-01) e texto alternativo.
- **RN-12 (autoria):** só a docente dona do módulo e o administrador criam, alteram e removem questões do banco, com registro de quem e quando (SPEC-023 RN-02 e RN-08).

## 4. Modelo de Dados (Data Model)

Nenhuma tabela nova. A tabela `questions` já tem os campos necessários (SPEC-011 e SPEC-023); muda só o que eles guardam para o tipo novo.

| Campo de `questions` | Uso na questão de verdadeiro ou falso |
| :--- | :--- |
| `kind` | `THEORETICAL_BOOLEAN` |
| `title`, `difficulty`, `status`, `statement`, `hints` | Como na prática |
| `answer_key` | Objeto com o campo `correct` (booleano). Obrigatório para publicar |
| `explanation` | Justificativa, HTML sanitizado, opcional |
| `choices` | Nulo (os rótulos "Verdadeiro" e "Falso" ficam nas mensagens da interface) |
| `scenario_id`, `reference_solution`, `validation_conditions`, `end_conditions`, `depends_on` | Sempre nulos |
| `in_assessment`, `exclusive_assessment` | Como na prática |

Restrição nova no banco: `depends_on` nulo quando `kind` não é `PRACTICAL`. Valores de `kind` aceitos pelo banco do módulo: `PRACTICAL` e `THEORETICAL_BOOLEAN` (regra do service, RN-01; o enum do schema não muda).

`exercise_progress` não muda: `attempts`, `last_passed` e `completed_at` valem para os dois tipos.

## 5. Contrato de API (API Contract)

### 5.1. Banco do módulo (alteração da SPEC-023)

**`POST /api/v1/teacher/modules/{id}/exercises`** e **`PUT /api/v1/teacher/modules/{id}/exercises/{exerciseId}`**: campos novos no corpo.

| Campo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| `kind` | texto | Não no `POST` (padrão `PRACTICAL`); não pode mudar no `PUT` | `PRACTICAL` ou `THEORETICAL_BOOLEAN` |
| `correctAnswer` | booleano ou nulo | Não | Só em `THEORETICAL_BOOLEAN`; obrigatório para publicar |
| `explanation` | HTML | Não | Só em `THEORETICAL_BOOLEAN`; sanitizado; até 20 mil caracteres |

Os demais campos seguem a SPEC-023; em `THEORETICAL_BOOLEAN`, `solution`, `conditions` e `dependsOn` presentes geram erro.

**`GET /api/v1/teacher/modules/{id}/exercises`** e **`GET .../exercises/{exerciseId}`**: a resposta passa a trazer `kind`, e as de verdadeiro ou falso trazem `correctAnswer` e `explanation`. A listagem aceita o filtro de query `kind`.

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 400 | `validation-error` | Tipo não aceito pelo banco, troca de tipo no `PUT`, campo de outro tipo, publicar sem resposta correta ou sem descrição |

Os demais erros seguem a SPEC-023.

### 5.2. Estudante

**`GET /api/v1/modules/{id}/exercises`**: cada item ganha `kind`. Itens `THEORETICAL_BOOLEAN` trazem `id`, `title`, `difficulty`, `statement` e `hints`, sem gabarito, sem justificativa e sem camadas de máquina.

**`POST /api/v1/questions/{id}/check`** (SPEC-014): o corpo passa a depender do tipo.

| Campo do corpo | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `snapshot` | objeto | Sim em `PRACTICAL` | Como na SPEC-014 |
| `response` | objeto | Sim em `THEORETICAL_BOOLEAN` | Campo `value` (booleano) com a escolha do estudante |

| Campo da resposta | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `passed` | booleano | Sim | Acertou |
| `completedAt` | instante ou nulo | Sim | Primeira resposta certa |
| `correctAnswer` | booleano | Só em `THEORETICAL_BOOLEAN` | Resposta correta, revelada depois da resposta |
| `explanation` | HTML ou nulo | Só em `THEORETICAL_BOOLEAN` | Justificativa |

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 400 | `validation-error` | `response` ausente ou `value` não booleano numa questão de verdadeiro ou falso |
| 401 | `not-authenticated` | Sem sessão |
| 403 | `forbidden` | Sem acesso ao módulo |
| 404 | `question-not-found` | Questão inexistente, não publicada, sem vínculo `practice` ou exclusiva da avaliação |
| 429 | `rate-limited` | Limite da SPEC-014 excedido |

A conferência em lote da SPEC-016 continua só com as práticas.

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| :--- | :--- |
| Gabarito vazando ao estudante antes da resposta | RN-10 e teste de que a lista pública nunca traz `answer_key` nem `explanation`; o gabarito só sai na resposta da conferência (RN-06) |
| Estudante "chuta" as duas opções no exercício | Aceito: o exercício não vale nota. O progresso registra as tentativas (RN-08) |
| Estudante descobre a resposta de uma questão de avaliação treinando no exercício | Vínculo `exclusive` já existe (SPEC-023 D-12): questão exclusiva da avaliação nunca vai à prática (404 na conferência) |
| Imagem de questão de avaliação é pública no bucket | O nome é o SHA-256 do arquivo (SPEC-025 D-03), impossível de adivinhar; risco aceito, revisável na spec de avaliação |
| Código do banco, do teste do banco e da tela de prática supõe que toda questão tem terminal | RN-02 (contrato por tipo) e RN-09; testes que misturam os dois tipos na trilha, no teste do banco e na tela do estudante |
| `RichTextEditor` sem imagem hoje | Botão novo que reaproveita o envio da SPEC-025; o sanitizador já aceita o formato de endereço do bucket |
| Spec de avaliação ignorar o retorno adiado | RN-07 registrada como obrigação; o modo avaliação do componente já nasce testado |

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente aciona "Criar nova questão", O SISTEMA DEVE pedir o tipo (Comando Linux ou Verdadeiro ou falso) e abrir a página do tipo escolhido.
- [ ] **CA-02** (ubíquo): A página da questão de verdadeiro ou falso DEVE ter título, nível, descrição com imagens, dicas, resposta correta e justificativa, e NÃO DEVE mostrar solução gravada, condições, ambiente nem dependência.
- [ ] **CA-03** (evento): QUANDO a docente insere uma imagem na descrição, O SISTEMA DEVE enviá-la pela rota da SPEC-025 e mostrá-la no texto, para a docente e para o estudante.
- [ ] **CA-04** (indesejado): SE a docente tenta publicar uma questão de verdadeiro ou falso sem resposta correta ou sem descrição, ENTÃO O SISTEMA DEVE recusar com o motivo (RN-04).
- [ ] **CA-05** (indesejado): SE a requisição traz `solution`, `conditions` ou `dependsOn` para uma questão de verdadeiro ou falso, ou um tipo não aceito pelo banco, ENTÃO O SISTEMA DEVE responder 400 (RN-01, RN-03).
- [ ] **CA-06** (ubíquo): O banco DEVE mostrar a etiqueta do tipo em cada questão e permitir filtrar por tipo.
- [ ] **CA-07** (estado): ENQUANTO uma questão de verdadeiro ou falso está publicada e vinculada à prática, O SISTEMA DEVE mostrá-la na aba "Desafios" na posição da trilha, com os botões Verdadeiro e Falso.
- [ ] **CA-08** (ubíquo): A lista de questões do estudante NÃO DEVE conter a resposta correta nem a justificativa das questões de verdadeiro ou falso (RN-10).
- [ ] **CA-09** (evento): QUANDO o estudante clica numa resposta no exercício, O SISTEMA DEVE corrigir no servidor e mostrar na hora se acertou, a resposta correta e a justificativa (RN-06).
- [ ] **CA-10** (evento): QUANDO o estudante acerta pela primeira vez, O SISTEMA DEVE gravar `completed_at` e marcar a questão como concluída; uma resposta errada depois NÃO DEVE apagar a conclusão (RN-08).
- [ ] **CA-11** (estado): ENQUANTO o componente de resposta está no modo avaliação, O SISTEMA DEVE permitir trocar a escolha e NÃO DEVE mostrar acerto, resposta correta nem justificativa (RN-07).
- [ ] **CA-12** (indesejado): SE a questão é exclusiva da avaliação, não publicada ou sem vínculo com a prática, ENTÃO a conferência DEVE responder 404.
- [ ] **CA-13** (evento): QUANDO a docente roda o "Testar Banco de Exercícios" ou o "Testar o módulo" com questões dos dois tipos, O SISTEMA DEVE rodar as baterias só com as práticas e mostrar as de verdadeiro ou falso como "não usa o terminal", com falha se estiverem incompletas (RN-09).
- [ ] **CA-14** (evento): QUANDO o estudante executa comandos ou reinicia a máquina, O SISTEMA NÃO DEVE alterar o estado das questões de verdadeiro ou falso.
- [ ] **CA-15** (indesejado): SE um visitante clica numa resposta, ENTÃO a interface DEVE pedir login e a API DEVE responder 401.
- [ ] **CA-16** (ubíquo): A escolha da resposta DEVE ser operável só pelo teclado, e as telas DEVEM usar só tokens de `_tokens.scss`.

## 8. Plano de Testes (Test Plan)

- **Domínio (Go):** contrato do tipo verdadeiro ou falso: validação (campos proibidos, publicar sem resposta ou sem descrição), versão pública sem gabarito e correção (certo e errado) (CA-04, CA-05, CA-08, CA-09); registro de tipos recusando os não aceitos (CA-05).
- **Service (Go, com fakes):** criar, salvar, publicar e vincular questão de verdadeiro ou falso; recusa de dependência; conferência com progresso e preservação da primeira resposta certa (CA-04, CA-05, CA-09, CA-10, CA-12).
- **Handler (Go, `httptest`):** corpos e erros das rotas 5.1 e 5.2, incluindo 400, 401, 404 e a ausência do gabarito na lista pública (CA-05, CA-08, CA-12, CA-15).
- **Repository (PostgreSQL real):** gravação e leitura de `answer_key` e `explanation`; restrição de `depends_on` só para práticas; filtro por tipo.
- **Frontend (Vitest e Testing Library):** seletor de tipo (CA-01); página da questão (CA-02); inserção de imagem com o serviço simulado (CA-03); etiqueta e filtro no banco (CA-06); aba "Desafios" com os dois tipos misturados (CA-07, CA-14); componente de resposta nos dois modos, por clique e por teclado (CA-09, CA-11, CA-16); pedido de login para visitante (CA-15); relatório do teste do banco com os dois tipos (CA-13).
- **Manual:** criar uma questão de verdadeiro ou falso com imagem, vinculá-la à prática, responder como estudante (certo e errado) e conferir o selo de concluído; rodar o "Testar Banco de Exercícios" com ela no banco.
- **Cobertura:** acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-011, 012, 014, 016, 022, 023 e 025; no código, `backend/internal/modules/content/domain/entities.go`, `content/service/exercises.go`, `content/service/reader.go`, `practice/service/service.go`, `frontend/src/components/ExerciseForm/`, `ModuleExercises/`, `TopicStudy/ChallengePanel.tsx`, `RichTextEditor/` e `frontend/src/services/contentService.ts` e `practiceService.ts`.
2. **Ordem de execução:** (1) contrato de tipo no domínio e o tipo verdadeiro ou falso; (2) migração da restrição de `depends_on`; (3) service e handler do banco (5.1); (4) conferência e progresso (5.2); (5) lista pública com `kind`; (6) teste do banco e do módulo; (7) serviços do frontend; (8) seletor de tipo, página da questão e imagem no `RichTextEditor`; (9) componente de resposta e aba "Desafios"; (10) glossário e esta spec.
3. **Arquivos e diretórios a criar ou alterar:** a definir na aprovação, depois de resolvidas as pendências.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, glossário atualizado e status `Implementada`.

## 10. Pendências para aprovação

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| P-01 | Formato da questão: **uma afirmação** com Verdadeiro e Falso, ou **várias afirmações**, cada uma julgada V ou F ("julgue os itens") | Uma afirmação por questão. "Julgue os itens" vira um tipo próprio numa spec futura, sobre o mesmo contrato (RN-02) |
| P-02 | No exercício, depois de responder, o estudante pode responder de novo? | Sim, com "Responder de novo". Não vale nota; o progresso guarda as tentativas e a primeira resposta certa (RN-08) |
| P-03 | Mostrar a resposta correta e uma justificativa escrita pela docente depois da resposta | Sim: resposta correta sempre, justificativa quando preenchida. Na avaliação, as duas só aparecem no resultado, depois de finalizar |
| P-04 | Dicas na avaliação: o estudante pode abri-las durante a prova? | Decidir na spec de avaliação (pode valer para todos os tipos, inclusive as práticas). Nesta spec, dicas só aparecem no exercício |
| P-05 | Onde a questão aparece para o estudante | Na aba "Desafios", na ordem da trilha, misturada com as práticas, sem terminal |
| P-06 | A aplicação de provas ainda não existe. Até onde vai esta spec na parte de avaliação? | Definir a regra (RN-07) como obrigação da spec de avaliação, entregar a correção do tipo no servidor e o modo avaliação do componente, testados. A tela da prova e a gravação das respostas ficam na spec de avaliação |
| P-07 | Verdadeiro ou falso também nos exercícios do card (SPEC-022)? | Não nesta spec; só no banco do módulo |
| P-08 | Como o "Testar Banco de Exercícios" e o "Testar o módulo" tratam a questão sem terminal | Fora das baterias; conferida só quanto a estar completa e listada como "não usa o terminal" (RN-09) |
| P-09 | Imagens da descrição | Reaproveitar o envio da SPEC-025 (AVIF, bucket, nome por conteúdo) com um botão de imagem no `RichTextEditor`; vale também para a descrição das práticas, que usa o mesmo editor |
| P-10 | Nome do tipo no código e no glossário | Reaproveitar `THEORETICAL_BOOLEAN`, que já está no enum, com o rótulo "Verdadeiro ou falso"; o tipo prático aparece como "Comando Linux". Entram no glossário: "Tipo de questão" (`QuestionKind`), "Questão de verdadeiro ou falso" (`THEORETICAL_BOOLEAN`), "Resposta do estudante" (`response`) e "Justificativa" (`explanation`) |
| P-11 | Renomear na interface "Banco de exercícios" para "Banco de questões", já que ele passa a ter tipos que não são exercício de terminal | Sim, só os textos da interface; os nomes no código (`ModuleExerciseBank`, rotas `/exercises`) ficam como estão, para não quebrar a SPEC-023 e o servidor MCP (SPEC-024) |
| P-12 | O servidor MCP da SPEC-024 deve criar questões de verdadeiro ou falso? | Não nesta spec; fica para uma revisão da SPEC-024 |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 11/10/2026 | Implementador (Claude) | Criação do rascunho a partir do pedido do Tech Lead (retorno das docentes: o banco só aceita comando Linux; criar verdadeiro ou falso, com retorno imediato no exercício e só no fim na avaliação; título, descrição com imagens e dicas; outros tipos virão). Pendências P-01 a P-12 |
