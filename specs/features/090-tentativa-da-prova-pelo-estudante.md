# SPEC-090: Tentativa da Prova pelo Estudante (Entrar, Resolver, Entregar e Nota Preliminar)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-090 |
| **Status** | Aprovada |
| **Data de criação** | 03/11/2026 |
| **Última revisão** | 04/11/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `assessment` (backend: a tentativa, as respostas, a conferência, a entrega, o vencimento e a nota preliminar; frontend: a janela da prova do estudante e a lista de tentativas da docente) |
| **Contexto de tela** | `/app/classes/[id]/assessments/[assessmentId]` (o botão *Entrar na prova* do estudante e a seção *Tentativas* da docente) e a rota nova `/app/classes/[id]/assessments/[assessmentId]/take` (a janela da prova) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-075 (RN-10, RN-14), SPEC-076 (RN-07, `AttemptCheck`), SPEC-077 (duração individual), SPEC-083 e SPEC-089 (o início pela docente), SPEC-084, SPEC-085 e SPEC-087 (a tela do aluno, o terminal e a conferência da questão prática no simulador), SPEC-035 a SPEC-039 (os tipos de questão) |
| **Substitui** | Nenhuma. Reescreve no modelo a parte de **tentativa, entrega e nota preliminar** do rascunho `052-avaliacao-telemetria-player-sessao.md`, como pediu a SPEC-075 D-01; a telemetria forense e o player do rascunho continuam fora |
| **Fontes canônicas** | `docs/arquitetura/transicao-backend.md`: seções 4.3 (início), 4.4 (submissão da questão e finalização) e 6.4.1 (encerramento não é anulação); o rascunho 052 (seções 2 e 3); pedido do Tech Lead de 03/11/2026: ao iniciar a prova, os alunos fazem a prova e a docente acompanha (o acompanhamento é a SPEC-091) |

---

## 1. Contexto e Problema (Context & Problem Statement)

A plataforma já agenda a prova (SPEC-075), decide quem pode entrar (`AccessOf`), deixa a docente iniciá-la (SPEC-083 e 089) e simula a prova para a docente com a tela do aluno, o terminal e a conferência da questão prática (SPEC-081, 084, 085 e 087). Mas **o estudante ainda não faz a prova**: não existe a tentativa. Quando a docente inicia a prova, o aluno lê que pode entrar e não há para onde ir. Sem a tentativa, também não há o que a docente acompanhar ao vivo (SPEC-091), corrigir ou homologar.

## 2. Objetivos (Goals)

- O estudante com acesso `ALLOWED` **entra na prova**: o servidor cria a tentativa dele, fixa as questões (as escolhidas, ou o sorteio dele) e o prazo, e abre a janela da prova.
- Na janela da prova, o estudante resolve cada questão na tela do aluno do simulador: escolha única, verdadeiro ou falso, ligar colunas, descritiva e prática no terminal. Cada resposta é **salva no servidor** enquanto ele trabalha.
- A questão prática é conferida pelo servidor, como no simulador (SPEC-085): o estudante sabe se a máquina já cumpre o pedido.
- O estudante que fecha a janela ou perde a conexão **volta para a mesma tentativa**, com as respostas e as máquinas salvas.
- O estudante **entrega** a prova. No fim do prazo, a prova é entregue sozinha, com 1 minuto de tolerância para a rede.
- Na entrega, o servidor calcula a **nota preliminar** das questões objetivas e práticas; a descritiva fica pendente da docente.
- A docente vê, no detalhe da avaliação, a lista das tentativas: aluno, situação, início, entrega e nota preliminar.

### 2.1. Fora de escopo (Non-Goals)

Toda IA implementadora deve tratar esta lista como proibição.

- A **sala da prova ao vivo** da docente: sala de espera, tela do aluno ao vivo, pedido de ajuda, comandos em tempo real e encerrar a prova de um aluno (SPEC-091).
- Tempo real de qualquer tipo: nesta spec, a janela da prova fala com o servidor só por REST.
- **Telemetria forense** (mouse, atalhos proibidos, perda de foco, copiar e colar) e o **player** de sessão (resto do rascunho 052).
- **Correção e homologação**: nota da descritiva, ajuste manual, anulação, homologação, correção em lote pelo MCP e o estudante ver a nota (rascunho `revisao-avaliacoes-telemetria-mcp`). Nesta spec o estudante vê só que entregou.
- Token de sala, troca de máquina com aviso à docente, repescagem e segunda chamada.
- A **atividade** (`ASSIGNMENT`): a tentativa desta spec é só da prova (`EXAM`). A atividade ganha a sua em spec própria (D-05).
- Mais de uma tentativa por aluno: cada aluno tem no máximo uma tentativa por prova.
- Qualquer mudança em `frontend/src/engine/core/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Tema único escuro, tokens semânticos, textos em `messages/pt-BR.ts`, navegação completa por teclado, contraste WCAG AA e alvos de toque de no mínimo 44 px.

**Detalhe da avaliação, visão do estudante** (o cartão e o aviso de acesso de hoje):

- Com o acesso `ALLOWED` e sem tentativa: o botão primário **Entrar na prova**. Ele abre a janela da prova numa janela própria, como o simulador (SPEC-087).
- Com a tentativa em andamento: o botão **Voltar para a prova**, que abre a mesma janela.
- Com a tentativa entregue ou vencida: a frase "Prova entregue em DD/MM/AAAA, HH:MM." e nenhum botão. A nota não aparece (fora de escopo).

**Janela da prova** (`/take`, só o estudante dono da tentativa):

- O cabeçalho traz o título, o **tempo restante** pelo relógio do servidor (em destaque nos últimos 5 minutos) e o botão **Entregar a prova**.
- O corpo é a tela do aluno do simulador (SPEC-084 e 087): a lista das questões com a marca de respondida, a questão com o enunciado e a resposta e, na prática, o terminal ao lado, com o botão de recomeçar a máquina.
- **Salvar:** a resposta objetiva e a descritiva são salvas ao mudar e ao sair da questão; a máquina da prática é salva depois de cada comando, no máximo uma vez a cada 2 segundos. Um indicador discreto diz "Salvo" ou "Salvando…"; se a gravação falha, aparece "Sem conexão: suas respostas serão enviadas quando ela voltar." e a janela tenta de novo.
- **Questão prática:** o botão **Conferir** pergunta ao servidor; resolvida, a questão ganha a marca e a comemoração do simulador (SPEC-087). As objetivas e a descritiva **não** dizem se estão certas.
- **Entregar:** um diálogo pede a confirmação e diz quantas questões estão sem resposta: "Entregar a prova? N questões estão sem resposta. Depois de entregar, não dá para mudar nada." Confirmado, a janela mostra "Prova entregue." e trava.
- **Fim do prazo:** quando o tempo chega a zero, a janela trava, envia o que falta e entrega sozinha, mostrando "O tempo acabou. Sua prova foi entregue."
- **Volta:** ao reabrir a janela, ela carrega a tentativa com as respostas salvas e cada máquina no último estado salvo; o que foi digitado sem Enter se perde (mudou na revisão 2, abaixo).

**Revisão 2 (04/11/2026): o terminal volta como estava.** Pedido do roteiro manual: o aluno recarregou a janela e o terminal voltou limpo, só com os arquivos.

- **O terminal vai junto com a máquina.** A gravação da prática (RN-04) leva também o terminal 1 da questão: a tela (as últimas 500 linhas), o histórico de comandos, a pasta atual e o usuário. Ao reabrir, a questão volta com a mesma tela, a seta para cima traz os comandos de antes e o aluno continua na mesma pasta. *Reset Máquina* limpa tudo isso, como hoje. Tudo cabe nos 256 KiB da RN-04, e a conferência e a nota continuam olhando só a máquina.
- **Cópia no navegador.** A janela guarda no `localStorage`, por tentativa, o que o servidor ainda não confirmou (as respostas e os terminais) e a linha que o aluno está digitando sem Enter. Ao reabrir no mesmo navegador, isso vale por cima do que veio do servidor e é enviado na hora. Em outro navegador, vale o do servidor. A cópia é apagada quando o servidor confirma a gravação e na entrega. Se o navegador não deixar gravar, a janela segue só com o servidor.

**Detalhe da avaliação, visão da docente e do administrador:** uma seção nova **Tentativas**, depois das questões. Ela traz uma tabela com aluno, RA, situação (*Em andamento*, *Entregue*, *Tempo esgotado*), início, entrega e nota preliminar ("7,50 de 10,00 · 1 descritiva pendente"), e o botão *Atualizar*. Sem tentativas: "Nenhum aluno entrou na prova ainda."

### 3.2. Backend (Go: módulo `assessment`)

- **RN-01 (entrar na prova):** só o estudante, e só com `AccessOf` igual a `ALLOWED`. Só a prova (`EXAM`) tem tentativa; na atividade, 400 `invalid-assessment`. A primeira entrada cria a tentativa; as seguintes devolvem a mesma tentativa em andamento (idempotente). Com a tentativa entregue ou vencida, 409 `attempt-already-submitted`. Sem acesso, 409 com o motivo (`assessment-not-open-yet`, `assessment-not-started`, `assessment-ended`, `assessment-canceled`, `not-cleared`) ou 403 `not-eligible`.
- **RN-02 (as questões da tentativa):** ao criar a tentativa, o servidor fixa a lista das questões com a ordem e o peso. Na composição manual, são as da avaliação. No sorteio, é uma amostra das regras, sorteada para este aluno, com os pesos de cada nível (SPEC-075 RN-07). Para cada questão, o servidor guarda **a visão do aluno** (enunciado, alternativas, colunas e cenário da máquina) e **o gabarito** do momento da entrada. Mudar a questão no banco depois não muda a tentativa.
- **RN-03 (o prazo):** o prazo da tentativa é o menor entre o início dela mais a duração individual (SPEC-077), quando há, e o término da avaliação. O servidor devolve o prazo e o `serverNow`; a janela conta pelo relógio do servidor.
- **RN-04 (salvar a resposta):** o estudante salva a resposta de uma questão da sua tentativa em andamento, até o prazo mais 1 minuto. A resposta é validada pelo tipo: escolha única (uma alternativa existente), verdadeiro ou falso, ligar colunas (pares entre colunas existentes, sem repetir), descritiva (texto filtrado como o editor da SPEC-039, até 10.000 caracteres) e prática (a máquina serializada, até 256 KiB). Salvar de novo substitui. Fora do prazo, 409 `attempt-expired`; entregue, 409 `attempt-already-submitted`.
- **RN-05 (conferir a prática):** o estudante pede a conferência de uma questão prática com a máquina que enviar. O servidor confere com o mesmo motor da SPEC-085, contra o gabarito guardado na tentativa (RN-02), salva a máquina e o resultado e responde se está resolvida. A conferência não muda a nota antes da entrega.
- **RN-06 (entregar):** o estudante entrega a tentativa em andamento até o prazo mais 1 minuto. A situação passa a `SUBMITTED` com o instante da entrega.
- **RN-07 (vencimento):** a tentativa em andamento cujo prazo mais 1 minuto passou é **entregue pelo servidor** com a situação `TIME_EXPIRED`. Isso acontece na primeira leitura ou escrita depois do vencimento e por uma varredura do servidor a cada minuto, para quem não voltou. As respostas salvas até o vencimento valem.
- **RN-08 (nota preliminar):** na entrega, de qualquer forma, o servidor corrige cada questão contra o gabarito guardado. Escolha única e verdadeiro ou falso valem tudo ou nada. Ligar colunas vale a proporção de pares certos (D-01). A prática vale tudo se a última máquina salva cumpre o pedido, conferida de novo na entrega, e nada se não cumpre. A descritiva fica **pendente**. Sem resposta, vale zero. A nota preliminar é a soma dos pontos das corrigidas; a tentativa guarda também quantas estão pendentes.
- **RN-09 (a lista da docente):** a docente dona e o administrador leem as tentativas da avaliação, com o nome e o RA do aluno, a situação, o início, a entrega, a nota preliminar e as pendentes. As respostas de cada aluno não saem nesta spec.
- **RN-10 (o que o estudante lê):** a tentativa que volta ao estudante traz a visão do aluno de cada questão, as respostas salvas, a última máquina de cada prática e se ela já foi conferida como resolvida, mas **nunca** o gabarito nem a nota.
- **RN-11 (a habilitação e a tentativa):** a interface `AttemptCheck` da SPEC-076 (RN-07) passa a responder pela tabela de tentativas: a decisão de habilitação de quem já tem tentativa é recusada com `clearance-locked`.
- **RN-12 (histórico):** a tentativa não grava eventos no histórico da avaliação (SPEC-075 RN-15); ela tem os próprios instantes.

## 4. Modelo de Dados (Data Model)

**`assessment_attempts`** (nova)

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | uuid | Sim | PK (UUIDv7) | — |
| `assessment_id` | uuid | Sim | FK `assessments` | A prova |
| `student_id` | uuid | Sim | FK `students` | O estudante |
| `status` | text | Sim | `IN_PROGRESS`, `SUBMITTED`, `TIME_EXPIRED` | A situação da tentativa |
| `started_at` | timestamptz | Sim | — | Relógio do servidor na entrada |
| `deadline_at` | timestamptz | Sim | `> started_at` | O prazo (RN-03) |
| `submitted_at` | timestamptz | Não | Preenchido fora de `IN_PROGRESS` | A entrega (RN-06, RN-07) |
| `preliminary_score` | numeric(5,2) | Não | Preenchido fora de `IN_PROGRESS` | A nota preliminar (RN-08) |
| `pending_items` | integer | Não | `>= 0`; preenchido fora de `IN_PROGRESS` | Quantas questões esperam a docente |
| `created_at`, `updated_at` | timestamptz | Sim | — | — |

Unicidade: (`assessment_id`, `student_id`). Índice por (`status`, `deadline_at`) para a varredura do vencimento.

**`assessment_attempt_items`** (nova): uma linha por questão da tentativa.

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `attempt_id` | uuid | Sim | FK `assessment_attempts`, PK com `position` | — |
| `position` | integer | Sim | `>= 1` | A ordem na prova |
| `question_id` | uuid | Sim | — | A questão do banco de origem |
| `kind` | text | Sim | Os tipos de questão | O tipo |
| `weight` | numeric(5,2) | Sim | `> 0` | O peso |
| `student_view` | jsonb | Sim | — | O que o aluno vê, fixado na entrada (RN-02) |
| `answer_key` | jsonb | Sim | — | O gabarito, fixado na entrada; nunca sai para o estudante (RN-10) |
| `answer` | jsonb | Não | Validado pelo tipo (RN-04) | A última resposta salva |
| `answered_at` | timestamptz | Não | — | Quando foi salva |
| `checked_solved` | boolean | Não | Só na prática | O resultado da última conferência (RN-05) |
| `points` | numeric(5,2) | Não | `0 <= points <= weight`; nulo na descritiva | Os pontos da correção na entrega (RN-08) |

Exclusão: nenhuma; a tentativa é registro acadêmico. A tentativa e os itens não têm exclusão lógica.

## 5. Contrato de API (API Contract)

Todas sob `/api/v1/classes/:id/assessments/:assessmentId`. Erros em RFC 7807.

| Método e rota | Quem | O que faz | Sucesso |
| :--- | :--- | :--- | :--- |
| `POST .../attempt` | Estudante | Entra na prova: cria ou devolve a tentativa em andamento (RN-01, RN-02, RN-03) | `201` na criação, `200` na volta: a tentativa do estudante |
| `GET .../attempt` | Estudante | Lê a própria tentativa (RN-07, RN-10) | `200` ou `404 attempt-not-found` |
| `PUT .../attempt/items/:position` | Estudante | Salva a resposta de uma questão (RN-04) | `204` |
| `POST .../attempt/items/:position/check` | Estudante | Confere a questão prática (RN-05) | `200` com `solved` |
| `POST .../attempt/submit` | Estudante | Entrega (RN-06, RN-08) | `200`: a tentativa entregue, sem a nota |
| `GET .../attempts` | Docente dona, administrador | A lista das tentativas (RN-09) | `200` |

**A tentativa do estudante** (resposta de `POST` e `GET .../attempt`): `id`, `status`, `startedAt`, `deadlineAt`, `submittedAt` (quando há), `serverNow` e `items`, cada um com `position`, `kind`, `weight`, `studentView`, `answer` (quando há) e `checkedSolved` (só na prática). Nunca `answerKey`, `points` nem `preliminaryScore`.

**A linha da lista da docente:** `attemptId`, `studentId`, `studentName`, `academicId`, `status`, `startedAt`, `submittedAt`, `preliminaryScore` e `pendingItems` (os três últimos só depois da entrega).

**O corpo de `PUT .../items/:position`:** `answer`, no formato do tipo da questão. **O de `.../check`:** `snapshot`, a máquina serializada.

| HTTP | `type` | Quando ocorre |
| :--- | :--- | :--- |
| 400 | `invalid-assessment` | A avaliação é uma atividade (RN-01) |
| 400 | `invalid-answer` | A resposta não vale para o tipo, ou passa do limite (RN-04) |
| 400 | `not-practical` | Conferência de uma questão que não é prática (RN-05) |
| 403 | `forbidden` | Quem pede não é o estudante (nas rotas do estudante) ou não é a docente dona nem o administrador (na lista) |
| 403 | `not-eligible` | O estudante não é elegível |
| 404 | `attempt-not-found` | O estudante não tem tentativa, ou a posição não existe |
| 409 | `assessment-not-open-yet`, `assessment-not-started`, `assessment-ended`, `assessment-canceled`, `not-cleared` | O motivo do acesso (RN-01) |
| 409 | `attempt-already-submitted` | A tentativa já foi entregue (RN-01, RN-04, RN-06) |
| 409 | `attempt-expired` | O prazo mais a tolerância passou (RN-04, RN-06) |

## 6. Impacto e Riscos (Impact & Risks)

- **Perder a resposta por queda de rede.** **Mitigação:** cada resposta é salva ao mudar e a janela tenta de novo; a máquina é salva depois de cada comando; a volta carrega tudo do servidor.
- **Relógio do computador do aluno errado.** **Mitigação:** o prazo vem do servidor, a janela conta pelo `serverNow`, e quem decide o vencimento é o servidor (RN-07).
- **Aluno que nunca volta fica com a tentativa aberta.** **Mitigação:** a varredura a cada minuto (RN-07).
- **O gabarito vazar para o estudante.** **Mitigação:** a RN-10 e um teste que confere as chaves da resposta do estudante.
- **Tamanho das máquinas salvas.** Uma turma de 40 alunos com 5 práticas de até 256 KiB dá cerca de 50 MiB por prova, no pior caso. **Mitigação:** o limite da RN-04 e uma linha por questão, substituída a cada gravação.
- **Muitas gravações seguidas.** **Mitigação:** a máquina é salva no máximo uma vez a cada 2 segundos por aluno.
- **Código de outras specs que muda:** `AttemptCheck` (SPEC-076) deixa de ser a implementação que responde "ninguém começou"; o cartão e o aviso de acesso do estudante ganham o botão. **Mitigação:** os testes dessas specs que mudam são ajustados, com o motivo registrado na entrega.
- **Colisão de número de migração.** **Mitigação:** conferir o próximo número livre imediatamente antes de criar.
- **`legacy/`:** removida; sem impacto.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (evento): QUANDO o estudante com acesso `ALLOWED` entra numa prova, O servidor DEVE criar a tentativa com as questões, os pesos, a visão do aluno, o gabarito e o prazo da RN-03, e devolver `201`; QUANDO ele entra de novo, DEVE devolver a mesma tentativa com `200` (RN-01 a RN-03).
- [x] **CA-02** (indesejado): SE o estudante não tem acesso, ENTÃO A entrada DEVE ser recusada com o motivo da tabela da seção 5 e nenhuma tentativa criada; SE a avaliação é uma atividade, ENTÃO 400 `invalid-assessment`; SE a tentativa já foi entregue, ENTÃO 409 `attempt-already-submitted` (RN-01).
- [x] **CA-03** (ubíquo): Numa prova por sorteio, cada tentativa DEVE ter uma amostra que cumpre as regras do sorteio, com os pesos de cada nível; mudar a questão no banco depois da entrada NÃO DEVE mudar a tentativa (RN-02).
- [x] **CA-04** (evento): QUANDO o estudante salva uma resposta válida, O servidor DEVE guardá-la, substituindo a anterior; SE a resposta não vale para o tipo ou passa do limite, ENTÃO 400 `invalid-answer`; SE o prazo mais 1 minuto passou, ENTÃO 409 `attempt-expired` (RN-04).
- [x] **CA-05** (evento): QUANDO o estudante confere uma questão prática, O servidor DEVE conferir a máquina contra o gabarito guardado na tentativa, salvar a máquina e o resultado e responder `solved`; numa questão que não é prática, 400 `not-practical` (RN-05).
- [x] **CA-06** (evento): QUANDO o estudante entrega, O servidor DEVE passar a tentativa a `SUBMITTED` e calcular a nota preliminar como a RN-08: tudo ou nada na escolha única e no verdadeiro ou falso, a proporção de pares certos no ligar colunas, a prática pela última máquina conferida de novo, a descritiva pendente e zero sem resposta (RN-06, RN-08).
- [x] **CA-07** (estado): ENQUANTO o prazo mais 1 minuto de uma tentativa em andamento já passou, A primeira leitura ou escrita e a varredura DEVEM entregá-la como `TIME_EXPIRED`, com a nota preliminar das respostas salvas (RN-07).
- [x] **CA-08** (ubíquo): A tentativa devolvida ao estudante NÃO DEVE trazer `answerKey`, `points` nem `preliminaryScore` (RN-10).
- [x] **CA-09** (evento): QUANDO a docente dona ou o administrador lê as tentativas, O servidor DEVE devolver uma linha por tentativa com o aluno, a situação, os instantes e, depois da entrega, a nota preliminar e as pendentes; outro papel recebe 403 (RN-09).
- [x] **CA-10** (indesejado): SE o aluno já tem tentativa, ENTÃO A decisão de habilitação sobre ele DEVE ser recusada com 409 `clearance-locked` (RN-11).
- [x] **CA-11** (estado): ENQUANTO o acesso é `ALLOWED`, O detalhe do estudante DEVE mostrar *Entrar na prova* sem tentativa, *Voltar para a prova* com a tentativa em andamento, e a frase da entrega sem botão depois de entregue.
- [x] **CA-12** (estado): ENQUANTO a tentativa está em andamento, A janela da prova DEVE mostrar o tempo restante pelo relógio do servidor, as questões com a marca de respondida, salvar as respostas como a seção 3.1 e mostrar o estado da gravação; a prática DEVE ter o *Conferir* com a comemoração; as objetivas e a descritiva NÃO DEVEM dizer se estão certas.
- [x] **CA-13** (evento): QUANDO o estudante entrega, A janela DEVE pedir a confirmação com o número de questões sem resposta e, confirmada, travar com "Prova entregue."; QUANDO o tempo chega a zero, DEVE travar, enviar o que falta e entregar sozinha.
- [x] **CA-14** (evento): QUANDO o estudante reabre a janela de uma tentativa em andamento, A janela DEVE carregar as respostas salvas e cada máquina no último estado salvo.
- [x] **CA-15** (estado): ENQUANTO a docente vê o detalhe da prova, A seção *Tentativas* DEVE listar as tentativas com a situação e a nota preliminar, ou dizer que nenhum aluno entrou.
- [x] **CA-16** (ubíquo): Os textos novos DEVEM estar em `messages/pt-BR.ts`, e a janela da prova e os diálogos DEVEM ter navegação por teclado, contraste AA e alvos de 44 px.
- [x] **CA-17** (evento): QUANDO o estudante reabre a janela de uma tentativa em andamento, A questão prática DEVE voltar com a tela, o histórico de comandos, a pasta e o usuário do terminal salvos, e *Reset Máquina* DEVE limpá-los (revisão 2).
- [x] **CA-18** (evento): QUANDO o estudante reabre a janela no mesmo navegador com respostas que o servidor não confirmou ou uma linha digitada sem Enter, A janela DEVE mostrá-las por cima das do servidor, enviá-las e apagar a cópia local quando o servidor confirmar; sem `localStorage`, DEVE seguir só com o servidor (revisão 2).

## 8. Plano de Testes (Test Plan)

Os testes são escritos **antes** do código e rodados vermelhos primeiro (SPEC-038). Nomes em inglês, como no código.

**Backend** (Go: `testing` e `testify`)

- Domain: o prazo (RN-03), a validação da resposta por tipo (RN-04) e a correção de cada tipo, com o ligar colunas proporcional (RN-08) (CA-04, CA-06)
- Service (`attempt`): entrar cria e depois devolve a mesma, as recusas de acesso e de atividade, o sorteio por aluno e as questões fixadas (CA-01 a CA-03); salvar, conferir, entregar e o vencimento na leitura e na varredura (CA-04 a CA-07); a tentativa sem gabarito (CA-08); a lista da docente (CA-09); `AttemptCheck` com a tabela (CA-10)
- Handler (roteador Gin real com `httptest`): as seis rotas, os papéis, os erros RFC 7807 e as chaves das respostas, inclusive a ausência do gabarito (CA-01 a CA-09)
- Repository (PostgreSQL real, `testcontainers-go`): a unicidade por aluno, salvar e substituir a resposta, a busca das vencidas e a migração para cima e para baixo (CA-01, CA-04, CA-07)

**Frontend** (Vitest e Testing Library)

- `assessmentService.test.ts` (ajustado): as seis chamadas (CA-01 a CA-09)
- O detalhe do estudante: os três estados do botão (CA-11)
- A janela da prova (`take/page.test.tsx`): o tempo restante, salvar e o estado da gravação, o *Conferir*, a entrega com a confirmação, o fim do prazo e a volta (CA-12 a CA-14)
- O detalhe da docente: a seção *Tentativas* (CA-15)
- Stylelint, ESLint e `tsc` limpos (CA-16)

**Manual** (roteiro)

1. Criar uma prova online com os cinco tipos de questão e iniciá-la.
2. Como estudante, entrar, responder uma de cada tipo, conferir uma prática, fechar a janela e voltar: tudo deve estar lá.
3. Entregar com uma questão em branco e conferir a confirmação com a contagem.
4. Como docente, conferir a seção *Tentativas* com a nota preliminar e a descritiva pendente.
5. Com outro estudante, deixar o tempo acabar e conferir a entrega automática como *Tempo esgotado*.

**Cobertura:** meta acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, esta spec, as SPEC-075, 076, 077, 083, 084, 085, 087 e 089, e as SPEC-035 a 039. Do código: `backend/internal/modules/assessment/` (inteiro, com atenção a `service/check.go`, `service/read.go` e `AttemptCheck`), `frontend/src/components/AssessmentSimulator/`, os componentes das respostas (`SingleChoiceAnswer`, `TrueFalseAnswer`, `MatchingAnswer`, `DescriptiveAnswer`) e `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/simulate/`.
2. **Ordem de execução:** (a) testes do backend, vermelhos e commitados; (b) a migração, o domínio, o repository, o service, a varredura e o handler; (c) testes do frontend, vermelhos e commitados; (d) o serviço, o botão do estudante, a janela da prova, a seção *Tentativas* e as mensagens; (e) roteiro manual; (f) status e histórico.
3. **Arquivos e diretórios a criar ou alterar:**
   - **Backend, novos:** a migração do próximo número livre, e em `backend/internal/modules/assessment/`: `domain/attempt.go`, `service/attempt.go`, `repository/attempt.go` e `handler/attempt.go`, cada um com o teste ao lado.
   - **Backend, alterados:** `domain/errors.go`, o registro das rotas em `handler/handler.go`, a ligação de `AttemptCheck` e da varredura em `backend/cmd/api/`.
   - **Frontend, novos:** `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/take/` (a página, o estilo e o teste) e, se a janela do simulador não servir como está, uma extração dela em `frontend/src/components/AssessmentSimulator/` que as duas usam.
   - **Frontend, alterados:** `frontend/src/services/assessmentService.ts` e o teste, `frontend/src/components/AssessmentCard/` ou `AssessmentAccessNotice/` (o botão), `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/page.tsx` e o teste (a seção *Tentativas*) e `frontend/src/messages/pt-BR.ts`.
   - **Documentação:** esta spec e `specs/GLOSSARY.md` (a tentativa e os status dela, D-02).
   - **Não alterar:** `frontend/src/engine/core/` e qualquer arquivo fora desta lista sem justificativa no resumo da entrega.
4. **Definição de pronto:** todos os CA marcados, os testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, o roteiro manual feito e o status atualizado para `Implementada`.

## 10. Pendências para aprovação

Nenhuma. O Tech Lead decidiu em 03/11/2026, ao aprovar a spec, as cinco pendências com as recomendações como estavam. As decisões estão incorporadas às seções 2, 3 e 4; esta tabela só as registra.

| ID | Decisão |
| :--- | :--- |
| D-01 | **Ligar colunas vale a proporção de pares certos** (RN-08). |
| D-02 | **Status da tentativa:** `IN_PROGRESS`, `SUBMITTED` e `TIME_EXPIRED`; `ENDED_BY_TEACHER` na SPEC-091 (equivalente a `BLOQUEADO_DOCENTE` e `ENCERRADO_DOCENTE`); o bloqueio cautelar fica fora. O glossário registra a equivalência. |
| D-03 | **O estudante sabe que a prática está resolvida** (RN-05); as objetivas e a descritiva não dizem se estão certas. |
| D-04 | **Tolerância de 1 minuto e varredura a cada minuto** (RN-07). |
| D-05 | **A atividade fica fora**; ganha a tentativa em spec própria. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 03/11/2026 | Aruna Architect | Criação em `Rascunho`, a pedido do Tech Lead, a partir do pedido de 03/11/2026 da sala da prova ao vivo, que precisa da tentativa antes. Reescreve no modelo a parte de tentativa do rascunho 052 (SPEC-075 D-01). Decisões do Tech Lead já incorporadas: duas specs em sequência (esta e a SPEC-091). Cinco pendências abertas (P-01 a P-05), todas com recomendação |
| 03/11/2026 | Tech Lead | Aprovada ("aprovo"), com as recomendações das cinco pendências aceitas como estavam: D-01 a D-05. Status: `Aprovada` |
| 03/11/2026 | Aruna Architect | Seção 10 esvaziada: as pendências viraram as decisões D-01 a D-05 |
| 03/11/2026 | Implementador | Implementada, menos o roteiro manual, por isso o status continua `Aprovada`. **Feito:** CA-01 a CA-16. Backend: migração 00047 (`assessment_attempts` e `assessment_attempt_items`), `domain/attempt.go`, `service/attempt.go` (entrar, salvar, conferir, entregar, vencer, a lista da docente), `repository/attempt.go` (também o `AttemptCheck`), `handler/attempt.go` (as seis rotas), a correção `Grade` no adaptador `cmd/api/assessment_refs.go` e a varredura `attempt-expiry` de um minuto no agendador. Frontend: `ExamRunner` (a janela da prova), a página `/take`, `AttemptAction` (o botão do aluno), `AssessmentAttempts` (a seção da docente), `lib/attemptAnswers.ts`, o `resume` do `ExamTerminal`, o serviço e as mensagens. **Medido:** vermelho pelos motivos esperados (tipos, rotas e componentes inexistentes); verde: `go test` de `assessment` com 97,3% no domain, 84,2% no handler, 88,7% no repository e 84,1% no service, `cmd/api` verde; frontend com 625 testes das pastas da avaliação verdes, 85,4% de cobertura nos arquivos novos, `tsc`, ESLint e Stylelint limpos. **Desvios:** a descritiva respeita o tamanho máximo da própria questão (o do banco), não 10.000 caracteres; `student_id` aponta para `users`, como as outras tabelas da avaliação, e não para `students`; o ligar colunas da tentativa aceita resposta parcial (a correção do banco exige todas as ligações), com o adaptador próprio `gradeLinks`; a descritiva em branco vale zero e não fica pendente. **Testes alterados depois do vermelho:** em `ExamRunner.test.tsx`, só o tipo dos mocks (`as never`), sem mudar o que verificam; `TestMigration00041_UpAndDown` desce e sobe também a 00047. O teste do adaptador de correção foi escrito depois do código e visto vermelho guardando o adaptador à parte. **Aberto:** o roteiro manual (seção 8). |
| 03/11/2026 | Implementador | A SPEC-091 acrescentou o status `ENDED_BY_TEACHER`, que a entrega, as respostas e a conferência tratam como entregue, e a sala de espera antes da entrada na prova. |
| 04/11/2026 | Implementador | Correção achada no roteiro manual: a cópia da questão gravada na tentativa saía com as chaves das alternativas e das colunas em maiúsculas (`ID`, `HTML`, `Left`, `Right`, `Text`), e a janela mostrava as letras sem o texto. As structs ganharam as tags JSON, e a migração 00049 corrige as cópias já gravadas (CA-11). |
| 04/11/2026 | Aruna Architect | **Revisão 2 proposta**, a pedido do Tech Lead no roteiro manual ("se ele recarrega ele perde a questão do terminal [...] deve ser mantido, tanto localmente como via servidor"): o terminal (tela, histórico, pasta e usuário) vai junto com a máquina, e a janela guarda no navegador o que o servidor ainda não confirmou e a linha sem Enter. CA-17 e CA-18 novos. |
| 04/11/2026 | Tech Lead | Revisão 2 aprovada ("aprovo"). Status: `Aprovada` |
| 04/11/2026 | Implementador | Revisão 2 implementada, menos o roteiro manual. **Feito:** CA-17 e CA-18. `terminalWindow` ganhou `terminalState`, `restoreTerminal` e `typedLine` (o terminal 1: as últimas 500 linhas da tela, o histórico, a pasta, o usuário e a linha sem Enter); o `ExamTerminal` manda o terminal junto com a máquina (campo `terminal`), o põe de volta ao reabrir e ao voltar a uma questão, e avisa a linha digitada; o `ExamRunner` guarda no `localStorage` (`exam-attempt:<id>`) as respostas não confirmadas e as linhas sem Enter, as aplica por cima do servidor e as envia ao abrir, e apaga a cópia na entrega. O backend não mudou: o leitor da máquina ignora o campo `terminal`. **Medido:** 9 vermelhos pelos motivos esperados; verdes os 225 testes das pastas da prova, do simulador, da sala e do motor do terminal (um da página da sala falhou uma vez por lentidão e passou sozinho), `tsc` e ESLint limpos. **Desvios:** o terminal que estava em `su` volta como aquele usuário sozinho (o `exit` fecha o terminal em vez de voltar ao root); a linha sem Enter de uma questão sem nenhum comando e sem cenário não volta. **Testes alterados depois do vermelho:** a janela falsa do teste do formato ganhou os métodos novos; a chave da cópia usava o id errado da fixture (`a-1` em vez de `t-1`). **Aberto:** o roteiro manual. |
