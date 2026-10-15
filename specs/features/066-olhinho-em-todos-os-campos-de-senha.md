# SPEC-066: Olhinho para ver a senha em todos os campos de senha

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-066 |
| **Status** | Implementada |
| **Data de criação** | 15/10/2026 |
| **Última revisão** | 15/10/2026 (implementada) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend |
| **Módulo** | `PasswordField` |
| **Contexto de tela** | Todas as telas com campo de senha: entrada, cadastro, redefinição de senha, troca de senha e autocadastro por convite (`/invite/[token]`) |
| **Prioridade** | Média |
| **Depende de** | SPEC-002, SPEC-003 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead em 15/10/2026: "onde tiver os inputs de senha, deve ter o olinho para visualizar a senha" |

---

## 1. Contexto e Problema (Context & Problem Statement)

Quase todos os campos de senha da plataforma usam o componente `PasswordField`, que tem um botão para mostrar e ocultar a senha. Há duas lacunas:

- O formulário de autocadastro por convite (`/invite/[token]`) usa um campo de senha comum, sem o botão. O estudante digita a senha às cegas, justamente na tela em que cria a conta.
- O botão do `PasswordField` desenha os caracteres `◎` (senha oculta) e `◉` (senha visível). Não lembram um olho, e o estado muda só pelo preenchimento do círculo, difícil de perceber.

## 2. Objetivos (Goals)

- Todo campo de senha da interface tem o botão de olho para mostrar e ocultar o valor, inclusive o do convite.
- O botão desenha um olho de verdade: olho aberto com a senha oculta, olho riscado com a senha visível.

### 2.1. Fora de escopo (Non-Goals)

- Mudar as regras de validação da senha, o fluxo de cadastro por convite ou qualquer serviço de rede.
- Converter os demais campos do formulário do convite (nome, RA, e-mail, WhatsApp, Discord) para `TextField`.
- Mudar os textos "Mostrar senha" e "Ocultar senha", que já existem no arquivo de mensagens.
- Mexer em `frontend/src/engine/core/` (o motor do terminal simulado).
- Adicionar biblioteca de ícones.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Ícone:** o botão do `PasswordField` passa a desenhar o olho em SVG embutido no próprio componente, do mesmo modo que os ícones do `ClassCard` (traço na cor do texto, escondido de leitores de tela). Com a senha oculta, olho aberto; com a senha visível, olho riscado. O botão continua com o mesmo tamanho, posição, foco e cores por tokens.
- **Acessibilidade:** o botão continua com o nome acessível "Mostrar senha" quando a senha está oculta e "Ocultar senha" quando está visível, e com o estado de pressionado coerente. O tamanho mínimo de alvo de toque do botão atual é mantido.
- **Convite:** o campo de senha de `/invite/[token]` passa a ser um `PasswordField`, com o mesmo rótulo, o mesmo valor controlado, a obrigatoriedade e o preenchimento automático adequados a uma senha nova. O restante da página não muda.
- Temas claro e escuro: o ícone usa a cor de texto do tema, sem cores literais.

### 3.2. Backend

Não se aplica nesta spec.

## 4. Modelo de Dados (Data Model)

Não se aplica nesta spec: não há mudança de schema.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: nenhum endpoint muda.

## 6. Impacto e Riscos (Impact & Risks)

- **Visual do convite:** o campo de senha passa a usar o estilo do `TextField`, e os vizinhos da página usam o estilo próprio dela, então a senha pode ficar um pouco diferente. Mitigação: conferir a página nos dois temas no roteiro manual e fazer o ajuste mínimo de estilo da página, sem converter os outros campos.
- **Testes existentes do convite:** localizam o campo pelo rótulo "Senha". Mitigação: o `PasswordField` mantém o rótulo ligado ao campo, e os testes existentes devem continuar verdes sem alteração.
- **Segurança:** mostrar a senha é uma ação local do navegador, sem envio de dados. O campo volta a ocultar o valor ao ser acionado de novo.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (ubíquo): O SISTEMA DEVE ter, em todo campo de senha da interface (entrada, cadastro, redefinição, troca de senha e convite), um botão que mostra e oculta o valor digitado.
- [x] **CA-02** (estado): ENQUANTO a senha está oculta, O SISTEMA DEVE mostrar o campo como senha, o ícone de olho aberto e o botão com o nome "Mostrar senha" e não pressionado.
- [x] **CA-03** (evento): QUANDO o usuário aciona o botão com a senha oculta, O SISTEMA DEVE mostrar o valor em texto, trocar o ícone para olho riscado e o nome do botão para "Ocultar senha", pressionado.
- [x] **CA-04** (evento): QUANDO o usuário aciona o botão com a senha visível, O SISTEMA DEVE voltar a ocultar o valor e restaurar o ícone e o nome do estado oculto.
- [x] **CA-05** (ubíquo): O SISTEMA DEVE desenhar o ícone em SVG, escondido de leitores de tela e na cor do texto do tema, e NÃO DEVE usar os caracteres `◎` e `◉`.
- [x] **CA-06** (ubíquo): O SISTEMA NÃO DEVE alterar o valor digitado ao mostrar ou ocultar a senha.
- [x] **CA-07** (ubíquo): O SISTEMA DEVE manter o rótulo, a obrigatoriedade e o fluxo de cadastro do convite como estão hoje, incluindo o envio da senha digitada.

## 8. Plano de Testes (Test Plan)

- **Frontend, `PasswordField.test.tsx` (novo):**
  - com a senha oculta, o campo é do tipo senha, o botão se chama "Mostrar senha", não está pressionado e tem um ícone SVG (cobre CA-02, CA-05);
  - ao acionar o botão, o campo vira texto, o botão passa a "Ocultar senha", pressionado, e o ícone muda (cobre CA-03);
  - ao acionar de novo, volta ao estado oculto (cobre CA-04);
  - o valor digitado é o mesmo nos dois estados (cobre CA-06);
  - o botão não contém os caracteres `◎` nem `◉` (cobre CA-05).
- **Frontend, `invite/[token]/page.test.tsx`:**
  - o campo de senha do convite tem o botão "Mostrar senha" e ele alterna o campo entre senha e texto (cobre CA-01);
  - os testes existentes de envio, validação e erro seguem verdes, sem alteração (cobre CA-07).
- **Frontend, `LoginForm.test.tsx`:** o teste existente de mostrar e ocultar a senha segue verde (cobre CA-01 na entrada).
- **Manual (CA-01 nas demais telas):** abrir entrada, cadastro, redefinição, troca de senha e convite, nos temas claro e escuro, e conferir que cada campo de senha tem o olhinho e que ele alterna. Justificativa: cadastro, redefinição e troca de senha já usam o mesmo componente e herdam os testes dele.
- **Cobertura:** acima de 80% no escopo da spec, medida com o Vitest em modo de cobertura.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, `PasswordField.tsx` e seu estilo, `TextField.tsx`, os ícones do `ClassCard.tsx` como modelo de SVG, e a página e o teste do convite.
2. **Ordem de execução:** (1) escrever `PasswordField.test.tsx` e os testes novos do convite, rodar e conferir o vermelho pelo motivo certo; (2) commit `test(frontend)`; (3) trocar o ícone no `PasswordField`; (4) trocar o campo de senha do convite pelo `PasswordField`; (5) rodar testes, lint, Stylelint e verificação de tipos; (6) commit `feat(frontend)`; (7) status `Implementada` e histórico.
3. **Arquivos a criar ou alterar:** `frontend/src/components/PasswordField/PasswordField.tsx`, `PasswordField.module.scss` (só se preciso), `PasswordField.test.tsx` (novo), `frontend/src/app/invite/[token]/page.tsx`, a folha de estilo da página do convite (só se preciso, para limpar o estilo que ficar sem uso), `frontend/src/app/invite/[token]/page.test.tsx`. Qualquer outro arquivo exige justificativa na entrega.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, ESLint e Stylelint sem erros, nenhuma violação de `specs/ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 15/10/2026 | Aruna Architect | Criação em Rascunho, a pedido do Tech Lead |
| 15/10/2026 | Aruna Architect | Aprovada pelo Tech Lead ("Sim chat, pode ir fazendo em ordem") |
| 15/10/2026 | Implementador | Implementada: olho em SVG (aberto e riscado) no `PasswordField` e o campo de senha do convite passou a usar o `PasswordField`. Os 7 critérios têm teste automatizado (41 testes dos formulários de senha passando); a conferência visual nos temas claro e escuro e no celular, em especial do campo do convite ao lado dos vizinhos, fica para o Tech Lead, porque a extensão do navegador não estava conectada |
