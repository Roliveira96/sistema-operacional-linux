# SPEC-015: Identidade Visual do Protótipo "Linux na Prática"

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-015 |
| **Status** | Rascunho |
| **Data de criação** | 09/10/2026 |
| **Última revisão** | 09/10/2026 |
| **Autor** | Implementador (Claude), a pedido do Tech Lead |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend |
| **Módulo** | Tokens globais, casca da aplicação e componentes visuais |
| **Contexto de tela** | Todas as telas; destaque para `/`, `/materials`, `/materials/[id]` e o terminal |
| **Prioridade** | Média |
| **Depende de** | SPEC-004, SPEC-007, SPEC-012, SPEC-014 |
| **Substitui** | Revisa as regras de tema de `specs/ARCHITECTURE.md` e a paleta da SPEC-007, conforme as pendências aprovadas |
| **Fontes canônicas** | `docs/screenshots/01` a `05`; `legacy/src/estilos/base.css`, `menu.css`, `topico.css`, `terminal.css` e `simulado.css`; `legacy/index.html` (fontes) |


---

## 1. Contexto e Problema (Context & Problem Statement)

O protótipo do TCC 1 (`legacy/`) tem uma identidade visual própria e reconhecível, que a docente e os estudantes já conhecem. O frontend novo nasceu com tokens neutros (fundo claro, acento dourado UTFPR, terminal grafite) e hoje parece outro produto. O Tech Lead pediu para replicar o visual do protótipo.

Como é o protótipo:

- **Paleta escura "berinjela"**:
  - fundo `#0e0b10`, superfícies `#17131b` e `#201a25`, borda `#342a3a`;
  - texto `#ece8ef`, texto suave `#9c93a3`;
  - acento laranja Ubuntu `#e95420`, com berinjela `#77216f` nos brilhos de fundo.
- **Cores por tópico** nos títulos e cards (as que já estão nos tokens `--color-module-*` do tema escuro).
- **Tipografia:**
  - Inter no texto;
  - Ubuntu Mono no código;
  - Ubuntu no terminal;
  - Cinzel só no certificado.
- **Cards** com raio de 14 px, número do tópico no canto (`01`, `02`) e etiquetas de comandos em fonte mono.
- **Terminal** no estilo da janela do GNOME Terminal (tema Yaru):
  - barra `#2b2b2b` com abas numeradas (a de root fica laranja) e os três botões de janela;
  - fundo berinjela `#300a24` e texto `#eeeeec`;
  - prompt verde e azul, com mensagem de boas-vindas do Ubuntu;
  - rodapé com atalhos em `kbd`.
- **Telas de tópico e de simulado divididas**: conteúdo à esquerda e terminal fixo à direita.
- **Selo institucional**: cartão branco com os logos da UTFPR e do TSI.
- **Botões**: primário laranja e secundário escuro com borda, raio de 10 px e peso 600.

O conflito: o protótipo só tem tema escuro, mas a `ARCHITECTURE.md` exige paridade entre claro e escuro, e a SPEC-007 definiu o dourado UTFPR como acento institucional.

## 2. Objetivos (Goals)

- Fazer o frontend novo ter a aparência do protótipo, com a mesma paleta, tipografia, cards, botões e janela do terminal.
- Manter as regras que continuam valendo: só tokens semânticos (nenhuma cor literal fora de `_tokens.scss`), contraste WCAG AA e navegação por teclado.
- Não mudar comportamento, rotas nem API: é uma spec só de apresentação.

### 2.1. Fora de escopo (Non-Goals)

- Os recursos do protótipo que não existem no sistema novo:
  - até 3 terminais em abas;
  - "Rodar este card" e o player de cards;
  - Cola de comandos;
  - Salvar e abrir o estado;
  - certificado.
- Cada um desses entra, se for o caso, por spec própria. A janela do terminal mostra uma aba só.
- Redesenho das telas de gestão da docente (turmas, alunos, módulos): elas só herdam os tokens novos.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Tokens (`_tokens.scss`):**
  - o tema escuro passa a usar os valores exatos do protótipo, mapeados para os tokens semânticos que já existem (por exemplo, `--fundo` vira `--color-bg` e `--laranja` vira `--color-accent`);
  - entram tokens novos para a janela do terminal (barra, aba, aba de root, botões de janela, prompt de usuário, prompt de caminho), para o brilho de fundo e para o raio dos cards;
  - o tema claro segue a decisão da P-01.
- **Tipografia:**
  - Inter, Ubuntu e Ubuntu Mono carregadas por `next/font`, servidas pelo próprio frontend, sem requisição ao Google em tempo de execução;
  - os tokens `--font-sans`, `--font-mono` e um novo `--font-terminal` apontam para elas.
- **Componentes:**
  - `Button`: primário laranja e secundário escuro com borda, nos raios e pesos do protótipo;
  - `ModuleCard` e `MaterialCard`: número do tópico, ícone, título na cor do tópico e etiquetas mono;
  - `HeroSection`: selo institucional em cartão branco, faixa de certificações, título grande e brilhos de fundo;
  - `Terminal`: moldura de janela do GNOME (barra, uma aba `root@servidor: ~`, botões decorativos), fundo berinjela, prompt verde e azul, mensagem de boas-vindas e rodapé de atalhos (`Tab`, `↑`, `Ctrl`+`C`, `Ctrl`+`L`);
  - `AppShell`: barra superior no estilo da tela de tópico.
- **Layout da prática:** conforme a P-03.

### 3.2. Backend (Go)

Não se aplica nesta spec.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec.

## 6. Impacto e Riscos (Impact & Risks)

- **Contraste do laranja `#e95420`:** com texto branco fica em cerca de 3,6:1 e não atinge AA para texto normal.
  *Mitigação:* texto escuro sobre o laranja, como o protótipo já faz no botão "Abrir o laboratório livre" (cerca de 5,3:1 com `#0e0b10`); a verificação com ferramenta de contraste é feita nos temas mantidos.
- **Conflito com specs aprovadas** (paridade de temas e paleta da SPEC-007).
  *Mitigação:* as pendências P-01 e P-02 decidem, e a `ARCHITECTURE.md` é atualizada no mesmo commit.
- **Peso das fontes.**
  *Mitigação:* `next/font` com subconjunto `latin` e só os pesos usados.
- **Outra sessão de trabalho alterando `AppShell` e `ClassCard`.**
  *Mitigação:* implementar só depois que essas alterações forem commitadas.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01**: No tema escuro, fundo, superfícies, bordas, textos e acento DEVEM ter os valores do protótipo (`legacy/src/estilos/base.css`).
- [ ] **CA-02**: O texto DEVE usar Inter, o código Ubuntu Mono e o terminal Ubuntu Mono, sem requisição a domínio externo em tempo de execução.
- [ ] **CA-03**: QUANDO o terminal da prática abrir, O SISTEMA DEVE mostrar a moldura da janela do GNOME, o fundo berinjela, o prompt de root nas cores do protótipo e o rodapé de atalhos.
- [ ] **CA-04**: A página inicial e a lista de materiais DEVEM reproduzir o selo institucional, o título e os cards numerados de `docs/screenshots/01-menu-principal.png`.
- [ ] **CA-05**: Nenhuma cor literal DEVE aparecer fora de `_tokens.scss` (regra do Stylelint continua passando).
- [ ] **CA-06**: Todo par de texto e fundo DEVE atingir contraste WCAG AA nos temas mantidos.
- [ ] **CA-07**: Os testes existentes DEVEM continuar passando, sem mudança de comportamento.

## 8. Plano de Testes (Test Plan)

- **Frontend:**
  - testes dos componentes alterados verificando estrutura e classes nos temas mantidos, sem comparar cores, conforme a `ARCHITECTURE.md`;
  - teste do terminal para a moldura e o rodapé de atalhos.
- **Manual:** comparação lado a lado com `docs/screenshots/01` a `03` na página inicial, na lista de materiais, em um módulo com o terminal aberto e na lista de simulados, com capturas registradas no histórico.
- **Cobertura:** acima de 80% no frontend.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura:** `ARCHITECTURE.md` (seções de tema e acessibilidade), SPEC-004, SPEC-007 e os CSS do legado listados nas fontes canônicas.
2. **Ordem:**
   1. tokens e fontes;
   2. `Button`;
   3. casca;
   4. página inicial e cards;
   5. terminal;
   6. layout da prática;
   7. revisão de contraste.
3. **Arquivos a alterar:**
   - `frontend/src/styles/_tokens.scss` e `frontend/src/app/layout.tsx`;
   - componentes citados na seção 3.1;
   - `specs/ARCHITECTURE.md`, se a P-01 mudar a regra de temas.
4. **Definição de pronto:** CA-01 a CA-07 verificados.

## 10. Pendências para aprovação

- **P-01 (temas):** o protótipo só tem tema escuro, e a `ARCHITECTURE.md` exige paridade claro e escuro.
  *Recomendação:*
  - manter os dois temas, com o escuro idêntico ao protótipo e padrão para quem não escolheu;
  - o claro passa a ser uma variante da mesma paleta (fundo claro com acento laranja e terminal berinjela, que é igual nos dois temas, como num terminal real);
  - o alternador continua no cabeçalho.
  *Alternativa:* só tema escuro, removendo o alternador e a regra de paridade.
- **P-02 (acento institucional):** a SPEC-007 definiu o dourado UTFPR como acento.
  *Recomendação:*
  - o laranja Ubuntu `#e95420` passa a ser o acento de interação (botões primários, links, foco), como no protótipo;
  - o dourado fica restrito à identidade institucional (selo, certificado e o botão "Cadastrar" do cabeçalho público, se quiser mantê-lo).
- **P-03 (layout da prática):** o protótipo mostra o conteúdo à esquerda e um terminal fixo à direita; hoje cada exercício abre um terminal embutido abaixo do enunciado.
  *Recomendação:*
  - no módulo, a seção de exercícios passa a ter a divisão do protótipo em telas largas (lista de exercícios à esquerda e terminal à direita, trocando de exercício por abas numeradas como na tela de simulado);
  - em telas estreitas, o terminal fica embutido como hoje;
  - o restante do material continua em coluna única.
  *Alternativa:* manter o terminal embutido e mudar só a aparência.
- **P-04 (mensagem de boas-vindas):** o protótipo abre o terminal com "Conectado a 192.168.0.10 via SSH como root" e o texto do Ubuntu 24.04.
  *Recomendação:* reproduzir, porque reforça a ideia de servidor real; o texto fica no arquivo de mensagens.
- **P-05 (logos):** o protótipo usa `utfpr-logo.svg` e `tsi.png` de `legacy/public`.
  *Recomendação:* copiar os dois para `frontend/public/brand/`, sem alteração.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 09/10/2026 | Implementador (Claude) | Criação, a pedido do Tech Lead ("quero replicar o visual do protótipo"), a partir das capturas de `docs/screenshots/` e dos CSS do legado. Pendências P-01 a P-05 |
