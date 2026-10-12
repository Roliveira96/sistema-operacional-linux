# SPEC-038: Testes Automatizados Antes da Implementação

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-038 |
| **Status** | Rascunho |
| **Data de criação** | 12/10/2026 |
| **Última revisão** | 12/10/2026 |
| **Autor** | Implementador (Claude), a pedido do Tech Lead |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | core/governance |
| **Contexto de tela** | Não se aplica |
| **Prioridade** | Alta |
| **Depende de** | SPEC-006 |
| **Substitui** | Nenhuma. Revisa a SPEC-006: a obrigação de entregar testes passa a ser a de escrevê-los antes |
| **Fontes canônicas** | Pedido do Tech Lead de 12/10/2026 ("o sistema sempre escreva os testes automatizados antes da implementação, por regra"); `specs/AI_INSTRUCTIONS.md`; `specs/ARCHITECTURE.md`, seção 5; SPEC-006 |

---

## 1. Contexto e Problema (Context & Problem Statement)

A SPEC-006 obriga a entregar os testes automatizados **junto** com o código, no mesmo commit, com mais de 80% de cobertura. Ela não diz **quando** os testes são escritos.

Nas SPECs 035 e 036, os testes vieram depois do código. A consequência: o teste tende a confirmar o que o código já faz, e não o que a spec pede. Várias falhas de teste da SPEC-036 eram testes antigos acompanhando o código, e não critérios de aceite sendo verificados.

O Tech Lead decidiu que, por regra, os testes automatizados são escritos **antes** da implementação.

## 2. Objetivos (Goals)

- **Ordem fixa:** toda implementação começa pelos testes dos critérios de aceite da spec. Eles são executados e falham pelo motivo esperado, e só então vem o código que os faz passar (vermelho, verde, refatorar).
- **Regra no lugar certo:** a ordem fica em `AI_INSTRUCTIONS.md` (fluxo e proibições), em `ARCHITECTURE.md` (seção 5) e no `_TEMPLATE.md` (seção 8 de cada spec), valendo para qualquer agente e para pessoas.
- **Testes na spec:** a seção 8 de cada spec passa a listar, antes da aprovação, os testes a escrever primeiro, cada um ligado ao seu critério de aceite.
- **Prova na entrega:** a entrega informa a execução vermelha dos testes antes do código, e a execução verde depois (P-01).

### 2.1. Fora de escopo (Non-Goals)

- Pipeline de CI que bloqueie merge automaticamente (continua fora, como na SPEC-006).
- Reescrever os testes das specs já implementadas.
- Mudar ferramentas ou a meta de cobertura: continuam as da SPEC-006 e de `ARCHITECTURE.md`, seção 5.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Fluxo de implementação

| Passo | O que o implementador faz |
| :--- | :--- |
| 1. Testes | Escreve os testes da seção 8 da spec aprovada, um ou mais por critério de aceite, na camada indicada (domínio, service, handler, repository, componente, serviço do frontend) |
| 2. Vermelho | Roda os testes e confere que falham **pelo motivo esperado** (o comportamento não existe), e não por erro de compilação de outra coisa ou por teste mal escrito |
| 3. Verde | Escreve o código mínimo para os testes passarem, sem alterar o que eles verificam |
| 4. Refatorar | Melhora o código com os testes verdes; testes novos só para casos que surgirem, também antes do código |
| 5. Cobertura | Confere a cobertura acima de 80% no escopo da spec; o que faltar ganha teste, sem afrouxar o que existe |

### 3.2. Regras

- **RN-01 (ordem):** nenhuma linha de código de produção de uma spec é escrita antes dos testes dos critérios de aceite que ela atende.
- **RN-02 (vermelho legítimo):** o teste escrito primeiro precisa falhar pela ausência do comportamento. Um teste que já passa antes do código, ou que falha por outro motivo, é corrigido antes de seguir.
- **RN-03 (testes não se ajustam ao código):** depois do passo 2, um teste só muda se estava errado em relação à spec. A mudança é registrada na entrega com o motivo.
- **RN-04 (correções):** toda correção de defeito começa por um teste que reproduz o defeito e falha. Depois vem a correção (P-02).
- **RN-05 (refatoração):** refatorar exige os testes existentes verdes antes e depois. Comportamento novo segue a RN-01.
- **RN-06 (seção 8 da spec):** a seção 8 lista os testes a escrever primeiro, nomeados e ligados aos critérios de aceite. Uma spec não é aprovada sem isso (P-03).
- **RN-07 (exceções):** P-04.
- **RN-08 (mudança de requisito no meio):** quando o Tech Lead muda um requisito durante a implementação, a spec é revisada, os testes do requisito novo são escritos e ficam vermelhos, e só então o código muda.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: muda só o processo.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: muda só o processo.

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| :--- | :--- |
| Commits com testes falhando quebram a branch para quem estiver nela | Testes vermelhos só nas branches de feature, nunca na `projeto-tcc2` diretamente (P-01) |
| Implementação mais lenta no começo | Os testes já são exigidos hoje; muda a ordem, não o volume |
| Testes escritos antes, mas frágeis (presos a detalhes de implementação) | A seção 8 descreve o comportamento a verificar pelo critério de aceite; asserções em saídas, estados e erros, como a SPEC-006 já exige |
| Agentes que não seguem a ordem | A regra fica em `AI_INSTRUCTIONS.md`, que todo agente lê primeiro, e a entrega exige a prova do vermelho (P-01) |

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (ubíquo): `specs/AI_INSTRUCTIONS.md` DEVE trazer o fluxo de testes antes da implementação (seção 4), a proibição de escrever código de produção antes dos testes (seção 5) e a prova do vermelho e do verde na entrega (seção 8).
- [ ] **CA-02** (ubíquo): `specs/ARCHITECTURE.md`, seção 5, DEVE trazer a regra de testes antes da implementação, com as RN-01 a RN-05.
- [ ] **CA-03** (ubíquo): `specs/_TEMPLATE.md`, seção 8, DEVE pedir os testes a escrever primeiro, nomeados e ligados aos critérios de aceite.
- [ ] **CA-04** (ubíquo): os ponteiros `CLAUDE.md`, `AGENTS.md` e `GEMINI.md` DEVEM lembrar que os testes vêm antes da implementação.
- [ ] **CA-05** (ubíquo): a SPEC-006 DEVE registrar no histórico a revisão por esta spec.

## 8. Plano de Testes (Test Plan)

Não há código. A verificação é manual:

- conferir os textos dos CA-01 a CA-05;
- na próxima spec implementada (a SPEC-037, de ligar colunas), conferir que a entrega traz a execução vermelha antes do código e a verde depois.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura:** `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `_TEMPLATE.md`, SPEC-006.
2. **Ordem de execução:**
   1. `AI_INSTRUCTIONS.md`;
   2. `ARCHITECTURE.md`;
   3. `_TEMPLATE.md`;
   4. os ponteiros (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`);
   5. o histórico da SPEC-006.
3. **Arquivos a alterar:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/_TEMPLATE.md`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `specs/features/006-diretriz-testes-automatizados.md`.
4. **Definição de pronto:** CA-01 a CA-05 verificados e status `Implementada`.

## 10. Pendências para aprovação

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |
| P-01 | Como fica registrado que o teste veio antes? (a) Um commit só com os testes, falhando, seguido do commit do código que os faz passar; (b) tudo num commit, com a saída da execução vermelha colada na entrega e no histórico da spec | (a), nas branches de feature: o histórico mostra a ordem por si só, e a entrega cita os dois commits e as duas execuções. Na `projeto-tcc2` só entram branches com tudo verde, pelo PR. Isso ajusta a regra "um commit por ajuste": cada ajuste vira dois commits, `test(...)` e `feat(...)` ou `fix(...)` |
| P-02 | Vale também para correções de defeito e refatorações, ou só para specs novas? | Para tudo: correção começa por um teste que reproduz o defeito; refatoração exige os testes verdes antes e depois |
| P-03 | A seção 8 de cada spec passa a listar os testes nomeados antes da aprovação? | Sim, ligados a cada critério de aceite, para o Tech Lead aprovar também o que será testado |
| P-04 | Há exceções? | Só o que não tem comportamento a testar: estilos (SCSS), textos de mensagens, configuração e documentação. Mesmo assim, o comportamento que dependa deles (por exemplo, uma mensagem que aparece num caso) é testado primeiro |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 12/10/2026 | Implementador (Claude) | Criação do rascunho a partir do pedido do Tech Lead (testes automatizados sempre antes da implementação, por regra). Pendências P-01 a P-04 |
