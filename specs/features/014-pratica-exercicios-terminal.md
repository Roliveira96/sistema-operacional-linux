# SPEC-014: Prática de Exercícios com Terminal no Navegador e Correção no Servidor

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-014 |
| **Status** | Rascunho |
| **Data de criação** | 08/10/2026 |
| **Última revisão** | 08/10/2026 |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `practice` (novo) e `content` |
| **Contexto de tela** | `/materials/[id]` e `/app/modules/[id]` (seção de exercícios) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-003, SPEC-011, SPEC-012 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | `docs/arquitetura/transicao-backend.md`, seção 2.1 (execução local e correção no servidor); `specs/ARCHITECTURE.md`, seção 6 (decisão em aberto sobre o motor do legado) |

> O corpo desta spec já reflete as recomendações da seção 10, marcadas com (P-xx).

---

## 1. Contexto e Problema (Context & Problem Statement)

Depois das SPECs 011 e 012, o estudante lê o conteúdo e vê o enunciado dos exercícios, mas não consegue resolvê-los: não há terminal na plataforma nova, e a correção, que no legado rodava no navegador, agora existe só no servidor (motor da SPEC-011). Sem prática, o material perde o principal diferencial do projeto, e a futura aplicação de provas não tem onde se apoiar.

O documento canônico define o modelo: a digitação e a execução dos comandos ficam no navegador, sem latência; a decisão de aprovado ou reprovado fica no servidor, a partir do estado final da máquina.

## 2. Objetivos (Goals)

- Reaproveitar o motor POSIX/VFS do legado no frontend novo, sem duplicar nem reescrever as 10.800 linhas do sistema de arquivos e do shell.
- Oferecer um terminal no navegador, em React, ligado ao motor, para cada exercício.
- Entregar ao navegador o cenário inicial da questão, sem nenhuma informação de correção.
- Corrigir no servidor o estado final enviado pelo navegador, com o motor da SPEC-011.
- Registrar o progresso do estudante por exercício e mostrar o que já foi concluído.

### 2.1. Fora de escopo (Non-Goals)

- Provas: janela de aplicação, código de sala, cronômetro, anti-fraude e notas (spec futura). Na prática, o estado enviado pelo navegador é aceito como está (P-04).
- Questões teóricas e simulados: esta spec trata só das questões práticas de uso `EXERCISE`.
- Editores `vim` e terminais múltiplos simultâneos na mesma tela (P-03).
- Qualquer alteração em `legacy/`.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Motor (P-01):** o frontend importa, somente leitura, os pacotes `legacy/src/linux` e `legacy/src/shell` por um alias de caminho único (`@legacy-engine/*`), configurado no TypeScript, no bundler do Next.js e no Vitest. Só um adaptador em `frontend/src/engine/` conversa com o motor; componentes nunca importam o legado diretamente. O código do legado continua com identificadores em português; o adaptador, como todo código novo, é em inglês.
- **Terminal (P-02):** componente React próprio, sem biblioteca nova: linha de comando com prompt `usuario@host:caminho$`, histórico com setas, cores ANSI básicas, `clear`, respostas a perguntas interativas (senhas e confirmações) e foco acessível por teclado.
- **Editor `nano` (P-03):** quando o comando pede edição, abre um editor simples em diálogo (área de texto com salvar e cancelar); `vim` responde com uma mensagem orientando o uso do `nano`.
- **Exercício:** cada exercício da página do módulo ganha o botão "Praticar", que abre o terminal com o cenário da questão. Os botões "Conferir" e "Recomeçar" ficam ao lado do terminal. O resultado mostra aprovado ou "ainda não", sem revelar as condições.
- **Progresso:** exercícios concluídos aparecem marcados na lista do módulo.
- **Visitantes (P-06):** podem abrir o terminal e praticar; "Conferir" pede login.

### 3.2. Backend (Go — Camada de Módulo/Service)

Módulo novo `backend/internal/modules/practice/` (`domain`, `service`, `repository`, `handler`), que usa o `content` pela interface pública do service.

- **RN-01 (cenário):** a rota de cenário devolve o estado inicial serializado da questão prática publicada, com a mesma regra de visibilidade do módulo (SPEC-012). Nunca devolve condições, solução de referência nem gabarito.
- **RN-02 (correção):** a rota de conferência recebe o estado final serializado, valida o formato (`exame-so/maquina`, versão 1) e o tamanho (até 2 MB, P-05), avalia as condições da questão com o motor da SPEC-011 e devolve só `passed` (verdadeiro ou falso).
- **RN-03 (progresso):** cada conferência de um estudante autenticado grava o resultado; a primeira aprovação marca o exercício como concluído, e aprovações posteriores não apagam a data da primeira.
- **RN-04 (limite):** conferências limitadas a 30 por usuário por minuto, com o limitador da plataforma.
- **RN-05 (só exercícios):** questões de uso `ASSESSMENT` não são servidas por estas rotas; elas pertencem à aplicação de provas.

## 4. Modelo de Dados (Data Model)

### 4.1. `exercise_progress`

| Campo | Tipo | Obrigatório | Restrições | Descrição |
| :--- | :--- | :--- | :--- | :--- |
| `id` | UUID | Sim | PK, UUIDv7 | |
| `user_id` | UUID | Sim | FK → `users.id` | |
| `question_id` | UUID | Sim | FK → `questions.id` | |
| `attempts` | inteiro | Sim | ≥ 1 | Quantidade de conferências |
| `last_passed` | booleano | Sim | | Resultado da última conferência |
| `completed_at` | timestamp | Não | | Primeira aprovação |
| `created_at`, `updated_at` | timestamp | Sim | | |

Unicidade (`user_id`, `question_id`). Os estados enviados não são guardados nesta spec (P-04).

## 5. Contrato de API (API Contract)

### 5.1. `GET /api/v1/questions/{id}/scenario`

Cenário inicial de um exercício prático. **Acesso:** visibilidade do módulo da questão (autenticação opcional).

| Campo da resposta | Tipo | Descrição |
| :--- | :--- | :--- |
| `questionId` | UUID | |
| `snapshot` | objeto | Estado serializado da máquina (formato do legado) |

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 401 | `not-authenticated` | Módulo não público sem sessão |
| 403 | `forbidden` | Módulo privado não liberado |
| 404 | `question-not-found` | Questão inexistente, não prática, não publicada ou de uso `ASSESSMENT` |

### 5.2. `POST /api/v1/questions/{id}/check`

Confere o estado final. **Acesso:** autenticado, com acesso ao módulo.

| Campo do corpo | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| `snapshot` | objeto | Sim | Formato `exame-so/maquina` versão 1; corpo até 2 MB |

| Campo da resposta | Tipo | Descrição |
| :--- | :--- | :--- |
| `passed` | booleano | Resultado da correção |
| `completedAt` | timestamp ou nulo | Data da primeira aprovação |

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 400 | `validation-error` | Estado ausente ou fora do formato |
| 401 | `not-authenticated` | Sem sessão |
| 403 | `forbidden` | Sem acesso ao módulo |
| 404 | `question-not-found` | Como em 5.1 |
| 413 | `file-too-large` | Corpo acima de 2 MB |
| 429 | `rate-limited` | Limite excedido |

### 5.3. `GET /api/v1/modules/{id}/progress`

Progresso do estudante nos exercícios de um módulo. **Acesso:** autenticado.

| Campo de cada item | Tipo | Descrição |
| :--- | :--- | :--- |
| `questionId` | UUID | |
| `completedAt` | timestamp ou nulo | |
| `attempts` | inteiro | |

## 6. Impacto e Riscos (Impact & Risks)

- **Acoplamento ao legado congelado.**
  *Mitigação:* um único alias e um único adaptador; o legado continua sem alterações, e uma futura extração do motor para um pacote próprio muda só o alias.
- **Tamanho do pacote do frontend.**
  *Mitigação:* o motor é carregado sob demanda, só quando o estudante abre o terminal.
- **Fraude na prática** (estado montado à mão).
  *Mitigação:* aceitável nesta fase, porque a prática não vale nota; a aplicação de provas terá anti-fraude próprio.
- **Comandos do legado que dependem do DOM** (editores, terminais múltiplos).
  *Mitigação:* `nano` por diálogo; `vim` e terminais múltiplos fora de escopo.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01**: QUANDO o estudante abrir "Praticar", O SISTEMA DEVE carregar o cenário da questão e permitir executar comandos no terminal.
- [ ] **CA-02**: A resposta do cenário NÃO DEVE conter condições, solução de referência nem gabarito.
- [ ] **CA-03**: QUANDO o estudante executar a solução de referência e conferir, O SISTEMA DEVE responder `passed` verdadeiro; QUANDO conferir o cenário intocado, falso.
- [ ] **CA-04**: QUANDO um estudante for aprovado pela primeira vez, O SISTEMA DEVE gravar `completed_at` e mostrar o exercício como concluído; uma reprovação posterior NÃO DEVE apagar a conclusão.
- [ ] **CA-05**: SE o estado enviado estiver fora do formato ou acima de 2 MB, ENTÃO O SISTEMA DEVE responder 400 ou 413.
- [ ] **CA-06**: SE a questão for de uso `ASSESSMENT`, rascunho ou teórica, ENTÃO as rotas 5.1 e 5.2 DEVEM responder 404.
- [ ] **CA-07**: SE o visitante tentar conferir, ENTÃO a interface DEVE pedir login, e a API DEVE responder 401.
- [ ] **CA-08**: Nenhum componente do frontend DEVE importar o legado diretamente; só o adaptador em `frontend/src/engine/`.
- [ ] **CA-09**: QUANDO um comando pedir edição com `nano`, O SISTEMA DEVE abrir o editor em diálogo e gravar o conteúdo salvo no arquivo.
- [ ] **CA-10**: As telas desta spec DEVEM usar só tokens de `_tokens.scss`, com paridade entre temas, e o terminal DEVE ser operável só pelo teclado.

## 8. Plano de Testes (Test Plan)

- **Backend:** service com fakes (cenário sem segredos, correção, progresso e preservação da primeira aprovação); handler com `httptest` (status e RFC 7807); repository com PostgreSQL real; teste ponta a ponta usando os estados das fixtures de equivalência (solução de referência aprova, cenário intocado reprova).
- **Frontend:** adaptador do motor (executar comandos sobre um cenário real e serializar), terminal (histórico, perguntas, ANSI, teclado), diálogo do `nano`, painel do exercício (conferir, recomeçar, login exigido) e os dois temas.
- **Manual:** resolver no navegador um exercício de cada módulo.
- **Cobertura:** acima de 80% em `practice` e no frontend novo.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura:** SPECs 011 e 012; `legacy/src/linux/Maquina.ts`, `Serializador.ts`, `legacy/src/shell/Shell.ts`, `Interpretador.ts`, `Contexto.ts` e `legacy/src/terminal/TerminalUbuntu.ts` (só como referência de comportamento).
2. **Ordem:** alias e adaptador do motor → backend (migração, domain, service, repository, handler) → terminal e diálogo do `nano` → painel de exercício → progresso na página do módulo.
3. **Arquivos a criar ou alterar:** `frontend/tsconfig.json`, `frontend/next.config.ts`, `frontend/vitest.config.ts` (alias), `frontend/src/engine/`, `frontend/src/components/Terminal/`, `frontend/src/components/NanoDialog/`, `frontend/src/components/ExercisePractice/`, `frontend/src/components/ModuleContentView/`, `frontend/src/services/practiceService.ts`, `backend/migrations/` (nova), `backend/internal/modules/practice/`, `backend/cmd/api/main.go`, `specs/ARCHITECTURE.md` (decisão sobre o motor).
4. **Definição de pronto:** CA-01 a CA-10 verificados e cobertura acima de 80%.

## 10. Pendências para aprovação

| ID | Pendência | Recomendação (já refletida no corpo) |
| :--- | :--- | :--- |
| P-01 | Como o frontend reaproveita o motor do legado: importar do `legacy/` por alias; copiar o código para o frontend (exigiria traduzir 10.800 linhas para inglês); ou extrair um pacote compartilhado (exigiria alterar o legado congelado). | Importar `legacy/src/linux` e `legacy/src/shell`, somente leitura, por um alias e um único adaptador. Registrar a decisão no `ARCHITECTURE.md`, seção 6, como exceção à regra de não importar o legado. |
| P-02 | Biblioteca de terminal (xterm.js) ou componente próprio. | Componente próprio, sem dependência nova; o motor já devolve texto com cores ANSI. |
| P-03 | Editores do legado (`nano` e `vim`) dependem do DOM antigo. | `nano` por diálogo simples; `vim` fora de escopo, com mensagem orientando o `nano`. |
| P-04 | Na prática, o estado vem do navegador e pode ser forjado. | Aceitar nesta fase, porque a prática não vale nota; não guardar os estados enviados; anti-fraude na spec de provas. |
| P-05 | Tamanho máximo do estado enviado. | 2 MB (um estado típico tem cerca de 50 KB). |
| P-06 | Visitantes podem praticar? | Podem abrir o terminal; conferir exige login, para limitar a taxa e registrar o progresso. |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 08/10/2026 | Implementador (Claude) | Criação, a pedido do Tech Lead, como próxima etapa depois da SPEC-013. Pendências P-01 a P-06 |
