# SPEC-084: Simulador da Prova: a Tela do Aluno com a Questão ao Lado do Terminal e o Reset da Máquina

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-084 |
| **Status** | Aprovada |
| **Data de criação** | 22/10/2026 |
| **Última revisão** | 22/10/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `assessment` (backend: a leitura do cenário de uma questão da avaliação; frontend: o simulador da prova) |
| **Contexto de tela** | `/app/classes/[id]/assessments/[assessmentId]/simulate`, na visão da docente e do administrador |
| **Prioridade** | Alta |
| **Depende de** | SPEC-081 (o simulador), SPEC-016 e SPEC-034 (a janela do terminal e o motor), SPEC-014 (a máquina) |
| **Substitui** | Nenhuma. Sobrepõe, na SPEC-081, a seção 3.1 (a visão do aluno e o arranjo das duas visões lado a lado), a decisão D-03 (a questão prática sem terminal) e o item do terminal da seção 2.1 |
| **Fontes canônicas** | Pedido do Tech Lead de 22/10/2026: o simulador está errado; a questão deve aparecer de um lado e o terminal do outro para o aluno fazer a prova, com o botão *Reset Máquina* para quando o aluno se perde. Referências que ele deu: a tela de estudo do módulo (`/materials/[id]`), "algo parecido", e os simulados da branch `main` (`src/app/TelaSimulado.ts`) |

---

## 1. Contexto e Problema (Context & Problem Statement)

O simulador da SPEC-081 mostra, ao lado da visão do professor, uma visão do aluno que **não é a prova**: numa questão de comando Linux ela só traz o enunciado e o aviso "o terminal aparece aqui na prova de verdade". Mas a prova prática do aluno **é** o terminal: sem ele a docente não consegue testar se o enunciado, o cenário e o tempo fazem sentido, que era o objetivo do simulador. Além disso, com as duas visões lado a lado, a do aluno ficaria com meia tela, pouco para uma questão ao lado de um terminal.

O que a docente quer ver já existe em duas formas no projeto:

- A **tela de estudo do módulo** (`/materials/[id]`): o conteúdo à esquerda, o terminal Ubuntu à direita, e uma barra com o botão *Reset Máquina*, que formata a máquina e a devolve ao estado inicial depois de uma confirmação, para quem se perdeu.
- O **simulado da branch `main`** (o simulador original, antes da plataforma): cabeçalho com o tempo da prova e o botão de finalizar; abaixo, à esquerda, a questão com o navegador de questões e, à direita, o terminal; a prova só teórica esconde o terminal.

## 2. Objetivos (Goals)

- A **visão do aluno** do simulador passa a ser a **tela da prova**: em cima o título, o cronômetro e *Entregar*; embaixo, a **questão à esquerda** e o **terminal à direita**, com o botão **Reset Máquina**.
- A visão do aluno e a visão do professor passam a ser **duas abas** (*Aluno* e *Professor*) e não mais duas colunas, para a prova ter a tela toda; trocar de aba não perde nada do que o aluno simulado fez.
- Numa questão de comando Linux, o terminal começa na **máquina do cenário da questão**, e o *Reset Máquina* a devolve a esse início.
- Numa questão teórica, o terminal fica à vista e **bloqueado**; numa prova sem questão prática, o terminal nem aparece e a questão ocupa a largura toda.
- A prova do simulador **não** traz o que é de estudo: nada de *Cola*, *Som*, player de narração, salvar e abrir máquina nem painel de processos.

### 2.1. Fora de escopo (Non-Goals)

Toda IA implementadora deve tratar esta lista como proibição.

- **Conferir** a questão prática: nada de validação em tempo real, de "questão concluída", de trava, de comemoração ou de nota, como fazia o simulado da `main`. A correção roda só no servidor (`ARCHITECTURE.md`, seção 2) e é da spec das tentativas. A visão do professor continua mostrando a solução de referência ao lado (SPEC-081 CA-11).
- O **tempo por questão**, os **avisos aos 10, 5, 2 e 1 minuto**, a **tolerância** depois do tempo e o **relatório final com o terminal de soluções** do simulado da `main`.
- A **tela real** da prova do aluno, a tentativa, o token, a telemetria e a gravação da sessão (SPEC-075 seção 2.1, rascunhos 052 e de revisão). O simulador não grava nada (SPEC-081 RN-04).
- Mudanças no servidor ou nos contratos de API além da leitura do cenário de uma questão da avaliação (RN-01 da seção 3.2).
- Mudanças na janela do terminal, no motor ou na tela de estudo; o simulador só usa o que já existe.
- A resposta simulada da questão prática na visão do professor: continua "Não respondida", porque a questão se resolve no terminal e o simulador não a confere.
- Qualquer mudança em `frontend/src/engine/core/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Tema único escuro, tokens semânticos, textos em `messages/pt-BR.ts`, navegação completa por teclado, contraste WCAG AA e alvos de toque de no mínimo 44 px. O que a SPEC-081 define e esta spec não muda continua valendo: a faixa "Simulação: nada é enviado nem gravado", o aviso abaixo de 48 rem, o cronômetro, a entrega com a confirmação, o *Refazer*, o *Sortear de novo* e os componentes de resposta das questões teóricas.

**A página**

- Acima de tudo, a faixa da simulação e a situação real da avaliação (SPEC-081). Logo abaixo, as duas abas, **Aluno** (a que abre primeiro) e **Professor**. A página do simulador usa a **largura toda** da tela, e não a coluna estreita das outras páginas de avaliação, para o terminal caber (D-02).
- Trocar de aba não recomeça nada: as respostas, a questão aberta, o cronômetro e as máquinas do terminal ficam como estavam. O cronômetro continua correndo com a aba *Professor* aberta.

**A aba *Aluno*: a tela da prova**

- *Antes de começar*, *Respondendo* e *Entregue*, como na SPEC-081. Só o *Respondendo* muda.
- **Cabeçalho da prova:** o título da avaliação, "Questão k de N", o cronômetro (quando há duração) e o botão *Entregar*.
- **Coluna da questão (esquerda):** o navegador de questões, o valor da questão, o enunciado, a área de resposta do tipo da questão (as das teóricas, como na SPEC-081) e *Anterior* e *Próxima*.
- **Coluna do terminal (direita):** a janela do terminal Ubuntu da tela de estudo, com a mesma aparência e os mesmos atalhos de teclado, e acima dela o botão **Reset Máquina**, que pede a confirmação da tela de estudo ("todos os dados, arquivos e diretórios criados nesta máquina serão perdidos...") e, confirmado, devolve a máquina ao início da questão aberta (D-01).
- **A largura** (D-02): a partir de 64 rem as duas colunas ficam lado a lado, a da questão com o espaço de um terço a dois quintos da tela e a do terminal com o resto; entre 48 e 64 rem a questão fica em cima e o terminal embaixo; abaixo de 48 rem vale o aviso da SPEC-081.

**O terminal, por tipo de questão**

- **Questão de comando Linux:** o terminal fica ativo. Na primeira vez que a questão abre, a máquina do terminal é carregada com o **cenário da questão** (a máquina padrão, se a questão não tem um). Se o aluno sai da questão e volta, encontra a máquina como a deixou. *Reset Máquina* só mexe na máquina da questão aberta.
- **Questão teórica** (verdadeiro ou falso, escolha única, ligar colunas, descritiva): o terminal continua à vista, mas **bloqueado**: sem receber teclas, escurecido e com o aviso "Esta questão não usa o terminal.". O *Reset Máquina* fica desabilitado (D-03).
- **Prova sem nenhuma questão de comando Linux:** não há coluna do terminal e a questão ocupa a largura toda.
- Uma só janela de terminal acompanha o aluno pela prova toda: o que muda de questão para questão é a máquina dentro dela (D-01).

**O que não entra do estudo** (D-04)

- Não há *Cola* (a colagem de comandos), *Som*, player de narração, salvar e abrir máquina nem o painel de processos: nada que ajude a resolver a prova ou que seja de estudo.

**A aba *Professor***

- Como na SPEC-081 (CA-11 e CA-12), sem mudança: a lista das questões na ordem do aluno, com o gabarito, a justificativa, a resposta simulada e a questão aberta destacada, e, no sorteio, as regras.

### 3.2. Backend (Go: módulo `assessment`)

- **RN-01 (cenário da questão):** a docente dona da turma e o administrador leem o cenário de uma questão da avaliação, isto é, a máquina em que a questão começa: o `snapshot` do cenário da questão, ou ausente quando a questão não tem cenário próprio (e então vale a máquina padrão). A questão tem de ser **da avaliação**: na composição manual, estar entre as questões escolhidas; no sorteio, que não guarda as questões, ser elegível no módulo da avaliação (SPEC-075 RN-05). Outra questão é 404 `question-not-found`. A leitura não grava nada.
- **RN-02 (por que não a rota da prática):** a rota de cenário da prática (`GET /questions/:id/scenario`, módulo `practice`) só serve as questões da prática do módulo e responde 404 para a questão que existe só na avaliação, que é o caso comum numa prova. A rota nova é da avaliação, lê o cenário pelo serviço do módulo de conteúdo, declarado na interface de questões que o `assessment` já tem (`ARCHITECTURE.md`, seção 3.2), e nunca devolve o gabarito, a solução nem as condições da questão.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: nenhuma tabela, coluna ou valor de enumeração muda.

## 5. Contrato de API (API Contract)

**`GET /api/v1/classes/:id/assessments/:assessmentId/questions/:questionId/scenario`**: o cenário de uma questão da avaliação, para a máquina do terminal do simulador (RN-01, RN-02).

- **Papéis autorizados:** docente dona da turma e administrador.
- **Parâmetros de rota:** `id` da turma, `assessmentId` e `questionId`.
- **Corpo da requisição:** não há.
- **Resposta de sucesso** (`200`):

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `questionId` | uuid | Sim | A questão pedida |
| `snapshot` | objeto | Não | A máquina em que a questão começa; ausente quando a questão não tem cenário próprio |

- **Erros (RFC 7807):**

| HTTP | `type` (slug do problema) | Quando ocorre |
| :--- | :--- | :--- |
| 403 | `forbidden` | Quem pede não é a docente dona nem o administrador |
| 404 | `class-not-found` | A turma não existe |
| 404 | `assessment-not-found` | A avaliação não existe nessa turma |
| 404 | `question-not-found` | A questão não é da avaliação, ou não existe |

## 6. Impacto e Riscos (Impact & Risks)

- **O terminal pesa na página do simulador.** A janela do terminal e o motor são carregados no navegador. **Mitigação:** a janela só é montada quando a prova começa e a prova tem questão de comando Linux, e é desmontada ao entregar e ao sair da página.
- **Trocar de questão com a máquina mexida.** **Mitigação:** a máquina de cada questão é guardada em memória ao sair dela e devolvida ao voltar (D-01); nada vai para o servidor.
- **O cenário de uma questão é grande.** **Mitigação:** a rota é por questão e o simulador só a chama quando a questão prática abre, nunca para a prova inteira de uma vez; a pré-visualização não muda.
- **O cenário de uma questão pode não carregar.** **Mitigação:** a questão mostra o aviso "Não foi possível carregar a máquina desta questão." com *Tentar de novo*, e o resto da prova continua.
- **A tela de estudo e o simulador ficam parecidos e divergem com o tempo.** **Mitigação:** o simulador usa o mesmo painel do terminal e as mesmas mensagens do botão *Reset Máquina*; o que for só do estudo não entra (D-04).
- **Testes da SPEC-081 que mudam.** Os testes da visão do aluno procuram o aviso do terminal e as duas colunas. **Mitigação:** ajustados no commit vermelho, com o motivo registrado na entrega.
- **Impacto em outros módulos:** nenhum. **`legacy/`:** removida; sem impacto.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (estado): ENQUANTO o simulador está na aba *Aluno* e a prova está em andamento, A tela DEVE mostrar o cabeçalho com o título, "Questão k de N", o cronômetro (havendo duração) e *Entregar*, e abaixo a coluna da questão e a coluna do terminal, lado a lado a partir de 64 rem e uma sobre a outra entre 48 e 64 rem.
- [x] **CA-02** (estado): O simulador DEVE ter as abas *Aluno* e *Professor*, com a *Aluno* aberta primeiro, e trocar de aba NÃO DEVE perder as respostas, a questão aberta, as máquinas do terminal nem o cronômetro, que DEVE continuar correndo.
- [x] **CA-03** (estado): ENQUANTO a questão aberta é de comando Linux, O terminal DEVE estar ativo com a máquina do cenário da questão (a máquina padrão se ela não tem um), carregada na primeira vez que a questão abre, e a máquina que o aluno deixou numa questão DEVE voltar quando ele volta a ela.
- [x] **CA-04** (evento): QUANDO a pessoa aciona *Reset Máquina* na questão de comando Linux, O simulador DEVE pedir a confirmação e, confirmada, devolver a máquina da questão aberta ao cenário dela, sem mexer nas máquinas das outras questões, nas respostas nem no cronômetro; recusada a confirmação, nada muda.
- [x] **CA-05** (estado): ENQUANTO a questão aberta é teórica, O terminal DEVE ficar à vista e bloqueado, com o aviso "Esta questão não usa o terminal.", e o *Reset Máquina* DEVE ficar desabilitado.
- [x] **CA-06** (estado): ENQUANTO a prova não tem nenhuma questão de comando Linux, O simulador NÃO DEVE mostrar o terminal nem o *Reset Máquina*, e a questão DEVE ocupar a largura toda.
- [x] **CA-07** (ubíquo): A tela da prova NÃO DEVE ter *Cola*, *Som*, player de narração, salvar e abrir máquina nem painel de processos.
- [x] **CA-08** (estado): ENQUANTO o cenário de uma questão não carrega, A questão DEVE mostrar o aviso de que não foi possível carregar a máquina, com *Tentar de novo*, sem impedir o resto da prova.
- [x] **CA-09** (evento): QUANDO a pessoa aciona *Refazer* ou *Sortear de novo*, O simulador DEVE descartar as máquinas das questões e as respostas, e a prova DEVE recomeçar com as máquinas nos cenários das questões.
- [x] **CA-10** (estado): ENQUANTO a janela tem menos de 48 rem, O simulador DEVE mostrar só o aviso da SPEC-081, sem montar nenhum terminal.
- [x] **CA-11** (ubíquo): O simulador NÃO DEVE gravar nada: nenhuma chamada de escrita, e o estado das máquinas DEVE existir só na memória da página; a única leitura nova é a do cenário de cada questão de comando Linux.
- [x] **CA-12** (ubíquo): A aba *Professor* DEVE continuar como a SPEC-081 define (CA-11 e CA-12 dela), e a prova DEVE continuar sem conferir a questão prática, sem trava e sem nota.
- [x] **CA-13** (ubíquo): Os textos novos DEVEM estar em `messages/pt-BR.ts`; as abas, o *Reset Máquina*, o navegador de questões e o diálogo DEVEM ter navegação por teclado, contraste AA, alvos de 44 px e nenhuma cor fora dos tokens, e o terminal DEVE manter o aviso das senhas e dos atalhos da tela de estudo.
- [x] **CA-14** (evento): QUANDO a docente dona ou o administrador pede o cenário de uma questão da avaliação, O servidor DEVE devolver o `snapshot` do cenário da questão, ou nenhum quando ela não tem um, sem gravar nada; e DEVE recusar o estudante e a docente que não é dona com 403, e a questão que não é da avaliação (na manual, fora das escolhidas; no sorteio, não elegível no módulo) com 404 `question-not-found` (RN-01, RN-02).

## 8. Plano de Testes (Test Plan)

Os testes são escritos **antes** do código e rodados vermelhos primeiro (SPEC-038). Nomes em inglês, como no código.

**Backend** (Go: `testing` e `testify`)

- Service: o cenário de uma questão escolhida, o de uma questão do sorteio (elegível no módulo), a questão sem cenário, a questão de outra avaliação ou de outro módulo, e as recusas por papel, sem escrita (CA-14)
- Handler (roteador Gin real com `httptest`): a rota, o formato com e sem `snapshot`, os erros RFC 7807 e os papéis (CA-14)
- Composition root (`cmd/api`): o cenário vem do módulo de conteúdo pelo adaptador, e a questão sem cenário devolve nada (CA-14)

**Frontend** (Vitest e Testing Library; a janela do terminal é substituída por um painel de teste que registra o cenário carregado e os `reset`)

- `AssessmentSimulator.test.tsx` (ajustado): as abas, a aba *Aluno* primeiro, o que é guardado ao trocar de aba, o cronômetro andando com a aba *Professor* aberta, o aviso abaixo de 48 rem sem montar o terminal (CA-01, CA-02, CA-10)
- `AssessmentSimulator.terminal.test.tsx` (novo): o cenário carregado na primeira visita de cada questão prática, a máquina devolvida ao voltar, o *Reset Máquina* com a confirmação, a recusa da confirmação, o terminal bloqueado na questão teórica, a prova sem questão prática sem terminal, e o cenário que não carrega com *Tentar de novo* (CA-03 a CA-06, CA-08)
- `AssessmentSimulator.answers.test.tsx` (ajustado): a questão prática deixa de mostrar o aviso do terminal (SPEC-081 CA-13 é substituída por CA-03 desta spec)
- `AssessmentSimulator.teacher.test.tsx` (ajustado): a aba *Professor* como antes, agora dentro da aba (CA-12)
- `simulate/page.test.tsx` (ajustado): a página sem chamada de escrita, lendo o cenário da questão pela rota da avaliação (CA-11)
- `assessmentService.test.ts` (ajustado): a chamada da rota do cenário (CA-14)
- Verificação de que *Refazer* e *Sortear de novo* descartam as máquinas e de que a tela da prova não tem os itens de estudo (CA-07, CA-09)
- Stylelint, ESLint e `tsc` limpos (CA-13)

**Manual** (roteiro)

1. Abrir o simulador de uma prova com questões de comando Linux e conferir a questão à esquerda e o terminal à direita, com o cronômetro e o *Entregar* em cima.
2. Digitar comandos numa questão, passar a outra e voltar: a máquina deve estar como foi deixada; acionar *Reset Máquina*, confirmar e conferir que a máquina volta ao cenário; acionar de novo e recusar.
3. Abrir uma questão teórica e conferir o terminal bloqueado; trocar para a aba *Professor* e voltar e conferir que nada se perdeu e que o tempo andou.
4. Numa prova só teórica, conferir que não há terminal.
5. Entre 48 e 64 rem conferir a questão em cima e o terminal embaixo; abaixo de 48 rem, o aviso.
6. Conferir a aparência e o contraste (WCAG AA) das abas, do cabeçalho e do terminal no tema escuro.

**Cobertura:** meta acima de 80% no escopo da spec (`ARCHITECTURE.md`, seção 5), com o Vitest em modo de cobertura.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md` e esta spec; a SPEC-081 inteira (as seções 3.1 e 10), as SPEC-014, 016 e 034 (a máquina e o terminal). Do código: `frontend/src/components/AssessmentSimulator/`, `frontend/src/components/TopicStudy/TerminalPane.tsx` e `TopicStudy.tsx` (o *Reset Máquina*, o carregamento de cenário e o aviso das senhas), `frontend/src/engine/terminalWindow.ts`, `frontend/src/services/practiceService.ts` e `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/simulate/page.tsx`. Do simulado da `main`, só para ver o arranjo: `src/app/TelaSimulado.ts` e `src/estilos/simulado.css`.
2. **Ordem de execução:** (a) os testes do backend, vermelhos e commitados (`test(assessment): ...`) e a leitura do cenário (RN-01, RN-02); (b) testes vermelhos do frontend, rodados e commitados (`test(frontend): ...`); (c) as abas e a tela da prova em duas colunas; (d) o terminal, o carregamento de cenário por questão e o *Reset Máquina*; (e) estilos; (f) roteiro manual; (g) status e histórico.
3. **Arquivos e diretórios a criar ou alterar:**
   - **Backend, alterados:** `backend/internal/modules/assessment/service/service.go` (a interface de questões ganha a leitura do cenário), um arquivo novo `service/scenario.go` (o caso de uso), `handler/handler.go` e `handler/dto.go` (a rota e a resposta), `domain/errors.go` (o erro da questão que não é da avaliação), `backend/cmd/api/assessment_refs.go` (o adaptador que lê o cenário pelo módulo de conteúdo), `backend/internal/modules/content/service/reader.go` (a leitura do cenário de uma questão, sem a regra de visibilidade da prática) e os testes ao lado de cada um.
   - **Frontend, novos:** `frontend/src/components/AssessmentSimulator/ExamTerminal.tsx` (a coluna do terminal, com o *Reset Máquina*, o bloqueio e o aviso do cenário) e seu `.module.scss` e teste, e `AssessmentSimulator.terminal.test.tsx`.
   - **Frontend, alterados:** `AssessmentSimulator.tsx`, `.module.scss` e os testes dele (as abas e a tela da prova), `frontend/src/lib/assessmentSimulation.ts` (só se a escolha da máquina por questão pedir), `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/simulate/page.tsx`, `page.test.tsx` e seu estilo (a largura toda), `frontend/src/services/assessmentService.ts` e o teste (a rota do cenário) e `frontend/src/messages/pt-BR.ts`.
   - **Documentação:** esta spec e a nota de substituição parcial no histórico da SPEC-081.
   - **Não alterar:** `TopicStudy`, `TerminalPane`, `frontend/src/engine/` e qualquer arquivo fora desta lista sem justificativa no resumo da entrega; se o `TerminalPane` não servir como está, parar e perguntar.
4. **Definição de pronto:** todos os CA marcados, os testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, o roteiro manual feito, as pendências da seção 10 vazias e o status atualizado para `Implementada`.

## 10. Pendências para aprovação

Nenhuma. O Tech Lead decidiu em 22/10/2026, ao aprovar a spec, todas as pendências que ela tinha, com as recomendações como estavam, e antes dela, ao pedi-la, as escolhas da primeira linha. As decisões estão incorporadas às seções 2, 3, 6, 7 e 8; esta tabela só as registra.

| ID | Decisão |
| :--- | :--- |
| Escolhas do pedido | **Abas, sem conferir, terminal único.** As abas *Aluno* e *Professor* no lugar das colunas lado a lado; a questão prática não é conferida (sem trava, sem nota, sem validação); e uma só janela de terminal acompanha o aluno pela prova toda. |
| D-01 | **A máquina do terminal.** Uma só janela de terminal para a prova toda; a máquina dentro dela é a do cenário da questão aberta: carregada na primeira visita, guardada ao sair e devolvida ao voltar; o *Reset Máquina* devolve ao início a máquina da questão aberta. |
| D-02 | **A largura da tela da prova.** Lado a lado a partir de 64 rem, uma sobre a outra entre 48 e 64 rem, o aviso de tela maior abaixo de 48 rem, e a página do simulador usa a largura toda. |
| D-03 | **O terminal nas questões teóricas.** À vista e bloqueado, com o aviso "Esta questão não usa o terminal."; só some quando a prova inteira não tem questão prática. |
| D-04 | **O que da tela de estudo entra na prova.** Só o terminal e o *Reset Máquina*; ficam de fora *Cola*, *Som*, o player, salvar e abrir máquina e o painel de processos. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 22/10/2026 | Aruna Architect | Criação em `Rascunho`, a pedido do Tech Lead, a partir do pedido de 22/10/2026 de que a tela do aluno no simulador tenha a questão de um lado e o terminal do outro, com o botão *Reset Máquina*; conferida contra a tela de estudo do módulo (`/materials/[id]`), o simulado da `main` (`TelaSimulado.ts`), a SPEC-081 e o banco de questões. Respostas do Tech Lead antes da escrita: abas *Aluno* e *Professor*, sem conferir a questão prática, uma máquina para a prova toda. Quatro pendências abertas (D-01 a D-04), todas com recomendação; a D-01 ajusta a escolha da máquina ao fato de cada questão ter o próprio cenário |
| 22/10/2026 | Tech Lead | Aprovada ("aprovo"), com as recomendações das quatro pendências aceitas como estavam na spec: D-01 a D-04, inclusive a D-01, que ajusta a máquina única ao cenário de cada questão. Status: `Aprovada` |
| 22/10/2026 | Aruna Architect | Seção 10 esvaziada: as quatro pendências viraram decisões D-01 a D-04, incorporadas ao texto |
| 22/10/2026 | Aruna Architect | Revisão do contrato, achada ao ligar o terminal ao banco de dados de desenvolvimento e aprovada pelo Tech Lead na mesma data ("Rota nova de leitura na avaliação"): a rota de cenário da prática (`GET /questions/:id/scenario`), que a spec dava por suficiente, responde 404 para a questão que existe só na avaliação, o caso comum. O escopo passa a Ambos: a seção 3.2 ganha a RN-01 e a RN-02, a seção 5 ganha a rota `GET /classes/:id/assessments/:assessmentId/questions/:questionId/scenario`, a seção 7 ganha o CA-14, e as seções 6, 8 e 9 acompanham. Nenhuma decisão D-01 a D-04 muda |
| 22/10/2026 | Implementador | Implementada, menos a parte do roteiro manual que só o olho vê com uma prova de outro tipo, por isso o status continua `Aprovada`. **Feito:** CA-01 a CA-14. Frontend: as abas *Aluno* e *Professor* (a inativa fica montada e escondida, para nada se perder), a tela da prova com o cabeçalho, a questão à esquerda e o terminal à direita (lado a lado a partir de 64 rem, empilhados abaixo), o componente `ExamTerminal` (uma janela, a máquina da questão aberta guardada ao sair, o *Reset Máquina* com confirmação, o terminal bloqueado nas questões teóricas e o aviso do cenário que não carrega) e a página com a largura toda. Backend: a rota `GET /classes/:id/assessments/:assessmentId/questions/:questionId/scenario` (RN-01 e RN-02), com a leitura do cenário no módulo de conteúdo. Commits: `test(assessment)` e `feat(assessment)` no backend; `test(frontend)`, `feat(frontend)` e, da revisão do contrato, outro par, no frontend. **Medido:** os testes novos falharam antes (o `ExamTerminal`, as abas e a leitura do cenário não existiam); depois, `go test` de `assessment` (service, handler, domain), de `content/service` e de `cmd/api` verdes, cobertura de 84,5% no service e 84,6% no handler; no frontend, 283 arquivos e 3.334 testes passam (1 pulado que já existia; a pasta `engine` não roda por desenho), `tsc`, ESLint e Stylelint limpos, e cobertura de 96,3% das linhas no escopo do simulador. **À mão** (Chrome sem janela, tema escuro, contra o backend de desenvolvimento com a rota nova): a tela da prova a 1.440 px com a questão à esquerda e o terminal à direita, a janela real do terminal com o cenário carregado, um comando digitado, o *Reset Máquina* com a confirmação e a animação de formatação, as abas indo e voltando com o terminal e o tempo no lugar, a tela empilhada a 1.000 px sem rolagem lateral, e o axe-core sem violação de contraste. **Achado na hora:** a rota de cenário da prática responde 404 para a questão que existe só na avaliação, então a spec ganhou a rota nova e o escopo passou a Ambos (revisão aprovada pelo Tech Lead, registrada acima). **Aberto:** a parte do roteiro com uma prova que misture os tipos: a avaliação do desenvolvedor só tem questões práticas, então o terminal bloqueado numa questão teórica e a prova sem terminal só foram vistos em teste automatizado. **Desvios:** nenhum além da revisão do contrato. **Testes alterados depois do vermelho:** os da SPEC-081 que procuravam as duas colunas, o aviso do terminal e a visão do professor sempre à vista passaram a esperar as abas e o terminal (requisito novo, em commit próprio antes do código), e o teste da página passou a espiar a rota da avaliação no lugar da rota da prática, pela revisão do contrato |
| 22/10/2026 | Aruna Architect | Substituição parcial pela SPEC-085 (em `Rascunho`), a pedido do Tech Lead, depois de ele fazer o comando certo no terminal do simulador e a prova não dar a questão como resolvida: a escolha "sem conferir" a questão prática (o primeiro item da seção 2.1 e a parte do CA-12 que diz que a prova não confere) passa a ser do servidor conferir, sem gravar nada. Continuam valendo a ausência de trava, de nota e de validação no navegador. O código da SPEC-084 não muda até a SPEC-085 ser aprovada |
