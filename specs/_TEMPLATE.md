# SPEC-NNN: Título curto e descritivo

<!--
COMO USAR ESTE TEMPLATE
- Copie para specs/features/NNN-slug-em-kebab-case.md, com NNN = próximo número livre (3 dígitos).
- O número é o ID imutável da spec ("SPEC-NNN"). Nunca reaproveite um número, nem de spec Obsoleta.
- Preencha todas as 9 seções. Seção sem conteúdo leva a frase explícita "Não se aplica nesta spec." e o motivo.
- Proibido: trechos de código, JSON/payloads mockados, SQL, scripts. Estruturas são descritas em tabelas.
- Use os termos de specs/GLOSSARY.md. Termo novo de domínio entra no glossário na mesma spec.
- Apague este comentário ao criar a spec.
-->

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-NNN |
| **Status** | Rascunho \| Aprovada \| Implementada \| Obsoleta |
| **Data de criação** | DD/MM/AAAA |
| **Última revisão** | DD/MM/AAAA |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Backend \| Frontend \| Ambos |
| **Módulo** | nome do módulo de domínio (ex.: `classgroup`, `assessment`) |
| **Contexto de tela** | rota/tela afetada, ou "Não se aplica" |
| **Prioridade** | Alta \| Média \| Baixa |
| **Depende de** | SPEC-XXX, SPEC-YYY, ou "Nenhuma" |
| **Substitui** | SPEC-XXX (quando esta spec torna outra Obsoleta), ou "Nenhuma" |
| **Fontes canônicas** | seções de `docs/arquitetura/transicao-backend.md` e/ou capítulos da monografia que originam esta spec |

---

## 1. Contexto e Problema (Context & Problem Statement)

Qual dor real esta spec resolve, para quem (docente, estudante, administrador) e por que agora. Descrever o estado atual e a lacuna. Sem solução nesta seção.

## 2. Objetivos (Goals)

Lista objetiva do que passa a ser verdade quando a spec estiver implementada.

### 2.1. Fora de escopo (Non-Goals)

O que, de forma deliberada, **não** será feito aqui, mesmo parecendo relacionado. Toda IA implementadora deve tratar esta lista como proibição.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Telas, componentes, estados de interface (carregando, vazio, erro, sucesso), fluxo de navegação, serviços de rede consumidos e regras de tema claro/escuro. Descrever comportamento, não implementação.

### 3.2. Backend (Go — Camada de Módulo/Service)

Responsabilidades de handler, service e repository; regras de negócio numeradas (RN-01, RN-02...), que são citadas nos critérios de aceite; transações; eventos de tempo real; autorização por papel.

## 4. Modelo de Dados (Data Model)

Para cada entidade nova ou alterada, uma tabela:

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| | | | | |

Depois das tabelas: relacionamentos (cardinalidade e nome das chaves estrangeiras), índices e unicidades, valores de enumeração (com significado de cada valor) e política de exclusão (lógica ou física). Se não houver mudança de schema, declarar explicitamente.

## 5. Contrato de API (API Contract)

Para cada endpoint ou evento de tempo real:

**`MÉTODO /api/v1/recurso`**: descrição em uma linha.

- **Papéis autorizados:** ...
- **Parâmetros de rota e de query:**

| Nome | Tipo | Obrigatório | Regra |
| :--- | :--- | :--- | :--- |
| | | | |

- **Corpo da requisição:**

| Campo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| | | | |

- **Resposta de sucesso** (código HTTP e campos):

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| | | | |

- **Erros (RFC 7807):**

| HTTP | `type` (slug do problema) | Quando ocorre |
| :--- | :--- | :--- |
| | | |

Eventos WebSocket seguem o mesmo formato: nome do evento, direção (cliente→servidor ou servidor→cliente), sala/canal, tabela de campos.

## 6. Impacto e Riscos (Impact & Risks)

Cada risco com **Mitigação** explícita. Incluir impacto em módulos existentes, migrações de dados, segurança, desempenho e o código em `legacy/`.

## 7. Critérios de Aceite (Acceptance Criteria)

Sintaxe EARS obrigatória. Cada critério é verificável por teste automatizado ou por roteiro manual descrito na seção 8.

- [ ] **CA-01** (ubíquo): O SISTEMA DEVE ...
- [ ] **CA-02** (evento): QUANDO <evento>, O SISTEMA DEVE ...
- [ ] **CA-03** (estado): ENQUANTO <estado>, O SISTEMA DEVE ...
- [ ] **CA-04** (indesejado): SE <condição de erro>, ENTÃO O SISTEMA DEVE ...
- [ ] **CA-05** (opcional): ONDE <funcionalidade/configuração presente>, O SISTEMA DEVE ...

## 8. Plano de Testes (Test Plan)

- **Backend:** testes de unidade de service (regras RN-xx), testes de integração de repository e de handler, por critério de aceite.
- **Frontend:** testes de componente e de fluxo, por critério de aceite, nos dois temas.
- **Manual:** roteiro passo a passo para o que não for automatizável.

Cada teste referencia o critério que cobre (ex.: "cobre CA-03").

## 9. Contexto Final da IA (AI Final Context Execution)

Instruções diretas para o agente implementador:

1. **Pré-leitura obrigatória:** arquivos de `specs/` e do código que precisam ser lidos antes de começar.
2. **Ordem de execução:** passos numerados e dependências entre eles.
3. **Arquivos e diretórios a criar ou alterar:** lista explícita. Alterar qualquer outro arquivo exige justificativa no resumo da entrega.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, status atualizado para `Implementada`.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| DD/MM/AAAA | Aruna Architect | Criação |
