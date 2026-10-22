# SPEC-085: Simulador da Prova: o Servidor Confere a Questão Prática e o Simulador a Dá como Resolvida

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-085 |
| **Status** | Rascunho |
| **Data de criação** | 22/10/2026 |
| **Última revisão** | 22/10/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `assessment` (backend: a conferência de uma questão prática da avaliação; frontend: o simulador da prova) |
| **Contexto de tela** | `/app/classes/[id]/assessments/[assessmentId]/simulate`, na visão da docente e do administrador |
| **Prioridade** | Alta |
| **Depende de** | SPEC-084 (a tela da prova com o terminal), SPEC-081 (o simulador), SPEC-011 e SPEC-013 (o motor e as condições de correção), SPEC-065 (a correção fora da prática, pelo composition root) |
| **Substitui** | Nenhuma. Sobrepõe, na SPEC-084, o primeiro item da seção 2.1 (a questão prática não é conferida) e a escolha "sem conferir" que o Tech Lead fez ao pedi-la |
| **Fontes canônicas** | Pedido do Tech Lead de 22/10/2026: ao fazer o comando correto no terminal do simulador, a prova não deu a questão como resolvida. Referências: a aba *Desafios* da tela de estudo e o simulado da branch `main` (`TelaSimulado.ts`), que valida em tempo real |

---

## 1. Contexto e Problema (Context & Problem Statement)

Na SPEC-084, ao pedir a tela da prova com o terminal, o Tech Lead escolheu que o simulador **não confere** a questão prática: o terminal serve só para usar. Ele testou: digitou `mkdir -p /labs/projetoX` e `mkdir -p /labs/projetoY`, o que o enunciado pede, e a prova **não deu a questão como resolvida**. Para quem simula uma prova, ver se a resposta certa é aceita é justamente o que o simulador deve mostrar: se as condições da questão estão certas, se o enunciado leva à resposta que a correção espera. Sem isso a docente só descobre o erro numa prova de verdade.

Duas coisas existem hoje que o simulador pode seguir. A tela de estudo confere os desafios e marca os resolvidos, com o servidor corrigindo (`POST /questions/:id/check`), mas ela grava o progresso do usuário, o que a simulação não pode fazer. O simulado antigo da `main` validava no navegador, em tempo real, e travava a questão com uma comemoração, o que contraria a regra de que a correção roda só no servidor (`ARCHITECTURE.md`, seção 2).

## 2. Objetivos (Goals)

- O simulador **confere a questão prática no servidor**: depois dos comandos do terminal ele pergunta se a máquina da questão aberta atende às condições da questão, e dá a questão como **resolvida** quando sim.
- A conferência **não grava nada**: nem tentativa, nem progresso do usuário, nem nota; e **não revela** as condições, a solução nem o gabarito.
- A questão resolvida aparece marcada no navegador de questões e na coluna da questão, conta como respondida na entrega e, na aba *Professor*, aparece como "Resolvida no terminal".
- O *Reset Máquina* tira a marca da questão cuja máquina voltou ao início.

### 2.1. Fora de escopo (Non-Goals)

Toda IA implementadora deve tratar esta lista como proibição.

- **Nota, pontuação ou "acertou/errou"**: a conferência diz só se a questão está resolvida. Nada de porcentagem, pontos ganhos ou aviso do que faltou, para não revelar as condições (D-03).
- **Travar** a questão ou **passar sozinho** para a próxima, como fazia o simulado da `main` (D-02), e a **comemoração** do mascote.
- O **tempo por questão**, os avisos de tempo e o relatório final com o terminal de soluções do simulado da `main`.
- Conferir as questões **teóricas**: elas não têm terminal e a docente compara a resposta simulada com o gabarito na aba *Professor* (SPEC-081 e SPEC-084 D-05).
- A conferência da prova **de verdade** do aluno, a tentativa e a nota (spec das tentativas).
- Gravar o progresso da docente nos exercícios da prática: a conferência do simulador nunca toca nele.
- Qualquer mudança no motor de correção, nas condições ou em `frontend/src/engine/core/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Tema único escuro, tokens semânticos, textos em `messages/pt-BR.ts`, navegação completa por teclado, contraste WCAG AA e alvos de toque de no mínimo 44 px. O que a SPEC-084 define e esta spec não muda continua valendo.

**Quando confere** (D-01)

- Numa questão de comando Linux, a cada comando que o terminal executa, o simulador espera **1 segundo sem comando novo** e então manda ao servidor o estado da máquina daquele momento. Uma conferência de cada vez por questão: se chega um estado novo enquanto uma volta, manda só o último depois.
- A questão já resolvida não é conferida de novo até o *Reset Máquina* (D-02).
- O simulador não confere uma máquina que acabou de ser carregada ou reiniciada, só depois de um comando.

**A questão resolvida** (D-02)

- No navegador de questões o botão passa a "Questão k, resolvida", com a marca de respondida.
- Na coluna da questão aparece o aviso "Questão resolvida no terminal." como mensagem de estado, para quem usa leitor de tela.
- Ela conta como **respondida** na confirmação de entrega ("k questões sem resposta") e na tela da entrega ("Você respondeu k de N questões").
- A marca **não trava** a questão nem leva à seguinte: a docente pode seguir mexendo no terminal. Ela fica até o *Reset Máquina* da questão, que a tira, ou até o *Refazer*.
- A questão prática que ainda não está resolvida continua "sem resposta", e **nada** é dito sobre o que falta (D-03).

**Quando a conferência falha**

- Se o servidor não responde, o simulador mostra, discreto, "Não foi possível conferir agora." na coluna da questão e tenta de novo no próximo comando. Não atrapalha o terminal nem o resto da prova.

**A aba *Professor*** (D-04)

- Na questão prática, a *Resposta simulada* passa a dizer "Resolvida no terminal" ou "Não resolvida", no lugar de "Não respondida". Continua sem nota.

**O que o terminal manda**

- O estado enviado é o que a janela do terminal já entrega depois de cada comando (o mesmo que a tela de estudo manda para conferir).

### 3.2. Backend (Go: módulo `assessment`)

- **RN-01 (conferir):** a docente dona da turma e o administrador mandam o estado de uma máquina e o servidor responde se ele atende às condições de correção da questão: `passed`, verdadeiro ou falso. A questão tem de ser **da avaliação** e **de comando Linux** (SPEC-084 RN-01): na composição manual, uma das escolhidas; no sorteio, uma elegível no módulo. Outra questão é 404 `question-not-found`; uma questão que não usa o terminal é 400 `invalid-question`.
- **RN-02 (a mesma correção):** o servidor corrige com o mesmo motor e as mesmas condições da prática (SPEC-011 RN-01, SPEC-013): lê o estado como uma máquina do simulador (formato, versão e limites, como `ParseMachine`) e avalia as condições da questão, pelo módulo de correção que o composition root liga; o estado que não é uma máquina é 400 `invalid-snapshot`, e o que falta é 400 `snapshot-required`.
- **RN-03 (não grava):** a conferência não escreve nada: nem tentativa, nem o progresso do usuário na prática, nem evento no histórico da avaliação nem auditoria.
- **RN-04 (não revela):** a resposta tem só `passed`: nunca as condições, o resultado de cada uma, a solução de referência ou o gabarito.
- **RN-05 (limite):** o corpo da requisição é limitado como o da conferência da prática (2 MB); acima disso, 413.
- **RN-06 (quem pede):** só a docente dona e o administrador; o estudante e a docente que não é dona recebem 403 `forbidden`.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: nenhuma tabela, coluna ou valor de enumeração muda; a conferência não grava.

## 5. Contrato de API (API Contract)

**`POST /api/v1/classes/:id/assessments/:assessmentId/questions/:questionId/check`**: confere o estado de uma máquina contra as condições de uma questão de comando Linux da avaliação, sem gravar nada (RN-01 a RN-06).

- **Papéis autorizados:** docente dona da turma e administrador.
- **Parâmetros de rota:** `id` da turma, `assessmentId` e `questionId`.
- **Corpo da requisição:**

| Campo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| `snapshot` | objeto | Sim | O estado da máquina que a janela do terminal entrega; até 2 MB |

- **Resposta de sucesso** (`200`):

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `passed` | booleano | Sim | Verdadeiro quando a máquina atende às condições da questão |

- **Erros (RFC 7807):**

| HTTP | `type` (slug do problema) | Quando ocorre |
| :--- | :--- | :--- |
| 400 | `snapshot-required` | O corpo não traz o estado da máquina |
| 400 | `invalid-snapshot` | O estado não é uma máquina do simulador |
| 400 | `invalid-question` | A questão não usa o terminal |
| 403 | `forbidden` | Quem pede não é a docente dona nem o administrador |
| 404 | `class-not-found` | A turma não existe |
| 404 | `assessment-not-found` | A avaliação não existe nessa turma |
| 404 | `question-not-found` | A questão não é da avaliação, ou não existe |
| 413 | `payload-too-large` | O estado passa de 2 MB |

## 6. Impacto e Riscos (Impact & Risks)

- **Uma requisição a cada pausa nos comandos pesa.** O estado de uma máquina chega a dezenas de kilobytes. **Mitigação:** a espera de 1 segundo, uma conferência de cada vez por questão, a questão resolvida não é conferida de novo e o corpo é limitado (RN-05).
- **A docente descobre o gabarito por tentativa e erro.** A conferência só diz sim ou não, e a docente é quem escreveu a questão e pode ver a solução na aba *Professor*; ainda assim, nada além de `passed` sai do servidor (RN-04). **Mitigação:** a rota é da docente dona e do administrador, nunca do estudante.
- **Conferir sem gravar contraria a tela de estudo, que grava.** **Mitigação:** a conferência do simulador é uma rota da avaliação, que não chama a gravação do progresso; um teste confere que o progresso do usuário não muda (CA-04).
- **A correção do simulador e a da prova real podem divergir.** **Mitigação:** as duas usam o mesmo motor e as mesmas condições (RN-02); a spec das tentativas usa a mesma função.
- **Testes da SPEC-084 que mudam.** O teste que diz que a questão prática não é conferida passa a dizer o contrário. **Mitigação:** ajustado no commit vermelho, com o motivo na entrega.
- **Impacto em outros módulos:** o `assessment` passa a pedir ao módulo de correção da prática, pelo composition root, que corrija um estado; nenhum módulo muda de contrato. **`legacy/`:** removida; sem impacto.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente dona ou o administrador manda o estado de uma máquina para uma questão de comando Linux da avaliação, O servidor DEVE responder `passed` verdadeiro quando o estado atende às condições da questão e falso quando não atende, com o mesmo motor e as mesmas condições da prática (RN-01, RN-02).
- [ ] **CA-02** (indesejado): SE o estado falta, não é uma máquina do simulador, ou passa de 2 MB, ENTÃO O servidor DEVE responder 400 `snapshot-required`, 400 `invalid-snapshot` ou 413, sem corrigir (RN-02, RN-05).
- [ ] **CA-03** (indesejado): SE a questão não é da avaliação, ENTÃO 404 `question-not-found`; SE não usa o terminal, ENTÃO 400 `invalid-question`; SE quem pede é o estudante ou a docente que não é dona, ENTÃO 403 `forbidden` (RN-01, RN-06).
- [ ] **CA-04** (ubíquo): A conferência NÃO DEVE gravar nada: nem o progresso do usuário na prática, nem tentativa, nem evento, nem auditoria; e a resposta DEVE ter só o campo `passed`, sem condições, solução nem gabarito (RN-03, RN-04).
- [ ] **CA-05** (evento): QUANDO o terminal executa um comando numa questão de comando Linux ainda não resolvida, O simulador DEVE esperar 1 segundo sem comando novo e mandar o último estado da máquina para conferir, uma conferência de cada vez por questão, e NÃO DEVE conferir antes de haver um comando nem uma questão já resolvida.
- [ ] **CA-06** (estado): ENQUANTO a questão está resolvida, O simulador DEVE mostrá-la marcada no navegador ("Questão k, resolvida"), mostrar "Questão resolvida no terminal." na coluna da questão e contá-la como respondida na confirmação e na tela da entrega, sem travá-la nem passar para a seguinte.
- [ ] **CA-07** (estado): ENQUANTO a questão prática não está resolvida, O simulador NÃO DEVE dizer o que falta nem que a resposta está errada, e DEVE continuar mostrando-a "sem resposta".
- [ ] **CA-08** (evento): QUANDO a pessoa aciona *Reset Máquina* numa questão resolvida e confirma, O simulador DEVE tirar a marca de resolvida dela, e *Refazer* e *Sortear de novo* DEVEM tirar todas.
- [ ] **CA-09** (estado): ENQUANTO a conferência falha, O simulador DEVE mostrar "Não foi possível conferir agora." na coluna da questão e tentar de novo no comando seguinte, sem atrapalhar o terminal.
- [ ] **CA-10** (estado): ENQUANTO a aba *Professor* está aberta, A *Resposta simulada* da questão prática DEVE dizer "Resolvida no terminal" ou "Não resolvida", sem nota.
- [ ] **CA-11** (ubíquo): Os textos novos DEVEM estar em `messages/pt-BR.ts`; o aviso de resolvida DEVE ser lido por leitor de tela, o contraste DEVE ser AA e nenhuma cor DEVE estar fora dos tokens.

## 8. Plano de Testes (Test Plan)

Os testes são escritos **antes** do código e rodados vermelhos primeiro (SPEC-038). Nomes em inglês, como no código.

**Backend** (Go: `testing` e `testify`)

- Service: a conferência de uma questão escolhida, de uma do sorteio, as recusas por questão fora da avaliação, por questão sem terminal e por papel, e a ausência de escrita (CA-01, CA-03, CA-04)
- Handler (roteador Gin real com `httptest`): a rota, o formato só com `passed`, os erros RFC 7807, o corpo grande e o corpo sem estado (CA-02, CA-03, CA-04)
- Composition root (`cmd/api`): o adaptador corrige com o motor e as condições da questão (um estado que atende e um que não atende) e não toca no progresso (CA-01, CA-04)

**Frontend** (Vitest e Testing Library; o terminal e o relógio são simulados)

- `AssessmentSimulator.check.test.tsx` (novo): a espera de 1 segundo e o último estado, uma conferência de cada vez, nenhuma conferência antes do primeiro comando nem depois de resolvida, a marca no navegador e o aviso, a contagem na entrega, o *Reset Máquina*, o *Refazer* e a falha da conferência (CA-05 a CA-09)
- `AssessmentSimulator.teacher.test.tsx` (ajustado): a *Resposta simulada* "Resolvida no terminal" e "Não resolvida" (CA-10)
- `AssessmentSimulator.terminal.test.tsx` e `answers.test.tsx` (ajustados): a questão prática sem conferência deixa de valer (SPEC-084 CA-12 muda)
- `simulate/page.test.tsx` e `assessmentService.test.ts` (ajustados): a chamada da conferência e a ausência de outra escrita (CA-04)
- Stylelint, ESLint e `tsc` limpos (CA-11)

**Manual** (roteiro)

1. Na prova do exemplo, digitar `mkdir -p /labs/projetoX` e `mkdir -p /labs/projetoY` e conferir que, um instante depois do último comando, a questão aparece como resolvida, no navegador e na coluna.
2. Digitar só um dos dois e conferir que nada é dito, e depois o outro.
3. Acionar *Reset Máquina*, confirmar, e conferir que a marca sai.
4. Conferir na aba *Professor* "Resolvida no terminal"; entregar e conferir a contagem.
5. Conferir, depois, no progresso da prática da docente, que nada mudou.

**Cobertura:** meta acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md` e esta spec; a SPEC-084 inteira, as SPEC-011, 013 e 065 (a correção fora da prática). Do código: `backend/internal/modules/practice/service/service.go` e `grading.go` (`Check`, `ParseMachine`), `backend/internal/modules/content/domain/condition.go` (`Grade`), `backend/cmd/api/assessment_refs.go`, `exercise_refs.go` (a correção do exercício ao vivo), `backend/internal/modules/assessment/` e `frontend/src/components/AssessmentSimulator/`.
2. **Ordem de execução:** (a) testes do backend, vermelhos e commitados (`test(assessment): ...`); (b) a conferência no `assessment` e o adaptador do composition root; (c) testes do frontend, vermelhos e commitados (`test(frontend): ...`); (d) o serviço, a conferência com a espera, as marcas e as mensagens; (e) roteiro manual; (f) status e histórico.
3. **Arquivos e diretórios a criar ou alterar:**
   - **Backend, alterados:** `backend/internal/modules/assessment/service/service.go` (a interface de questões ganha a conferência), `service/scenario.go` ou um arquivo novo `service/check.go`, `handler/handler.go` e `handler/dto.go`, `domain/errors.go`, `backend/cmd/api/assessment_refs.go` (o adaptador que corrige pelo motor da prática) e os testes ao lado de cada um.
   - **Frontend, novos:** `AssessmentSimulator.check.test.tsx`.
   - **Frontend, alterados:** `AssessmentSimulator.tsx`, `ExamTerminal.tsx` e os testes, `frontend/src/services/assessmentService.ts` e o teste, `.../simulate/page.tsx` e o teste, e `frontend/src/messages/pt-BR.ts`.
   - **Documentação:** esta spec e a nota de sobreposição no histórico da SPEC-084.
   - **Não alterar:** o motor, as condições, o módulo `practice` além do que o composition root já usa, `frontend/src/engine/core/` e qualquer arquivo fora desta lista sem justificativa no resumo da entrega.
4. **Definição de pronto:** todos os CA marcados, os testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, o roteiro manual feito, as pendências da seção 10 vazias e o status atualizado para `Implementada`.

## 10. Pendências para aprovação

Escolhas em aberto, cada uma com uma recomendação. **Uma spec só pode ser aprovada com esta tabela vazia.** O texto acima já segue as recomendações.

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| D-01 | **Quando conferir.** Sozinho, depois dos comandos, ou só quando a docente aciona um botão *Conferir*. | Sozinho: 1 segundo depois do último comando, como o simulado da `main` fazia em tempo real e como a docente espera ("fiz o comando certo e a prova não deu como resolvida"). Um botão exigiria lembrar de apertá-lo. |
| D-02 | **O que a questão resolvida faz.** Só marcar, ou também travar e passar para a seguinte, como o simulado da `main`. | Só marcar: no navegador e na coluna da questão, contando como respondida. Não trava nem avança, porque a docente está testando e pode querer mexer mais; o *Reset Máquina* e o *Refazer* tiram a marca. |
| D-03 | **O que dizer quando ainda não está resolvida.** Dizer o que falta, ou nada. | Nada. A questão continua "sem resposta"; dizer o que falta revelaria as condições da correção, que são do servidor. |
| D-04 | **A aba *Professor* na questão prática.** | A *Resposta simulada* diz "Resolvida no terminal" ou "Não resolvida", no lugar de "Não respondida": a docente vê o que o simulador concluiu, sem nota. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 22/10/2026 | Aruna Architect | Criação em `Rascunho`, a pedido do Tech Lead, depois de ele ter feito o comando certo no terminal do simulador e a prova não ter dado a questão como resolvida. Reverte a escolha "sem conferir" da SPEC-084, que ele havia feito ao pedi-la, e que passa a valer só para as questões teóricas. Conferida contra a conferência da prática (`Check`, `ParseMachine`), as condições (`Grade`) e o simulado da `main`. Quatro pendências abertas (D-01 a D-04), todas com recomendação |
