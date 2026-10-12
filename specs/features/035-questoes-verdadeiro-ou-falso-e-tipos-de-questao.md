# SPEC-035: Questões de Verdadeiro ou Falso e Tipos de Questão no Banco

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-035 |
| **Status** | Implementada |
| **Data de criação** | 11/10/2026 |
| **Última revisão** | 11/10/2026 (decisões D-01 a D-14, sem pendências) |
| **Autor** | Implementador (Claude), a pedido do Tech Lead |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `content` (questões, banco do módulo, bloco `EXERCISES`, correção), `practice` (progresso) e `mcp` (ferramentas de autoria); aba Exercícios da edição do módulo, página da questão, aba Exercícios do card e tela de estudo |
| **Contexto de tela** | `/app/modules/[id]/edit?tab=exercises`, página da questão do banco, aba Exercícios de `/app/modules/[id]/cards/[cardId]`, aba "Desafios" e exercícios do card em `/app/modules/[id]` e `/materials/[id]` |
| **Prioridade** | Alta |
| **Depende de** | SPEC-011, SPEC-012, SPEC-014, SPEC-016, SPEC-019, SPEC-022, SPEC-023, SPEC-024, SPEC-025 |
| **Substitui** | Item "Questões teóricas (escolha, verdadeiro/falso, dissertativa) no banco" do Fora de escopo da SPEC-023. Altera a SPEC-022 (exercício do card ganha o tipo) e a SPEC-024 (ferramentas aceitam o tipo) |
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
- O **exercício do card** (SPEC-022) também pode ser de verdadeiro ou falso (D-08).
- O **servidor MCP** (SPEC-024) cria e edita questões e exercícios de card de verdadeiro ou falso (D-11).
- O código passa a tratar cada tipo de questão por um contrato único (validar, entregar sem gabarito, corrigir), para que um tipo novo entre sem mexer nos demais.

### 2.1. Fora de escopo (Non-Goals)

- Os outros tipos teóricos (escolha única, múltipla seleção, dissertativa e "julgue os itens"): cada um terá spec própria, sobre o contrato desta.
- Aplicação de provas: tela da prova, tentativa, cronômetro, código de sala, gravação das respostas durante a prova e nota (spec de avaliação). Esta spec só define a regra que ela DEVE seguir (RN-07) e entrega a correção do tipo no servidor.
- Edição pela interface das 30 questões de escolha única da carga inicial.
- Banco compartilhado entre módulos (continua por módulo, SPEC-023 D-02).
- Edição de imagem no navegador (SPEC-025 já exclui).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

**Banco de exercícios (aba Exercícios da edição do módulo):**

- O banco passa a se chamar **"Banco de questões do módulo"** na interface (D-05): ele guarda as questões de Comando Linux e as de Verdadeiro ou falso, lado a lado. Os blocos de vínculo e as ações da SPEC-023 continuam valendo para os dois tipos.
- Cada linha mostra a etiqueta do tipo ("Comando Linux" ou "Verdadeiro ou falso"), ao lado das etiquetas de vínculo que já existem.
- O filtro do banco ganha **tipo**, além de vínculo, nível e publicação.
- "Criar nova questão" (no cabeçalho do banco e no "Adicionar do Banco" dos blocos) pergunta primeiro o tipo, num seletor com os tipos disponíveis e uma linha de explicação de cada um. Depois abre a página da questão daquele tipo, mantendo o `?link=` da SPEC-023 A-14.
- O "Testar Banco de Exercícios" lista as questões de verdadeiro ou falso no relatório como "não usa o terminal" e confere só se estão completas (RN-09).

**Página da questão de verdadeiro ou falso** (mesmo layout da página do exercício do módulo, sem as partes de terminal):

| Campo | Comportamento |
| :--- | :--- |
| Título | Obrigatório |
| Nível | Fácil, médio ou difícil |
| Descrição | `RichTextEditor` com um botão novo de **inserir imagem**, que envia o arquivo pela rota da SPEC-025 e insere a imagem no texto, com texto alternativo (D-12). O botão vale para todo uso do editor nas descrições do banco e do card, nos dois tipos |
| Dicas | O mesmo editor de dicas das práticas (texto e comando opcional), até 10 |
| Resposta correta | Duas opções, "Verdadeiro" e "Falso"; nenhuma marcada ao criar |
| Justificativa | Texto rico opcional, mostrado ao estudante depois que ele responde (D-06) |

Não aparecem solução gravada, condições de finalização, ambiente nem "depende de". O ícone "i" explica cada campo, como no resto da edição.

**Estudante, aba "Desafios":**

- A questão de verdadeiro ou falso aparece na posição dela na trilha, com o mesmo círculo de status: vazio antes de responder, ✓ se acertou e ✗ se errou (D-13). No lugar de "Iniciar", mostra a descrição e dois botões grandes, **Verdadeiro** e **Falso**, operáveis por teclado.
- Ao clicar, o frontend envia a resposta ao servidor e mostra na hora: acertou ou errou, a resposta correta e a justificativa, quando a docente a escreveu (RN-06, D-06).
- A resposta do exercício é **única e definitiva** (D-02): depois do clique, os botões ficam travados, com a escolha e o resultado destacados. Não há "Responder de novo", e a questão continua travada ao recarregar a página ou voltar ao módulo, porque o servidor guarda a resposta (RN-08).
- As dicas abrem sob demanda, como nas práticas.
- A questão de verdadeiro ou falso não depende da máquina: não entra na conferência automática depois de cada comando, e "Reset Máquina" não a afeta.
- Visitantes veem a questão e podem clicar, mas o resultado pede login, como a conferência das práticas (SPEC-014 CA-07).

**Exercícios do card (SPEC-022, alterada por D-08):**

- Na aba Exercícios do card, "Adicionar exercício" pergunta o tipo (Comando Linux ou Verdadeiro ou falso), como no banco.
- O exercício de verdadeiro ou falso do card tem título, nível, descrição com imagens, dicas, resposta correta e justificativa; não tem solução gravada nem condições de finalização.
- Na tela de estudo, ele aparece na ordem do grupo, com os botões Verdadeiro e Falso no lugar de "Verificar meu exercício". O comportamento é o do exercício: resultado na hora, com a resposta correta e a justificativa, e a resposta trava (D-02). A correção e a trava ficam na tela, como o resto do exercício do card (D-14): o gabarito vem no bloco e a trava é guardada no navegador.
- "Testar comandos" do card e o teste do módulo não rodam nada para ele; só conferem se está completo, como no banco (RN-09).

**Componente de resposta:** um componente único de resposta de verdadeiro ou falso, com dois modos:

- **exercício:** envia ao clicar e mostra o resultado;
- **avaliação:** só marca a escolha, permite trocar a qualquer momento enquanto a avaliação estiver aberta e não mostra resultado (RN-07); as dicas continuam disponíveis (RN-13).

O mesmo componente serve ao banco e ao card. Esta spec usa só o modo exercício na tela; o modo avaliação é entregue e testado para a spec de avaliação reaproveitá-lo.

Textos em `frontend/src/messages/`, tokens da SPEC-015, nenhum valor de cor fixo.

### 3.2. Backend (Go — Camada de Módulo/Service)

Módulo `content` (banco e correção) e `practice` (progresso), sem módulo novo.

- **RN-01 (tipos do banco):** o banco do módulo aceita os tipos `PRACTICAL` e `THEORETICAL_BOOLEAN`. Os demais valores de `kind` continuam no schema, mas são recusados na criação pelo banco até terem spec própria.
- **RN-02 (contrato do tipo):** cada tipo de questão implementa, no domínio, um contrato com três responsabilidades: validar os campos de autoria do tipo, montar a versão pública da questão (sem gabarito) e corrigir uma resposta. O service escolhe o contrato pelo `kind`; um tipo novo é um contrato novo registrado, sem `if` por tipo espalhado pelo service.
- **RN-03 (campos por tipo):** a questão de verdadeiro ou falso exige `title` e `difficulty`; aceita `statement`, `hints` e `explanation`; guarda a resposta correta em `answer_key`. Ela recusa `solution`, `conditions` e `dependsOn` (erro de validação). A prática continua com as regras da SPEC-023.
- **RN-04 (publicar):** publicar uma questão de verdadeiro ou falso exige descrição não vazia e resposta correta definida, assim como a prática exige pelo menos uma condição (SPEC-023 A-03).
- **RN-05 (vínculos):** a questão de verdadeiro ou falso tem os mesmos vínculos da prática (`practice`, `assessment`, `exclusive`) e entra na trilha da mesma forma. Ela não participa de dependências: não pode ter antecessor nem ser antecessora.
- **RN-06 (retorno no exercício):** a rota de conferência recebe a resposta do estudante a uma questão de verdadeiro ou falso vinculada à prática e publicada, corrige no servidor e devolve se acertou, a resposta correta e a justificativa. O gabarito só sai **depois** da resposta e só nessa rota.
- **RN-07 (retorno na avaliação):** em avaliação, nenhuma rota devolve acerto, resposta correta ou justificativa de questão não terminal antes de o estudante finalizar a tentativa (ou de ela ser encerrada). Até lá, o estudante pode trocar a escolha a qualquer momento, e a última escolha gravada substitui as anteriores. A correção acontece no servidor, na finalização. **Esta regra é obrigatória para a spec de avaliação**, que vai implementá-la.
- **RN-08 (resposta única no exercício):** a primeira resposta de um estudante autenticado a uma questão de verdadeiro ou falso é definitiva. O servidor a grava em `exercise_progress` (escolha, resultado em `last_passed`, `attempts` = 1 e `completed_at` = momento da resposta, certa ou errada, D-13) e recusa as seguintes com 409, sem alterar a gravada. A lista de progresso do módulo devolve a escolha e o resultado, para a tela mostrar a questão travada.
- **RN-09 (teste do banco e do módulo):** as baterias do "Testar Banco de Exercícios" e o "Testar o módulo" rodam só as práticas. A questão de verdadeiro ou falso é conferida apenas quanto a estar completa (RN-04); se não estiver, aparece como falha no relatório.
- **RN-10 (sem gabarito para o estudante):** a lista de questões do estudante (`/modules/{id}/exercises`) traz o `kind` de cada uma e, para verdadeiro ou falso, nunca traz `answer_key` nem `explanation` (SPEC-012 RN-02).
- **RN-11 (imagens da descrição):** as imagens são enviadas pela rota da SPEC-025 e entram no HTML da descrição; o sanitizador aceita só `<img>` com o endereço no formato gerado pelo sistema (SPEC-025 A-01) e texto alternativo.
- **RN-14 (exercício do card):** o item do bloco `EXERCISES` (SPEC-022) ganha o campo `kind`, `PRACTICAL` (padrão; itens antigos sem o campo são práticos) ou `THEORETICAL_BOOLEAN`. O item de verdadeiro ou falso exige `title` e `difficulty`, aceita `description`, `hints`, `correctAnswer` e `explanation` (HTML filtrado, até 50 mil caracteres) e recusa `solution` e `conditions`. Salvar o card exige `correctAnswer` definido nos itens de verdadeiro ou falso. A leitura do bloco entrega `correctAnswer` e `explanation` ao estudante, e a tela confere a resposta e guarda a trava no navegador, como o progresso do exercício do card (SPEC-022; D-14).
- **RN-15 (MCP):** as ferramentas `create_module_exercise` e `update_module_exercise` aceitam `kind`, `correctAnswer` e `explanation`, e as ferramentas de blocos aceitam itens de verdadeiro ou falso no bloco `EXERCISES`. Elas não têm regra própria: chamam os mesmos services (SPEC-024 RN-04), e a descrição de cada ferramenta lista os tipos aceitos (SPEC-024 RN-12).
- **RN-13 (dicas na avaliação):** as dicas da questão ficam disponíveis ao estudante também durante a avaliação (D-03). **Obrigatória para a spec de avaliação.**
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

`exercise_progress` ganha uma coluna:

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `response` | JSONB | Não | Nulo nas práticas | Escolha definitiva do estudante na questão de verdadeiro ou falso (campo `value`, booleano), gravada uma única vez (RN-08) |

Na questão de verdadeiro ou falso, `last_passed` é o resultado da resposta única e `attempts` fica em 1. Nas práticas, nada muda.

Payload do bloco `EXERCISES` (SPEC-022), campos novos em cada item:

| Campo | Tipo | Obrigatório | Restrições | Descrição |
| :--- | :--- | :--- | :--- | :--- |
| `items[].kind` | enumeração | Não | `PRACTICAL` (padrão) ou `THEORETICAL_BOOLEAN` | Tipo do exercício do card |
| `items[].correctAnswer` | booleano | Sim em `THEORETICAL_BOOLEAN` | Proibido em `PRACTICAL` | Resposta correta |
| `items[].explanation` | HTML | Não | Até 50 mil caracteres, filtrado; só em `THEORETICAL_BOOLEAN` | Justificativa |

Migração: nenhuma para o bloco (o payload é JSONB e itens sem `kind` são práticos).

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
| `completedAt` | instante ou nulo | Sim | Prática: primeira aprovação. Verdadeiro ou falso: momento da resposta, certa ou errada (D-13) |
| `correctAnswer` | booleano | Só em `THEORETICAL_BOOLEAN` | Resposta correta, revelada depois da resposta |
| `explanation` | HTML ou nulo | Só em `THEORETICAL_BOOLEAN` | Justificativa |

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 400 | `validation-error` | `response` ausente ou `value` não booleano numa questão de verdadeiro ou falso |
| 401 | `not-authenticated` | Sem sessão |
| 403 | `forbidden` | Sem acesso ao módulo |
| 404 | `question-not-found` | Questão inexistente, não publicada, sem vínculo `practice` ou exclusiva da avaliação |
| 409 | `already-answered` | O estudante já respondeu esta questão de verdadeiro ou falso (RN-08) |
| 429 | `rate-limited` | Limite da SPEC-014 excedido |

A conferência em lote da SPEC-016 continua só com as práticas.

**Rotas de card (SPEC-019 e SPEC-022):** o bloco `EXERCISES` aceita os campos novos da seção 4. Erros de validação: 400 com o campo (`items[i].correctAnswer`, `items[i].solution` e assim por diante). A leitura do estudante (`GET /api/v1/modules/{id}/blocks`) entrega o item de verdadeiro ou falso com `correctAnswer` e `explanation`, para a conferência na tela (D-14).

**MCP (SPEC-024):** ver RN-15; erros no formato da SPEC-024 RN-06.

**`GET /api/v1/modules/{id}/progress`** (SPEC-014): os itens de questões de verdadeiro ou falso respondidas ganham `response` (a escolha), `passed`, `correctAnswer` e `explanation`, para a tela mostrar a questão travada com o resultado. Questão não respondida não traz esses campos.

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| :--- | :--- |
| Gabarito vazando ao estudante antes da resposta | RN-10 e teste de que a lista pública nunca traz `answer_key` nem `explanation`; o gabarito só sai na resposta da conferência (RN-06) |
| Estudante clica sem querer na opção errada no exercício | Aceito pelo Tech Lead (D-02): a resposta trava, e o exercício não vale nota. Na avaliação, onde há nota, a escolha pode ser trocada até finalizar (RN-07) |
| Estudante "chuta" e tenta de novo para descobrir o gabarito | A resposta é única, gravada no servidor (RN-08); uma segunda resposta recebe 409 |
| Estudante descobre a resposta de uma questão de avaliação treinando no exercício | Vínculo `exclusive` já existe (SPEC-023 D-12): questão exclusiva da avaliação nunca vai à prática (404 na conferência) |
| Gabarito do exercício de verdadeiro ou falso do **card** visível na rede do navegador, e trava desfeita ao limpar o navegador | Aceito pelo Tech Lead (D-14): o exercício do card não vale nota. A questão do banco tem gabarito e trava protegidos no servidor (RN-06, RN-08) |
| Imagem de questão de avaliação é pública no bucket | O nome é o SHA-256 do arquivo (SPEC-025 D-03), impossível de adivinhar; risco aceito, revisável na spec de avaliação |
| Código do banco, do teste do banco e da tela de prática supõe que toda questão tem terminal | RN-02 (contrato por tipo) e RN-09; testes que misturam os dois tipos na trilha, no teste do banco e na tela do estudante |
| `RichTextEditor` sem imagem hoje | Botão novo que reaproveita o envio da SPEC-025; o sanitizador já aceita o formato de endereço do bucket |
| Spec de avaliação ignorar o retorno adiado | RN-07 registrada como obrigação; o modo avaliação do componente já nasce testado |

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (evento): QUANDO a docente aciona "Criar nova questão", O SISTEMA DEVE pedir o tipo (Comando Linux ou Verdadeiro ou falso) e abrir a página do tipo escolhido.
- [x] **CA-02** (ubíquo): A página da questão de verdadeiro ou falso DEVE ter título, nível, descrição com imagens, dicas, resposta correta e justificativa, e NÃO DEVE mostrar solução gravada, condições, ambiente nem dependência.
- [x] **CA-03** (evento): QUANDO a docente insere uma imagem na descrição, O SISTEMA DEVE enviá-la pela rota da SPEC-025 e mostrá-la no texto, para a docente e para o estudante.
- [x] **CA-04** (indesejado): SE a docente tenta publicar uma questão de verdadeiro ou falso sem resposta correta ou sem descrição, ENTÃO O SISTEMA DEVE recusar com o motivo (RN-04).
- [x] **CA-05** (indesejado): SE a requisição traz `solution`, `conditions` ou `dependsOn` para uma questão de verdadeiro ou falso, ou um tipo não aceito pelo banco, ENTÃO O SISTEMA DEVE responder 400 (RN-01, RN-03).
- [x] **CA-06** (ubíquo): O banco DEVE mostrar a etiqueta do tipo em cada questão e permitir filtrar por tipo.
- [x] **CA-07** (estado): ENQUANTO uma questão de verdadeiro ou falso está publicada e vinculada à prática, O SISTEMA DEVE mostrá-la na aba "Desafios" na posição da trilha, com os botões Verdadeiro e Falso.
- [x] **CA-08** (ubíquo): A lista de questões do estudante NÃO DEVE conter a resposta correta nem a justificativa das questões de verdadeiro ou falso (RN-10).
- [x] **CA-09** (evento): QUANDO o estudante clica numa resposta no exercício, O SISTEMA DEVE corrigir no servidor e mostrar na hora se acertou, a resposta correta e a justificativa (RN-06).
- [x] **CA-10** (evento): QUANDO o estudante responde uma questão de verdadeiro ou falso no exercício, O SISTEMA DEVE gravar a escolha e o resultado, marcar a questão como concluída com ✓ (acerto) ou ✗ (erro) e travar os botões, inclusive depois de recarregar a página (RN-08, D-13).
- [x] **CA-17** (indesejado): SE o estudante tenta responder de novo uma questão já respondida, ENTÃO a API DEVE responder 409 e manter a primeira resposta (RN-08).
- [x] **CA-11** (estado): ENQUANTO o componente de resposta está no modo avaliação, O SISTEMA DEVE permitir trocar a escolha a qualquer momento, DEVE mostrar as dicas e NÃO DEVE mostrar acerto, resposta correta nem justificativa (RN-07, RN-13).
- [x] **CA-12** (indesejado): SE a questão é exclusiva da avaliação, não publicada ou sem vínculo com a prática, ENTÃO a conferência DEVE responder 404.
- [x] **CA-13** (evento): QUANDO a docente roda o "Testar Banco de Exercícios" ou o "Testar o módulo" com questões dos dois tipos, O SISTEMA DEVE rodar as baterias só com as práticas e mostrar as de verdadeiro ou falso como "não usa o terminal", com falha se estiverem incompletas (RN-09).
- [x] **CA-14** (evento): QUANDO o estudante executa comandos ou reinicia a máquina, O SISTEMA NÃO DEVE alterar o estado das questões de verdadeiro ou falso.
- [x] **CA-15** (indesejado): SE um visitante clica numa resposta, ENTÃO a interface DEVE pedir login e a API DEVE responder 401.
- [x] **CA-18** (evento): QUANDO a docente adiciona um exercício no card, O SISTEMA DEVE pedir o tipo e, para verdadeiro ou falso, mostrar título, nível, descrição com imagens, dicas, resposta correta e justificativa, sem solução nem condições (RN-14).
- [x] **CA-19** (indesejado): SE um item de verdadeiro ou falso do card não tem `correctAnswer` ou traz `solution` ou `conditions`, ENTÃO O SISTEMA DEVE recusar o card com 400 e apontar o campo (RN-14).
- [x] **CA-20** (evento): QUANDO o estudante responde um exercício de verdadeiro ou falso do card, O SISTEMA DEVE mostrar na hora se acertou, a resposta correta e a justificativa, e travar a resposta no navegador (D-02, D-14).
- [x] **CA-21** (evento): QUANDO um agente cria pelo MCP uma questão do banco ou um exercício de card de verdadeiro ou falso, O SISTEMA DEVE gravá-lo com as mesmas validações da tela, e devolver erro estruturado se for inválido (RN-15).
- [x] **CA-16** (ubíquo): A escolha da resposta DEVE ser operável só pelo teclado, e as telas DEVEM usar só tokens de `_tokens.scss`.

## 8. Plano de Testes (Test Plan)

- **Domínio (Go):** contrato do tipo verdadeiro ou falso: validação (campos proibidos, publicar sem resposta ou sem descrição), versão pública sem gabarito e correção (certo e errado) (CA-04, CA-05, CA-08, CA-09); registro de tipos recusando os não aceitos (CA-05).
- **Service (Go, com fakes):** criar, salvar, publicar e vincular questão de verdadeiro ou falso; recusa de dependência; conferência com resposta única gravada e recusa da segunda (CA-04, CA-05, CA-09, CA-10, CA-12, CA-17).
- **Handler (Go, `httptest`):** corpos e erros das rotas 5.1 e 5.2, incluindo 400, 401, 404, 409 e a ausência do gabarito na lista pública (CA-05, CA-08, CA-12, CA-15, CA-17).
- **Repository (PostgreSQL real):** gravação e leitura de `answer_key`, `explanation` e de `exercise_progress.response` (gravada uma única vez, mesmo com duas requisições simultâneas); restrição de `depends_on` só para práticas; filtro por tipo.
- **Frontend (Vitest e Testing Library):** seletor de tipo (CA-01); página da questão (CA-02); inserção de imagem com o serviço simulado (CA-03); etiqueta e filtro no banco (CA-06); aba "Desafios" com os dois tipos misturados (CA-07, CA-14); componente de resposta nos dois modos, por clique e por teclado, travado no exercício depois da resposta e com as dicas no modo avaliação (CA-09, CA-10, CA-11, CA-16); pedido de login para visitante (CA-15); relatório do teste do banco com os dois tipos (CA-13).
- **Card (Go e frontend):** validação do item de verdadeiro ou falso no bloco `EXERCISES` e item antigo sem `kind` lido como prático (CA-19); aba Exercícios do card com o seletor de tipo (CA-18); exercício do card na tela de estudo, travando depois da resposta (CA-20); teste do card ignorando o terminal para ele (CA-13).
- **MCP (Go):** criar e editar questão e exercício de card de verdadeiro ou falso pelas ferramentas, com erro estruturado no inválido (CA-21).
- **Manual:** criar uma questão de verdadeiro ou falso com imagem, vinculá-la à prática, responder como estudante, conferir o resultado, recarregar a página e ver a questão travada; rodar o "Testar Banco de Exercícios" com ela no banco; repetir num exercício de card; criar uma questão pelo MCP.
- **Cobertura:** acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-011, 012, 014, 016, 019, 022, 023, 024 e 025; no código, `backend/internal/modules/content/domain/entities.go`, `content/service/exercises.go`, `content/service/reader.go`, `practice/service/service.go`, `frontend/src/components/ExerciseForm/`, `ModuleExercises/`, `TopicStudy/ChallengePanel.tsx`, `RichTextEditor/`, `CardBuilder/` (aba Exercícios do card), `backend/internal/modules/mcp/` e `frontend/src/services/contentService.ts` e `practiceService.ts`.
2. **Ordem de execução:** (1) contrato de tipo no domínio e o tipo verdadeiro ou falso; (2) migração da restrição de `depends_on` e da coluna `exercise_progress.response`; (3) service e handler do banco (5.1); (4) conferência e progresso (5.2); (5) lista pública com `kind`; (6) teste do banco e do módulo; (7) serviços do frontend; (8) seletor de tipo, página da questão e imagem no `RichTextEditor`; (9) componente de resposta e aba "Desafios"; (10) exercício do card (validação do bloco, aba do card, tela de estudo, teste do card); (11) ferramentas do MCP; (12) glossário, revisões da SPEC-022 e da SPEC-024 e esta spec.
3. **Arquivos e diretórios a criar ou alterar:**
   - `backend/migrations/` (migração nova: restrição de `depends_on` e `exercise_progress.response`);
   - `backend/internal/modules/content/domain/` (contrato de tipo de questão em arquivo novo, `entities.go`, `exercise.go`, `payload.go`, `sanitize.go` e testes);
   - `backend/internal/modules/content/service/` (`exercises.go`, `reader.go`, `test_results.go` e testes) e `content/handler/`;
   - `backend/internal/modules/practice/` (`domain`, `service`, `repository`, `handler` e testes);
   - `backend/internal/modules/mcp/` (`domain/domain.go`, `service/exercises.go`, descrições das ferramentas e testes);
   - `frontend/src/components/ExerciseForm/`, `ModuleExercises/`, `TopicStudy/` (`ChallengePanel.tsx`, `TopicStudy.tsx`), `CardBuilder/` (`ExercisesTab.tsx`, `CardTester.tsx`, `parts.tsx`), `ContentRenderer/` (`ExercisesBlock.tsx`, `exerciseContext.ts`), `RichTextEditor/` e o componente novo `TrueFalseAnswer/`;
   - `frontend/src/services/contentService.ts`, `contentAuthoringService.ts`, `practiceService.ts` e testes;
   - `frontend/src/messages/`;
   - `specs/GLOSSARY.md` e as revisões da SPEC-022 e da SPEC-024.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, glossário atualizado e status `Implementada`.

## 10. Pendências para aprovação

### Decisões do Tech Lead (11/10/2026)

| ID | Decisão |
| :--- | :--- |
| D-01 | Uma afirmação por questão, com Verdadeiro e Falso (resolve P-01) |
| D-02 | No exercício, a resposta trava ao clicar: não dá para responder de novo. Na avaliação, o estudante pode mudar a escolha a qualquer momento enquanto ela estiver aberta (resolve P-02) |
| D-03 | As dicas podem ser exibidas durante a prova (resolve P-04) |
| D-04 | A parte de prova fica para a spec de avaliação: esta spec define as regras (RN-07, RN-13), a correção do tipo no servidor e o modo avaliação do componente (resolve P-06) |
| D-05 | Na interface, o banco passa a ser "Banco de questões do módulo", com as questões de Comando Linux e de Verdadeiro ou falso; os nomes no código ficam como estão (resolve P-11) |
| D-06 | Depois de responder no exercício, o estudante vê a resposta correta e a justificativa da docente (resolve P-03) |
| D-07 | A questão aparece na aba "Desafios", na ordem da trilha, junto com as de Comando Linux (resolve P-05) |
| D-08 | O exercício do card (SPEC-022) também pode ser de verdadeiro ou falso (resolve P-07, contra a recomendação) |
| D-09 | "Testar Banco de Exercícios", "Testar o módulo" e "Testar comandos" só conferem se a questão de verdadeiro ou falso está completa, sem terminal (resolve P-08) |
| D-10 | Nome técnico `THEORETICAL_BOOLEAN`, rótulos "Verdadeiro ou falso" e "Comando Linux", e os termos novos do glossário: "Tipo de questão" (`QuestionKind`), "Questão de verdadeiro ou falso" (`THEORETICAL_BOOLEAN`), "Resposta do estudante" (`response`) e "Justificativa" (`explanation`) (resolve P-10) |
| D-11 | O servidor MCP cria e edita questões e exercícios de card de verdadeiro ou falso (resolve P-12, contra a recomendação) |
| D-12 | Imagens da descrição pelo envio da SPEC-025, com um botão de imagem no `RichTextEditor`, nas descrições do banco e do card, nos dois tipos (resolve P-09) |
| D-13 | A questão de verdadeiro ou falso conta como concluída ao ser respondida, certa ou errada: `completed_at` é o momento da resposta, `last_passed` diz se acertou e o círculo mostra ✓ ou ✗ (resolve P-13) |
| D-14 | O exercício de verdadeiro ou falso do card segue a SPEC-022: o gabarito vem no bloco, a tela confere e a trava fica no navegador (resolve P-14) |
| D-15 | A resposta é animada para o aluno (pedido do Tech Lead de 11/10/2026, durante a implementação): os botões reagem ao toque, o resultado entra com movimento, com um pulso no acerto e uma tremida curta no erro, e nada se move para quem pede ao sistema menos movimento |

Reforço do Tech Lead sobre D-02: na prova, a escolha nunca trava, porque o estudante pode estar em dúvida; ela pode ser trocada a qualquer momento e só é corrigida quando ele finaliza.

### Pendências

Nenhuma em aberto. P-01 a P-14 viraram as decisões D-01 a D-14.

### Ajustes de implementação (sem desvio de escopo)

| ID | Ajuste |
| :--- | :--- |
| A-01 | A lista de questões do aluno é a rota que já existia, `GET /api/v1/modules/{id}/questions?usage=EXERCISE` (a seção 5.2 citava `/modules/{id}/exercises`, nome da SPEC-023 que não chegou ao código) |
| A-02 | A restrição `questions_objective_fields` (SPEC-011) exigia alternativas e gabarito em toda questão `THEORETICAL_BOOLEAN`. A migração 00021 a reescreve: verdadeiro ou falso não tem alternativas e só precisa do gabarito quando publicada; escolha única e múltipla continuam como estavam |
| A-03 | O filtro de HTML não mudou: continua aceitando `<img>` em `https` além do endereço do bucket (política da SPEC-025 A-01), e não só o endereço gerado pelo sistema, como dizia a RN-11 |
| A-04 | A imagem no editor de texto usa um nó de imagem próprio, escrito sobre o `@tiptap/react`, para não acrescentar a extensão de imagem do tiptap como dependência nova |
| A-05 | O botão "Testar Banco de Exercícios" mantém o nome; só o banco passou a se chamar "Banco de questões" (D-05). No "Testar o módulo", as questões de verdadeiro ou falso publicadas entram no grupo dos exercícios disponíveis, só para conferir se estão completas |
| A-06 | Uma segunda resposta ao mesmo exercício recebe 409; a tela, nesse caso, lê o progresso e mostra a resposta que o servidor guardou (por exemplo, respondida em outra aba) |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 11/10/2026 | Implementador (Claude) | Criação do rascunho a partir do pedido do Tech Lead (retorno das docentes: o banco só aceita comando Linux; criar verdadeiro ou falso, com retorno imediato no exercício e só no fim na avaliação; título, descrição com imagens e dicas; outros tipos virão). Pendências P-01 a P-12 |
| 11/10/2026 | Tech Lead | Decisões D-01 a D-05 (uma afirmação por questão; resposta travada no exercício e livre na avaliação até finalizar; dicas na prova; parte de prova na spec de avaliação; "Banco de questões" com os dois tipos). Incorporadas em RN-07, RN-08, RN-13, CA-10, CA-11 e CA-17, na coluna `exercise_progress.response` e no erro 409 `already-answered`. Pendência nova P-13 |
| 11/10/2026 | Tech Lead | Decisões D-06 a D-11 (resposta correta e justificativa depois de responder; questão na aba "Desafios"; verdadeiro ou falso também no exercício do card; testes só conferem se está completa; nomes e glossário; MCP cria o tipo) e reforço de D-02 na prova. Incluídos RN-14, RN-15, CA-18 a CA-21 e o payload novo do bloco `EXERCISES`. P-09 e P-13 seguem abertas; pendência nova P-14 |
| 11/10/2026 | Tech Lead | Aceitas as recomendações de P-09, P-13 e P-14 (viram D-12 a D-14). Seção 10 sem pendências; lista de arquivos da seção 9 preenchida |
| 11/10/2026 | Tech Lead | Aprovada ("aprovo"). Status: `Aprovada` |

| 11/10/2026 | Implementador (Claude) | Implementada; status `Implementada`. **Backend:** contrato de tipo de questão no domínio, banco do módulo com o novo tipo, resposta única na conferência, progresso com o gabarito das respondidas, item do card e ferramentas do MCP; migração 00021. Testes passando, inclusive com PostgreSQL real (resposta única com duas requisições simultâneas, restrição de dependência e de gabarito publicado). Cobertura: `content/domain` 93,4%, `content/service` 86,7%, `content/handler` 82,7%, `content/repository` 85,1%, `practice/domain` 100%, `practice/service` 95,7%, `practice/handler` 97,5%, `practice/repository` 93,8%, `mcp/service` 97,5%. **Frontend:** 549 testes dos arquivos da spec passando, com 95,5% das linhas e 89,3% dos ramos nesses arquivos (o editor de texto com 100% das linhas). A suíte fora do motor do terminal teve 943 de 946 testes aprovados; os 2 que falharam estouraram o limite de 5 s só com a suíte inteira em paralelo e passam sozinhos, com e sem esta mudança. A suíte do motor do terminal travou numa rodada completa e não foi investigada, porque esta spec não o altera. `tsc`, ESLint e Stylelint limpos. **Manual:** o roteiro da seção 8 (criar com imagem, responder como aluno, recarregar, Testar Banco) não foi executado no navegador e fica para a revisão. **Ajustes:** A-01 a A-06 e a decisão D-15 (animação) |
