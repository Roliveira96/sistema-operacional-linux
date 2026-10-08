# SPEC-012: Leitura e Exibição do Conteúdo Didático

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-012 |
| **Status** | Aprovada |
| **Data de criação** | 08/10/2026 |
| **Última revisão** | 08/10/2026 |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `content` (leitura) |
| **Contexto de tela** | `/materials`, `/materials/[id]`, `/simulations`, `/app/modules/[id]` |
| **Prioridade** | Alta |
| **Depende de** | SPEC-007, SPEC-010, SPEC-011 |
| **Substitui** | Parte da SPEC-005 original (exibição) |
| **Fontes canônicas** | Seção 3.3 da monografia; insumo `docs/insumos/conversao-conteudo-legado.md` |


---

## 1. Contexto e Problema (Context & Problem Statement)

Depois da carga da SPEC-011, o conteúdo do legado está no banco, mas ninguém consegue vê-lo: as páginas públicas da SPEC-007 (`/materials` e `/simulations`) mostram dados fixos no código, e não há tela que exiba os blocos de um módulo. Também é preciso garantir que gabaritos e condições de correção nunca cheguem ao navegador do estudante.

## 2. Objetivos (Goals)

- Expor endpoints de leitura de módulos com blocos, questões sem gabarito e modelos de avaliação, respeitando a visibilidade da SPEC-010.
- Trocar os dados fixos de `/materials` e `/simulations` pelos dados do banco.
- Criar a página de leitura de um módulo, com um componente para cada tipo de bloco.
- Recriar em React os dois componentes interativos do legado: calculadora de permissões e anatomia do `ls -l`.

### 2.1. Fora de escopo (Non-Goals)

- Terminal simulado dentro da página e correção de exercícios: spec futura de prática e tentativa.
- Autoria (criar ou editar blocos e questões).
- Aplicação de provas a partir dos modelos de avaliação.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **`/materials`:** lista os módulos públicos vindos de `GET /api/v1/modules/public` (SPEC-010), com ícone, cor e ordem da carga. Substitui os dados fixos da SPEC-007.
- **`/materials/[id]`:** página pública de leitura de um módulo `PUBLIC`, com os blocos em ordem.
- **`/app/modules/[id]`:** a mesma leitura para módulos `AUTHENTICATED` ou `PRIVATE` liberados ao usuário.
- **`/simulations`:** lista os modelos de avaliação ativos (título, descrição, duração, quantidade de questões). Substitui os dados fixos da SPEC-007.
- **`ContentRenderer`:** recebe a lista de blocos e escolhe o componente de cada tipo: `TextBlock`, `CommandBlock` (passos com comando, explicação e terminal indicado), `TipBlock` (variante de alerta), `CuriosityBlock`, `StepByStepBlock`, `CardsBlock`, `WidgetBlock` e `LegacyHtmlBlock`. Tipo desconhecido é ignorado com aviso discreto, sem quebrar a página.
- **HTML:** `TextBlock` e `LegacyHtmlBlock` exibem o HTML que o backend já filtrou (SPEC-011, RN-08); o frontend não acrescenta biblioteca de filtragem.
- **Componentes interativos:** `PermissionCalculator` e `LsAnatomy`, portados do legado (`legacy/src/app/Widgets.ts`) para React, com tokens de tema.
- **Estilo:** SCSS Modules, tokens e paridade entre temas; as cores de módulo vêm de tokens nomeados, nunca de valores fixos.

### 3.2. Backend (Go — Camada de Módulo/Service)

Handler e service de leitura no módulo `content`.

- **RN-01 (visibilidade):** a leitura de blocos e questões de um módulo segue a mesma regra de acesso da SPEC-010 (público, autenticado ou privado com turma liberada) e a vigência temporal.
- **RN-02 (sem gabarito para estudante):** respostas para visitantes e estudantes NUNCA trazem `validation_conditions`, `answer_key`, `reference_solution` nem `explanation`. Docentes e administradores recebem esses campos só na rota de docente.
- **RN-03 (só publicadas):** visitantes e estudantes veem apenas questões `PUBLISHED`; docentes veem também `DRAFT`, com a marca de revisão pendente.
- **RN-04 (modelos):** a lista de modelos de avaliação é pública apenas em título, descrição, duração e quantidade de questões.

## 4. Modelo de Dados (Data Model)

Não há mudança de schema nesta spec (usa as tabelas da SPEC-011).

## 5. Contrato de API (API Contract)

### 5.1. `GET /api/v1/modules/{id}/blocks`

Blocos de um módulo, em ordem. **Acesso:** regra de visibilidade da SPEC-010.

| Campo da resposta | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `moduleId` | UUID | Sim | |
| `blocks` | lista de { `id`, `type`, `position`, `payload` } | Sim | Conteúdo conforme o catálogo de blocos |

| HTTP | `type` | Quando |
| :--- | :--- | :--- |
| 401 | `not-authenticated` | Módulo não público sem sessão |
| 403 | `forbidden` | Módulo privado não liberado ao usuário |
| 404 | `module-not-found` | Módulo inexistente, excluído ou fora da vigência |

### 5.2. `GET /api/v1/modules/{id}/questions`

Questões de um módulo, sem gabarito. **Acesso:** regra da SPEC-010. Query opcional `usage` (`EXERCISE` ou `ASSESSMENT`).

| Campo de cada item | Tipo | Descrição |
| :--- | :--- | :--- |
| `id`, `kind`, `usage`, `difficulty`, `title`, `statement`, `hint` | | Dados públicos da questão |
| `choices` | lista | Só nas teóricas objetivas, sem indicar a correta |

Erros iguais aos de 5.1.

### 5.3. `GET /api/v1/teacher/modules/{id}/questions`

Questões completas, com gabarito, condições e status. **Papéis:** `TEACHER` (dono do módulo) e `ADMIN`. Erros: 401, 403 e 404, como em 5.1.

### 5.4. `GET /api/v1/assessment-templates`

Modelos de avaliação ativos. **Público.**

| Campo de cada item | Tipo | Descrição |
| :--- | :--- | :--- |
| `id`, `title`, `description` | | |
| `durationMinutes` | inteiro | |
| `questionCount` | inteiro | |

## 6. Impacto e Riscos (Impact & Risks)

- **Vazamento de gabarito.**
  *Mitigação:* respostas de estudante montadas por DTO próprio, sem os campos de correção; teste automatizado verifica a ausência (RN-02).
- **HTML perigoso na página.**
  *Mitigação:* filtragem no backend em duas etapas (SPEC-005 e SPEC-011); o frontend só exibe.
- **Quebra das páginas públicas da SPEC-007.**
  *Mitigação:* os componentes visuais da 007 são mantidos; muda só a origem dos dados, com estado de carregamento, vazio e erro.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01**: QUANDO um visitante abrir `/materials`, O SISTEMA DEVE listar os módulos públicos do banco, na ordem da carga.
- [ ] **CA-02**: QUANDO um visitante abrir `/materials/[id]` de um módulo público, O SISTEMA DEVE exibir todos os blocos na ordem, cada um com o seu componente.
- [ ] **CA-03**: SE o módulo não for público e não houver sessão, ENTÃO O SISTEMA DEVE responder 401; SE for privado e não liberado, 403.
- [ ] **CA-04**: Nenhuma resposta das rotas 5.1, 5.2 e 5.4 DEVE conter `validation_conditions`, `answer_key`, `reference_solution` ou `explanation`.
- [ ] **CA-05**: ENQUANTO a questão estiver em `DRAFT`, O SISTEMA NÃO DEVE exibi-la a visitantes e estudantes.
- [ ] **CA-06**: QUANDO um docente dono do módulo consultar a rota 5.3, O SISTEMA DEVE devolver as questões com gabarito e status.
- [ ] **CA-07**: QUANDO `/simulations` for aberta, O SISTEMA DEVE listar os modelos de avaliação ativos.
- [ ] **CA-08**: A calculadora de permissões e a anatomia do `ls -l` DEVEM funcionar como no legado.
- [ ] **CA-09**: SE o bloco tiver tipo desconhecido, ENTÃO a página DEVE continuar renderizando os demais.
- [ ] **CA-10**: As telas desta spec DEVEM usar só tokens de `_tokens.scss`, com paridade entre temas.

## 8. Plano de Testes (Test Plan)

- **Backend:** service com repositório em memória (visibilidade, filtro de `DRAFT`, ausência de gabarito); handler com `httptest` (status, RFC 7807 e campos ausentes, CA-03 a CA-06).
- **Frontend:** testes de cada componente de bloco, do `ContentRenderer` com tipo desconhecido (CA-09), dos componentes interativos (CA-08), das páginas com serviço simulado (CA-01, CA-02, CA-07) e de estrutura nos dois temas (CA-10).
- **Cobertura:** acima de 80% no backend (`domain`, `service`, `handler`) e no frontend.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura:** SPEC-007, SPEC-010, SPEC-011 e `legacy/src/app/Widgets.ts`.
2. **Ordem:** service e handler de leitura → serviços do frontend → componentes de bloco e interativos → páginas.
3. **Arquivos a criar ou alterar:** `backend/internal/modules/content/` (service e handler de leitura), `frontend/src/services/contentService.ts`, `frontend/src/components/ContentRenderer/` e subcomponentes, `frontend/src/app/materials/`, `frontend/src/app/simulations/`, `frontend/src/app/app/modules/[id]/`.
4. **Definição de pronto:** CA-01 a CA-10 verificados e cobertura acima de 80%.

## 10. Pendências para aprovação

Nenhuma. P-01 a P-03 aprovadas pelo Tech Lead em 08/10/2026 (ver histórico).

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 08/10/2026 | Implementador (Claude) | Criação a partir da divisão aprovada da SPEC-005 original (leitura e exibição), alinhada às SPECs 007, 010 e 011. Pendências P-01 a P-03 |
| 08/10/2026 | Tech Lead | Aprovação integral das recomendações P-01 a P-03. Status: `Aprovada` |
