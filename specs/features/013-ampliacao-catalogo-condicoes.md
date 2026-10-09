# SPEC-013: Ampliação do Catálogo de Condições de Validação

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-013 |
| **Status** | Implementada |
| **Data de criação** | 08/10/2026 |
| **Última revisão** | 08/10/2026 |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Backend e extrator do legado |
| **Módulo** | `content` |
| **Contexto de tela** | Não se aplica |
| **Prioridade** | Média |
| **Depende de** | SPEC-005, SPEC-011 |
| **Substitui** | Nenhuma (revisa o catálogo da SPEC-011) |
| **Fontes canônicas** | Relatório de conversão `backend/internal/modules/content/seed/data/content_report.md`; histórico da SPEC-005 |


---

## 1. Contexto e Problema (Context & Problem Statement)

A extração da SPEC-005 publicou 190 das 222 questões práticas. Das 32 em rascunho, 18 ficaram assim só porque a correção original usa uma lógica que o catálogo fechado da SPEC-011 não expressa: "o arquivo **não** contém", "o arquivo tem N linhas", "uma **ou** outra condição" e "nenhum pacote pode ser atualizado". Essas questões funcionavam no legado e são parte dos simulados oficiais; enquanto ficarem em rascunho, os modelos de avaliação têm questões que não podem ser aplicadas.

A SPEC-011 determina que um tipo novo só entra por revisão do catálogo. Esta spec faz essa revisão.

## 2. Objetivos (Goals)

- Acrescentar quatro tipos ao catálogo, nos dois avaliadores (TypeScript do extrator e Go do motor de correção), com a mesma semântica do legado.
- Ensinar o tradutor do extrator a reconhecer as expressões correspondentes.
- Regenerar manifesto, relatório e fixtures, e recarregar o banco de desenvolvimento.
- Publicar toda questão recuperada que passar na prova de equivalência.

### 2.1. Fora de escopo (Non-Goals)

- As 13 questões cujo cenário já nasce resolvido (dependiam da adaptação de alvo do legado, que não foi migrada): continuam em rascunho para revisão da docente.
- A questão `usr-5`, que depende de sessões abertas (estado que não existe na máquina serializada).
- Composição arbitrária de condições (negação genérica, aninhamento): só o "ou" de um nível.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Não se aplica nesta spec.

### 3.2. Backend (Go) e extrator (TypeScript)

Tipos novos:

| Tipo | Parâmetros | Semântica (igual ao legado) |
| :--- | :--- | :--- |
| `CONTENT_NOT_CONTAINS` | `path`, `value`, `caseSensitive` | Verdadeiro quando o conteúdo **não** contém o trecho. Arquivo inexistente conta como conteúdo vazio, como em `!Verificar.contem`. Sem `caseSensitive`, compara sem diferenciar maiúsculas |
| `CONTENT_LINE_COUNT` | `path`, `comparison` (`EQUAL` ou `AT_LEAST`), `count` | O arquivo existe e o conteúdo, sem espaços nas pontas e dividido por quebra de linha, tem a quantidade indicada de linhas |
| `ANY_OF` | `conditions` | Pelo menos uma das condições é atendida. As condições internas são do catálogo, exceto `ANY_OF` (um nível só) |
| `PACKAGES_AT_VERSIONS` | `packages` (lista de `package` e `version`) | Todo pacote listado que estiver instalado tem exatamente a versão indicada (pacote não instalado não reprova) |

- **RN-01 (avaliadores):** os dois avaliadores implementam os quatro tipos com a mesma semântica; a paridade continua garantida pelas fixtures de equivalência (SPEC-011, RN-02).
- **RN-02 (tradução):** o tradutor reconhece `!Verificar.contem(...)`, `!(conteúdo ?? "").includes(...)`, contagens de linhas com `===` e `>=`, expressões com `||` cujos termos sejam todos traduzíveis, e `atualizaveis().length === 0`. Para esta última, o extrator grava em `PACKAGES_AT_VERSIONS` a versão candidata de cada pacote do catálogo do legado (a versão nova quando existir), sem precisar do catálogo no backend.
- **RN-03 (validação):** `ANY_OF` vazio ou aninhado, `comparison` desconhecida, `count` negativo e `packages` vazio invalidam a lista.
- **RN-04 (recarga):** depois da regeneração, a carga da SPEC-011 atualiza as questões recuperadas, sem tocar nas editadas pela docente.

## 4. Modelo de Dados (Data Model)

Sem alteração de schema: as condições ficam no `jsonb` `validation_conditions`.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec. Os endpoints de docente da SPEC-012 passam a devolver os tipos novos dentro de `validationConditions`.

## 6. Impacto e Riscos (Impact & Risks)

- **Divergência entre os avaliadores.**
  *Mitigação:* fixtures de equivalência regeneradas e teste de paridade obrigatório.
- **`ANY_OF` abrindo espaço para correções frouxas.**
  *Mitigação:* um nível só, e a prova de equivalência contra a solução de referência, as formas alternativas e o cenário intocado continua obrigatória.
- **Versões de pacotes do legado mudarem.**
  *Mitigação:* as versões ficam gravadas na condição; uma mudança no legado exige regenerar o manifesto, como qualquer outro conteúdo.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01**: Cada tipo novo DEVE ter teste positivo e negativo nos dois avaliadores.
- [x] **CA-02**: QUANDO o motor em Go avaliar as fixtures regeneradas, O SISTEMA DEVE produzir exatamente o veredito esperado em todos os estados.
- [x] **CA-03**: SE uma lista tiver `ANY_OF` vazio ou aninhado, `comparison` desconhecida, `count` negativo ou `packages` vazio, ENTÃO O SISTEMA DEVE recusá-la.
- [x] **CA-04**: QUANDO o extrator rodar de novo, o relatório DEVE mostrar quantas questões foram recuperadas, e nenhuma questão publicada pode divergir da correção original.
- [x] **CA-05**: QUANDO a carga rodar no banco de desenvolvimento, as questões recuperadas DEVEM passar a `PUBLISHED`, e as editadas pela docente NÃO DEVEM mudar.
- [x] **CA-06**: Os artefatos regenerados DEVEM continuar idênticos byte a byte entre duas execuções.

## 8. Plano de Testes (Test Plan)

- **Extrator:** testes do avaliador e do tradutor para os quatro tipos; execução completa e comparação dos artefatos (CA-01, CA-04, CA-06).
- **Backend:** testes de domínio dos quatro tipos e das regras de validação; paridade com as fixtures (CA-01 a CA-03); integração da recarga (CA-05).
- **Cobertura:** acima de 80% em `content/domain` e no extrator.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura:** SPEC-005, SPEC-011 e o relatório de conversão.
2. **Ordem:** avaliador TypeScript → tradutor → regeneração → motor em Go → paridade → recarga.
3. **Arquivos a alterar:** `legacy/scripts/extract/` (catálogo, tradutor e testes), artefatos em `backend/internal/modules/content/seed/data/`, `backend/internal/modules/content/domain/` e a tabela do catálogo na SPEC-011 (seção 3.2), registrando a revisão.
4. **Definição de pronto:** CA-01 a CA-06 verificados.

## 10. Pendências para aprovação

Nenhuma. P-01 a P-04 aprovadas pelo Tech Lead em 08/10/2026 (ver histórico).

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 08/10/2026 | Implementador (Claude) | Criação a partir do relatório de conversão da SPEC-005. Pendências P-01 a P-04 |
| 08/10/2026 | Tech Lead | Aprovação integral de P-01 a P-04. Status: `Aprovada` |
| 08/10/2026 | Implementador (Claude) | Implementação concluída; status `Implementada`. **Resultado:** 14 questões recuperadas, de 190 para **204 publicadas** e de 32 para **18 em rascunho**; 219 das 222 correções traduzidas automaticamente; nenhuma questão publicada diverge da correção original. **Verificação:** 46 testes do extrator; testes de domínio em Go dos quatro tipos e das regras de validação (cobertura de 87,7%); paridade do motor em Go em todos os 627 estados das 222 questões; integração e recarga no banco de desenvolvimento (234 questões publicadas no total, incluindo as 30 do quiz; nenhuma edição de docente existia para preservar); artefatos idênticos byte a byte em duas execuções com mais de um minuto de intervalo. **Rascunhos restantes:** os 13 cenários que já nascem resolvidos; `arq-2` e `arq-3`, que precisariam de condições sobre o texto de linhas específicas (primeira linha, todas as linhas contendo um trecho), além da contagem; `arq-6` (solução de referência falhando) e `usr-5` (sessões abertas). **Correção de reprodutibilidade (SPEC-005):** a saída do `ps aux` gravada por `av-med-7` trazia a hora real de início dos processos, porque o legado a calcula ao carregar o módulo; o extrator agora importa o legado só depois de congelar o relógio. A verificação anterior tinha passado porque as duas execuções caíram no mesmo minuto. |
