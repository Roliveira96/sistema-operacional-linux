# SPEC-046: Botão "Visualizar" no Card da Turma

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-046 |
| **Status** | Aprovada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (aprovada) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend |
| **Módulo** | `ClassCard` |
| **Contexto de tela** | `/app/classes` (lista de turmas) |
| **Prioridade** | Média |
| **Depende de** | SPEC-009, SPEC-041 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead em 14/10/2026: "ao clicar na turma eu não consigo visualizar o que tem na turma, precisa de um visualizar" |

---

## 1. Contexto e Problema (Context & Problem Statement)

No card da turma, a única ligação para a página da turma (visão geral, agenda, estudantes) é o título, que não parece clicável. As ações visíveis levam a "Adicionar estudantes" e a "Configurações". A docente não percebe como ver o que há na turma.

## 2. Objetivos (Goals)

- Cada card da lista de turmas tem uma ação explícita **Visualizar**, que abre a página da turma.

### 2.1. Fora de escopo (Non-Goals)

- Mudar a página da turma, o título do card (continua sendo ligação) ou as demais ações.
- Mudar o card para o estudante.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

No rodapé do card, nas ações secundárias, antes de "Configurações", um link com ícone de olho e o texto "Visualizar", que leva à página da turma (`/app/classes/{id}`). Vale para turmas ativas, em rascunho e arquivadas. Texto no arquivo de mensagens; cores só dos tokens; alvo de toque de no mínimo 44 px, como os demais links do rodapé.

### 3.2. Backend

Não se aplica nesta spec.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: não há mudança de schema.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: nenhum endpoint muda.

## 6. Impacto e Riscos (Impact & Risks)

Baixo. O link novo não muda o comportamento das demais ações. Risco de rodapé apertado no celular; mitigação: as ações secundárias já quebram de linha.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (ubíquo): O card da turma DEVE ter um link "Visualizar" para `/app/classes/{id}`, em qualquer situação da turma.
- [ ] **CA-02** (ubíquo): O link "Visualizar" DEVE vir antes de "Configurações" nas ações secundárias.

## 8. Plano de Testes (Test Plan)

- **Frontend, `ClassCard.test.tsx`:** o link "Visualizar" aponta para a página da turma, para turma ativa, em rascunho e arquivada (CA-01), e vem antes de "Configurações" (CA-02).
- **Cobertura:** acima de 80% no escopo.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura:** `AI_INSTRUCTIONS.md`, `ClassCard.tsx`.
2. **Ordem:** testes vermelhos, depois o link, o ícone e a mensagem.
3. **Arquivos:** `ClassCard.tsx`, `ClassCard.module.scss` (se preciso), `ClassCard.test.tsx`, `messages/pt-BR.ts`.
4. **Pronto:** CA marcados, testes verdes, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo Tech Lead ao pedir o botão Visualizar |
