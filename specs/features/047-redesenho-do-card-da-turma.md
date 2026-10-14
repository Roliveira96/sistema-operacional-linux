# SPEC-047: Redesenho do Card da Turma

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-047 |
| **Status** | Aprovada |
| **Data de criação** | 14/10/2026 |
| **Última revisão** | 14/10/2026 (aprovada) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend |
| **Módulo** | `ClassCard` |
| **Contexto de tela** | `/app/classes` (lista de turmas) |
| **Prioridade** | Média |
| **Depende de** | SPEC-041, SPEC-046 |
| **Substitui** | Nenhuma (reorganiza a SPEC-046 e o card da SPEC-009) |
| **Fontes canônicas** | Pedido do Tech Lead em 14/10/2026: "esse card pode ser melhorado, o visual está feio e nada intuitivo" |

---

## 1. Contexto e Problema (Context & Problem Statement)

O card da turma mostra tudo em caixas do mesmo peso: contadores, horários, link de convite (caixa tracejada), alerta e um rodapé com quatro ações de estilos diferentes. A ação em destaque é "Adicionar estudantes", e não ver a turma. Não há hierarquia: em três segundos a docente não sabe o que é a turma, qual o estado dela e o que fazer.

## 2. Objetivos (Goals)

- Hierarquia clara em uma olhada: identificação e estado no alto, números e horários numa faixa leve, ações no rodapé.
- **Visualizar** é a ação principal; "Adicionar estudantes" é a secundária; "Configurações" e "Arquivar" viram ações discretas (ícones com nome acessível e dica).
- Menos caixas e bordas: os dados saem das caixas e viram uma faixa de informações; o alerta de vigência e as pendências ganham destaque só quando há algo a fazer.
- **Um só padrão de botão:** todas as ações do card usam o componente `Button` do sistema (SPEC-015), sem estilos próprios de botão no card.
- Visual consistente com o sistema de design do projeto (tokens, espaçamento em múltiplos de 4 px, raios, alvos de toque de 44 px, temas claro e escuro).

### 2.1. Fora de escopo (Non-Goals)

- Mudar dados, rotas, serviços ou o comportamento das ações (copiar link, arquivar, ligações).
- Mudar a página da turma, o card do estudante ou a grade da lista.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Estrutura do card, de cima para baixo:

1. **Cabeçalho:** à esquerda o código e o semestre (fonte monoespaçada, discreta); à direita a **situação** (Ativa, Rascunho, Arquivada) como etiqueta com ponto de cor e texto, sem letras maiúsculas. Faixa fina de cor no topo, na cor da situação.
2. **Título** em destaque, que continua sendo ligação para a turma; **resumo** em até 2 linhas.
3. **Alerta de vigência** (só quando a turma está perto do fim): uma linha compacta com a ação "Estender".
4. **Faixa de informações**, sem caixas:
   - alunos ativos, com ícone;
   - ingressos pendentes, como ligação para a aba de estudantes; **só destacada** (cor de atenção) quando há pendências;
   - horários, em uma linha (quando houver);
   - link de convite: um texto curto "Link de convite ativo" com o botão de copiar; "Link desativado" aparece em tom discreto.
5. **Rodapé:** só os dois botões, **na mesma linha**, em partes iguais e em qualquer largura do card (inclusive no celular): **Visualizar** (principal) e **Adicionar estudantes** (secundário), só com texto. O texto não quebra de linha nem alarga o card.
6. **Ações discretas no cabeçalho:** **Configurações** e **Arquivar** (este só se a turma não está arquivada e há a ação) ficam no canto superior direito do card, ao lado da situação, como botões de ícone, com nome acessível, dica ao passar o mouse e alvo de toque de 44 px.

Cores só dos tokens semânticos, nos temas claro e escuro. Texto das mensagens no arquivo de mensagens.

**Padrão de botões (CA-06).** O componente `Button` do sistema (variantes `primary` e `secondary`) passa a ter também a variante `ghost` (sem fundo nem borda, para ações discretas), o tamanho `sm` e o modo `icon` (quadrado de 44 px, só ícone). Há uma versão para ligação, `ButtonLink`, que tem exatamente o mesmo visual e leva a uma rota. No card:

| Ação | Componente | Variante |
| :--- | :--- | :--- |
| Visualizar | `ButtonLink` | `primary` |
| Adicionar estudantes | `ButtonLink` | `secondary` |
| Copiar link | `Button` | `secondary`, tamanho `sm` |
| Configurações | `ButtonLink` | `ghost`, `icon` |
| Arquivar | `Button` | `ghost`, `icon` |

Todos têm a mesma altura (44 px; o de tamanho `sm`, 32 px), o mesmo raio, a mesma fonte e o mesmo foco. Cada botão expõe a variante em `data-variant`.

### 3.2. Backend

Não se aplica nesta spec.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: não há mudança de schema.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: nenhum endpoint muda.

## 6. Impacto e Riscos (Impact & Risks)

- **Testes e leitores de tela dependem dos nomes das ações.** Mitigação: todas as ações mantêm o nome acessível atual ("Visualizar", "Adicionar estudantes", "Configurações", "Arquivar"), mesmo as de ícone.
- **Ações de ícone menos descobríveis.** Mitigação: dica ao passar o mouse e foco visível; as ações importantes (Visualizar, Adicionar estudantes) continuam com texto.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (ubíquo): No card, a ação **Visualizar** DEVE ser a primeira e a principal do rodapé, antes de "Adicionar estudantes".
- [ ] **CA-02** (ubíquo): "Configurações" e "Arquivar" DEVEM ter nome acessível e dica (`title`), mesmo sendo botões de ícone.
- [ ] **CA-03** (estado): ENQUANTO há ingressos pendentes, o contador de pendências DEVE ser destacado e ligar à aba de estudantes; sem pendências, DEVE ficar discreto.
- [ ] **CA-04** (ubíquo): Os dados, as ações e as ligações atuais do card (título, contadores, link de convite, copiar, arquivar, alerta de vigência) DEVEM continuar existindo e funcionando.
- [ ] **CA-07** (ubíquo): Os botões **Visualizar** e **Adicionar estudantes** DEVEM ficar no mesmo contêiner de ações do rodapé, na mesma linha, e **Configurações** e **Arquivar** DEVEM ficar no cabeçalho do card.
- [ ] **CA-06** (ubíquo): Todas as ações do card DEVEM usar `Button` ou `ButtonLink` com as variantes da tabela da seção 3.1, e o `Button` DEVE aceitar `ghost`, `sm` e `icon`.
- [ ] **CA-05** (ubíquo): Stylelint e ESLint DEVEM ficar sem erros e as cores DEVEM vir dos tokens, nos temas claro e escuro.

## 8. Plano de Testes (Test Plan)

- **Frontend, `ClassCard.test.tsx`:** Visualizar vem antes de Adicionar estudantes (CA-01); "Configurações" e "Arquivar" têm `title` e nome acessível (CA-02); o contador de pendências tem a marca de atenção só com pendências (CA-03, `data-attention`); os testes atuais do card continuam passando (CA-04).
- **Frontend, `Button.test.tsx` e `ButtonLink` (CA-06):** variantes, tamanho e modo de ícone aparecem em `data-variant`, `data-size` e `data-icon`; `ButtonLink` é uma ligação com o mesmo visual; no `ClassCard`, cada ação tem a variante da tabela.
- **Frontend, `ClassCard.test.tsx` (CA-07):** Visualizar e Adicionar estudantes têm o mesmo contêiner de ações, e Configurações e Arquivar ficam no cabeçalho. O alinhamento na mesma linha é estilo, conferido no roteiro manual.
- **Manual:** conferir o card em 360 px e em desktop, nos dois temas, com nome longo, sem resumo, sem horários, arquivada e com alerta de vigência (CA-05).
- **Cobertura:** acima de 80% no escopo.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura:** `AI_INSTRUCTIONS.md`, `ClassCard.tsx`, `ClassCard.module.scss`, SPEC-046.
2. **Ordem:** testes vermelhos; reorganizar o JSX; reescrever o SCSS; conferir lint e testes.
3. **Arquivos:** `ClassCard.tsx`, `ClassCard.module.scss`, `ClassCard.test.tsx`, `Button/Button.tsx`, `Button/Button.module.scss`, `Button/ButtonLink.tsx` (novo), `Button/Button.test.tsx` (novo), `messages/pt-BR.ts` (só textos novos).
4. **Pronto:** CA marcados, testes verdes, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 14/10/2026 | Aruna Architect | Criação; aprovada pelo Tech Lead ao pedir a melhoria do visual do card |
| 14/10/2026 | Implementador | Implementada: cabeçalho com situação, faixa de informações sem caixas, Visualizar como ação principal e Configurações e Arquivar como botões de ícone |
| 14/10/2026 | Aruna Architect | Pedido do Tech Lead: os botões do card não seguem um padrão. Passam a usar o `Button` do sistema, estendido com `ghost`, `sm`, `icon` e `ButtonLink` (CA-06); volta a Aprovada |
| 14/10/2026 | Implementador | Implementado o padrão de botões: `Button` com `ghost`, `sm` e `icon`, `ButtonLink`, card e botão "Nova turma" da lista usando-os. Os testes `data-primary` e `data-icon-only` da primeira versão foram trocados por `data-variant` e `data-icon`, porque o padrão mudou |
| 14/10/2026 | Aruna Architect | Pedido do Tech Lead: Visualizar e Adicionar estudantes na mesma linha. As ações de ícone sobem para o cabeçalho; os botões do rodapé perdem o ícone (CA-07); volta a Aprovada |
