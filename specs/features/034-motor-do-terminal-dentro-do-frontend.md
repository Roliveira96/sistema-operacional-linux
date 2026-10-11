# SPEC-034: Motor do terminal dentro do frontend (fim da pasta `legacy/`)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-034 |
| **Status** | Implementada |
| **Data de criação** | 11/10/2026 |
| **Última revisão** | 11/10/2026 |
| **Autor** | Aruna Architect (redigida por agente de IA a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend (sem backend, sem banco, sem API) |
| **Módulo** | `engine` (`frontend/src/engine/`) |
| **Contexto de tela** | Terminal do simulador e `/app/admin/conformidade` (nenhuma mudança visível) |
| **Prioridade** | Média |
| **Depende de** | SPEC-014, SPEC-016, SPEC-028, SPEC-029, SPEC-030 |
| **Substitui** | A regra de "pasta `legacy/` congelada e somente leitura" da SPEC-014 e de `AI_INSTRUCTIONS.md`, seção 5 |
| **Fontes canônicas** | Pedido do Tech Lead de 11/10/2026: "copiar o que importa do legacy para o projeto front, para podermos remover ele de fato". |

---

## 1. Contexto e Problema (Context & Problem Statement)

O terminal do navegador roda sobre o motor POSIX/VFS do simulador original "Linux na Prática", que vive na pasta `legacy/` e é lido pelo frontend por um alias (`@legacy-engine`). A pasta é declarada congelada, mas o motor continua em uso e ganha comandos novos por uma camada de adaptação (SPEC-028, SPEC-029, SPEC-033), com contornos para não tocar nos arquivos. Isso mantém um projeto inteiro (com `node_modules`, scripts, testes e conteúdo) só para fornecer 64 arquivos, e cada correção no motor precisa de um desvio. O Tech Lead decidiu incorporar o que importa ao frontend e remover a pasta.

## 2. Objetivos (Goals)

- Os 64 arquivos de `legacy/src` de que o motor depende (diretamente ou pelas importações deles) passam a viver em `frontend/src/engine/core/`, com a mesma estrutura de pastas e o mesmo código.
- O alias do motor passa a apontar para essa pasta e ganha um nome que não diz "legado" (`@engine-core`).
- A pasta `legacy/` é **removida do repositório**.
- Nenhuma mudança de comportamento: tela, comandos e a verificação de conformidade continuam iguais.

### 2.1. Fora de escopo (Non-Goals)

- Traduzir os identificadores em português do motor, reescrevê-lo ou reorganizá-lo.
- Migrar o conteúdo de ensino do simulador original (a conversão de conteúdo já é tratada no backend) ou os scripts de extração.
- Copiar os testes do simulador original (a verificação do motor é a conformidade da SPEC-030, com seus testes).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Sem mudança de tela.

### 3.2. Backend (Go — Camada de Módulo/Service)

Não se aplica nesta spec.

### 3.3. Regras de negócio

- **RN-01 (cópia fiel):** os arquivos entram sem alteração de código; só a pasta muda. As exceções são os caminhos de importação para fora do conjunto copiado, se houver.
- **RN-02 (conjunto):** entram os arquivos alcançáveis a partir dos módulos que o adaptador importa (`Maquina`, `Serializador`, `Contas`, `Sessao`, `Pacotes`, `Shell`, `Saida`, `comandos/Processos`, `JanelaDeTerminais`, `ArmazemDeMaquinas`, `ColaDeComandos`, `CatalogoDeTopicos` e o CSS do terminal). O que não é alcançado por eles não é copiado.
- **RN-03 (fronteira):** só `frontend/src/engine/` importa `@engine-core`, como antes (regra de lint).
- **RN-04 (código do motor):** `frontend/src/engine/core/` é código do projeto, não mais congelado: mudanças nele seguem o fluxo das specs, mas ficam fora da checagem de estilo (ESLint, Stylelint) e da medição de cobertura, por vir de um projeto com outro padrão.
- **RN-05 (remoção):** `legacy/` sai do repositório depois que os testes passam sem ela.

## 4. Modelo de Dados (Data Model)

Não há mudança de schema.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec.

## 6. Impacto e Riscos (Impact & Risks)

- **Risco:** o motor depender de um arquivo que o levantamento não viu (importação por texto, CSS, recurso estático). **Mitigação:** o levantamento segue as importações estáticas e dinâmicas e o CSS; os testes do motor real e a verificação de conformidade pegam o que faltar antes da remoção.
- **Risco:** o TypeScript estrito do frontend rejeitar o código copiado. **Mitigação:** as declarações de tipo do adaptador continuam sendo a fronteira, e `core/` fica fora da checagem de tipos (RN-04).
- **Impacto:** `next.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, o arquivo de declarações do adaptador e os textos de `AI_INSTRUCTIONS.md` e `ARCHITECTURE.md` que citam `legacy/`.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (ubíquo): O SISTEMA DEVE ter o motor em `frontend/src/engine/core/` e NÃO DEVE ter a pasta `legacy/`.
- [x] **CA-02** (ubíquo): O SISTEMA DEVE importar o motor só por `@engine-core`, e nenhum arquivo do frontend ou da configuração DEVE referenciar `legacy/` (RN-03).
- [x] **CA-03** (evento): QUANDO a verificação de conformidade roda, O SISTEMA DEVE dar o mesmo resultado de antes da mudança (RN-01).
- [x] **CA-04** (evento): QUANDO `tsc`, ESLint e os testes do frontend rodam, ENTÃO DEVEM passar sem a pasta `legacy/` presente.
- [x] **CA-05** (ubíquo): `AI_INSTRUCTIONS.md` e `ARCHITECTURE.md` DEVEM deixar de tratar `legacy/` como existente.

## 8. Plano de Testes (Test Plan)

- **Motor real:** os testes `*.engine.test.ts` do adaptador e as suítes de conformidade de amostra passam com `legacy/` removida (cobre CA-03, CA-04).
- **Estático:** busca por `legacy` nos arquivos de código e configuração do frontend (cobre CA-02); `tsc` e ESLint (cobre CA-04).
- **Build:** `next build` do frontend (cobre CA-04).
- **Manual:** abrir `/app/admin/conformidade` e um tópico com terminal e rodar um comando.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, SPEC-014 e SPEC-016, `frontend/next.config.ts`, `frontend/vitest.config.ts`, `frontend/src/engine/legacy-engine.d.ts`.
2. **Ordem de execução:** (1) copiar os 64 arquivos; (2) trocar o alias; (3) excluir `core/` da checagem; (4) rodar tsc, ESLint e os testes do motor; (5) remover `legacy/`; (6) atualizar os textos de `specs/`.
3. **Arquivos a criar ou alterar:** criar `frontend/src/engine/core/**`; alterar `next.config.ts`, `vitest.config.ts`, `tsconfig.json`, `eslint.config.mjs`, o arquivo de declarações e os `import` do adaptador; remover `legacy/`; alterar `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `.gitignore` se citar `legacy`.
4. **Definição de pronto:** todos os CA marcados, nenhuma violação de `ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 11/10/2026 | Aruna Architect | Criação, a pedido do Tech Lead; aprovada ao pedir a implementação |
| 11/10/2026 | Implementador (Claude) | Implementada: 64 arquivos copiados sem alteração de código para `frontend/src/engine/core/`, alias `@engine-core`, `core/` fora de `tsc` e ESLint, `legacy/` removida. Com ela ausente: `tsc` e ESLint limpos, `next build` passa, 234 testes do motor passam. Saíram junto o gerador do manifesto da SPEC-005 (`legacy/scripts`), os testes do simulador original e o conteúdo de ensino dele; ficam no histórico do Git. Os logos do README foram para `docs/assets/`. Não rodei a verificação de conformidade completa depois da mudança |
