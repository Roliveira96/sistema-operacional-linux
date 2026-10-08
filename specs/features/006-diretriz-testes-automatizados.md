# SPEC-006: Diretriz de Testes Automatizados e Cobertura Mínima

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-006 |
| **Status** | Implementada |
| **Data de criação** | 08/10/2026 |
| **Última revisão** | 08/10/2026 |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | core/governance |
| **Contexto de tela** | Não se aplica |
| **Prioridade** | Alta |
| **Depende de** | SPEC-004 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | `specs/ARCHITECTURE.md` (seção 5) e `specs/AI_INSTRUCTIONS.md` |

---

## 1. Contexto e Problema (Context & Problem Statement)

O fluxo Spec-Driven Development exige um plano de testes em cada spec, mas não tem uma regra vinculante para a entrega simultânea dos testes automatizados nem uma meta mínima de cobertura. Funcionalidades, correções e refatorações correm o risco de chegar sem os testes correspondentes, e implementações manuais ou feitas por agentes de IA podem introduzir regressões silenciosas no backend Go e no frontend Next.js.

Sem ferramentas padronizadas e sem meta de cobertura, cada implementação valida de um jeito, e o sistema fica exposto a quebras de contrato de API e a falhas de renderização, inclusive na paridade entre os temas claro e escuro.

## 2. Objetivos (Goals)

- Tornar obrigatória a entrega de testes automatizados junto com toda funcionalidade, refatoração ou correção, no mesmo commit.
- Padronizar as ferramentas: `testing` com `testify` e mocks escritos à mão sobre interfaces no backend; Vitest e Testing Library no frontend.
- Fixar a cobertura mínima em **mais de 80%** das instruções nas camadas de negócio do backend e em serviços, hooks e componentes do frontend.
- Exigir testes unitários isolados para services e testes de handler com `httptest`, conferindo status HTTP e envelopes RFC 7807.
- Exigir testes de componentes com rede simulada e renderização verificada nos dois temas.
- Registrar a regra em `ARCHITECTURE.md`, `AI_INSTRUCTIONS.md` e `_TEMPLATE.md`.

### 2.1. Fora de escopo (Non-Goals)

- Pipeline de CI/CD e bloqueio automático de merge: spec futura.
- Testes ponta a ponta em navegador (Playwright ou similar).
- Retrofit de cobertura nos pacotes de `internal/platform/` já entregues pela SPEC-004.
- Qualquer código de produção.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Co-location:** todo serviço (`services/`), hook (`hooks/`) e componente (`components/`) tem um arquivo de teste ao lado da implementação.
- **Serviços:** a rede é simulada injetando um `fetch` falso no cliente HTTP; são cobertos sucesso, erro RFC 7807, erro sem RFC 7807 e falha de rede. Nenhum teste faz tráfego real.
- **Hooks:** transições de estado assíncronas, tratamento de erro e cenários de sucesso e falha.
- **Componentes:** eventos de usuário, papéis ARIA e elementos semânticos. Cada componente é renderizado com `data-theme="light"` e com `data-theme="dark"` no elemento raiz, e o teste verifica que a estrutura e as classes de módulo são equivalentes nos dois casos. Os testes não comparam valores de cor; a proibição de cores literais é garantida pelo Stylelint (SPEC-004).
- **Cobertura:** medida pelo Vitest com o provedor `v8`.

### 3.2. Backend (Go — Camada de Módulo/Service)

- **Services:** testes unitários no mesmo pacote, com dependências substituídas por implementações de teste escritas à mão sobre as interfaces que o próprio service declara (sem geradores de mock). Nenhum teste unitário abre conexão real com PostgreSQL, MinIO ou SMTP. São cobertos o sucesso, cada regra de negócio (RN-xx), cada erro de domínio e a propagação de transação.
- **Handlers:** testes contra o roteador Gin real com `httptest`, cobrindo validação de entrada, conversão de tipos, cabeçalhos, status HTTP (200, 201, 204, 400, 401, 403, 404, 409, 410, 413, 429, 500 e 503, conforme o endpoint) e o envelope RFC 7807.
- **Repositories:** testes de integração com PostgreSQL real via `testcontainers-go` (já adotado na SPEC-004).
- **Asserções:** `testify` (`assert` e `require`) para legibilidade.
- **Cobertura:** `go test -cover` sobre cada módulo de `internal/modules/`, incluindo os testes de integração. A meta vale para `domain`, `service` e `handler` de cada módulo.
- **Condições de corrida:** `go test -race` sempre que o ambiente tiver cgo disponível; obrigatório na futura CI.
- **Qualidade das asserções:** cada critério de aceite de uma spec é mapeado a pelo menos um teste nomeado, e as asserções verificam saídas, estados e erros, não a contagem de chamadas internas.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: trata apenas de governança de qualidade.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: nenhum endpoint é criado.

## 6. Impacto e Riscos (Impact & Risks)

- **Mais tempo na primeira entrega de cada funcionalidade.**
  *Mitigação:* menos depuração manual e regressões detectadas no próprio commit.
- **Testes frágeis por excesso de mocks.**
  *Mitigação:* asserções sobre comportamento observável (saídas, estados, erros), não sobre detalhes internos.
- **Cobertura artificial (linhas executadas sem asserção real).**
  *Mitigação:* mapeamento obrigatório de cada critério de aceite a um teste nomeado; o relatório de entrega lista esse mapeamento.
- **Meta impossível em código de infraestrutura** (clientes de MinIO, SMTP, encerramento do processo).
  *Mitigação:* a meta vale para os módulos de negócio; a plataforma é coberta por testes de integração e por roteiro manual.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01**: O `specs/AI_INSTRUCTIONS.md` DEVE proibir a entrega de código de produção sem os testes automatizados correspondentes no mesmo commit e DEVE exigir, no relatório de entrega, a cobertura medida e o mapeamento critério de aceite → teste.
- [x] **CA-02**: O `specs/ARCHITECTURE.md` DEVE descrever a pilha de testes (Go `testing` + `testify`, mocks manuais por interface, `testcontainers-go`; Vitest + Testing Library + cobertura `v8`) e a meta de cobertura acima de 80%.
- [x] **CA-03**: O `specs/_TEMPLATE.md` DEVE exigir, na seção 8, a meta de cobertura e o mapeamento de cada CA para os testes.
- [x] **CA-04**: O `package.json` do frontend DEVE ter um script de teste com cobertura que falhe abaixo de 80% em linhas e ramos para serviços, hooks e componentes.
- [x] **CA-05**: QUANDO uma spec com código for implementada depois desta, a entrega DEVE incluir os testes no mesmo commit e a cobertura acima de 80% no escopo definido na seção 3.
- [x] **CA-06**: Os arquivos `CLAUDE.md`, `GEMINI.md` e `AGENTS.md` DEVEM conter um lembrete de uma linha de que toda entrega de código exige testes, apontando para `specs/AI_INSTRUCTIONS.md`, sem duplicar a regra.

## 8. Plano de Testes (Test Plan)

- **Backend:** executar `go test -cover` sobre um módulo de exemplo e conferir a cobertura por pacote; executar com `-race` onde houver cgo.
- **Frontend:** executar o script de cobertura e confirmar que ele falha quando o limite não é atingido (CA-04); executar os testes em lote e isoladamente, sem dependência de ordem.
- **Documentação (manual):** revisar `specs/` e os ponteiros da raiz, confirmando a regra sem ambiguidade (CA-01 a CA-03, CA-06).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md` e `specs/_TEMPLATE.md`.
2. **Ordem:** `ARCHITECTURE.md` → `AI_INSTRUCTIONS.md` → `_TEMPLATE.md` → ponteiros da raiz → dependências de teste e script de cobertura no frontend → `testify` no `go.mod`.
3. **Arquivos a alterar:** `specs/ARCHITECTURE.md`, `specs/AI_INSTRUCTIONS.md`, `specs/_TEMPLATE.md`, `CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, `frontend/package.json`, configuração do Vitest e `backend/go.mod`.
4. **Definição de pronto:** CA-01 a CA-06 verificados.

## 10. Pendências para aprovação

Nenhuma. P-01 a P-08 aprovadas pelo Tech Lead em 08/10/2026 (ver histórico).

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 08/10/2026 | Aruna Architect | Criação |
| 08/10/2026 | Implementador (Claude) | Conversão para o template: arquivo renomeado (sem `spec-`), cabeçalho com status, fora de escopo, critérios numerados e reescritos como verificáveis, pendências P-01 a P-08 |
| 08/10/2026 | Tech Lead | Aprovação integral: `testify` e mocks manuais; meta de 80% só para `internal/modules/` e frontend; `@vitest/coverage-v8`; `-race` na futura CI; sem NATS e sem 422; teste de tema por estrutura; CI em spec própria; lembrete de uma linha nos ponteiros. Status: `Aprovada` |
| 08/10/2026 | Implementador (Claude) | Regra aplicada em `ARCHITECTURE.md` (seção 5), `AI_INSTRUCTIONS.md`, `_TEMPLATE.md` e ponteiros; `@vitest/coverage-v8` com limite de 80% (linhas e ramos) no script `test:coverage`, verificado falhando a 77% e passando depois dos testes complementares (97% linhas, 96% ramos). O `testify` entra no `go.mod` com o primeiro módulo de negócio (SPEC-003). Status: `Implementada` |
