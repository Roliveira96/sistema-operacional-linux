# SPEC-038: Testes Automatizados Antes da Implementação

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-038 |
| **Status** | Implementada |
| **Data de criação** | 12/10/2026 |
| **Última revisão** | 12/10/2026 (implementada) |
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
- **Prova na entrega:** um commit `test(...)` com os testes vermelhos, seguido do commit do código que os faz passar; a entrega cita os dois commits e as duas execuções (D-01).

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
- **RN-04 (correções):** toda correção de defeito começa por um teste que reproduz o defeito e falha. Depois vem a correção (D-02).
- **RN-05 (refatoração):** refatorar exige os testes existentes verdes antes e depois. Comportamento novo segue a RN-01.
- **RN-06 (seção 8 da spec):** a seção 8 lista os testes a escrever primeiro, nomeados e ligados aos critérios de aceite. Uma spec não é aprovada sem isso (D-03).
- **RN-07 (exceções):** só o que não tem comportamento a testar: estilos (SCSS), textos de mensagens, configuração e documentação. O comportamento que dependa deles (por exemplo, uma mensagem que aparece num caso) é testado primeiro (D-04).
- **RN-09 (commits e branches):** cada ajuste vira dois commits na branch de feature: `test(...)`, com os testes vermelhos, e depois `feat(...)`, `fix(...)` ou `refactor(...)`, com o código que os faz passar. Commits com testes vermelhos ficam só nas branches de feature; na `projeto-tcc2` só entra o que está todo verde, pelo PR (D-01).
- **RN-08 (mudança de requisito no meio):** quando o Tech Lead muda um requisito durante a implementação, a spec é revisada, os testes do requisito novo são escritos e ficam vermelhos, e só então o código muda.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: muda só o processo.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: muda só o processo.

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| :--- | :--- |
| Commits com testes falhando quebram a branch para quem estiver nela | Testes vermelhos só nas branches de feature, nunca na `projeto-tcc2` diretamente (D-01, RN-09) |
| Implementação mais lenta no começo | Os testes já são exigidos hoje; muda a ordem, não o volume |
| Testes escritos antes, mas frágeis (presos a detalhes de implementação) | A seção 8 descreve o comportamento a verificar pelo critério de aceite; asserções em saídas, estados e erros, como a SPEC-006 já exige |
| Agentes que não seguem a ordem | A regra fica em `AI_INSTRUCTIONS.md`, que todo agente lê primeiro, e a entrega cita o commit dos testes vermelhos e o do código (D-01) |

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (ubíquo): `specs/AI_INSTRUCTIONS.md` DEVE trazer o fluxo de testes antes da implementação (seção 4), a proibição de escrever código de produção antes dos testes (seção 5) e a prova do vermelho e do verde na entrega (seção 8).
- [x] **CA-02** (ubíquo): `specs/ARCHITECTURE.md`, seção 5, DEVE trazer a regra de testes antes da implementação, com as RN-01 a RN-05.
- [x] **CA-03** (ubíquo): `specs/_TEMPLATE.md`, seção 8, DEVE pedir os testes a escrever primeiro, nomeados e ligados aos critérios de aceite.
- [x] **CA-04** (ubíquo): os ponteiros `CLAUDE.md`, `AGENTS.md` e `GEMINI.md` DEVEM lembrar que os testes vêm antes da implementação.
- [x] **CA-05** (ubíquo): a SPEC-006 DEVE registrar no histórico a revisão por esta spec.

## 8. Plano de Testes (Test Plan)

Não há código. A verificação é manual:

- conferir os textos dos CA-01 a CA-05;
- na próxima spec com código, conferir que a entrega traz a execução vermelha antes do código e a verde depois.

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

### Decisões do Tech Lead (12/10/2026)

| ID | Decisão |
| :--- | :--- |
| D-01 | A ordem fica registrada em dois commits na branch de feature: `test(...)`, só com os testes vermelhos, e depois o commit do código. Na `projeto-tcc2` só entra o que está todo verde, pelo PR. Cada ajuste vira dois commits (resolve P-01) |
| D-02 | Vale para tudo: correção começa por um teste que reproduz o defeito; refatoração exige os testes verdes antes e depois (resolve P-02) |
| D-03 | A seção 8 de cada spec lista os testes nomeados, ligados aos critérios de aceite, antes da aprovação (resolve P-03) |
| D-04 | Exceções só para o que não tem comportamento a testar: estilos, textos de mensagens, configuração e documentação (resolve P-04) |

### Pendências

Nenhuma em aberto. P-01 a P-04 viraram as decisões D-01 a D-04.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 12/10/2026 | Implementador (Claude) | Criação do rascunho a partir do pedido do Tech Lead (testes automatizados sempre antes da implementação, por regra). Pendências P-01 a P-04 |
| 12/10/2026 | Tech Lead | Aprovada ("Aprovo"), aceitas as recomendações de P-01 a P-04 (D-01 a D-04). Status: `Aprovada` |
| 12/10/2026 | Implementador (Claude) | Implementada; status `Implementada`. Regra aplicada em `AI_INSTRUCTIONS.md` (seção 4.0, proibições e entrega), `ARCHITECTURE.md` (seção 5, RN-01 a RN-05), `_TEMPLATE.md` (seção 8), nos ponteiros `CLAUDE.md`, `AGENTS.md` e `GEMINI.md` e no histórico da SPEC-006. A proibição de trabalhar fora da `projeto-tcc2` passa a aceitar branches de feature criadas a partir dela, como a D-01 pede |
