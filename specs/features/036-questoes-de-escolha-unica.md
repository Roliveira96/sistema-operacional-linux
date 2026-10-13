# SPEC-036: Questões de Escolha Única

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-036 |
| **Status** | Implementada |
| **Data de criação** | 11/10/2026 |
| **Última revisão** | 12/10/2026 (decisões D-01 a D-06, sem pendências) |
| **Autor** | Implementador (Claude), a pedido do Tech Lead |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `content` (questões, banco do módulo, bloco `EXERCISES`, correção), `practice` (progresso) e `mcp` (ferramentas de autoria) |
| **Contexto de tela** | `/app/modules/[id]/edit?tab=exercises`, página da questão do banco, aba Exercícios do card, aba "Desafios" e exercícios do card na tela de estudo |
| **Prioridade** | Alta |
| **Depende de** | SPEC-011, SPEC-022, SPEC-023, SPEC-024, SPEC-025, SPEC-035 |
| **Substitui** | Nenhuma. Amplia a lista de tipos aceitos pelo banco (SPEC-035 RN-01) |
| **Fontes canônicas** | Pedido do Tech Lead de 11/10/2026; `docs/arquitetura/transicao-backend.md` (questão teórica de escolha única); SPEC-035 (contrato de tipo de questão) |

---

## 1. Contexto e Problema (Context & Problem Statement)

A SPEC-035 trouxe ao banco de questões do módulo o primeiro tipo sem terminal, o verdadeiro ou falso, e um contrato que deixa entrar outros tipos sem mexer nos que já existem. O Tech Lead pediu o próximo tipo: a **escolha única**, em que a docente escreve de **2 a 7 alternativas**, marca **uma correta** e as demais ficam erradas.

O tipo `THEORETICAL_SINGLE` já existe no schema, e a carga inicial trouxe 30 questões dele no módulo de simulados (alternativas como lista de textos e gabarito como posição), mas nenhuma tela cria, edita, entrega ou corrige uma questão de escolha única, e o banco do módulo ainda a recusa (SPEC-035 RN-01).

O pedido do Tech Lead:

- de 2 a 7 alternativas: 1 certa e de 1 a 6 erradas;
- nível de dificuldade, dicas e descrição com imagens, como as demais;
- o mesmo comportamento do verdadeiro ou falso: no **exercício** a resposta trava e o resultado aparece na hora; na **avaliação** o aluno muda a escolha quando quiser e a correção só acontece ao finalizar;
- a resposta é animada para o aluno (SPEC-035 D-15).

## 2. Objetivos (Goals)

- O banco de questões do módulo e os exercícios do card passam a aceitar a **escolha única**, além de Comando Linux e Verdadeiro ou falso.
- A docente escreve as alternativas, marca a correta e, se quiser, uma justificativa.
- O aluno responde no exercício com uma escolha, travada, e vê na hora se acertou, qual era a correta e a justificativa.
- O componente de resposta ganha o modo avaliação da escolha única, com troca livre e sem resultado, para a spec de avaliação reaproveitar.
- O novo tipo entra pelo contrato da SPEC-035 (RN-02), sem regra espalhada por tipo.

### 2.1. Fora de escopo (Non-Goals)

- Múltipla seleção (mais de uma correta), dissertativa e ligar colunas (spec própria, na sequência).
- Aplicação de provas (spec de avaliação), que DEVE seguir as regras SPEC-035 RN-07 e RN-13 também para este tipo.
- Pontuação parcial: a escolha única vale tudo ou nada.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Autoria (banco e card):**

- O seletor de tipo (SPEC-035 CA-01, CA-18) passa a oferecer "Escolha única", com a explicação de uma linha.
- A página da questão de escolha única tem título, nível, descrição com imagens, dicas, **alternativas** e justificativa.
- **Alternativas:**
  - nasce com 2 alternativas vazias;
  - o botão "+ Adicionar alternativa" vai até 7;
  - cada alternativa tem o texto, o marcador "Correta" (um só em toda a lista, como um botão de rádio) e os botões subir, descer e remover;
  - remover fica bloqueado quando restam 2.
- **Prévia:** mostra a questão como o aluno vê.
- **Banco:** a etiqueta e o filtro por tipo incluem "Escolha única".
- **Lista do banco e do card:** mostram a quantidade de alternativas e se a correta está marcada.
- **Testes:** o "Testar Banco de Exercícios", o "Testar o módulo" e o "Testar comandos" do card não rodam nada para ela. Só conferem se está completa (SPEC-035 RN-09).

**Aluno (aba "Desafios" e exercício do card):**

- A questão aparece na ordem da trilha, com a descrição e as alternativas como botões grandes, operáveis por teclado.
- Ao escolher, o resultado aparece na hora com a animação da SPEC-035 D-15:
  - a alternativa escolhida fica marcada como certa ou errada;
  - a correta aparece destacada;
  - a justificativa aparece, se houver.
- A resposta trava (SPEC-035 D-02) e continua travada ao recarregar a página.
- A professora escolhe, em cada questão, entre **embaralhar as alternativas** (o padrão) ou **manter a ordem** em que as escreveu (D-07). Embaralhadas, elas aparecem numa ordem diferente a cada vez que a questão é exibida, para o aluno não decorar a posição (D-03). A correta é reconhecida pelo identificador, então embaralhar não muda o resultado nem a resposta travada.

**Componente de resposta:**

- Componente de escolha única com os dois modos da SPEC-035: exercício e avaliação.
- Os textos da interface ficam nos arquivos de mensagens.
- Usa os tokens da SPEC-015.

### 3.2. Backend (Go — Camada de Módulo/Service)

- **RN-01 (tipo aceito):** o banco do módulo e os exercícios do card aceitam `THEORETICAL_SINGLE`, registrado no contrato de tipos da SPEC-035.
- **RN-02 (alternativas):** de 2 a 7 alternativas.
  - Cada uma tem um identificador estável e um conteúdo obrigatório em HTML, escrito no mesmo editor de texto das descrições: texto, formatação, comandos e imagens (D-02). O servidor filtra o HTML como as descrições (SPEC-019, SPEC-025) e aceita até 5.000 caracteres por alternativa.
  - O gabarito aponta para o identificador da alternativa correta, não para a posição. Assim, reordenar e embaralhar não muda a correta (P-01).
- **RN-03 (campos por tipo):**
  - exige `title` e `difficulty`;
  - aceita `statement`, `hints`, `choices`, `correctChoice` e `explanation`;
  - recusa `solution`, `conditions`, `dependsOn` e `correctAnswer` (o campo do verdadeiro ou falso).
- **RN-04 (publicar):** publicar exige:
  - descrição não vazia;
  - de 2 a 7 alternativas com texto;
  - nenhuma alternativa vazia (sem texto nem imagem) ou repetida, comparando o texto sem as marcações, sem diferenciar maiúsculas e espaços nas pontas;
  - a correta marcada entre elas.
- **RN-05 (correção no exercício):** a rota de conferência (SPEC-035 5.2) recebe o identificador escolhido, corrige no servidor e devolve:
  - se acertou;
  - o identificador da correta;
  - a justificativa.

  O gabarito só sai depois da resposta.
- **RN-06 (resposta única):** a primeira resposta é definitiva e gravada em `exercise_progress.response`; a segunda recebe 409. A questão conta como concluída ao ser respondida (SPEC-035 RN-08, D-13).
- **RN-07 (sem gabarito para o aluno):** a lista de questões do aluno traz as alternativas, com identificador e conteúdo, embaralhadas pelo servidor quando a questão pede (D-03, D-07) ou na ordem da professora, e nunca a correta nem a justificativa.
- **RN-12 (ordem das alternativas):** cada questão de escolha única tem a opção `shuffleChoices` (padrão verdadeiro). No card, a tela embaralha ao exibir quando o item pede.
- **RN-08 (avaliação):** valem SPEC-035 RN-07 (troca livre até finalizar, correção no servidor ao finalizar) e RN-13 (dicas na prova).
- **RN-09 (exercício do card):** o item do bloco `EXERCISES` aceita o tipo com os mesmos campos e limites. Como o verdadeiro ou falso do card, é conferido na tela, e a trava fica no navegador (SPEC-035 D-14).
- **RN-10 (MCP):** as ferramentas aceitam o tipo, com `choices` e `correctChoice` (SPEC-035 RN-15).
- **RN-11 (questões da carga inicial):** uma migração converte as 30 questões de escolha única da carga inicial para o formato novo: gera o identificador de cada alternativa, guarda o texto como conteúdo da alternativa e aponta o gabarito para a mesma alternativa que era a correta. Depois disso elas são editáveis no banco do módulo de simulados (D-04).

## 4. Modelo de Dados (Data Model)

Nenhuma tabela nova. Campos de `questions` para `THEORETICAL_SINGLE`:

| Campo | Uso |
| :--- | :--- |
| `choices` | Lista de 2 a 7 alternativas, cada uma com `id` (texto curto gerado na criação, estável) e `html` (o conteúdo, filtrado) |
| `answer_key` | Objeto com `correct` = `id` da alternativa correta; obrigatório para publicar |
| `explanation`, `hints`, `statement`, `title`, `difficulty` | Como no verdadeiro ou falso |
| `scenario_id`, `reference_solution`, `validation_conditions`, `end_conditions`, `depends_on` | Sempre nulos |

A restrição `questions_objective_fields` (SPEC-035 A-02) passa a exigir, para `THEORETICAL_SINGLE` publicada, alternativas e gabarito; um rascunho pode não ter gabarito.

`questions` ganha a coluna `shuffle_choices` (booleano, obrigatório, padrão verdadeiro): embaralhar as alternativas para o aluno (D-07). As questões convertidas da carga inicial ficam com o padrão.

`exercise_progress.response` guarda `{ "choice": "<id>" }`.

No bloco `EXERCISES`, o item ganha `choices`, `correctChoice` e `shuffleChoices` (padrão verdadeiro), só para este tipo.

## 5. Contrato de API (API Contract)

### 5.1. Banco do módulo

**`POST` e `PUT /api/v1/teacher/modules/{id}/exercises[/{exerciseId}]`**: aceitam `kind = THEORETICAL_SINGLE` e os campos abaixo.

| Campo | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `choices` | lista de { `id`, `html` } | Para publicar | De 2 a 7. Uma alternativa sem `id` ganha um no servidor. HTML filtrado, até 5.000 caracteres, com texto ou imagem |
| `correctChoice` | texto ou nulo | Para publicar | `id` de uma das alternativas |
| `shuffleChoices` | booleano | Não | Padrão verdadeiro: embaralha as alternativas para o aluno; falso mantém a ordem da professora (D-07) |
| `explanation` | HTML | Não | Como no verdadeiro ou falso |

A resposta traz os mesmos campos. Erros: 400 `validation-error` com o campo (`choices[2].text`, `correctChoice`...).

### 5.2. Aluno

- **`GET /api/v1/modules/{id}/questions`:** os itens de escolha única trazem `choices` com `id` e `html`, embaralhadas, sem gabarito.
- **`POST /api/v1/questions/{id}/check`:**
  - corpo: `response` = { `choice`: `<id>` };
  - resposta: `passed`, `completedAt`, `correctChoice` e `explanation`;
  - 400 se o `id` não for de uma das alternativas;
  - 409 `already-answered` na segunda resposta.
- **`GET /api/v1/modules/{id}/progress`:** as respondidas trazem `response`, `passed`, `correctChoice` e `explanation`.

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| :--- | :--- |
| Gabarito vazando antes da resposta | RN-07 e teste de que a lista pública nunca traz a correta |
| Reordenar ou embaralhar mudando a correta | Gabarito por identificador estável (RN-02) |
| As 30 questões da carga inicial em outro formato | Migração para o formato novo (D-04), com teste que confere que a correta continua a mesma |
| HTML e imagens dentro das alternativas | Mesmo filtro de HTML das descrições, no servidor; as imagens só pelo envio da SPEC-025 |
| Gabarito do card visível no navegador | Aceito como no verdadeiro ou falso (SPEC-035 D-14) |
| Muitos tipos complicando as telas | Componentes por tipo e o contrato da SPEC-035, com testes que misturam os três tipos |

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (evento): QUANDO a docente cria uma questão, O SISTEMA DEVE oferecer "Escolha única" entre os tipos, no banco e no card.
- [x] **CA-02** (ubíquo): A página da questão de escolha única DEVE ter título, nível, descrição com imagens, dicas, de 2 a 7 alternativas com uma marcada como correta e justificativa, sem solução, condições, ambiente nem dependência.
- [x] **CA-03** (indesejado): SE a docente tentar ter menos de 2 ou mais de 7 alternativas, ENTÃO a tela NÃO DEVE permitir, e o servidor DEVE recusar com 400.
- [x] **CA-16** (opcional): ONDE a questão estiver marcada para manter a ordem, O SISTEMA DEVE mostrar as alternativas na ordem da professora; ONDE estiver marcada para embaralhar (o padrão), DEVE mostrá-las embaralhadas (D-07).
- [x] **CA-15** (ubíquo): Cada alternativa DEVE ser escrita no editor de texto, com formatação, comandos e imagens, e o aluno DEVE vê-la com essa formatação (D-02).
- [x] **CA-04** (indesejado): SE a docente publicar sem descrição, com alternativa vazia ou repetida, ou sem a correta marcada, ENTÃO O SISTEMA DEVE recusar com o motivo (RN-04).
- [x] **CA-05** (evento): QUANDO a docente reordena as alternativas, O SISTEMA DEVE manter a mesma alternativa como correta (RN-02).
- [x] **CA-06** (ubíquo): A lista de questões do aluno NÃO DEVE conter a correta nem a justificativa (RN-07).
- [x] **CA-07** (evento): QUANDO o aluno escolhe uma alternativa no exercício, O SISTEMA DEVE corrigir no servidor e mostrar na hora, com animação, se acertou, qual era a correta e a justificativa, e travar a resposta, inclusive depois de recarregar (RN-05, RN-06).
- [x] **CA-08** (indesejado): SE o aluno tentar responder de novo, ou enviar um identificador que não é de uma alternativa, ENTÃO a API DEVE responder 409 ou 400.
- [x] **CA-09** (estado): ENQUANTO o componente está no modo avaliação, O SISTEMA DEVE permitir trocar a escolha a qualquer momento, mostrar as dicas e NÃO DEVE mostrar resultado (RN-08).
- [x] **CA-10** (evento): QUANDO o aluno responde um exercício de escolha única do card, O SISTEMA DEVE mostrar o resultado na hora e travar a resposta no navegador (RN-09).
- [x] **CA-11** (evento): QUANDO a docente roda os testes do banco, do módulo ou do card, O SISTEMA DEVE conferir só se a questão de escolha única está completa, sem terminal.
- [x] **CA-12** (evento): QUANDO um agente cria pelo MCP uma questão ou um exercício de card de escolha única, O SISTEMA DEVE aplicar as mesmas validações da tela (RN-10).
- [x] **CA-13** (ubíquo): A escolha DEVE ser operável só pelo teclado, a animação DEVE respeitar a preferência de menos movimento e as telas DEVEM usar só tokens.
- [x] **CA-14** (evento): QUANDO as migrações rodarem, as questões de escolha única da carga inicial DEVEM ficar no formato novo com a mesma alternativa correta (D-04).

## 8. Plano de Testes (Test Plan)

- **Domínio (Go):** contrato do tipo (validação de 2 a 7, texto, repetidas, correta entre elas, campos proibidos, ids gerados) e correção (certa, errada, id desconhecido) (CA-03 a CA-05, CA-08).
- **Service e handler (Go):** criar, salvar, publicar; conferência com resposta única; lista pública sem gabarito; progresso (CA-04, CA-06 a CA-08).
- **Repository (PostgreSQL real):** gravação do formato novo, restrição de publicação e migração das questões da carga (CA-14).
- **MCP (Go):** criar e editar pelas ferramentas (CA-12).
- **Frontend:**
  - editor de alternativas (adicionar até 7, remover até 2, mover, marcar a correta, cada uma com o editor de texto e imagem) (CA-02, CA-03, CA-05, CA-15);
  - seletor de tipo (CA-01);
  - componente de resposta nos dois modos, por clique e teclado (CA-07, CA-09, CA-13);
  - aba "Desafios" e card (CA-07, CA-10);
  - testes do banco e do card (CA-11).
- **Manual:**
  - criar uma questão com imagem e 4 alternativas;
  - responder como aluno, certo e errado;
  - recarregar e ver a questão travada;
  - rodar o "Testar Banco".
- **Cobertura:** acima de 80% no escopo da spec.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:**
   - `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`;
   - SPEC-035 inteira, que é a base desta;
   - SPEC-022, 023, 024 e 025;
   - no código, `content/domain/question_type.go` e os componentes `TrueFalseAnswer`, `KindChooser` e `ExerciseForm`.
2. **Ordem de execução:**
   1. domínio (tipo no contrato);
   2. migração;
   3. banco, conferência e progresso;
   4. bloco do card;
   5. MCP;
   6. serviços do frontend;
   7. editor de alternativas;
   8. componente de resposta;
   9. aba "Desafios" e card;
   10. testes do banco;
   11. glossário e spec.
3. **Arquivos e diretórios a criar ou alterar:** os mesmos da SPEC-035 seção 9, mais:
   - o componente novo de resposta de escolha única;
   - o editor de alternativas;
   - a migração das questões da carga inicial.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, glossário atualizado e status `Implementada`.

## 10. Pendências para aprovação

### Decisões do Tech Lead (12/10/2026)

| ID | Decisão |
| :--- | :--- |
| D-01 | A professora marca a alternativa correta, e o sistema a guarda pelo identificador da alternativa, não pela posição (resolve P-01) |
| D-02 | A alternativa usa o editor de texto que já existe: texto, formatação, comandos, HTML e imagens (resolve P-02, no lugar da recomendação de só texto simples) |
| D-03 | O sistema embaralha a ordem das alternativas para o aluno, para ele não ver sempre a mesma ordem: no exercício, a cada vez que a questão é exibida; na avaliação, também embaralhada, com a ordem por tentativa definida na spec de avaliação (resolve P-03, no lugar da recomendação de manter a ordem da professora no exercício) |

| D-04 | As 30 questões de escolha única da carga inicial são convertidas para o formato novo, com a mesma alternativa correta, e passam a ser editáveis (resolve P-04) |
| D-05 | A escolha única também vale nos exercícios do card, conferida na tela e travada no navegador, como o verdadeiro ou falso (resolve P-05) |
| D-06 | Nomes: "Questão de escolha única" (`THEORETICAL_SINGLE`), "Alternativa" (`Choice`, campo `choices`) e "Alternativa correta" (`correctChoice`) (resolve P-06) |

Reforço do Tech Lead: a questão tem **somente uma** alternativa correta; as demais são erradas.

| ID | Decisão |
| :--- | :--- |
| D-07 | Pedido do Tech Lead durante a implementação (12/10/2026): a questão tem a opção de embaralhar as alternativas ou manter a ordem da professora. O padrão é embaralhar, como a D-03 |

### Pendências

Nenhuma em aberto. P-01 a P-06 viraram as decisões D-01 a D-06.

### Ajustes de implementação (sem desvio de escopo)

| ID | Ajuste |
| :--- | :--- |
| A-01 | O conteúdo da alternativa é o campo `html` (e não `text`, como a primeira versão da seção 4 dizia), porque a alternativa usa o editor de texto (D-02) |
| A-02 | O identificador das alternativas convertidas da carga inicial são os 8 primeiros dígitos hexadecimais de `md5('<id da questão>:<posição>')`, iguais na migração 00022 e no comando de carga, para os dois concordarem; as alternativas novas ganham um identificador aleatório de 8 dígitos |
| A-03 | O texto das alternativas convertidas é o mesmo que a carga já gravava (o filtro de HTML aplicado ao texto); a conversão não muda o que o aluno lia |
| A-04 | O exercício de escolha única do card só é salvo completo (de 2 a 7 alternativas, sem vazias nem repetidas, com a correta), como o verdadeiro ou falso do card exige a resposta; a descrição continua opcional no card |
| A-05 | A resposta da conferência traz `correctChoice` para este tipo e `correctAnswer` para o verdadeiro ou falso; o contrato de tipos ganhou o método que diz qual campo revelar |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 11/10/2026 | Implementador (Claude) | Criação do rascunho a partir do pedido do Tech Lead (escolha única, de 2 a 7 alternativas com 1 correta, nível, dicas, descrição com imagens, mesmo comportamento e animação do verdadeiro ou falso). Pendências P-01 a P-06 |
| 12/10/2026 | Tech Lead | P-01: a professora marca a correta e o sistema a guarda pelo identificador (D-01). P-03: as alternativas aparecem embaralhadas para o aluno (D-03). Seguem abertas P-02, P-04, P-05 e P-06 |
| 12/10/2026 | Tech Lead | P-02: alternativa com o editor de texto (texto, comandos, HTML e imagens) (D-02). P-04: conversão das 30 questões da carga inicial (D-04). Seguem abertas P-05 e P-06 |
| 12/10/2026 | Tech Lead | P-05 e P-06 aceitas nas recomendações (D-05, D-06), com o reforço de que há somente uma alternativa correta. Seção 10 sem pendências |
| 12/10/2026 | Tech Lead | Aprovada ("eu aprovo"). Status: `Aprovada` |
| 12/10/2026 | Tech Lead | Durante a implementação: opção por questão de embaralhar ou manter a ordem das alternativas (D-07, CA-16, RN-12, coluna `shuffle_choices`) |
| 12/10/2026 | Implementador (Claude) | Implementada; status `Implementada`. **Backend:** tipo `THEORETICAL_SINGLE` no contrato de tipos, banco do módulo, conferência com resposta única, progresso, item do card, MCP, migração 00022 (coluna `shuffle_choices`, restrição de publicação e conversão das 30 questões da carga) e comando de carga no formato novo. Testes passando, inclusive com PostgreSQL real (banco com a escolha única e a conversão da migração). Cobertura: `content/domain` 94,1%, `content/service` 86,2%, `content/handler` 83,4%, `content/repository` 85,1%, `practice/service` 95,8%, `practice/handler` 97,6%, `mcp/service` 97,6%. No banco de desenvolvimento, a migração converteu as 30 questões e todas têm a correta entre as alternativas (a `quiz-fac-1` continua com "Kernel Linux"). **Frontend:** 306 testes dos arquivos da spec passando, com 96,3% das linhas e 89,9% dos ramos nesses arquivos; nenhum arquivo alterado abaixo de 80% de ramos. Três testes do `CardScreen` estouram o tempo só com a suíte em paralelo e com cobertura, e passam sozinhos (8 de 8). `tsc`, ESLint e Stylelint limpos. **Manual:** o roteiro da seção 8 no navegador não foi executado e fica para a revisão. **Ajustes:** A-01 a A-05 e a decisão D-07 (embaralhar ou manter a ordem) |
