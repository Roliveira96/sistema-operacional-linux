# SPEC-081: Simulador da Prova: a Visão do Professor e a Visão do Aluno Lado a Lado

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-081 |
| **Status** | Rascunho |
| **Data de criação** | 22/10/2026 |
| **Última revisão** | 22/10/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `assessment` (backend: leitura da pré-visualização; frontend: a nova página do simulador e o detalhe da avaliação) |
| **Contexto de tela** | `/app/classes/[id]/assessments/[assessmentId]` (o botão) e a nova `/app/classes/[id]/assessments/[assessmentId]/simulate`, na visão da docente e do administrador |
| **Prioridade** | Média |
| **Depende de** | SPEC-075 (RN-16, a pré-visualização), SPEC-077 (instruções gerais em texto formatado), SPEC-079 (questões escolhidas), SPEC-035, SPEC-036, SPEC-037 e SPEC-039 (os componentes de resposta do aluno, que já têm o modo avaliação) |
| **Substitui** | Nenhuma. O *Pré-visualizar* da SPEC-075 continua como está |
| **Fontes canônicas** | Pedido do Tech Lead de 22/10/2026: a docente quer um simulador da prova, com a visão do professor e a visão do aluno abertas juntas, para testar a prova e revisar como o aluno a verá. Decisão dele na mesma data: por enquanto a prova não é feita em tela de celular |

---

## 1. Contexto e Problema (Context & Problem Statement)

Hoje a docente tem, no detalhe da avaliação, o botão *Pré-visualizar*, que lista as questões na ordem, com o gabarito e a justificativa (SPEC-075 RN-16). Isso mostra **o que está na prova**, mas não **como o aluno a vê**: a ordem em que as alternativas aparecem, o enunciado dentro da tela de resposta, as instruções, o tempo, a navegação entre as questões. Um enunciado que quebra no componente do aluno, uma alternativa que some, um tempo curto demais ou um peso mal posto só aparecem quando os alunos já estão fazendo a prova.

A tela em que o aluno resolve a prova ainda não existe: a SPEC-075 a deixa fora de escopo (seção 2.1) e os rascunhos 052 e `revisao-avaliacoes-telemetria-mcp` não foram implementados. O aluno vê hoje só o cartão da avaliação, com a contagem regressiva e o aviso de acesso. Os componentes de resposta (verdadeiro ou falso, escolha única, ligar colunas e descritiva) já existem e já têm um modo avaliação, mas só são usados nos exercícios do módulo.

A docente pediu um simulador: abrir **a visão do professor e a visão do aluno juntas**, responder como aluno e conferir, do outro lado, o que o professor vê.

## 2. Objetivos (Goals)

- O detalhe da avaliação ganha o botão *Simular prova*, que abre a página do simulador.
- A página mostra, lado a lado, a **visão do professor** e a **visão do aluno**.
- A visão do aluno percorre a prova como ela será: *Antes de começar* (instruções, duração, nota máxima), *Respondendo* (uma questão por vez, navegação, cronômetro) e *Entregue*.
- As respostas ficam só na memória da página: **nada é enviado nem gravado**.
- A visão do professor mostra, por questão, o gabarito, a justificativa, o valor e a **resposta simulada** do aluno ao lado, sem nota.
- Numa tela estreita (menos de 48 rem) o simulador não abre e explica que precisa de uma tela maior, como a prova.
- O servidor passa a entregar, na pré-visualização, o conteúdo de cada questão **como o aluno o recebe**, sem a resposta correta.

### 2.1. Fora de escopo (Non-Goals)

Toda IA implementadora deve tratar esta lista como proibição.

- A **tela real** em que o aluno faz a prova (rota `/take`), a tentativa, o cronômetro do servidor, o token de liberação, a telemetria, a correção, a nota e a homologação (SPEC-075 seção 2.1, rascunhos 052 e `revisao-avaliacoes-telemetria-mcp`).
- **Gravar qualquer coisa** da simulação: nenhuma tentativa, resposta, evento no histórico ou auditoria, e nenhuma rota de escrita nova.
- **Nota, pontuação ou "acertou/errou"** da simulação. A correção roda só no servidor (`ARCHITECTURE.md`, seção 2); o simulador mostra o gabarito e a resposta simulada lado a lado e a docente compara (D-05).
- O **terminal** e a correção das questões práticas (D-03).
- Simular **um aluno específico**: a habilitação, a elegibilidade e a decisão de acesso (SPEC-075 RN-14, SPEC-076). O simulador mostra a prova, não o acesso a ela.
- Mudar o cartão e o aviso de acesso que o aluno real já vê, ou avisar o aluno real de que a prova não se faz em celular (D-02).
- Mudar o *Pré-visualizar* ou o que ele mostra à docente.
- Qualquer mudança nos componentes de resposta do aluno. Se o modo avaliação deles não bastar, parar e perguntar (`AI_INSTRUCTIONS.md`, seção 7).
- Qualquer mudança em `frontend/src/engine/core/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Tema único escuro, tokens semânticos, textos em `messages/pt-BR.ts`, navegação completa por teclado, contraste WCAG AA e alvos de toque de no mínimo 44 px. Os estados carregando e erro (com *Tentar de novo*) seguem o padrão da pré-visualização.

**A entrada**

- No detalhe da avaliação, para a docente dona e o administrador, o botão *Simular prova* fica ao lado do *Pré-visualizar* e leva à página `simulate` (D-01). O estudante não vê o botão; se abrir o endereço, volta ao detalhe da avaliação.

**A página do simulador**

- Título "Simulador da prova" com o título da avaliação, e uma faixa fixa no alto: "Simulação: nada é enviado nem gravado". Ao lado, a situação real da avaliação (por exemplo, "Agendada"): a simulação funciona em qualquer fase e em qualquer status, inclusive cancelada, com essa faixa lembrando em que pé a avaliação está.
- **A partir de 48 rem**, duas colunas de largura igual: *Visão do professor* e *Visão do aluno*. Cada uma rola por conta própria quando a questão é comprida.
- **Abaixo de 48 rem**, nenhuma das duas visões aparece: a página mostra o aviso "O simulador, como a prova, precisa de uma tela maior. Abra no computador ou no tablet." e o link *Voltar à avaliação* (D-02).
- *Sortear de novo* só aparece na composição por sorteio (D-04). *Refazer* aparece na tela *Entregue* e dentro da simulação.

**A visão do aluno** (uma máquina de três estados)

1. **Antes de começar:** o título da avaliação, as instruções gerais formatadas (SPEC-077), a duração ("90 minutos", ou "Até o fim do período" quando não há duração individual), a nota máxima, a quantidade de questões e o botão *Começar*.
2. **Respondendo:**
   - No alto: o título, "Questão k de N" e, quando há duração, o cronômetro regressivo que começa em *Começar* e conta no navegador, só como ilustração (D-06); o servidor é a fonte da verdade do tempo na prova real.
   - Um **navegador de questões**: um botão numerado por questão, com a atual destacada e uma marca nas respondidas. Cada botão tem nome para leitor de tela ("Questão 3, respondida").
   - Uma questão por vez: o número, o valor em pontos (D-06), o enunciado em HTML, e o componente de resposta do tipo dela **no modo avaliação**: verdadeiro ou falso, escolha única (alternativas embaralhadas ao começar, ou na ordem da docente quando a questão pede, SPEC-036 D-07), ligar colunas (colunas embaralhadas conforme a questão, SPEC-037 D-10) e descritiva (com o limite de caracteres da questão). A resposta muda a qualquer momento enquanto se está *Respondendo*, e nada diz se está certa.
   - Questão prática: o enunciado e o aviso "O terminal aparece aqui na prova de verdade. Esta simulação não executa comandos." (D-03).
   - *Anterior*, *Próxima* e *Entregar*. *Anterior* fica desabilitado na primeira questão; *Próxima*, na última.
3. **Entregue:** ao *Entregar*, um diálogo pede a confirmação e diz quantas questões estão sem resposta ("2 questões sem resposta. Entregar mesmo?"). Confirmada a entrega, ou quando o cronômetro chega a zero (com o motivo "O tempo acabou"), aparece "Simulação entregue", "Nada foi enviado", "Você respondeu k de N questões", e os botões *Refazer* (volta a *Antes de começar* sem respostas e embaralha de novo) e *Voltar à avaliação*.

**A visão do professor**

- No alto, os dados da avaliação (tipo, modalidade, período, nota máxima, composição), como o detalhe.
- A lista das questões **na ordem em que o aluno as vê**, cada uma com: a posição, o título, o tipo, o nível, o valor, o enunciado, o **gabarito**, a **justificativa** e a **Resposta simulada** do aluno ("Não respondida" enquanto não houver; para a escolha única, a alternativa marcada; para ligar colunas, os pares ligados; para a descritiva, o texto). É o mesmo bloco da pré-visualização (`AssessmentPreview`), com a resposta simulada a mais.
- A questão aberta na visão do aluno fica destacada e rola para a vista. Não há nota, pontuação nem marca de certo ou errado (D-05).
- Na composição por sorteio, a tabela das regras (SPEC-075) e, como as questões do aluno, o **exemplo sorteado** que o servidor já devolve; *Sortear de novo* pede outro exemplo e reinicia a simulação (D-04).

**Acesso à rede.** A página usa a rota de pré-visualização que já existe, pelo serviço de avaliações (`ARCHITECTURE.md`, seção 4.3), e não escreve em nenhuma rota.

### 3.2. Backend (Go: módulo `assessment`)

- **RN-01 (conteúdo do aluno):** a pré-visualização (SPEC-075 RN-16) passa a trazer, em cada questão e em cada questão do exemplo sorteado, o bloco `studentView` com o que o aluno recebe da questão **sem a resposta correta**: na escolha única, as alternativas (identificador e HTML, sem dizer qual é a correta) e se devem ser embaralhadas; no ligar colunas, as duas colunas na ordem da docente (sem os pares certos) e se devem ser embaralhadas; na descritiva, o limite de caracteres; no verdadeiro ou falso e na prática, nenhum campo além do enunciado. É o mesmo conteúdo que o exercício do módulo entrega ao estudante (SPEC-035, 036, 037 e 039).
- **RN-02 (a resposta correta fica fora do bloco):** o bloco `studentView` nunca contém a resposta correta, o texto esperado da descritiva, a justificativa nem a solução de referência; isso continua só nos campos que a pré-visualização já tem (`answerKey` e `explanation`), que são da docente.
- **RN-03 (quem lê):** só a docente dona e o administrador, como na RN-16. O estudante e a docente que não é dona recebem a mesma recusa que a pré-visualização já dá.
- **RN-04 (nada é gravado):** a simulação não cria rota de escrita, tentativa, resposta, evento no histórico nem registro de auditoria. A rota de pré-visualização continua só de leitura.
- **RN-05 (sem mudar o que existe):** os campos atuais da pré-visualização não mudam de nome, tipo nem valor; o bloco novo é um acréscimo.
- **RN-06 (HTML):** o enunciado e as alternativas chegam já filtrados pelo banco do módulo, como hoje; o simulador não filtra de novo e não monta HTML por conta própria.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: nenhuma tabela, coluna ou valor de enumeração muda. O bloco `studentView` é montado na leitura, a partir do que o banco do módulo já guarda.

## 5. Contrato de API (API Contract)

**`GET /api/v1/classes/:id/assessments/:assessmentId/preview`**: a pré-visualização da avaliação, agora com o conteúdo do aluno em cada questão. Rota existente (SPEC-075); só acrescenta um campo.

- **Papéis autorizados:** `TEACHER` (a docente dona da turma) e `ADMIN`, como hoje.
- **Parâmetros de rota:** os mesmos de hoje (`id` da turma e `assessmentId`).
- **Corpo da requisição:** não há.
- **Resposta de sucesso** (`200`): os campos atuais (`questions`, `rules`, `stock`, `sample`) não mudam. Cada item de `questions` e de `sample` ganha:

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `studentView` | objeto | Sim | O conteúdo da questão como o aluno o recebe, sem a resposta correta (RN-01, RN-02) |
| `studentView.choices` | lista de `{ id, html }` | Só na escolha única | As alternativas, na ordem da docente, sem dizer qual é a correta |
| `studentView.shuffle` | booleano | Só na escolha única e no ligar colunas | `true` quando o aluno vê a ordem embaralhada (padrão), `false` quando a docente mantém a dela |
| `studentView.columns` | objeto `{ left, right }`, cada um uma lista de `{ id, html }` | Só no ligar colunas | As duas colunas na ordem da docente, sem os pares certos |
| `studentView.maxLength` | inteiro | Só na descritiva | O limite de caracteres da resposta |

- **Erros (RFC 7807):** os mesmos de hoje (autenticação, papel sem permissão, turma ou avaliação não encontrada). Esta spec não cria `type` novo.

## 6. Impacto e Riscos (Impact & Risks)

- **A tela real da prova ainda não existe e pode sair diferente do simulador.** **Mitigação:** a visão do aluno usa os componentes de resposta que a prova real vai usar (modo avaliação) e a mesma regra de embaralhar; o simulador vira a base da tela real, e o que divergir se ajusta na spec das tentativas. O simulador não promete o desenho final da navegação (uma questão por vez com navegador numerado segue a ideia do rascunho 052).
- **O servidor ganha um bloco novo na pré-visualização.** **Mitigação:** só acrescenta campos (RN-05, CA-15); o bloco é testado para nunca conter a resposta correta (RN-02, CA-14) e a rota continua só da docente dona e do administrador.
- **O embaralhar é feito no navegador na simulação.** Se o exercício embaralhar no servidor, a ordem da simulação não reproduz uma ordem real, só o efeito. **Mitigação:** a spec das tentativas decide onde embaralhar; aqui o objetivo é ver as alternativas fora da ordem da docente.
- **O cronômetro do navegador pode divergir do real.** **Mitigação:** a visão do aluno diz que é ilustração; o servidor é a fonte da verdade na prova real (`ARCHITECTURE.md`, seção 2).
- **Duas colunas em janela de 48 rem apertam o conteúdo.** **Mitigação:** cada coluna rola por conta própria; abaixo de 48 rem o simulador não abre (D-02).
- **Impacto em outros módulos:** o `assessment` passa a pedir ao banco do módulo o conteúdo do aluno, pela interface que ele já declara e o composition root liga; o banco do módulo (`content`) não muda de contrato. **`legacy/`:** removida; sem impacto.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente dona ou o administrador abre o detalhe de uma avaliação, A página DEVE mostrar o botão *Simular prova*, que leva a `.../simulate`; o estudante NÃO DEVE ver o botão, e abrir o endereço DEVE devolvê-lo ao detalhe da avaliação.
- [ ] **CA-02** (estado): ENQUANTO a janela tem 48 rem ou mais, A página do simulador DEVE mostrar lado a lado a *Visão do professor* e a *Visão do aluno*, com a faixa "Simulação: nada é enviado nem gravado" e a situação real da avaliação.
- [ ] **CA-03** (estado): ENQUANTO a janela tem menos de 48 rem, A página DEVE mostrar só o aviso de que o simulador precisa de uma tela maior e o link *Voltar à avaliação*, sem nenhuma das duas visões.
- [ ] **CA-04** (estado): ENQUANTO a simulação está em *Antes de começar*, A visão do aluno DEVE mostrar o título, as instruções gerais formatadas, a duração (ou "Até o fim do período"), a nota máxima, a quantidade de questões e o botão *Começar*.
- [ ] **CA-05** (evento): QUANDO a docente aciona *Começar*, A visão do aluno DEVE mostrar a primeira questão com "Questão 1 de N", o navegador de questões e, havendo duração, o cronômetro regressivo.
- [ ] **CA-06** (estado): ENQUANTO a simulação está em *Respondendo*, CADA questão DEVE aparecer com o componente de resposta do seu tipo no modo avaliação (verdadeiro ou falso, escolha única, ligar colunas, descritiva), com o valor em pontos; a resposta DEVE poder mudar a qualquer momento, e nada DEVE dizer se está certa.
- [ ] **CA-07** (evento): QUANDO a docente usa *Anterior*, *Próxima* ou o navegador, A visão do aluno DEVE mudar de questão sem perder as respostas dadas, e o navegador DEVE marcar as respondidas, com o nome acessível "Questão k, respondida" ou "Questão k, sem resposta".
- [ ] **CA-08** (evento): QUANDO a docente aciona *Entregar*, A visão do aluno DEVE pedir a confirmação com a quantidade de questões sem resposta; confirmada, DEVE mostrar "Simulação entregue", "Nada foi enviado", "Você respondeu k de N questões" e os botões *Refazer* e *Voltar à avaliação*.
- [ ] **CA-09** (evento): QUANDO o cronômetro chega a zero, A visão do aluno DEVE encerrar a simulação como na entrega, com o motivo "O tempo acabou".
- [ ] **CA-10** (evento): QUANDO a docente aciona *Refazer*, A simulação DEVE voltar a *Antes de começar*, sem respostas, e a ordem embaralhada das alternativas e das colunas DEVE ser sorteada de novo.
- [ ] **CA-11** (estado): ENQUANTO a simulação roda, A visão do professor DEVE listar as questões na ordem do aluno, cada uma com posição, título, tipo, nível, valor, gabarito, justificativa e a *Resposta simulada* (ou "Não respondida"), destacar a questão aberta na visão do aluno, e NÃO DEVE mostrar nota, pontuação nem marca de certo ou errado.
- [ ] **CA-12** (estado): ENQUANTO a composição é por sorteio, A visão do professor DEVE mostrar a tabela das regras e a visão do aluno DEVE usar as questões do exemplo sorteado; *Sortear de novo* DEVE trazer outro exemplo e reiniciar a simulação.
- [ ] **CA-13** (estado): ENQUANTO a questão é prática, A visão do aluno DEVE mostrar o enunciado e o aviso de que o terminal só aparece na prova de verdade, sem terminal e sem executar comandos.
- [ ] **CA-14** (ubíquo): O servidor NÃO DEVE incluir no bloco `studentView` a resposta correta, o texto esperado da descritiva, a justificativa nem a solução de referência de nenhum tipo de questão (RN-02).
- [ ] **CA-15** (evento): QUANDO a docente dona ou o administrador pede a pré-visualização, A resposta DEVE manter os campos atuais sem mudança e trazer o `studentView` de cada questão e de cada questão do exemplo sorteado, com os campos do tipo dela (RN-01, RN-05).
- [ ] **CA-16** (indesejado): SE o pedido da pré-visualização vem de um estudante ou de uma docente que não é a dona da turma, ENTÃO O servidor DEVE recusá-lo como a pré-visualização já recusa (RN-03).
- [ ] **CA-17** (ubíquo): A simulação NÃO DEVE gravar nada: nenhuma chamada de escrita, nenhuma tentativa, evento ou auditoria; as respostas DEVEM existir só na memória da página (RN-04).
- [ ] **CA-18** (ubíquo): Os textos novos DEVEM estar em `messages/pt-BR.ts`; a página DEVE ter navegação por teclado (inclusive o navegador de questões e o diálogo de entrega), contraste AA, alvos de 44 px e nenhuma cor fora dos tokens.

## 8. Plano de Testes (Test Plan)

Os testes são escritos **antes** do código e rodados vermelhos primeiro (SPEC-038). Nomes em inglês, como no código.

**Backend** (Go: `testing` e `testify`)

- Service: o conteúdo do aluno de cada tipo de questão (escolha única com alternativas e embaralhar, ligar colunas com as colunas e sem os pares, descritiva com o limite, verdadeiro ou falso e prática sem campos extras), com o banco do módulo substituído por implementação de teste (CA-15)
- Service: o `studentView` nunca traz a resposta correta, o texto esperado, a justificativa nem a solução de referência, de nenhum tipo (CA-14)
- Handler (roteador Gin real com `httptest`): o formato da resposta com o bloco novo, os campos antigos intactos, a recusa do estudante e da docente que não é dona (CA-15, CA-16)
- Composition root (`cmd/api`): o conteúdo do aluno vem do banco do módulo e passa pelo adaptador (CA-15)

**Frontend** (Vitest e Testing Library)

- `AssessmentSimulator.test.tsx`: os três estados da visão do aluno, o cronômetro (com relógio simulado), a navegação, a entrega com a confirmação, o *Refazer* e o fim do tempo (CA-04 a CA-10)
- `AssessmentSimulator.answers.test.tsx`: cada tipo de questão no modo avaliação, sem dizer se está certa, a prática sem terminal (CA-06, CA-13)
- `AssessmentSimulator.teacher.test.tsx`: a visão do professor, a resposta simulada de cada tipo, o destaque da questão aberta, a ausência de nota, o sorteio e *Sortear de novo* (CA-11, CA-12)
- `simulate/page.test.tsx`: as duas colunas a partir de 48 rem, o aviso abaixo dele, o estudante devolvido ao detalhe, nenhuma chamada de escrita (CA-02, CA-03, CA-01, CA-17)
- `[assessmentId]/page.test.tsx` (ajustado): o botão *Simular prova* para a docente e o administrador, e não para o estudante (CA-01)
- `assessmentService.test.ts` (ajustado): a leitura do bloco novo (CA-15)
- Stylelint, ESLint e `tsc` limpos (CA-18)

**Manual** (roteiro)

1. Numa avaliação com um exemplo de cada tipo de questão, abrir o simulador numa janela larga e responder todas como aluno; conferir, na visão do professor, a resposta simulada de cada uma ao lado do gabarito.
2. Deixar uma questão sem resposta e entregar; conferir a contagem no diálogo e o texto "Nada foi enviado". Abrir a avaliação em seguida e conferir que nada mudou nela.
3. Numa avaliação de duração curta, esperar o cronômetro zerar e conferir o fim com "O tempo acabou".
4. Numa avaliação por sorteio, usar *Sortear de novo* e conferir que as questões mudam.
5. Estreitar a janela abaixo de 48 rem e conferir o aviso; abrir o simulador como estudante e conferir que ele volta ao detalhe.
6. Conferir a aparência e o contraste (WCAG AA) das duas colunas, do navegador de questões e do diálogo no tema escuro, e a navegação só com o teclado.

**Cobertura:** meta acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5): `domain`, `service` e `handler` do `assessment` e os componentes e o serviço do frontend desta spec.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md` e esta spec; a SPEC-075 (seção 2.1, RN-16), a SPEC-077, a SPEC-079 e as SPEC-035, 036, 037 e 039 (os componentes de resposta e o conteúdo que o exercício entrega ao estudante). Do código: `backend/internal/modules/assessment/service/service.go` e `read.go`, `handler/dto.go`, `backend/cmd/api/assessment_refs.go`, `frontend/src/components/AssessmentPreview`, `frontend/src/components/{TrueFalseAnswer,SingleChoiceAnswer,MatchingAnswer,DescriptiveAnswer}` e `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/page.tsx`.
2. **Ordem de execução:** (a) testes do backend, rodados vermelhos e commitados (`test(assessment): ...`); (b) o conteúdo do aluno no `assessment` e no adaptador do composition root; (c) testes do frontend, vermelhos e commitados (`test(frontend): ...`); (d) o serviço, os componentes do simulador, a página, o botão e as mensagens; (e) roteiro manual; (f) status e histórico.
3. **Arquivos e diretórios a criar ou alterar:**
   - **Backend, alterados:** `backend/internal/modules/assessment/service/service.go` (o conteúdo da questão ganha o bloco do aluno) e `read.go` (se a montagem pedir), `backend/internal/modules/assessment/handler/dto.go` (o campo novo da resposta) e `backend/cmd/api/assessment_refs.go` (o adaptador que lê o conteúdo do banco do módulo); os testes ao lado de cada um (`service_test.go` ou `view_test.go`, `handler_test.go`, e o teste do composition root).
   - **Backend, só leitura:** `backend/internal/modules/content/domain` (ler como o exercício monta o conteúdo do aluno para reaproveitar a regra; se for preciso mudar o contrato do módulo, parar e perguntar).
   - **Frontend, novos:** `frontend/src/components/AssessmentSimulator/` (`AssessmentSimulator.tsx`, o estilo `.module.scss` e os três arquivos de teste da seção 8), e `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/simulate/page.tsx` com o `page.test.tsx`.
   - **Frontend, alterados:** `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/page.tsx` e `page.test.tsx` (o botão), `frontend/src/services/assessmentService.ts` e o teste dele (o tipo do bloco novo), `frontend/src/messages/pt-BR.ts` (os textos do simulador) e `frontend/src/components/AssessmentPreview/AssessmentPreview.tsx` só se o bloco do professor for reaproveitado dele (com teste).
   - **Documentação:** esta spec e `specs/GLOSSARY.md` (seção 4.3).
   - **Não alterar:** os componentes de resposta do aluno, `frontend/src/engine/core/` e qualquer arquivo fora desta lista sem justificativa no resumo da entrega.
4. **Definição de pronto:** todos os CA marcados, os testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, o roteiro manual feito, as pendências da seção 10 vazias e o status atualizado para `Implementada`.

## 10. Pendências para aprovação

Dúvidas e escolhas em aberto, cada uma com uma recomendação. **Uma spec só pode ser aprovada com esta tabela vazia.** O texto acima já segue as recomendações; se o Tech Lead decidir diferente, a seção correspondente é revisada antes da aprovação.

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| D-01 | **Onde fica a entrada.** Só o botão *Simular prova* no detalhe da avaliação, ou também um item no menu *Mais ações* da lista (SPEC-080). | Só o botão no detalhe, ao lado do *Pré-visualizar*. O menu da lista fica como a SPEC-080 o definiu, com poucas ações de uso raro. |
| D-02 | **Tela de celular.** O Tech Lead decidiu que, por enquanto, a prova não é feita em celular. Qual é a largura mínima, e o aluno real é avisado agora? | Mínimo de 48 rem, a mesma largura em que a lista de avaliações vira cartão. O aviso fica só no simulador; o cartão e o aviso de acesso do aluno real não mudam agora, e a regra entra na spec das tentativas, que é onde a tela real nasce. |
| D-03 | **Questões práticas.** Abrir o terminal do aluno na simulação, ou só o enunciado. | Só o enunciado e o aviso de que o terminal aparece na prova de verdade. O terminal exige a correção no servidor e a máquina por tentativa, que são da spec das tentativas. |
| D-04 | **Sorteio.** Como a visão do aluno obtém as questões numa avaliação por sorteio. | Usar o exemplo sorteado que a pré-visualização já devolve (não gravado), com o botão *Sortear de novo* que pede outro exemplo e reinicia. |
| D-05 | **Nota na visão do professor.** Mostrar nota e "acertou/errou" da simulação, ou só o gabarito e a resposta simulada lado a lado. | Só lado a lado, sem nota. A correção roda só no servidor e a nota da simulação, calculada no navegador, contrariaria a `ARCHITECTURE.md` (seção 2). |
| D-06 | **Cronômetro e valor das questões.** A visão do aluno mostra o cronômetro e o valor em pontos de cada questão? | Sim aos dois: o cronômetro conta a duração individual no navegador, só como ilustração (sem duração, não há cronômetro), e o valor aparece em cada questão. Se a prova real não mostrar o valor, a docente vê isso aqui e a spec das tentativas decide. |
| D-07 | **De onde vem o conteúdo do aluno.** Acrescentar o bloco à rota de pré-visualização, ou criar uma rota nova de simulação. | Acrescentar à rota existente: o campo é aditivo, a autorização é a mesma (RN-16) e não nasce rota para manter. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 22/10/2026 | Aruna Architect | Criação em `Rascunho`, a pedido do Tech Lead, a partir do pedido de 22/10/2026 de um simulador da prova com a visão do professor e a do aluno, conferida contra a SPEC-075 (RN-16 e seção 2.1), os componentes de resposta do aluno, a pré-visualização atual e os rascunhos 052 e de revisão. O Tech Lead escolheu a "prévia lado a lado" (não o simulado completo) e decidiu que a prova não é feita em tela de celular por enquanto. Sete pendências abertas (D-01 a D-07), todas com recomendação |
