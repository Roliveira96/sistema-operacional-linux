# SPEC-036: Questões de Escolha Única

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-036 |
| **Status** | Rascunho |
| **Data de criação** | 11/10/2026 |
| **Última revisão** | 11/10/2026 |
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
- Alternativa com imagem ou formatação: nesta spec a alternativa é texto simples (ver P-02).
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
- A ordem das alternativas segue a P-03.

**Componente de resposta:**

- Componente de escolha única com os dois modos da SPEC-035: exercício e avaliação.
- Os textos da interface ficam nos arquivos de mensagens.
- Usa os tokens da SPEC-015.

### 3.2. Backend (Go — Camada de Módulo/Service)

- **RN-01 (tipo aceito):** o banco do módulo e os exercícios do card aceitam `THEORETICAL_SINGLE`, registrado no contrato de tipos da SPEC-035.
- **RN-02 (alternativas):** de 2 a 7 alternativas.
  - Cada uma tem um identificador estável e um texto obrigatório, de até 500 caracteres.
  - O gabarito aponta para o identificador da alternativa correta, não para a posição. Assim, reordenar e embaralhar não muda a correta (P-01).
- **RN-03 (campos por tipo):**
  - exige `title` e `difficulty`;
  - aceita `statement`, `hints`, `choices`, `correctChoice` e `explanation`;
  - recusa `solution`, `conditions`, `dependsOn` e `correctAnswer` (o campo do verdadeiro ou falso).
- **RN-04 (publicar):** publicar exige:
  - descrição não vazia;
  - de 2 a 7 alternativas com texto;
  - nenhuma alternativa repetida, comparando sem diferenciar maiúsculas e espaços nas pontas;
  - a correta marcada entre elas.
- **RN-05 (correção no exercício):** a rota de conferência (SPEC-035 5.2) recebe o identificador escolhido, corrige no servidor e devolve:
  - se acertou;
  - o identificador da correta;
  - a justificativa.

  O gabarito só sai depois da resposta.
- **RN-06 (resposta única):** a primeira resposta é definitiva e gravada em `exercise_progress.response`; a segunda recebe 409. A questão conta como concluída ao ser respondida (SPEC-035 RN-08, D-13).
- **RN-07 (sem gabarito para o aluno):** a lista de questões do aluno traz as alternativas, com identificador e texto, e nunca a correta nem a justificativa.
- **RN-08 (avaliação):** valem SPEC-035 RN-07 (troca livre até finalizar, correção no servidor ao finalizar) e RN-13 (dicas na prova).
- **RN-09 (exercício do card):** o item do bloco `EXERCISES` aceita o tipo com os mesmos campos e limites. Como o verdadeiro ou falso do card, é conferido na tela, e a trava fica no navegador (SPEC-035 D-14).
- **RN-10 (MCP):** as ferramentas aceitam o tipo, com `choices` e `correctChoice` (SPEC-035 RN-15).
- **RN-11 (questões da carga inicial):** as 30 questões de escolha única da carga seguem a P-04.

## 4. Modelo de Dados (Data Model)

Nenhuma tabela nova. Campos de `questions` para `THEORETICAL_SINGLE`:

| Campo | Uso |
| :--- | :--- |
| `choices` | Lista de 2 a 7 alternativas, cada uma com `id` (texto curto gerado na criação, estável) e `text` |
| `answer_key` | Objeto com `correct` = `id` da alternativa correta; obrigatório para publicar |
| `explanation`, `hints`, `statement`, `title`, `difficulty` | Como no verdadeiro ou falso |
| `scenario_id`, `reference_solution`, `validation_conditions`, `end_conditions`, `depends_on` | Sempre nulos |

A restrição `questions_objective_fields` (SPEC-035 A-02) passa a exigir, para `THEORETICAL_SINGLE` publicada, alternativas e gabarito; um rascunho pode não ter gabarito.

`exercise_progress.response` guarda `{ "choice": "<id>" }`.

No bloco `EXERCISES`, o item ganha `choices` e `correctChoice`, só para este tipo.

## 5. Contrato de API (API Contract)

### 5.1. Banco do módulo

**`POST` e `PUT /api/v1/teacher/modules/{id}/exercises[/{exerciseId}]`**: aceitam `kind = THEORETICAL_SINGLE` e os campos abaixo.

| Campo | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `choices` | lista de { `id`, `text` } | Para publicar | De 2 a 7. Uma alternativa sem `id` ganha um no servidor. Texto de 1 a 500 caracteres |
| `correctChoice` | texto ou nulo | Para publicar | `id` de uma das alternativas |
| `explanation` | HTML | Não | Como no verdadeiro ou falso |

A resposta traz os mesmos campos. Erros: 400 `validation-error` com o campo (`choices[2].text`, `correctChoice`...).

### 5.2. Aluno

- **`GET /api/v1/modules/{id}/questions`:** os itens de escolha única trazem `choices` com `id` e `text`, sem gabarito.
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
| As 30 questões da carga inicial em outro formato | P-04: migração para o formato novo, com teste que confere que a correta continua a mesma |
| Gabarito do card visível no navegador | Aceito como no verdadeiro ou falso (SPEC-035 D-14) |
| Muitos tipos complicando as telas | Componentes por tipo e o contrato da SPEC-035, com testes que misturam os três tipos |

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente cria uma questão, O SISTEMA DEVE oferecer "Escolha única" entre os tipos, no banco e no card.
- [ ] **CA-02** (ubíquo): A página da questão de escolha única DEVE ter título, nível, descrição com imagens, dicas, de 2 a 7 alternativas com uma marcada como correta e justificativa, sem solução, condições, ambiente nem dependência.
- [ ] **CA-03** (indesejado): SE a docente tentar ter menos de 2 ou mais de 7 alternativas, ENTÃO a tela NÃO DEVE permitir, e o servidor DEVE recusar com 400.
- [ ] **CA-04** (indesejado): SE a docente publicar sem descrição, com alternativa vazia ou repetida, ou sem a correta marcada, ENTÃO O SISTEMA DEVE recusar com o motivo (RN-04).
- [ ] **CA-05** (evento): QUANDO a docente reordena as alternativas, O SISTEMA DEVE manter a mesma alternativa como correta (RN-02).
- [ ] **CA-06** (ubíquo): A lista de questões do aluno NÃO DEVE conter a correta nem a justificativa (RN-07).
- [ ] **CA-07** (evento): QUANDO o aluno escolhe uma alternativa no exercício, O SISTEMA DEVE corrigir no servidor e mostrar na hora, com animação, se acertou, qual era a correta e a justificativa, e travar a resposta, inclusive depois de recarregar (RN-05, RN-06).
- [ ] **CA-08** (indesejado): SE o aluno tentar responder de novo, ou enviar um identificador que não é de uma alternativa, ENTÃO a API DEVE responder 409 ou 400.
- [ ] **CA-09** (estado): ENQUANTO o componente está no modo avaliação, O SISTEMA DEVE permitir trocar a escolha a qualquer momento, mostrar as dicas e NÃO DEVE mostrar resultado (RN-08).
- [ ] **CA-10** (evento): QUANDO o aluno responde um exercício de escolha única do card, O SISTEMA DEVE mostrar o resultado na hora e travar a resposta no navegador (RN-09).
- [ ] **CA-11** (evento): QUANDO a docente roda os testes do banco, do módulo ou do card, O SISTEMA DEVE conferir só se a questão de escolha única está completa, sem terminal.
- [ ] **CA-12** (evento): QUANDO um agente cria pelo MCP uma questão ou um exercício de card de escolha única, O SISTEMA DEVE aplicar as mesmas validações da tela (RN-10).
- [ ] **CA-13** (ubíquo): A escolha DEVE ser operável só pelo teclado, a animação DEVE respeitar a preferência de menos movimento e as telas DEVEM usar só tokens.
- [ ] **CA-14** (evento): QUANDO as migrações rodarem, as questões de escolha única da carga inicial DEVEM ficar no formato novo com a mesma alternativa correta (P-04).

## 8. Plano de Testes (Test Plan)

- **Domínio (Go):** contrato do tipo (validação de 2 a 7, texto, repetidas, correta entre elas, campos proibidos, ids gerados) e correção (certa, errada, id desconhecido) (CA-03 a CA-05, CA-08).
- **Service e handler (Go):** criar, salvar, publicar; conferência com resposta única; lista pública sem gabarito; progresso (CA-04, CA-06 a CA-08).
- **Repository (PostgreSQL real):** gravação do formato novo, restrição de publicação e migração das questões da carga (CA-14).
- **MCP (Go):** criar e editar pelas ferramentas (CA-12).
- **Frontend:**
  - editor de alternativas (adicionar até 7, remover até 2, mover, marcar a correta) (CA-02, CA-03, CA-05);
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

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| P-01 | Gabarito por posição (como veio da carga inicial) ou por identificador estável da alternativa | Por identificador: reordenar e embaralhar não mudam a correta, e a resposta gravada continua válida se a docente mudar a ordem |
| P-02 | A alternativa pode ter formatação ou imagem? | Só texto simples nesta spec, até 500 caracteres; imagens ficam na descrição. Alternativa com imagem pode vir depois sem mudar o formato (o objeto da alternativa ganha campos) |
| P-03 | A ordem das alternativas para o aluno: a da docente ou embaralhada? | No exercício, a ordem da docente. Na avaliação, embaralhada por aluno (para dificultar cola), decidido na spec de avaliação |
| P-04 | As 30 questões de escolha única da carga inicial (módulo de simulados), com alternativas como lista de textos e gabarito por posição | Uma migração converte para o formato novo (gera os identificadores e aponta o gabarito para a mesma alternativa), e elas passam a ser editáveis no banco do módulo de simulados |
| P-05 | Também nos exercícios do card? | Sim, como o verdadeiro ou falso (SPEC-035 D-08), conferida na tela e travada no navegador |
| P-06 | Nome no glossário | "Questão de escolha única" (`THEORETICAL_SINGLE`) e "Alternativa" (`Choice`, campo `choices`), com "Alternativa correta" (`correctChoice`) |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 11/10/2026 | Implementador (Claude) | Criação do rascunho a partir do pedido do Tech Lead (escolha única, de 2 a 7 alternativas com 1 correta, nível, dicas, descrição com imagens, mesmo comportamento e animação do verdadeiro ou falso). Pendências P-01 a P-06 |
