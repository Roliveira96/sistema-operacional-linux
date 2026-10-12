# SPEC-037: Questões de Ligar Colunas

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-037 |
| **Status** | Implementada |
| **Data de criação** | 11/10/2026 |
| **Última revisão** | 12/10/2026 (decisões D-01 a D-10, aprovada) |
| **Autor** | Implementador (Claude), a pedido do Tech Lead |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `content` (questões, banco do módulo, bloco `EXERCISES`, correção), `practice` (progresso) e `mcp` (ferramentas de autoria) |
| **Contexto de tela** | `/app/modules/[id]/edit?tab=exercises`, página da questão do banco, aba Exercícios do card, aba "Desafios" e exercícios do card na tela de estudo |
| **Prioridade** | Alta |
| **Depende de** | SPEC-022, SPEC-023, SPEC-024, SPEC-025, SPEC-035 |
| **Substitui** | Nenhuma. Amplia a lista de tipos aceitos pelo banco (SPEC-035 RN-01) |
| **Fontes canônicas** | Pedido do Tech Lead de 11/10/2026; SPEC-035 (contrato de tipo de questão, comportamento no exercício e na avaliação, animação) |

---

## 1. Contexto e Problema (Context & Problem Statement)

Depois do verdadeiro ou falso (SPEC-035) e da escolha única (SPEC-036), o Tech Lead pediu a questão de **ligar colunas**. Ela tem uma coluna de itens à esquerda e uma à direita, e o aluno liga cada item da esquerda ao seu par da direita. Exemplo: ligar `chmod`, `chown` e `ls` às suas descrições.

O pedido:

- de **2 a 5 pares** (mínimo de duas ligações, máximo de cinco);
- nível de dificuldade, dicas, descrição com imagens e justificativa, como os demais tipos;
- o mesmo comportamento do verdadeiro ou falso:
  - no **exercício**, o resultado aparece na hora e a resposta trava;
  - na **avaliação**, o aluno muda as ligações até finalizar, e a correção só acontece ao finalizar;
- a ligação é **animada** para o aluno.

Esse tipo não existe no schema: `questions.kind` só aceita `PRACTICAL`, `THEORETICAL_SINGLE`, `THEORETICAL_MULTIPLE`, `THEORETICAL_BOOLEAN` e `DISCURSIVE` (SPEC-011).

## 2. Objetivos (Goals)

- Um tipo novo, **Ligar colunas** (`THEORETICAL_MATCHING`), no banco de questões do módulo e nos exercícios do card, pelo contrato da SPEC-035.
- A docente escreve de 2 a 5 pares, cada um com o item da esquerda e o seu par da direita.
- O aluno liga os itens com o mouse, o toque ou o teclado. Cada ligação aparece como uma linha animada entre os dois itens.
- No exercício, depois de ligar tudo e confirmar, o aluno vê na hora:
  - quais ligações acertou e quais errou, com animação;
  - os pares corretos;
  - a justificativa.

  A resposta trava.
- Na avaliação, as ligações mudam livremente e nada diz se estão certas.

### 2.1. Fora de escopo (Non-Goals)

- Itens extras sem par (distratores) e colunas de tamanhos diferentes: ver P-01.
- Um item ligado a mais de um par.
- Imagem ou formatação dentro dos itens: só texto simples (P-06).
- Arrastar e soltar como forma principal de ligar: ver P-04.
- Aplicação de provas (spec de avaliação), que DEVE seguir SPEC-035 RN-07 e RN-13 também para este tipo, e a regra de nota da P-02.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Autoria (banco e card):**

- O seletor de tipo oferece "Ligar colunas", com uma linha de explicação.
- A página da questão tem título, nível, descrição com imagens, dicas, **pares** e justificativa.
- **Colunas e ligações corretas (D-09):**
  - a docente monta a **coluna da esquerda** e a **coluna da direita** como duas listas, cada uma na ordem que quiser, com o mesmo número de itens, de 2 a 5;
  - cada lista tem "+ Adicionar item", que acrescenta um item nas duas colunas para manter o mesmo tamanho, e os botões subir, descer e remover;
  - remover fica bloqueado quando restam 2 itens em cada coluna;
  - para cada item da esquerda, a docente **seleciona no sistema** qual item da direita é o seu par correto. Cada item da direita é par de um único item da esquerda;
  - a opção **"Embaralhar a ordem para o aluno"** (ligada por padrão) sorteia a ordem a cada vez. Desligada, o aluno vê as duas colunas exatamente na ordem que a docente montou (D-10).
- **Prévia:** mostra a questão como o aluno vê, na ordem que a opção pede.
- **Banco e card:** "Ligar colunas" entra na etiqueta, no filtro por tipo e no resumo da lista ("3 pares").
- **Testes do banco, do módulo e do card:** só conferem se a questão está completa (SPEC-035 RN-09).

**Aluno (aba "Desafios" e exercício do card):**

- Duas colunas, na ordem que a questão pede (D-10): sorteada a cada vez, ou exatamente a ordem que a docente montou. Como a docente monta a direita numa ordem própria, manter a ordem não entrega os pares.
- **Ligar:**
  - clicar ou tocar num item da esquerda e depois num da direita; pelo teclado, Enter num e Enter no outro (P-04);
  - a linha entre os dois se desenha com animação;
  - escolher de novo um item já ligado desfaz a ligação antiga;
  - cada par ligado ganha a mesma cor e o mesmo número nos dois lados, para quem não enxerga bem a linha.
- **No exercício:** o botão "Conferir minhas ligações" só se habilita com todos os itens ligados (P-05). Ao conferir:
  - as linhas certas ficam verdes, com um pulso;
  - as erradas ficam vermelhas, com uma tremida curta;
  - os pares corretos aparecem;
  - a justificativa aparece, se houver.

  A resposta trava, inclusive depois de recarregar.
- **No modo avaliação:** liga e desliga à vontade, sem conferir e sem resultado.
- **Movimento reduzido:** quem pede ao sistema menos movimento vê as linhas sem animação.
- **Telas estreitas:** as colunas ficam uma embaixo da outra, e as ligações aparecem pelo número e pela cor, sem linha.

**Componente de resposta:**

- Componente de ligar colunas com os dois modos da SPEC-035: exercício e avaliação.
- As linhas são desenhadas em SVG com as cores dos tokens.
- Os textos ficam nos arquivos de mensagens.

### 3.2. Backend (Go — Camada de Módulo/Service)

- **RN-01 (tipo novo):** `THEORETICAL_MATCHING` entra no enum de `questions.kind` por migração, no glossário e no contrato de tipos da SPEC-035, aceito no banco do módulo e nos exercícios do card.
- **RN-02 (colunas e pares):**
  - a docente envia a coluna da esquerda e a da direita, cada uma na sua ordem, e os pares corretos ligando cada item da esquerda a um da direita (D-09);
  - de 2 a 5 pares;
  - cada lado tem um texto obrigatório, de até 200 caracteres;
  - os itens de um mesmo lado não se repetem (comparando sem diferenciar maiúsculas e espaços nas pontas);
  - cada item, da esquerda e da direita, tem um identificador próprio e opaco, que não revela qual é o seu par.
- **RN-03 (campos por tipo):**
  - exige `title` e `difficulty`;
  - aceita `statement`, `hints`, `left`, `right`, `pairs`, `shuffleChoices` e `explanation`;
  - recusa `solution`, `conditions`, `dependsOn`, `correctAnswer` e `correctChoice`.
- **RN-04 (publicar):** publicar exige descrição não vazia e de 2 a 5 pares completos, sem repetição.
- **RN-05 (entrega ao aluno):**
  - a lista de questões traz os itens da esquerda e os da direita como duas listas separadas, cada item com identificador e texto;
  - as duas colunas vêm na ordem da docente ou sorteadas pelo servidor, conforme `shuffleChoices` (D-10);
  - nunca traz quais itens formam par, nem a justificativa.
- **RN-06 (correção no exercício):**
  - a rota de conferência recebe as ligações: uma para cada item da esquerda, cada item da direita usado uma única vez;
  - ela corrige no servidor e devolve se acertou tudo, o resultado de cada ligação, os pares corretos e a justificativa.
- **RN-07 (resposta única):**
  - a primeira resposta é definitiva, gravada em `exercise_progress.response`, e a segunda recebe 409;
  - a questão conta como concluída ao ser respondida (SPEC-035 RN-08 e D-13);
  - `passed` é verdadeiro só com todas as ligações certas (P-02).
- **RN-08 (avaliação):** valem SPEC-035 RN-07 (troca livre até finalizar, correção no servidor) e RN-13 (dicas na prova).
- **RN-09 (exercício do card):** o item do bloco `EXERCISES` aceita o tipo com os mesmos campos e limites. Ele é conferido na tela e travado no navegador, como os outros tipos sem terminal do card (SPEC-035 D-14).
- **RN-10 (MCP):** as ferramentas aceitam o tipo e os pares, com as mesmas validações.

## 4. Modelo de Dados (Data Model)

**Migração:** acrescenta `THEORETICAL_MATCHING` ao `CHECK` de `questions.kind`. A restrição `questions_objective_fields` passa a exigir, para `THEORETICAL_MATCHING` publicada, os pares e o gabarito.

| Campo de `questions` | Uso em `THEORETICAL_MATCHING` |
| :--- | :--- |
| `choices` | As colunas: `left` e `right`, duas listas de { `id`, `text` }, cada uma na ordem que a docente montou (D-09) |
| `shuffle_choices` | Sorteia a ordem das colunas para o aluno (padrão) ou mantém a da docente (D-10); a mesma coluna da SPEC-036 |
| `answer_key` | Os pares: lista de { `left`: id, `right`: id } |
| `explanation`, `hints`, `statement`, `title`, `difficulty` | Como nos outros tipos sem terminal |
| `scenario_id`, `reference_solution`, `validation_conditions`, `end_conditions`, `depends_on` | Sempre nulos |

`exercise_progress.response` guarda as ligações do aluno: lista de { `left`, `right` }.

**No bloco `EXERCISES`:** o item guarda `left` e `right` (listas de { `id`, `text` }), `pairs` (os pares corretos, por identificador) e `shuffleChoices`, porque o card é conferido na tela.

## 5. Contrato de API (API Contract)

### 5.1. Banco do módulo

**`POST` e `PUT /api/v1/teacher/modules/{id}/exercises[/{exerciseId}]`**: aceitam `kind = THEORETICAL_MATCHING` e os campos abaixo.

| Campo | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `left` | lista de { `id`, `text` } | Para publicar | A coluna da esquerda, na ordem da docente: de 2 a 5 itens, texto de 1 a 200 caracteres, sem repetição. O `id` vem da tela (letras, dígitos, `-` e `_`) |
| `right` | lista de { `id`, `text` } | Para publicar | A coluna da direita, na ordem da docente, com o mesmo número de itens da esquerda e as mesmas regras |
| `pairs` | lista de { `left`, `right` } (ids) | Para publicar | Um par para cada item da esquerda, cada item da direita usado uma única vez |
| `shuffleChoices` | booleano | Não | Padrão verdadeiro: sorteia a ordem para o aluno; falso mantém a da docente (D-10) |
| `explanation` | HTML | Não | Como nos outros tipos |

A resposta para a docente traz `left`, `right`, `pairs` e `shuffleChoices` como ela montou. Erros: 400 `validation-error` com o campo (`pairs[1].right`...).

### 5.2. Aluno

- **`GET /api/v1/modules/{id}/questions`:** os itens deste tipo trazem `left` e `right` (listas de { `id`, `text` }), na ordem da docente ou sorteadas, sem os pares.
- **`POST /api/v1/questions/{id}/check`:**
  - corpo: `response` = { `links`: [ { `left`, `right` } ] };
  - resposta: `passed`, `completedAt`, `results` (cada ligação com `correct`), `pairs` (os pares corretos, por identificador) e `explanation`;
  - 400 se as ligações não cobrirem todos os itens uma única vez;
  - 409 `already-answered` na segunda resposta.
- **`GET /api/v1/modules/{id}/progress`:** as respondidas trazem as ligações dadas, `passed`, `results`, `pairs` e `explanation`.

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| :--- | :--- |
| Os identificadores revelando os pares | Identificadores opacos e independentes por lado; a direita embaralhada (RN-02, RN-05); teste de que a lista pública não permite deduzir os pares |
| Linhas difíceis de ver ou de seguir | Número e cor iguais nos dois lados de cada par; em tela estreita, só número e cor; navegação por teclado |
| Animação incomodando | Respeita a preferência de menos movimento |
| Valor novo no enum de `kind` | Migração com volta; o banco, o glossário e o contrato mudam juntos |
| Gabarito do card visível no navegador | Aceito como nos outros tipos do card (SPEC-035 D-14) |

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (evento): QUANDO a docente cria uma questão, O SISTEMA DEVE oferecer "Ligar colunas" entre os tipos, no banco e no card.
- [x] **CA-02** (ubíquo): A página da questão DEVE ter título, nível, descrição com imagens, dicas, de 2 a 5 pares e justificativa, sem solução, condições, ambiente nem dependência.
- [x] **CA-03** (indesejado): SE a docente tentar ter menos de 2 ou mais de 5 pares, ENTÃO a tela NÃO DEVE permitir, e o servidor DEVE recusar com 400.
- [x] **CA-04** (indesejado): SE a docente publicar sem descrição, com um lado vazio ou com itens repetidos no mesmo lado, ENTÃO O SISTEMA DEVE recusar com o motivo (RN-04).
- [x] **CA-05** (ubíquo): A lista de questões do aluno NÃO DEVE conter os pares nem a justificativa (RN-05).
- [x] **CA-15** (evento): QUANDO a docente monta as colunas, O SISTEMA DEVE deixá-la ordenar cada coluna e selecionar, para cada item da esquerda, o seu par correto na direita, sem repetir um item da direita (D-09).
- [x] **CA-16** (opcional): ONDE a questão estiver marcada para manter a ordem, O SISTEMA DEVE mostrar as duas colunas exatamente na ordem da docente; ONDE estiver marcada para sortear (o padrão), DEVE mostrá-las numa ordem sorteada a cada vez (D-10).
- [x] **CA-06** (evento): QUANDO o aluno escolhe um item de cada coluna, O SISTEMA DEVE desenhar a ligação com animação e marcar os dois com o mesmo número e cor; escolher de novo um item ligado DEVE desfazer a ligação antiga.
- [x] **CA-07** (estado): ENQUANTO houver item sem ligação no exercício, O SISTEMA NÃO DEVE habilitar a conferência (P-05).
- [x] **CA-08** (evento): QUANDO o aluno confere no exercício, O SISTEMA DEVE corrigir no servidor e mostrar na hora, com animação, as ligações certas e erradas, os pares corretos e a justificativa, e travar a resposta, inclusive depois de recarregar (RN-06, RN-07).
- [x] **CA-09** (indesejado): SE as ligações enviadas não cobrirem cada item uma única vez, ou se o aluno responder de novo, ENTÃO a API DEVE responder 400 ou 409.
- [x] **CA-10** (estado): ENQUANTO o componente está no modo avaliação, O SISTEMA DEVE permitir ligar e desligar a qualquer momento, mostrar as dicas e NÃO DEVE mostrar resultado (RN-08).
- [x] **CA-11** (evento): QUANDO o aluno responde um exercício de ligar colunas do card, O SISTEMA DEVE mostrar o resultado na hora e travar a resposta no navegador (RN-09).
- [x] **CA-12** (evento): QUANDO a docente roda os testes do banco, do módulo ou do card, O SISTEMA DEVE conferir só se a questão está completa.
- [x] **CA-13** (evento): QUANDO um agente cria pelo MCP uma questão ou um exercício de card de ligar colunas, O SISTEMA DEVE aplicar as mesmas validações da tela (RN-10).
- [x] **CA-14** (ubíquo): Ligar DEVE ser possível só pelo teclado, a animação DEVE respeitar a preferência de menos movimento, a tela estreita DEVE funcionar sem as linhas, e as telas DEVEM usar só tokens.

## 8. Plano de Testes (Test Plan)

- **Domínio (Go):** contrato do tipo (de 2 a 5 pares, textos, repetição, campos proibidos, identificadores gerados e opacos) e correção (tudo certo, parte certa, ligações que não cobrem os itens) (CA-03, CA-04, CA-09).
- **Service e handler (Go):** criar, salvar, publicar; lista pública sem pares e com a direita embaralhada; conferência com resposta única; progresso (CA-05, CA-08, CA-09).
- **Repository (PostgreSQL real):** migração do enum e da restrição; gravação e leitura.
- **MCP (Go):** criar e editar pelas ferramentas (CA-13).
- **Frontend:**
  - editor de pares (adicionar até 5, remover até 2, mover) (CA-02, CA-03);
  - componente de ligar nos dois modos:
    - ligar e desfazer por clique e por teclado, número e cor dos pares, conferência só com tudo ligado (CA-06, CA-07, CA-10, CA-14);
    - resultado animado e travado (CA-08);
  - aba "Desafios" e card (CA-08, CA-11);
  - testes do banco e do card (CA-12).
- **Manual:**
  - criar uma questão com 4 pares e imagem na descrição;
  - ligar com o mouse e com o teclado, conferir e recarregar;
  - ver numa tela estreita;
  - rodar o "Testar Banco".
- **Cobertura:** acima de 80% no escopo da spec.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:**
   - `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`;
   - SPEC-035 inteira;
   - a SPEC-036, se já implementada;
   - SPEC-022, 023, 024 e 025;
   - no código, `content/domain/question_type.go` e os componentes `TrueFalseAnswer`, `KindChooser` e `ExerciseForm`.
2. **Ordem de execução:**
   1. migração e domínio;
   2. banco, conferência e progresso;
   3. bloco do card;
   4. MCP;
   5. serviços do frontend;
   6. editor de pares;
   7. componente de ligar com as linhas em SVG;
   8. aba "Desafios" e card;
   9. testes do banco;
   10. glossário e spec.
3. **Arquivos e diretórios a criar ou alterar:** os mesmos da SPEC-035 seção 9, mais:
   - a migração do enum;
   - o componente de ligar colunas;
   - o editor de pares.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, glossário atualizado e status `Implementada`.

## 10. Pendências para aprovação

### Decisões do Tech Lead (12/10/2026, as recomendações do rascunho)

| ID | Decisão |
| :--- | :--- |
| D-01 | As duas colunas têm o mesmo número de itens, de 2 a 5 pares; sem distratores nesta spec (resolve P-01) |
| D-02 | No exercício, cada ligação aparece certa ou errada, e a questão conta como acertada só com todas certas; a nota parcial na prova fica para a spec de avaliação (resolve P-02) |
| D-03 | ~~Esquerda na ordem da docente e direita embaralhada pelo servidor (resolve P-03)~~ Substituída pela D-10 |
| D-04 | Liga-se clicando (ou tocando) num item e depois no outro, com o teclado fazendo o mesmo; arrastar pode vir depois (resolve P-04) |
| D-05 | A resposta do exercício trava só no "Conferir minhas ligações", habilitado com todos os itens ligados; antes disso o aluno refaz à vontade (resolve P-05) |
| D-06 | Itens só com texto simples, até 200 caracteres por lado (resolve P-06) |
| D-07 | O tipo também vale nos exercícios do card (resolve P-07) |
| D-09 | Pedido do Tech Lead na aprovação: a docente monta as duas colunas, cada uma na sua ordem, e seleciona no sistema qual item da direita é o par correto de cada item da esquerda (substitui escrever os pares lado a lado) |
| D-10 | Pedido do Tech Lead na aprovação: a docente escolhe entre sortear a ordem para o aluno (padrão) ou manter a ordem que montou, como na SPEC-036 D-07 (substitui a D-03, que sempre embaralhava a direita) |
| D-08 | Tipo `THEORETICAL_MATCHING` ("Ligar colunas"); "Par" (`Pair`, campo `pairs`) e "Ligação" (`Link`, campo `links` da resposta) entram no glossário (resolve P-08) |

### Pendências

Nenhuma em aberto. P-01 a P-08 viraram as decisões D-01 a D-08.

### Ajustes de implementação (sem desvio de escopo)

| ID | Ajuste |
| :--- | :--- |
| A-01 | Os identificadores dos itens vêm da tela (a docente monta as colunas e os pares na mesma página), e o servidor só confere o formato e a repetição, em vez de gerá-los |
| A-02 | A opção de sortear vale para as duas colunas, na mesma coluna `shuffle_choices` da SPEC-036; mantida a ordem, as duas aparecem como a docente montou (D-10) |
| A-03 | O resultado de cada ligação (`results`) é corrigido de novo a partir da resposta guardada quando o progresso é lido, sem uma coluna nova |
| A-04 | A marca "ligação certa/errada" aparece uma vez por ligação, no item da esquerda; o item da direita mostra a cor do resultado |
| A-05 | Os testes de cada camada foram escritos antes do código, executados vermelhos e depois verdes, já na linha da SPEC-038 (ainda em rascunho) |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 11/10/2026 | Implementador (Claude) | Criação do rascunho a partir do pedido do Tech Lead (ligar colunas, de 2 a 5 pares, mesmo comportamento do verdadeiro ou falso no exercício e na avaliação, animado para o aluno). Pendências P-01 a P-08 |
| 12/10/2026 | Tech Lead | Aceitas as recomendações de P-01 a P-08 (viram D-01 a D-08). Seção 10 sem pendências |
| 12/10/2026 | Tech Lead | Aprovada, com duas mudanças: a docente monta as colunas e seleciona os pares corretos no sistema (D-09) e escolhe sortear ou manter a ordem (D-10, no lugar da D-03). Status: `Aprovada` |
| 12/10/2026 | Implementador (Claude) | Implementada; status `Implementada`. **Backend:** tipo `THEORETICAL_MATCHING` no contrato de tipos (colunas na ordem da docente, pares que ela seleciona, correção por ligação), banco do módulo, conferência com resposta única, progresso com o resultado de cada ligação, item do card, MCP e migração 00023. Testes passando, inclusive com PostgreSQL real. Cobertura: `content/domain` 94,5%, `content/service` 86,3%, `content/handler` 83,7%, `content/repository` 85,1%, `practice/service` 95,9%, `practice/handler` 97,6%, `mcp/service` 97,7%. **Frontend:** 355 testes das áreas afetadas passando, com 97% das linhas e 88,3% dos ramos nos arquivos alterados, nenhum abaixo de 80% de ramos; `tsc`, ESLint e Stylelint limpos. A migração 00023 foi aplicada no banco de desenvolvimento. **Manual:** o roteiro da seção 8 no navegador não foi executado e fica para a revisão. **Ajustes:** A-01 a A-05 |
