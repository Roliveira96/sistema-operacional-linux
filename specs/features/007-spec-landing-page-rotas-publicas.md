# SPEC-007: Interface Pública, Landing Page Institucional e Catálogo Educacional

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-007 |
| **Status** | Implementada |
| **Data de criação** | 08/10/2026 |
| **Última revisão** | 08/10/2026 |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend |
| **Módulo** | `portal/public` |
| **Contexto de tela** | `/`, `/materials`, `/simulations` |
| **Prioridade** | Alta |
| **Depende de** | SPEC-004 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | `docs/arquitetura/transicao-backend.md` (seção 4.1) |

---

## 1. Contexto e Problema (Context & Problem Statement)

A versão inicial do sistema operava exclusivamente como um simulador focado na interação com terminal embutido, carecendo de uma porta de entrada institucional que apresente a finalidade acadêmica, a contextualização pedagógica do projeto na UTFPR e a navegação desimpedida para usuários não autenticados. Atualmente, não existe uma apresentação visual que explique a motivação do simulador POSIX no navegador, nem pontos de partida claros para quem busca explorar os módulos didáticos teóricos e os exames preparatórios antes de se autenticar.

O impacto de não possuir essa camada pública é a barreira de entrada para estudantes e visitantes, a ausência de consolidação da identidade institucional da universidade e a falta de pontos de acesso estruturados para as rotas de autenticação (`/login` e `/register`). É necessária uma interface pública, com transições visuais fluidas, suporte a design tokens com paridade Dark/Light e integração das cores oficiais da universidade.

---

## 2. Objetivos (Goals)

* Implementar a página inicial institucional (Landing Page) na rota `/`, contextualizando o projeto acadêmico e seus objetivos pedagógicos.


* Estruturar a barra de navegação global pública com logotipo institucional, links para rotas públicas e botões de ação que redirecionem para os fluxos de login e cadastro.
* Criar a casca da rota `/materials`, apresentando o catálogo público de módulos didáticos a partir de dados estruturados.


* Criar a casca da rota `/simulations`, apresentando as modalidades de simulados preparatórios práticos disponíveis.


* Mapear os tokens institucionais da universidade em `_tokens.scss` com suporte a temas claro e escuro, utilizando as cores oficiais Amarelo Ouro e Preto/Grafite como âncoras semânticas.


* Implementar animações e microinterações fluidas fundamentadas exclusivamente em transições CSS e `@keyframes` via SCSS Modules, sem dependências externas de animação.
* Estabelecer a camada de dados mockados em arquivos dedicados na camada de serviços/dados estáticos para suprir a renderização sem acoplamento prévio de endpoints.

---

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

A arquitetura visual organiza a casca pública sob o App Router do Next.js, mantendo co-location estrito e estilos desacoplados via SCSS Modules:

* **Tokens e Identidade Visual (`styles/_tokens.scss`):**
* Mapear os valores institucionais da UTFPR em propriedades semânticas. A cor Amarelo Ouro atua como destaque primário de ação, foco e realce interativo em ambos os temas. A cor Grafite atua como âncora de contraste, assumindo função de superfície/plano de fundo predominante no tema escuro e de texto/bordas no tema claro.


* Garantir paridade visual sob a diretiva `[data-theme="dark"]`, mantendo o contraste acessível em botões primários e links de navegação.


* **Barra de Navegação Pública (`NavbarPublic`):**
* Componente fixado no topo contendo o brasão/logotipo institucional vetorizado, links de navegação para a página inicial, `/materials` e `/simulations`, alternador de tema e botões de chamada para ação.


* Os botões de ação realizam redirecionamento programático via roteador nativo para a rota de login (`/login`) e tela de cadastro/convite (`/register`).


* **Página Inicial / Landing Page (`app/page.tsx`):**
* **Seção Hero:** Cabeçalho de impacto apresentando o título do projeto, proposta de valor (eliminação do atrito de máquinas virtuais e foco na prática de linha de comando), botões de ação primária direcionando aos materiais e ilustração animada simulando uma janela de terminal GNOME com comandos em execução contínua via CSS.


* **Seção de Pilares e Funcionalidades:** Grade de cartões interativos destacando os diferenciais arquiteturais: simulação POSIX local sem latência, catálogo completo de comandos essenciais e ambiente de provas com auditoria e resiliência.


* **Seção de Métricas e Escopo:** Exibição numérica destacando tópicos curriculares, quantidade de lições práticas e taxa de cobertura de testes.


* **Rodapé Institucional:** Bloco com identificação do curso de Tecnologia em Sistemas para Internet (TSI), Campus Guarapuava, referências docentes e links institucionais.




* **Página de Materiais Didáticos (`app/materials/page.tsx`):**
* Rota pública apresentando listagem em grade responsiva contendo os módulos didáticos. Cada cartão exibe ícone representativo, título do tópico, descrição sucinta, tag de nível e botão para exploração do conteúdo.


* O conteúdo é suprido por estrutura estática mockada centralizada na camada de dados compartilhada.


* **Página de Simulados Preparatórios (`app/simulations/page.tsx`):**
* Rota pública listando as modalidades de exames cronometrados: fundamentos operacionais, administração intermediária, tópicos avançados e simulados alinhados às diretrizes de certificações internacionais.


* Cada item expõe a quantidade de questões do caderno, tempo estimado e nível de complexidade.




* **Camada de Animações e Estilos (`_mixins.scss` e módulos locais):**
* Definição de mixins para elevação suave de cartões ao passar o mouse (`hover`), pulsação de cursor de terminal simulado e fade-in suave de seções no carregamento.
* Proibição de estilos inline ou manipulação de classes utilitárias globais.



---

## 4. Modelo de Dados (Data Model)

Sem alteração de schema. Esta entrega restringe-se integralmente à interface pública de usuário e landing page, consumindo dados mockados isolados no frontend para viabilizar testes visuais e navegação sem chamadas à camada relacional.

---

## 5. Contrato de API (API Contract)

Sem endpoints novos. As telas públicas utilizam coleções estáticas tipadas locais para renderização dos módulos e modalidades de simulação nesta etapa.

---

## 6. Impacto e Riscos (Impact & Risks)

* **Risco de Perda de Contraste no Modo Claro com Amarelo Institucional:** O uso de texto branco ou elementos claros sobre fundos Amarelo Ouro pode comprometer a acessibilidade e legibilidade.
*Mitigação:* Utilizar a cor grafite institucional para tipografias aplicadas sobre superfícies amarelas, mantendo a taxa de contraste em conformidade com as diretrizes WCAG AA.
* **Risco de Degradação de Performance por Animações Contínuas:** Efeitos visuais concorrentes na landing page causarem recálculos constantes de layout (reflow) no navegador.
*Mitigação:* Restringir todas as animações CSS às propriedades de composição acelerada por hardware (`transform` e `opacity`), vedando transições de largura, margem ou posicionamento absoluto.
* **Risco de Inconsistência nos Dados Mockados:** Os dados estáticos temporários divergirem das entidades que serão servidas pelo backend na carga do seed.


*Mitigação:* Modelar as interfaces TypeScript dos dados mockados em estrita concordância com os campos previstos nas especificações de conteúdo e tópicos.



---

## 7. Critérios de Aceite (Acceptance Criteria)

* [x] QUANDO a rota raiz `/` for acessada, O SISTEMA DEVE renderizar a Landing Page completa com Navbar, Hero animado, grade de pilares institucionais, métricas do simulador e rodapé.
* [x] QUANDO o usuário interagir com a barra de navegação pública, O SISTEMA DEVE exibir o logotipo institucional da universidade, links para `/`, `/materials`, `/simulations` e alternador de tema.
* [x] QUANDO o botão "Entrar" na barra de navegação for acionado, O SISTEMA DEVE redirecionar o navegador para a rota `/login`.
* [x] QUANDO o botão "Cadastrar" na barra de navegação for acionado, O SISTEMA DEVE redirecionar o navegador para a rota `/register`.
* [x] QUANDO a rota `/materials` for acessada, O SISTEMA DEVE renderizar a grade pública de módulos didáticos contendo título, descrição, ícone e nível a partir dos dados mockados.
* [x] QUANDO a rota `/simulations` for acessada, O SISTEMA DEVE renderizar a listagem de simulados práticos contendo duração, quantidade de questões e complexidade a partir dos dados mockados.
* [x] QUANDO o tema for alternado entre claro e escuro, O SISTEMA DEVE aplicar a mudança instantaneamente em todas as seções e rotas públicas sem recarregar a página.
* [x] QUANDO os componentes visuais forem renderizados, O SISTEMA DEVE aplicar exclusivamente variáveis semânticas de `_tokens.scss`, preservando a identidade Amarelo Ouro e Grafite da UTFPR.
* [x] QUANDO as animações visuais forem executadas, O SISTEMA DEVE utilizar unicamente transições e `@keyframes` de SCSS Modules sem bibliotecas de animação de terceiros.
* [x] QUANDO executados os testes automatizados da interface, O SISTEMA DEVE comprovar renderização íntegra e presença de todos os nós estruturais nos modos claro e escuro com cobertura superior a 80%.

---

## 8. Plano de Testes (Test Plan)

* **Frontend / Testes Automatizados (Vitest e Testing Library):**
* Renderizar o componente `NavbarPublic` verificando presença dos links acessíveis, logotipo e disparos de navegação para `/login` e `/register`.
* Renderizar a página `LandingPage` validando a exibição de cada seção temática, asserções de acessibilidade em cabeçalhos (hierarquia de `h1`, `h2`, `h3`) e execução de testes em ambos os temas (`light` e `dark`).
* Renderizar a rota `/materials` atestando que a lista de módulos mockados é percorrida e exibe a quantidade exata de cartões esperada.
* Renderizar a rota `/simulations` atestando a presença dos cartões de simulados e suas respectivas propriedades de duração e questões.
* Testar o comportamento do alternador de tema nos componentes, verificando a comutação do atributo de tema no elemento raiz e a preservação de acessibilidade.


* **Frontend / Validação Visual Manual:**
* Inspecionar a página inicial nas resoluções desktop, tablet e mobile, assegurando o recolhimento responsivo da barra de navegação e quebra correta das grades de cartões.
* Alternar o tema visual e verificar a legibilidade dos textos sobre o fundo escuro e claro, com ênfase no contraste dos botões amarelos de destaque.
* Atestar o redirecionamento dos botões de ação para as rotas correspondentes ao clicar nos elementos interativos da barra de navegação.



---

## 9. Contexto Final da IA (AI Final Context Execution)

Para implementar esta especificação, atue exclusivamente dentro do diretório `frontend/`, estruturando a camada de tokens, componentes de layout e páginas públicas na ordem abaixo:

1. Atualizar `frontend/src/styles/_tokens.scss` para incorporar a paleta institucional da UTFPR (Amarelo Ouro e Preto/Grafite) em conformidade com os tokens semânticos e a paridade de temas.


2. Criar a camada de dados mockados em `frontend/src/data/mockContent.ts` contendo as coleções tipadas de tópicos curriculares e modalidades de simulados.
3. Desenvolver os componentes atômicos e moleculares: `NavbarPublic`, `HeroSection`, `FeatureCard`, `MetricCard`, `FooterPublic`, `MaterialCard` e `SimulationCard`, cada um com seu respectivo arquivo `.module.scss`.
4. Implementar as páginas `frontend/src/app/page.tsx`, `frontend/src/app/materials/page.tsx` e `frontend/src/app/simulations/page.tsx`.
5. Implementar a suíte de testes automatizados com Vitest e Testing Library cobrindo os componentes e páginas em ambos os temas, garantindo cobertura superior a 80%.

Arquivos a criar ou alterar:

* `frontend/src/styles/_tokens.scss`
* `frontend/src/styles/_mixins.scss`
* `frontend/src/data/mockContent.ts`
* `frontend/src/components/NavbarPublic/NavbarPublic.tsx`
* `frontend/src/components/NavbarPublic/NavbarPublic.module.scss`
* `frontend/src/components/NavbarPublic/NavbarPublic.test.tsx`
* `frontend/src/components/HeroSection/HeroSection.tsx`
* `frontend/src/components/HeroSection/HeroSection.module.scss`
* `frontend/src/components/HeroSection/HeroSection.test.tsx`
* `frontend/src/components/FeatureCard/FeatureCard.tsx`
* `frontend/src/components/FeatureCard/FeatureCard.module.scss`
* `frontend/src/components/MetricCard/MetricCard.tsx`
* `frontend/src/components/MetricCard/MetricCard.module.scss`
* `frontend/src/components/FooterPublic/FooterPublic.tsx`
* `frontend/src/components/FooterPublic/FooterPublic.module.scss`
* `frontend/src/components/MaterialCard/MaterialCard.tsx`
* `frontend/src/components/MaterialCard/MaterialCard.module.scss`
* `frontend/src/components/SimulationCard/SimulationCard.tsx`
* `frontend/src/components/SimulationCard/SimulationCard.module.scss`
* `frontend/src/messages/pt-BR.ts`
* `frontend/src/app/layout.tsx`
* `frontend/src/app/layout.module.scss`
* `frontend/src/app/page.tsx`
* `frontend/src/app/page.test.tsx`
* `frontend/src/app/materials/page.tsx`
* `frontend/src/app/materials/page.test.tsx`
* `frontend/src/app/simulations/page.tsx`
* `frontend/src/app/simulations/page.test.tsx`

Dependências de execução: Esta especificação consome a fundação de frontend estabelecida na SPEC-004 (Next.js 15+, App Router e configuração de SCSS Modules) e não possui dependências bloqueantes no backend Go nesta fase.

---

## 10. Pendências (Open Issues / Questions)

Nenhuma pendência em aberto. Spec aprovada e implementada.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 08/10/2026 | Aruna Architect | Criação da spec inicial |
| 08/10/2026 | Tech Lead (Ricardo Martins de Oliveira) | Aprovação para implementação |
| 08/10/2026 | Implementador (Antigravity) | Implementação completa com 105 testes no frontend, paridade de temas e status alterado para `Implementada` |