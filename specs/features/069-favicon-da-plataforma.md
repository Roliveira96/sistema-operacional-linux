# SPEC-069: Favicon da plataforma

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-069 |
| **Status** | Rascunho |
| **Data de criação** | 15/10/2026 |
| **Última revisão** | 15/10/2026 |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend |
| **Módulo** | `app` (raiz do Next.js) |
| **Contexto de tela** | Todas as telas: aba do navegador, favoritos e atalho na tela inicial do celular |
| **Prioridade** | Baixa |
| **Depende de** | Nenhuma |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead em 15/10/2026: "eu quero adicionar o favicon"; decisão do mesmo dia: usar o símbolo da UTFPR |

---

## 1. Contexto e Problema (Context & Problem Statement)

A plataforma não tem favicon. A aba do navegador, os favoritos e o atalho na tela inicial do celular mostram o ícone genérico do navegador, e o navegador ainda pede `/favicon.ico` a cada visita e recebe erro 404. O único recurso visual da instituição no projeto é o logo largo da UTFPR (`public/utfpr-logo.svg`), com a legenda por extenso, que não se lê em 16 px.

## 2. Objetivos (Goals)

- Toda tela mostra um ícone próprio na aba, nos favoritos e no atalho do celular.
- O ícone é o "UTF" do logo da UTFPR, com as cores e as formas originais do logo, sobre um quadrado branco de cantos arredondados, legível em 16 px nos temas claro e escuro do navegador.

### 2.1. Fora de escopo (Non-Goals)

- Mudar as formas ou as cores do logo da UTFPR, ou o logo que já aparece na barra do sistema.
- Manifesto de aplicativo (PWA), imagem de pré-visualização para redes sociais e ícone por tema do sistema.
- Texto, título e descrição da aba (já existem).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Três arquivos de ícone na raiz do roteador, que o Next.js publica e liga ao HTML de todas as páginas sem código novo:

| Arquivo | Uso |
| :--- | :--- |
| `icon.svg` | Aba do navegador e favoritos, em qualquer tamanho |
| `favicon.ico` | Navegadores antigos e o pedido automático a `/favicon.ico`, com os tamanhos 16, 32 e 48 px |
| `apple-icon.png` | Atalho na tela inicial do iPhone e do iPad, com 180 × 180 px |

Os três vêm do mesmo desenho: as três primeiras formas do logo (as letras "U", "T" e "F", com a barra amarela do "F") centralizadas em um quadrado branco de cantos arredondados, com uma margem em volta. O desenho não leva texto nem cores novas.

### 3.2. Backend

Não se aplica nesta spec.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: não há mudança de schema.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: nenhum endpoint do backend muda. A aplicação passa a servir `/icon.svg`, `/favicon.ico` e `/apple-icon.png` em qualquer tela, inclusive para quem não entrou, como arquivos públicos.

## 6. Impacto e Riscos (Impact & Risks)

- **Cache do navegador:** navegadores guardam favicons por muito tempo, e quem já abriu a plataforma pode continuar vendo o ícone antigo por um tempo. Mitigação: o ícone novo aparece ao limpar o cache ou numa janela anônima, e o roteiro manual usa a janela anônima.
- **Uso do logo da instituição:** o logo já é usado na barra do sistema, com as formas e as cores originais; o ícone só recorta as letras "UTF". Mitigação: o Tech Lead confere o resultado antes de aprovar; os arquivos de origem (o SVG) ficam no repositório para ajuste.
- **Legibilidade em tamanho pequeno:** o recorte foi conferido em 16, 32 e 48 px, sobre fundo claro e escuro, e ficou legível.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (ubíquo): O SISTEMA DEVE ter `icon.svg`, `favicon.ico` e `apple-icon.png` na raiz do roteador do frontend.
- [ ] **CA-02** (ubíquo): O `icon.svg` DEVE ser um quadrado, com as formas do "UTF" do logo da UTFPR nas cores originais (amarelo e o preto do logo) sobre fundo branco de cantos arredondados, e NÃO DEVE conter texto nem imagem embutida.
- [ ] **CA-03** (ubíquo): O `favicon.ico` DEVE conter as imagens de 16, 32 e 48 px.
- [ ] **CA-04** (ubíquo): O `apple-icon.png` DEVE ser um PNG de 180 × 180 px.
- [ ] **CA-05** (evento): QUANDO qualquer página é aberta, inclusive a de entrada, por quem não está autenticado, O SISTEMA DEVE ligar o ícone no `<head>` e responder 200 aos endereços dos três arquivos.
- [ ] **CA-06** (indesejado): SE o navegador pede `/favicon.ico`, ENTÃO O SISTEMA NÃO DEVE responder 404.

## 8. Plano de Testes (Test Plan)

- **Frontend, `src/app/icons.test.ts` (novo):** os três arquivos existem (CA-01); o SVG é quadrado, usa o amarelo e o preto do logo, tem fundo branco arredondado e não tem `<text>` nem `<image>` (CA-02); o `.ico` declara as imagens de 16, 32 e 48 px (CA-03); o PNG tem 180 × 180 px, lido do cabeçalho do arquivo (CA-04).
- **Manual (CA-05, CA-06 e a leitura visual):** com o servidor reiniciado, abrir a tela de entrada numa janela anônima, conferir o ícone na aba nos temas claro e escuro do navegador, abrir `/favicon.ico`, `/icon.svg` e `/apple-icon.png` direto no navegador (200) e ver no inspetor que o `<head>` tem os `link rel="icon"` e `apple-touch-icon`. Justificativa: o `<head>` e a leitura visual do ícone dependem do navegador e do servidor do Next.js, e não do código do projeto.
- **Cobertura:** não se aplica: a spec não adiciona código de produção, só arquivos estáticos.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md` e `frontend/public/utfpr-logo.svg`.
2. **Ordem de execução:** (1) escrever `icons.test.ts`, rodar e conferir o vermelho (os arquivos não existem) e commitar como `test`; (2) gerar o SVG a partir das três primeiras formas do logo, e o `.ico` e o `.png` a partir do SVG; (3) rodar o teste, o lint e a verificação de tipos; (4) commit `feat`; (5) roteiro manual; (6) status `Implementada`.
3. **Arquivos a criar:** `frontend/src/app/icon.svg`, `frontend/src/app/favicon.ico`, `frontend/src/app/apple-icon.png`, `frontend/src/app/icons.test.ts`. Nenhum outro arquivo deve mudar; o `layout.tsx` não precisa de `icons` no `metadata`.
4. **Definição de pronto:** todos os CA marcados, teste passando, ESLint e verificação de tipos sem erros, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 15/10/2026 | Aruna Architect | Criação em Rascunho, a pedido do Tech Lead, com o símbolo da UTFPR como decisão dele |
