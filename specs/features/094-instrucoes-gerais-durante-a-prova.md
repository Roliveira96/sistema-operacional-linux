# SPEC-094: Instruções Gerais ao Alcance do Estudante Durante a Prova

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-094 |
| **Status** | Aprovada |
| **Data de criação** | 05/11/2026 |
| **Última revisão** | 05/11/2026 |
| **Autor** | Aruna Architect (agente de IA, a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend |
| **Módulo** | `assessment` (frontend: a janela da prova) |
| **Contexto de tela** | `/app/classes/[id]/assessments/[assessmentId]/take` (a janela da prova) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-077 (as instruções gerais em HTML filtrado), SPEC-090 (a janela da prova), SPEC-093 (o botão *Conversa*, o modelo reaproveitado) |
| **Substitui** | Nenhuma. |
| **Fontes canônicas** | Pedido do Tech Lead em 05/11/2026, no roteiro manual do chat da prova: "o enunciado da prova deve poder ser acessado a qualquer instante, para que o aluno leia novamente, às vezes tem dicas e outras coisas para fazer". |

---

## 1. Contexto e Problema (Context & Problem Statement)

A docente escreve as **instruções gerais** da prova (SPEC-077): o que vale, o que não usar, dicas para as práticas. O estudante as lê no cartão do detalhe da avaliação, **antes** de entrar. Na janela da prova (SPEC-090) elas não aparecem em lugar nenhum: para reler, o estudante teria de sair da janela e voltar ao detalhe, o que ninguém faz no meio da prova.

A janela já recebe as instruções: a página busca a avaliação (`assessmentService.get`) para mostrar o título, e a resposta do estudante já traz `description`.

## 2. Objetivos (Goals)

- O estudante abre e fecha as instruções gerais **a qualquer momento** da prova, sem sair da questão nem perder o que digitou.
- As instruções aparecem formatadas, como no cartão (o mesmo HTML filtrado da SPEC-077).

### 2.1. Fora de escopo (Non-Goals)

- Mudar as instruções durante a prova, ou avisar o estudante de uma mudança.
- Instruções por questão (o enunciado da questão já fica sempre na tela).
- Mudança no backend: a rota e o campo já existem.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Botão *Instruções*** no topo da janela da prova, ao lado de *Conversa* (SPEC-093), com `aria-expanded`. Só aparece quando a prova tem instruções (texto visível não vazio).
- **Coluna das instruções:** ao clicar, abre uma coluna com o título "Instruções gerais" e o HTML das instruções, desenhado pelo mesmo componente de texto formatado do cartão do estudante. Clicar de novo, ou no botão *Fechar* da coluna, ou apertar `Esc` com o foco nela, fecha. A questão, as respostas e o terminal continuam como estavam (D-01).
- **Uma coluna por vez:** abrir *Instruções* fecha *Conversa* e vice-versa, para não espremer a questão.
- **Sala de espera (D-02):** abaixo da frase de espera, a sala mostra o título "Instruções gerais" e o mesmo HTML, quando a prova tem instruções.
- **Depois da entrega:** o botão continua, só leitura, como a conversa.
- Textos novos em `messages/pt-BR.ts`. Navegação por teclado, contraste AA e alvos de 44 px.

### 3.2. Backend (Go — Camada de Módulo/Service)

Nenhuma mudança.

## 4. Modelo de Dados (Data Model)

Nenhuma mudança.

## 5. Contrato de API (API Contract)

Nenhuma mudança. Usa `GET /api/v1/classes/{id}/assessments/{assessmentId}` (o campo `description`), que a janela já chama.

## 6. Impacto e Riscos (Impact & Risks)

- **Instruções longas** tomam a coluna inteira. **Mitigação:** a coluna rola sozinha, sem rolar a página.
- **HTML de fora.** O HTML já vem filtrado pelo servidor (SPEC-077 RN-01) e é o mesmo que o cartão já mostra.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (estado): ENQUANTO o estudante está na janela da prova e a prova tem instruções gerais, A janela DEVE ter o botão *Instruções*; sem instruções, o botão NÃO DEVE aparecer.
- [x] **CA-02** (evento): QUANDO o estudante clica em *Instruções*, A janela DEVE mostrar as instruções formatadas, com a questão aberta e as respostas intactas; QUANDO clica de novo, em *Fechar* ou aperta `Esc`, DEVE escondê-las.
- [x] **CA-03** (evento): QUANDO o estudante abre *Instruções* com a *Conversa* aberta, A janela DEVE fechar a *Conversa*, e vice-versa.
- [x] **CA-05** (estado): ENQUANTO o estudante está na sala de espera e a prova tem instruções gerais, A sala DEVE mostrá-las formatadas abaixo da frase de espera (D-02).
- [x] **CA-04** (ubíquo): Os textos novos DEVEM estar em `messages/pt-BR.ts`, com `aria-expanded` no botão, navegação por teclado, contraste AA e alvos de 44 px.

## 8. Plano de Testes (Test Plan)

- **Frontend (Vitest + Testing Library):**
  - página `take` (`page.test.tsx`): o botão com e sem instruções (CA-01), abrir, fechar por clique, *Fechar* e `Esc`, com a resposta marcada antes ainda marcada depois (CA-02), uma coluna por vez (CA-03) e as instruções na sala de espera (CA-05).
  - CA-04: os textos vêm de `messages/pt-BR.ts` e o botão tem `aria-expanded`.
- **Roteiro manual:** numa prova com instruções que tenham lista e trecho de comando, abrir e fechar as instruções no meio de uma prática e conferir que o terminal não perdeu a linha digitada.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, esta spec e as SPEC-077, 090 e 093.
2. **Arquivos:** `frontend/src/app/app/classes/[id]/assessments/[assessmentId]/take/page.tsx`, o `page.test.tsx` dela e o SCSS dela, `frontend/src/components/ExamChat/` (só se a coluna for compartilhada) e `frontend/src/messages/pt-BR.ts`.
3. Testes antes, vermelhos, num commit `test(...)`; depois o código.

## 10. Decisões (antes: pendências para aprovação)

| ID | Decisão |
| :--- | :--- |
| D-01 | **As instruções abrem numa coluna ao lado da questão**, como a *Conversa*, e não num diálogo: o aluno lê a dica e digita no terminal ao mesmo tempo. |
| D-02 | **A sala de espera também mostra as instruções**, abaixo da frase de espera (CA-05). |

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 05/11/2026 | Aruna Architect | Criada em `Rascunho`, a pedido do Tech Lead no roteiro manual do chat da prova. Pendências D-01 e D-02. |
| 05/11/2026 | Tech Lead | Aprovada ("Aprovo"), com as recomendações de D-01 e D-02. CA-05 novo (sala de espera). Status: `Aprovada` |
| 05/11/2026 | Implementador | Implementada, menos o roteiro manual, por isso o status continua `Aprovada`. **Feito:** CA-01 a CA-05 na página `take`: o botão *Instruções* (só com texto visível, `descriptionText`), a coluna com o mesmo estilo da *Conversa* (`ExamChat.module.scss`), *Fechar* e `Esc`, uma coluna por vez, e o bloco na sala de espera; textos em `messages.assessments.take.instructions`. **Medido:** 4 testes vermelhos pelo motivo esperado (o botão e o título não existiam); verdes os 17 da página `take`, `tsc`, ESLint e Stylelint limpos. **Desvios:** nenhum. **Testes alterados depois do vermelho:** nenhum. **Aberto:** o roteiro manual. |
