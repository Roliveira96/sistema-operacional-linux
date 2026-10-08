# SPEC-001: Estruturação do Monorepo e Governança Spec-Driven Development

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-001 |
| **Status** | Implementada |
| **Data de criação** | 08/10/2026 |
| **Última revisão** | 08/10/2026 |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | core/governance |
| **Contexto de tela** | Não se aplica |
| **Prioridade** | Alta |
| **Depende de** | Nenhuma |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | `docs/arquitetura/transicao-backend.md` (seções 1, 2 e 6.4) |

---

## 1. Contexto e Problema (Context & Problem Statement)

O projeto "Linux na Prática" operava exclusivamente no cliente, como Single Page Application em TypeScript modular empacotada com Vite. A emulação POSIX, o sistema de arquivos virtual (VFS) em memória, o interpretador de comandos e a correção das avaliações rodavam no navegador. A resposta é imediata, mas, em exames formais, qualquer usuário pode inspecionar ou manipular o estado de correção pelas ferramentas de desenvolvedor (DevTools). O modelo também impede a persistência estruturada de notas, a auditoria forense, a governança centralizada e a supervisão em tempo real.

O TCC 2 estabelece a evolução para uma arquitetura cliente-servidor na branch única `projeto-tcc2`. Sem uma topologia de repositório padronizada e sem governança orientada a especificações, o projeto corre o risco de sobrescrever acidentalmente o código legado, perder o simulador validado pela suíte Vitest, desviar dos padrões arquiteturais (Go 1.24 e Next.js 15+) e receber implementações descoordenadas de agentes de desenvolvimento.

## 2. Objetivos (Goals)

- Estabelecer a topologia de monorepo na branch `projeto-tcc2`, separando backend, frontend, legado e governança.
- Preservar integralmente o simulador client-side em `legacy/`, executável de forma autônoma e com a suíte Vitest passando.
- Estruturar o diretório de governança `specs/` (visível, sem ponto inicial) na raiz.
- Consolidar o protocolo de atuação de agentes de IA em `specs/AI_INSTRUCTIONS.md`.
- Consolidar as regras arquiteturais em `specs/ARCHITECTURE.md`.
- Criar o template canônico de specs (`specs/_TEMPLATE.md`) e o glossário PT↔EN (`specs/GLOSSARY.md`).
- Fazer com que Claude, Gemini, Kiro e ChatGPT/Codex leiam a mesma fonte, por meio de arquivos ponteiro na raiz.
- Garantir que nenhuma linha de código de produção seja escrita sem spec aprovada.

### 2.1. Fora de escopo (Non-Goals)

- Qualquer código de aplicação em `backend/` ou `frontend/`.
- Modelagem de schema e de endpoints (cada módulo terá spec própria).
- Mover `docs/` para `legacy/`: a documentação e a monografia são fontes canônicas do projeto todo e permanecem na raiz.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Provisionar o diretório `frontend/`, vazio, reservado à aplicação Next.js 15+ com App Router. As regras de estilização (SCSS Modules em co-location, design tokens semânticos em CSS Custom Properties, paridade de temas claro e escuro, mixins centralizados) e de acesso à rede (camada exclusiva em `frontend/src/services/`) ficam em `specs/ARCHITECTURE.md`, seção 4.

Mover para `legacy/` o código-fonte, as configurações, os manifestos de dependências, os ativos públicos, os scripts e a suíte de testes do simulador original, preservando a execução autônoma dentro da pasta. Ajustar os caminhos relativos que apontavam para fora do simulador (geração de capturas de tela em `docs/screenshots/`) e remover do manifesto do legado os atalhos de compilação da monografia, que não pertencem ao simulador.

### 3.2. Backend (Go — Camada de Módulo/Service)

Provisionar o diretório `backend/`, vazio, reservado ao serviço Go 1.24. As regras de Clean Architecture, Modular Monolith, DDD-lite, Gin-Gonic, GORM, RFC 7807, transações por propagação de contexto e hub WebSocket ficam em `specs/ARCHITECTURE.md`, seção 3.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: trata apenas da fundação estrutural e documental. O schema PostgreSQL e as entidades (UUIDv7 gerados em hook do GORM) serão definidos em specs dedicadas por módulo.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: nenhum endpoint é criado.

## 6. Impacto e Riscos (Impact & Risks)

- **Isolamento incorreto do código legado.**
  *Mitigação:* mover configurações, manifestos, fontes, ativos e testes juntos e executar a suíte e o build dentro de `legacy/` após a movimentação.
- **Desvio arquitetural por assistentes de IA.**
  *Mitigação:* `specs/AI_INSTRUCTIONS.md` como leitura obrigatória, apontado por `CLAUDE.md`, `GEMINI.md` e `AGENTS.md`; proibição de implementar spec que não esteja `Aprovada`.
- **Nomes divergentes entre agentes.**
  *Mitigação:* `specs/GLOSSARY.md` com o nome em código obrigatório para cada conceito.
- **Mistura entre as disciplinas acadêmicas (TCC 1 e TCC 2).**
  *Mitigação:* todo o desenvolvimento acontece na branch `projeto-tcc2`.
- **Links quebrados no README da raiz.**
  *Mitigação:* atualizar para `legacy/public/` os caminhos de imagens.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01**: O REPOSITÓRIO DEVE ter a branch `projeto-tcc2` como base de desenvolvimento.
- [x] **CA-02**: O REPOSITÓRIO DEVE conter `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, `specs/_TEMPLATE.md` e o diretório `specs/features/`.
- [x] **CA-03**: O REPOSITÓRIO DEVE conter os diretórios `backend/` e `frontend/` versionados.
- [x] **CA-04**: O REPOSITÓRIO NÃO DEVE conter o diretório `.specs/`.
- [x] **CA-05**: QUANDO a suíte Vitest for executada dentro de `legacy/`, TODOS OS TESTES DEVEM passar (verificado em 08/10/2026: 4 arquivos, 752 testes).
- [x] **CA-06**: QUANDO o build for executado dentro de `legacy/`, ELE DEVE concluir sem erros.
- [x] **CA-07**: QUANDO um agente de IA abrir o repositório, `CLAUDE.md`, `GEMINI.md` e `AGENTS.md` DEVEM direcioná-lo para `specs/AI_INSTRUCTIONS.md`.
- [x] **CA-08**: Os documentos de `specs/` NÃO DEVEM conter código de exemplo, payloads mockados nem scripts de banco de dados.
- [x] **CA-09**: As specs em `specs/features/` DEVEM seguir o padrão de nome `NNN-slug.md`.

## 8. Plano de Testes (Test Plan)

- **Repositório (cobre CA-01 a CA-04, CA-07 e CA-09):** conferir a branch ativa, a existência e o rastreamento no Git dos diretórios e arquivos listados e a integridade dos links internos entre os documentos de `specs/`.
- **Legado (cobre CA-05 e CA-06):** executar, dentro de `legacy/`, a suíte de testes e o build do simulador.
- **Revisão manual (cobre CA-08):** ler os documentos de `specs/` em busca de blocos de código, JSON ou SQL.

## 9. Contexto Final da IA (AI Final Context Execution)

1. Criar a branch `projeto-tcc2` a partir da `main`.
2. Criar `legacy/` e mover para dentro dela todos os artefatos do simulador; ajustar os caminhos relativos que saíam da pasta.
3. Criar `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, `specs/_TEMPLATE.md` e `specs/features/`.
4. Criar `backend/.gitkeep` e `frontend/.gitkeep`.
5. Criar os ponteiros `CLAUDE.md`, `GEMINI.md` e `AGENTS.md` na raiz.
6. Remover `.specs/`.
7. Atualizar o README da raiz (caminhos de imagens e nova estrutura).

Arquivos e diretórios criados ou alterados:

- `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, `specs/_TEMPLATE.md`
- `specs/features/001-setup-estrutura-monorepo-spec-driven.md`
- `legacy/` (código-fonte, testes, scripts, ativos públicos e configurações do simulador)
- `backend/.gitkeep`, `frontend/.gitkeep`
- `CLAUDE.md`, `GEMINI.md`, `AGENTS.md`
- `README.md`

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 08/10/2026 | Aruna Architect | Criação |
| 08/10/2026 | Implementador (Claude) | Adequação ao template (ID, status, critérios EARS, não objetivos); número real de testes (752, e não 558); `docs/` mantido na raiz; inclusão de `GLOSSARY.md`, `_TEMPLATE.md` e ponteiros de IA; status `Implementada` |
