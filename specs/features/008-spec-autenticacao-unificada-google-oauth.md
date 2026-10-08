# SPEC-008: Interface Unificada de Autenticação, Cadastro Dinâmico e Provedor Google OAuth2

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-008 |
| **Status** | Aprovada |
| **Data de criação** | 08/10/2026 |
| **Última revisão** | 08/10/2026 |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `auth` |
| **Contexto de tela** | `/login`, `/register` |
| **Prioridade** | Alta |
| **Depende de** | SPEC-003, SPEC-004 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | `docs/arquitetura/transicao-backend.md` (seção 3.1) |

---

## 1. Contexto e Problema (Context & Problem Statement)

Atualmente, o fluxo de entrada e registro de novos usuários possui interfaces fragmentadas e restringe-se a métodos locais de autenticação por identificador institucional e senha. Essa abordagem cria fricção inicial de acesso, eleva o tempo gasto por discentes na criação manual de contas e desconsidera padrões modernos de autenticação federada (Social Login via OpenID Connect/OAuth2).

Além disso, a existência de telas desvinculadas para entrar e registrar desfavorece a experiência em ambientes acadêmicos e laboratoriais. A ausência de suporte à federação com o Google impede que acadêmicos utilizem contas institucionais ou pessoais com um único clique, sobrecarregando mecanismos de redefinição de senhas. A falta de reconciliação automática entre contas pré-cadastradas por docentes (via importação CSV ou registro manual) e acessos originados via provedores externos provoca duplicidade cadastral ou bloqueio indevido de acadêmicos legítimos.

---

## 2. Objetivos (Goals)

* Unificar as interfaces visuais de acesso e registro sob a rota `/login`, provendo alternância contextual animada entre os modos de entrada e criação de conta.
* Integrar autenticação federada via Google (OAuth2/OIDC) intermediada pelo backend Go, delegando ao servidor a troca de código de autorização, validação de tokens e emissão de cookies de sessão seguros (`SameSite=Strict`).
* Atribuir automaticamente o papel de acesso `STUDENT` a qualquer novo usuário provisionado via provedor Google.
* Provisionar senha gerada aleatoriamente em formato hash para registros criados via Google, mantendo o indicador de troca compulsória de senha como falso.
* Unificar contas de forma transparente caso um usuário pré-cadastrado pela docente (via CSV ou manual) realize login com a conta Google compartilhando o mesmo endereço de e-mail.
* Tornar o preenchimento do Registro Acadêmico (`academic_id`) estritamente facultativo no formulário de cadastro manual e na federação Google, aplicando validação numérica de 7 dígitos apenas quando o dado for fornecido.
* Manter suporte integral às diretrizes visuais do ecossistema, incluindo paridade entre os modos Dark e Light via tokens semânticos e transições fluidas por SCSS Modules.

---

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

A solução concentra os fluxos de acesso na rota `/login` através de um contêiner reativo com suporte a transições CSS e co-location:

* **Componente Unificado de Autenticação (`AuthContainer`):**
* Mantém o estado da visualização ativa (`LOGIN` ou `REGISTER`), inicializado por padrão como `LOGIN`.
* Estrutura a casca visual com painel duplo: um painel de apresentação institucional e um painel dinâmico de formulários.
* Ao alternar entre login e cadastro, aciona classes CSS locais controladas por `@keyframes` e transições de translação/opacidade, deslocando suavemente os campos sem recarregar o navegador.
* Disponibiliza botão padronizado de autenticação federada ("Continuar com o Google"), persistindo a ação em ambos os modos.


* **Formulário de Entrada (`LoginForm`):**
* Campos: identificador unificado (e-mail ou RA) e senha.
* Botão de envio primário e atalho para o fluxo de esquecimento de senha.


* **Formulário de Cadastro (`RegisterForm`):**
* Campos: nome completo, endereço de e-mail institucional, RA (opcional, com máscara flexível) e senha com verificação de requisitos mínimos.
* Validação em tempo real garantindo que o RA, se preenchido, contenha 7 dígitos numéricos após desconsiderar prefixo.


* **Integração OAuth2 com o Google:**
* O botão de autenticação social redireciona a janela para a rota de inicialização exposta pelo backend Go, contendo parâmetros de escopo (`openid`, `profile`, `email`) e proteção contra falsificação de requisições cross-site via parâmetro `state`.


* **Serviços de Cliente HTTP e Redirecionamento:**
* A camada de serviços em `services/` processa as requisições de autenticação manual e cadastro tradicional.
* Em caso de sucesso, o estado de sessão é renovado e o navegador é direcionado à área principal da plataforma (`/app`).


* **Estilização e Temas (`AuthContainer.module.scss`):**
* Construído exclusivamente com tokens declarados em `_tokens.scss`.
* Superfícies, bordas de campos, sombras e destaques utilizam CSS Custom Properties, garantindo contraste equivalente nos temas claro e escuro.



### 3.2. Backend (Go — Camada de Módulo/Service)

A camada de retaguarda gerencia a máquina de estados de autenticação e os endpoints do ciclo OIDC:

* **Handlers de Federação Google:**
* Handler de Inicialização: gera parâmetro `state` criptográfico efêmero atrelado a cookie de curta duração e redireciona o cliente para o endpoint de autorização do Google.
* Handler de Callback: intercepta o retorno do Google, valida a integridade do parâmetro `state`, realiza a troca do código de autorização pelo token de identidade (ID Token), extrai e valida as declarações (claims) assinadas: e-mail, nome e confirmação de e-mail verificado.


* **Lógica de Domínio e Reconciliação no Service:**
* Caso o e-mail retornado pelo Google já exista na base de dados (criado via importação CSV ou cadastro docente), o serviço reconcilia a identidade, vincula o identificador federado se aplicável, atualiza o nome caso esteja pendente e valida o status da conta.
* Caso o e-mail não exista na base, o serviço provisiona um novo usuário atribuindo papel `STUDENT`, status ativo, preenchendo o nome fornecido pelo provedor, deixando o `academic_id` como nulo, gerando hash criptográfico de senha com entropia aleatória de alta complexidade e definindo a flag de troca compulsória de senha como falsa.
* Para cadastro manual via formulário, valida a presença dos campos obrigatórios, aplica a normalização do RA (descartando prefixo e checando 7 numerais se informado), gera o hash da credencial e cria o registro com papel `STUDENT`.


* **Emissão de Sessão e Cookies:**
* Ao concluir a autenticação (manual ou via Google), o serviço emite a sessão opaca, persiste o registro correspondente e grava o cookie seguro (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`).


* **Tratamento de Erros RFC 7807:**
* Mapeamento de falhas de comunicação com o provedor externo, incompatibilidade de estados OAuth2, duplicidade em cadastro tradicional e violações de regras de negócio em respostas Problem Details.



---

## 4. Modelo de Dados (Data Model)

Sem alteração de schema. A tabela `users` estruturada no schema `project-manager` absorve os registros federados utilizando o campo de e-mail corporativo/pessoal como chave natural de conciliação e o campo `password_hash` preenchido com entropia criptográfica segura, mantendo o campo `academic_id` como anulável para comportar cadastros sem RA obrigatório.

---

## 5. Contrato de API (API Contract)

### 5.1. GET /api/v1/auth/google/login

* **Objetivo:** Iniciar o fluxo federado OpenID Connect / OAuth2.
* **Entrada:** Nenhuma entrada via corpo. Aceita parâmetro opcional na query string para URL de redirecionamento pós-autenticação.
* **Saída Sucesso:** HTTP 307 Temporary Redirect para o provedor de identidade Google, acompanhado de cabeçalho `Set-Cookie` com token de estado de segurança.
* **Saída Erro:**
* HTTP 500 Internal Server Error (RFC 7807): falha na geração de parâmetros criptográficos ou variáveis de cliente não configuradas.



### 5.2. GET /api/v1/auth/google/callback

* **Objetivo:** Processar o retorno da autorização externa, reconciliar ou provisionar o usuário e emitir a sessão.
* **Entrada:** Query parameters obrigatórios contendo o código de autorização (`code`) e o verificador de estado (`state`).
* **Saída Sucesso:** HTTP 302 Found redirecionando para a rota interna da aplicação (`/app`), acompanhado de cabeçalho `Set-Cookie` com a sessão segura do sistema.
* **Saída Erro:**
* HTTP 400 Bad Request (RFC 7807): discrepância no parâmetro de estado ou código de autorização ausente.
* HTTP 401 Unauthorized (RFC 7807): falha na troca de tokens com o Google ou e-mail externo não verificado.
* HTTP 403 Forbidden (RFC 7807): conta existente associada ao e-mail encontra-se suspensa ou inativa.



### 5.3. POST /api/v1/auth/register

* **Objetivo:** Cadastro tradicional autônomo através do formulário em tela.
* **Entrada (Campos descritivos):**
* `name`: texto, obrigatório, nome completo do usuário.
* `email`: texto, formato de e-mail válido, obrigatório.
* `academicId`: texto, opcional, normalizado para 7 dígitos numéricos caso fornecido.
* `password`: texto, obrigatório, atendendo às políticas de complexidade vigentes.


* **Saída Sucesso:** HTTP 201 Created acompanhado de `Set-Cookie` com a sessão autenticada do novo estudante e corpo informando identificador do usuário, nome, e-mail e papel atribuído.
* **Saída Erro:**
* HTTP 400 Bad Request (RFC 7807): campos obrigatórios ausentes, RA malformado ou senha fora dos padrões de complexidade.
* HTTP 409 Conflict (RFC 7807): endereço de e-mail já cadastrado ou RA em uso por outra conta.



---

## 6. Impacto e Riscos (Impact & Risks)

* **Risco de Discrepância de E-mails entre Contas Google e Institucionais:** Alunos previamente cadastrados com e-mail acadêmico tentarem autenticar com conta Google pessoal contendo endereço diferente.
*Mitigação:* O sistema vinculará contas estritamente por coincidência exata de e-mail; caso o e-mail seja distinto, uma nova conta de estudante será provisionada de forma isolada, permitindo associação posterior caso o RA seja inserido.
* **Risco de Indisponibilidade dos Serviços do Google:** Falha momentânea de rede ou instabilidade na API OIDC externa impossibilitar entradas na plataforma.
*Mitigação:* Manter o formulário tradicional de login e cadastro totalmente operante e acessível na mesma interface, garantindo via alternativa de acesso.
* **Risco de Falsificação de Requisição em Fluxos OAuth2 (CSRF):** Interceptação de respostas de autorização por agentes maliciosos.
*Mitigação:* Implementar validação mandatória de token `state` assinado em cookie temporário `HttpOnly`, rejeitando qualquer callback divergente.

---

## 7. Critérios de Aceite (Acceptance Criteria)

* [ ] QUANDO a rota `/login` for acessada, O SISTEMA DEVE carregar a interface no modo de login por padrão, exibindo os campos de entrada e o botão de acesso via Google.
* [ ] QUANDO o usuário clicar na ação de alternância para cadastro, O SISTEMA DEVE executar transição visual animada sem recarregar a página e exibir o formulário de registro.
* [ ] QUANDO o usuário submeter o cadastro manual fornecendo nome, e-mail e senha válidos sem preencher o RA, O SISTEMA DEVE criar a conta com sucesso atribuindo papel `STUDENT` e emitir a sessão.
* [ ] QUANDO o usuário informar um RA no cadastro manual contendo prefixo alfanumérico e 7 numerais, O SISTEMA DEVE normalizar o valor gravando unicamente os dígitos numéricos.
* [ ] SE o RA informado no cadastro manual contiver quantidade de dígitos diferente de 7, ENTÃO O SISTEMA DEVE rejeitar a requisição com erro de validação sintática (RFC 7807).
* [ ] QUANDO o usuário acionar o botão de acesso via Google, O SISTEMA DEVE redirecionar para a página de autorização do provedor com os escopos adequados.
* [ ] QUANDO o retorno do Google for processado com sucesso para um e-mail inédito, O SISTEMA DEVE provisionar a conta como `STUDENT`, salvar uma senha aleatória em hash com flag de troca falsa, gerar a sessão e redirecionar para `/app`.
* [ ] QUANDO o retorno do Google corresponder a um e-mail já cadastrado previamente, O SISTEMA DEVE unificar o acesso autenticando o usuário sem duplicar a conta no banco de dados.
* [ ] SE a conta vinculada ao e-mail retornado pelo Google estiver suspensa ou inativa, ENTÃO O SISTEMA DEVE barrar o acesso e exibir mensagem de erro apropriada.
* [ ] QUANDO o tema for alternado entre claro e escuro, A INTERFACE DEVE manter a legibilidade, contraste dos campos e alinhamento visual utilizando exclusivamente tokens semânticos de `_tokens.scss`.

---

## 8. Plano de Testes (Test Plan)

### Backend

* Testar geração e validação do parâmetro `state` no ciclo OAuth2, garantindo rejeição quando o valor retornado for divergente ou inexistente.
* Testar handler de callback simulando resposta com e-mail inexistente, validando a criação da entidade com papel `STUDENT` e senha aleatória.
* Testar handler de callback simulando resposta com e-mail já existente na base, validando unificação cadastral e ausência de duplicações.
* Testar endpoint de cadastro manual sem informar `academicId`, certificando criação de conta com campo nulo e sessão ativa.
* Testar endpoint de cadastro manual fornecendo `academicId` válido e inválido, atestando a normalização e o bloqueio de formatos fora do padrão.

### Frontend

* Testar renderização da tela de login nos modos Dark e Light, certificando paridade cromática sem valores fixos de cor.
* Executar teste de componente para alternância de modo (Login para Cadastro e vice-versa), verificando aplicação das classes de animação e foco acessível.
* Validar acionamento do botão Google assegurando o encaminhamento correto para a rota de inicialização do backend.
* Simular submissão de cadastro manual verificando tratamento de erros de validação da API e exibição de mensagens amigáveis em tela.

---

## 9. Contexto Final da IA (AI Final Context Execution)

Para implementar esta especificação, atue no backend e frontend respeitando as camadas arquiteturais. Configure no backend o cliente OIDC do Google integrado ao módulo de autenticação e exponha as rotas de inicialização e callback; no frontend, construa os formulários co-localizados dentro de `/login`, implementando as transições visuais em SCSS Modules.

Arquivos e pacotes a criar ou alterar:

* `backend/internal/platform/config/config.go`
* `backend/internal/platform/config/config_test.go`
* `backend/internal/modules/auth/domain/oauth.go`
* `backend/internal/modules/auth/domain/oauth_test.go`
* `backend/internal/modules/auth/service/service.go`
* `backend/internal/modules/auth/service/service_test.go`
* `backend/internal/modules/auth/service/google_oauth.go`
* `backend/internal/modules/auth/service/google_oauth_test.go`
* `backend/internal/modules/auth/handler/handler.go`
* `backend/internal/modules/auth/handler/handler_test.go`
* `backend/cmd/api/main.go`
* `frontend/src/services/authService.ts`
* `frontend/src/services/authService.test.ts`
* `frontend/src/messages/pt-BR.ts`
* `frontend/src/components/GoogleAuthButton/GoogleAuthButton.tsx`
* `frontend/src/components/GoogleAuthButton/GoogleAuthButton.module.scss`
* `frontend/src/components/GoogleAuthButton/GoogleAuthButton.test.tsx`
* `frontend/src/components/RegisterForm/RegisterForm.tsx`
* `frontend/src/components/RegisterForm/RegisterForm.module.scss`
* `frontend/src/components/RegisterForm/RegisterForm.test.tsx`
* `frontend/src/components/AuthContainer/AuthContainer.tsx`
* `frontend/src/components/AuthContainer/AuthContainer.module.scss`
* `frontend/src/components/AuthContainer/AuthContainer.test.tsx`
* `frontend/src/app/login/page.tsx`
* `frontend/src/app/login/page.test.tsx`
* `frontend/src/app/register/page.tsx`
* `frontend/src/app/register/page.test.tsx`

Dependências de execução: Esta especificação estende o módulo `auth` estruturado a partir da SPEC-004 e complementa a SPEC-003, consumindo o schema existente e respeitando as definições de sessões seguras em cookies HttpOnly.

---

## 10. Pendências (Open Issues / Questions)

Nenhuma pendência em aberto. Spec aprovada para implementação.