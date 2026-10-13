# SPEC-043: Navegação e Menu Responsivo para Dispositivos Móveis (AppShell e Navbar)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-043 |
| **Status** | Implementada |
| **Data de criação** | 13/10/2026 |
| **Última revisão** | 13/10/2026 (implementada) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend |
| **Módulo** | `AppShell`, `NavbarPublic` |
| **Contexto de tela** | Cabeçalho e barra superior de navegação da área autenticada (`/app/**`) e das rotas públicas |
| **Prioridade** | Alta |
| **Depende de** | SPEC-007, SPEC-015, SPEC-026, SPEC-041, SPEC-042 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Relato de usabilidade em campo trazido pelo Tech Lead em 13/10/2026 ("o menu navbar tanto do sistema do aluno como do admin não estão preparados para o mobile, o professor, de dentro do carro não consegue usar pois tá tudo ruim") |

---

## 1. Contexto e Problema (Context & Problem Statement)

A barra de navegação da área autenticada (`AppShell`) foi concebida com disposição horizontal em linha (`display: flex; flex-wrap: wrap`), exibindo diretamente todos os links de destino: "Turmas", "Estudantes", "Módulos", "Calendário", "Segurança", e para administradores "Conformidade do motor" e "Feriados", além da marca da instituição/plataforma (`BrandMark`) e do menu da conta (`AccountMenu`).

Em telas estreitas (smartphones e telas com largura menor que 768 px — como a professora ou estudante acessando via smartphone em trânsito ou no carro):
1. **Quebra desordenada de linhas:** os links se acumulam em múltiplas linhas desiguais, ocupando até metade da altura útil da tela e empurrando o conteúdo da página.
2. **Alvos de toque inadequados:** os links ficam muito próximos e pequenos, difíceis de acionar por toque com um único dedo (não cumprem o alvo mínimo recomendado de 44×44 px da WCAG / mobile ergonomics).
3. **Ausência de gaveta/menu colapsável:** não há botão de menu hambúrguer para condensar os itens de navegação quando o espaço for escasso.
4. **Navbar pública (`NavbarPublic`):** sofre do mesmo sintoma ao exibir simultaneamente logo, links públicos ("Início", "Materiais", "Simulações") e botões de ação ("Entrar", "Criar conta" ou "Minha área" + `AccountMenu`).

## 2. Objetivos (Goals)

1. Dotar o `AppShell` de um **menu hambúrguer colapsável** para telas estreitas (abaixo de 768 px).
2. Manter no cabeçalho mobile apenas o essencial visível: logotipo/marca (`BrandMark`), botão do menu móvel (hambúrguer/fechar) e o menu de conta (`AccountMenu`).
3. Quando acionado, o menu móvel expande uma **gaveta/painel de navegação** contendo todos os links da aplicação correspondentes ao papel do usuário (aluno, professor ou administrador), com alvos de toque confortáveis (mínimo de 44 px de altura por item).
4. Fechamento intuitivo do menu: ao clicar em qualquer link de navegação, ao pressionar a tecla `Escape`, ou ao clicar no botão de fechar / fora do painel.
5. Garantir total acessibilidade (WAI-ARIA): botão com `aria-expanded`, `aria-label`, navegação operável por teclado, foco gerenciado.
6. Aplicar padrão idêntico na barra pública (`NavbarPublic`), condensando os links públicos e ações em menu hambúrguer em visualizações móveis.
7. Seguir estritamente o tema escuro, tokens CSS (`_tokens.scss`) e aprovação em Stylelint e ESLint.

### 2.1. Fora de escopo (Non-Goals)

- Redesenhar as páginas internas ou formulários da aplicação (o escopo é estritamente as barras de navegação `AppShell` e `NavbarPublic`).
- Alterar as permissões de acesso por papel definidas nas specs anteriores.
- Criar navegação por abas inferiores (bottom navigation bar) de aplicativo nativo nesta etapa.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

#### 3.1.1. `AppShell` Mobile

1. **Breakpoints responsivos:**
   - Telas largas (≥ 768 px): a barra horizontal tradicional é mantida inalterada.
   - Telas estreitas (< 768 px):
     - A `<nav>` horizontal clássica fica oculta (`display: none`).
     - Exibe-se o botão de alternância do menu móvel (ícone hambúrguer ☰ / fechar ✕) ao lado do `BrandMark`.
     - O `AccountMenu` permanece acessível no canto direito superior para consulta rápida de perfil e saída.
2. **Painel / Gaveta de Navegação Móvel:**
   - Posicionado logo abaixo da barra superior fixa ou em sobreposição com backdrop translúcido (`--color-backdrop`).
   - Apresenta os links em coluna vertical, com ícones ou texto nítido, fundo `--color-surface-raised`, borda `--color-border` e espaçamento amplo (`padding: var(--space-3) var(--space-4)`).
   - Links mostrados conforme o papel:
     - **Estudante:** "Calendário", "Segurança".
     - **Professor:** "Turmas", "Estudantes", "Módulos", "Calendário", "Segurança".
     - **Administrador:** "Turmas", "Estudantes", "Módulos", "Conformidade do motor", "Feriados", "Calendário", "Segurança".
3. **Comportamento e Acessibilidade:**
   - Botão possui `aria-label="Abrir menu"` / `aria-label="Fechar menu"` e `aria-expanded="false|true"`.
   - Mudança de rota fecha o menu automaticamente.
   - Tecla `Escape` fecha o menu e devolve o foco ao botão de abertura.

#### 3.1.2. `NavbarPublic` Mobile

1. Telas estreitas (< 768 px):
   - Os links horizontais e botões de login/cadastro são agrupados dentro do menu móvel colapsável.
   - O cabeçalho mantém visível o `BrandMark` e o botão hambúrguer (mais o `AccountMenu` se já houver sessão ativa).

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec. Nenhuma alteração no modelo de dados ou schema de banco.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec. Nenhum endpoint novo ou alterado no backend.

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| :--- | :--- |
| Conflito de cliques em links ao fechar o menu | Tratamento de evento `onClick` nos links fechando o estado antes do roteamento sem bloquear a transição de rota do Next.js. |
| Altura do menu ultrapassar telas pequenas | Gaveta móvel com `max-height: calc(100vh - 60px)` e `overflow-y: auto`. |
| Regressão visual em desktop | Consultas de mídia estritas `@media (min-width: 768px)` preservando o layout desktop sem alteração de classes. |

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (estado): EM telas com largura inferior a 768 px, a barra de navegação desktop do `AppShell` DEVE ficar oculta e O SISTEMA DEVE exibir o botão de menu móvel.
- [x] **CA-02** (evento): QUANDO o usuário clica no botão de menu móvel, O SISTEMA DEVE abrir a lista vertical com os links de navegação adequados ao seu papel e alterar o ícone/rótulo do botão para indicar fecho.
- [x] **CA-03** (evento): QUANDO o usuário clica em qualquer link do menu móvel ou pressiona a tecla `Escape`, O SISTEMA DEVE fechar o menu móvel.
- [x] **CA-04** (ubíquo): O botão de menu móvel e os itens de navegação DEVEM ter altura mínima de 44 px para toque em celular.
- [x] **CA-05** (ubíquo): O menu móvel DEVE conter os atributos de acessibilidade `aria-expanded`, `aria-label` e ser operável via teclado.
- [x] **CA-06** (ubíquo): A barra pública `NavbarPublic` DEVE colapsar seus links e botões de ação em menu móvel em telas com largura inferior a 768 px.
- [x] **CA-07** (ubíquo): Stylelint e ESLint DEVEM permanecer sem erros e todas as cores devem vir dos tokens semânticos de `_tokens.scss`.

## 8. Plano de Testes (Test Plan)

Escritos antes da implementação (SPEC-038):
1. `AppShell.test.tsx`:
   - Exibição do botão de menu mobile e abertura/fechamento ao clicar.
   - Fechamento ao pressionar a tecla `Escape`.
   - Renderização dos links pertinentes a cada papel (`STUDENT`, `TEACHER`, `ADMIN`) na lista móvel.
2. `NavbarPublic.test.tsx`:
   - Alternância do menu móvel na barra pública para visitantes e usuários logados.

---

## 9. Glossário e Alinhamento

Utiliza os termos de `specs/GLOSSARY.md`. Nenhum termo de domínio novo necessário.

---

## 10. Pendências (Open Questions)

Nenhuma pendência.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 13/10/2026 | Aruna Architect | Criação do rascunho da SPEC-043 após feedback do Tech Lead sobre a dificuldade de navegação mobile para professores, estudantes e administradores. Status: `Rascunho` |
| 13/10/2026 | Tech Lead | Aprovada pelo Tech Lead ("aprovo sim"). Status: `Aprovada` |
| 13/10/2026 | Implementador | Implementação do menu e navegação mobile responsiva no AppShell e NavbarPublic, verificação com 33 testes verdes e Stylelint/ESLint limpos. Status: `Implementada` |
