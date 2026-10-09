# SPEC-017: Leitura Guiada por Voz (Síntese de Fala com Marcas de Palavra)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-017 |
| **Status** | Implementada |
| **Data de criação** | 09/10/2026 |
| **Última revisão** | 09/10/2026 |
| **Autor** | Implementador (Claude), a pedido do Tech Lead |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Backend |
| **Módulo** | `tts` (novo módulo de domínio) e adaptador `speech` em `platform` |
| **Contexto de tela** | Não se aplica nesta spec (o consumo na interface fica para spec própria, SPEC-018) |
| **Prioridade** | Média |
| **Depende de** | SPEC-003 (sessão e papéis), SPEC-012 (conteúdo lido em voz alta) |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Proposta de serviço de leitura do Tech Lead (texto colado na conversa de 09/10/2026), `specs/ARCHITECTURE.md` (seções 3.2 a 3.10 e 5) |

---

## 1. Contexto e Problema (Context & Problem Statement)

O conteúdo didático da plataforma (SPEC-012) é longo e denso para um estudante que lê na tela. Ouvir o texto enquanto acompanha a leitura, com a palavra falada destacada, ajuda quem tem dificuldade de leitura, quem estuda em laboratório sem tempo de ler tudo e quem aprende melhor ouvindo.

Hoje não existe nenhuma forma de gerar áudio do conteúdo. Para destacar a palavra que está sendo falada, não basta o áudio: é preciso saber em que instante (em milissegundos) cada palavra começa e termina.

A proposta original era um serviço separado, em outra porta e com Dockerfile próprio, que usa o serviço de voz neural do navegador Microsoft Edge pelo protocolo WebSocket. Esta spec mantém a ideia, mas a encaixa no monólito modular da plataforma (`ARCHITECTURE.md`, seção 1: serviço único em Go), com as regras de camadas, erros, logs e testes do repositório.

## 2. Objetivos (Goals)

- Receber um texto simples e devolver o áudio falado em português do Brasil, junto com o instante inicial e final de cada palavra.
- Expor isso em uma única rota REST autenticada, no padrão do repositório (Gin, RFC 7807, logs com Zap).
- Isolar o provedor de voz atrás de uma interface, de modo que trocá-lo (ou desligá-lo) não exija mudar a regra de negócio.
- Proteger a plataforma contra uso abusivo (limite de tamanho, limite de taxa e de concorrência, prazo máximo por chamada).
- Montar o SSML com escape correto do texto, de modo que nenhum texto de entrada consiga alterar a estrutura do documento enviado ao provedor.

### 2.1. Fora de escopo (Non-Goals)

- **Interface:** botão "Ouvir", player de áudio e destaque da palavra na tela (spec própria, SPEC-018).
- **Serviço separado:** não há segundo executável, segunda porta nem Dockerfile novo. O módulo roda no `backend/` existente.
- **Persistência e cache:** o áudio não é gravado em banco nem em MinIO, e não há cache de áudio no servidor. Não há migração de schema.
- **Streaming:** a resposta é única, depois de a síntese terminar. Não há entrega parcial do áudio.
- **Vozes além da lista da RN-03**, ajuste de velocidade, tom ou volume, e outros idiomas.
- **Leitura de HTML:** o corpo recebe texto simples. Extrair texto dos blocos HTML é responsabilidade do consumidor.
- **Correção de avaliações:** a leitura em voz alta nunca participa de correção, nota ou prova.
- **Alterar `legacy/`.**

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Não se aplica nesta spec: o escopo é só o backend. O contrato da seção 5 já traz tudo o que a interface precisa (áudio e marcas de palavra), e o consumo entra em spec própria.

### 3.2. Backend (Go — Camada de Módulo/Service)

**Estrutura:**

| Camada | Local | Responsabilidade |
| :--- | :--- | :--- |
| domain | `backend/internal/modules/tts/domain` | Entidades `SpeechSynthesis` e `WordTiming`, lista de vozes, limites e erros de domínio |
| service | `backend/internal/modules/tts/service` | Regras RN-01 a RN-08. Declara a interface do provedor que consome |
| handler | `backend/internal/modules/tts/handler` | Rota 5.1, validação sintática, tradução de erros para RFC 7807 |
| adaptador do provedor | `backend/internal/platform/speech` | Cliente WebSocket do provedor de voz. É infraestrutura transversal (como `mailer` e `storage`), por isso fica em `platform` |

O módulo `tts` não tem `repository`, porque não persiste nada.

**Regras de negócio:**

- **RN-01 (texto obrigatório):** o texto, depois de remover espaços das pontas, não pode ser vazio.
- **RN-02 (tamanho máximo):** o texto tem no máximo 2000 caracteres (contados em letras Unicode, não em bytes). Acima disso a requisição é recusada, nunca truncada.
- **RN-03 (vozes permitidas):** a voz é escolhida de uma lista fechada: `pt-BR-FranciscaNeural` (padrão) e `pt-BR-AntonioNeural`. Voz ausente usa a padrão. Voz fora da lista é recusada. O nome da voz nunca vem de texto livre do cliente para dentro do SSML.
- **RN-04 (escape do SSML):** antes de entrar no SSML, o texto passa por duas etapas, nesta ordem:
  1. remoção dos caracteres que o XML 1.0 não admite (controles de U+0000 a U+001F, exceto tabulação, quebra de linha e retorno de carro, e os não-caracteres U+FFFE e U+FFFF);
  2. escape dos cinco caracteres reservados do XML: `&`, `<`, `>`, aspa dupla e aspa simples.
  Consequência: um texto como `a < b & c` é falado como tal e nunca é interpretado como marcação. O escape é feito pelo serviço, com a biblioteca padrão de XML, e não por concatenação de texto.
- **RN-05 (prazo e cancelamento):** cada síntese tem prazo máximo de 15 segundos e respeita o `context.Context` da requisição. Se o cliente desistir, a conexão com o provedor é fechada.
- **RN-06 (resposta completa ou erro):** a síntese só é bem-sucedida se o provedor sinalizar o fim normal do turno de fala e entregar pelo menos um quadro de áudio. Conexão que cai antes do fim, ou áudio vazio, é erro (502), nunca uma resposta de sucesso com áudio parcial.
- **RN-07 (marcas de palavra):** cada palavra devolvida traz o texto, o instante inicial e o instante final em milissegundos inteiros, na ordem em que são faladas. O provedor informa tempos em unidades de 100 nanossegundos; a conversão é dividir por 10.000.
- **RN-08 (proteção contra abuso):**
  - limite de taxa por usuário autenticado: 20 requisições por minuto;
  - limite de concorrência global: no máximo 4 sínteses ao mesmo tempo; acima disso responde 503 imediatamente, sem enfileirar.

**Autorização:** a rota exige sessão autenticada e senha já trocada (`authn.Required` e `authn.PasswordChanged`, como as demais rotas privadas). Qualquer papel (`ADMIN`, `TEACHER`, `STUDENT`) pode usar. Visitante sem sessão recebe 401 (P-02).

**Falha do provedor não derruba a plataforma:** o provedor é um serviço externo não oficial (seção 6). Se ele estiver fora, só esta rota falha (502 ou 503); a plataforma sobe e funciona normalmente, no mesmo espírito do MinIO (`cmd/api/main.go`). Não há verificação de saúde que chame o provedor.

**Logs (Zap, seção 3.10 do `ARCHITECTURE.md`):** um erro é registrado uma só vez, no handler, com `zap.Error`. O texto enviado **não** é registrado; só o tamanho em caracteres, a voz e a duração da chamada.

**Configuração (`platform/config`):** `TTS_TIMEOUT` (padrão 15s) e `TTS_MAX_CONCURRENT` (padrão 4). Valores inválidos entram na lista de problemas de configuração, como as demais variáveis.

## 4. Modelo de Dados (Data Model)

Não há mudança de schema, nem tabela nova, nem migração: nada é persistido. As estruturas abaixo existem só em memória, durante a requisição.

**`SpeechSynthesis`** (resultado da síntese):

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `audio` | bytes | Sim | Não vazio (RN-06) | Áudio MP3 completo |
| `mimeType` | texto | Sim | Valor fixo `audio/mpeg` | Formato do áudio |
| `words` | lista de `WordTiming` | Sim | Pode ser vazia (RN-07) | Marcas de palavra na ordem de fala |

**`WordTiming`** (marca de palavra):

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `word` | texto | Sim | | Palavra como falada |
| `startMs` | inteiro | Sim | maior ou igual a 0 | Início, em milissegundos desde o começo do áudio |
| `endMs` | inteiro | Sim | maior ou igual a `startMs` | Fim, em milissegundos |

**Voz permitida (enumeração em código):** `pt-BR-FranciscaNeural` (padrão) e `pt-BR-AntonioNeural`.

## 5. Contrato de API (API Contract)

### 5.1. `POST /api/v1/speech-syntheses`

Gera o áudio falado de um texto e as marcas de palavra. Não cria recurso persistido; responde 200.

- **Papéis autorizados:** `ADMIN`, `TEACHER`, `STUDENT` (sessão autenticada, senha já trocada).
- **Parâmetros de rota e de query:** nenhum.
- **Corpo da requisição:**

| Campo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| `text` | texto | Sim | Texto simples. Não vazio depois de aparar (RN-01), no máximo 2000 caracteres (RN-02) |
| `voice` | texto | Não | Uma das vozes da RN-03. Ausente usa `pt-BR-FranciscaNeural` |

- **Resposta de sucesso** (200):

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `audioBase64` | texto | Sim | Áudio MP3 em Base64 padrão, **sem** o prefixo `data:`. O consumidor monta o `data:` URL ou decodifica |
| `mimeType` | texto | Sim | Sempre `audio/mpeg` |
| `voice` | texto | Sim | A voz efetivamente usada |
| `words` | lista de { `word`, `startMs`, `endMs` } | Sim | Marcas de palavra (RN-07). Lista vazia se o provedor não as enviar |

- **Erros (RFC 7807):**

| HTTP | `type` (slug do problema) | Quando ocorre |
| :--- | :--- | :--- |
| 400 | `validation-error` | Corpo que não é um JSON com `text`, `text` vazio ou maior que 2000 caracteres, ou `voice` fora da lista (com a lista de campos inválidos) |
| 401 | `not-authenticated` | Sem sessão |
| 403 | `password-change-required` | Sessão com troca de senha pendente (comportamento do middleware existente) |
| 429 | `rate-limited` | Limite de taxa da RN-08 excedido (com `Retry-After`) |
| 502 | `speech-provider-failed` | Provedor recusou, caiu antes do fim ou devolveu áudio vazio (RN-06) |
| 503 | `speech-busy` | Limite de concorrência da RN-08 atingido |
| 503 | `speech-unavailable` | Provedor inalcançável |
| 504 | `speech-timeout` | Prazo da RN-05 estourado |

## 6. Impacto e Riscos (Impact & Risks)

**Impacto nos módulos existentes:** nenhum comportamento muda. Mudam, de forma aditiva, `cmd/api/main.go` (montagem do módulo), `platform/config` (duas variáveis) e `go.mod` (dependências aprovadas, P-01). O `legacy/` não é tocado.

- **Endpoint não oficial do provedor.** O serviço de voz do Edge não é uma API pública documentada nem tem contrato de nível de serviço. A Microsoft pode mudar o protocolo, exigir novos tokens de handshake (já houve bloqueio por validação de relógio e token), limitar por origem ou bloquear sem aviso, e os termos de uso do serviço para uso fora do navegador devem ser conferidos antes de qualquer uso além do acadêmico (TCC).
  *Mitigação:* o provedor fica atrás de uma interface no `platform/speech`, trocável por um provedor oficial (ex.: Azure Speech) sem alterar `tts`; falhas viram 502/503 isolados da plataforma (seção 3.2); o risco e a decisão de usar o endpoint ficam registrados nesta spec e na monografia.
- **Texto enviado a terceiro.** O texto lido sai da plataforma para servidores da Microsoft.
  *Mitigação:* a spec só autoriza conteúdo didático público ou do módulo; não há texto de avaliação, gabarito nem dado pessoal no caso de uso. O texto não é registrado nos logs (seção 3.2). O consumidor (spec da interface) não deve enviar nomes, e-mails ou respostas de estudantes.
- **Injeção de marcação no SSML.** Montar o SSML por concatenação permitiria que o texto fechasse a tag `voice` e inserisse outra voz, prosódia ou marcação.
  *Mitigação:* RN-04 (remoção de caracteres inválidos e escape dos cinco reservados) e RN-03 (voz de lista fechada); testes dedicados (CA-04, CA-05).
- **Uso da rota como TTS gratuito de terceiros.** Uma rota que converte texto qualquer em áudio atrai abuso e consome a cota do provedor.
  *Mitigação:* exige sessão (RN-08), limite por usuário, limite global de concorrência, tamanho máximo e prazo.
- **Áudio parcial tratado como sucesso.** Laço de leitura que sai em qualquer erro de leitura e devolve o que juntou entrega áudio cortado sem aviso.
  *Mitigação:* RN-06; teste com conexão que cai no meio (CA-07).
- **Quadros do provedor em formato diferente do esperado.** O formato dos quadros de metadados (corpo, nomes dos campos, necessidade de pedir marcas de palavra na mensagem de configuração) pode diferir do que a proposta original assume, e as marcas viriam vazias sem erro.
  *Mitigação:* o implementador verifica o formato contra quadros reais e grava quadros de exemplo como arquivos de teste; o conversor de quadros é função pura, testada com esses exemplos (CA-06). Se a biblioteca escolhida não oferecer o que a seção 3.2 exige, o implementador para e pergunta (P-01).
- **Pressão de memória.** O áudio é montado inteiro em memória e codificado em Base64 (cerca de 33% maior). Com 2000 caracteres o áudio fica na casa de 1 MB.
  *Mitigação:* limite de texto e de concorrência (RN-02 e RN-08) fixam o teto de memória; sem streaming nesta spec.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO um usuário autenticado enviar um texto válido, O SISTEMA DEVE responder 200 com `audioBase64` não vazio, `mimeType` igual a `audio/mpeg`, a voz usada e as marcas de palavra.
- [ ] **CA-02** (indesejado): SE o texto for vazio ou só espaços, ENTÃO O SISTEMA DEVE responder 400 `validation-error` sem chamar o provedor (RN-01).
- [ ] **CA-03** (indesejado): SE o texto tiver mais de 2000 caracteres, ENTÃO O SISTEMA DEVE responder 400 `validation-error` sem truncar e sem chamar o provedor (RN-02). Texto de exatamente 2000 caracteres acentuados, que passam de 2000 bytes, DEVE ser aceito.
- [ ] **CA-04** (ubíquo): O SISTEMA DEVE enviar ao provedor um SSML em que o texto do usuário aparece com `&`, `<`, `>`, aspa dupla e aspa simples escapados, de modo que um texto como `</voice><voice name="x">` não altere a estrutura do documento (RN-04).
- [ ] **CA-05** (ubíquo): O SISTEMA DEVE remover do texto os caracteres inválidos em XML 1.0 antes de montar o SSML, preservando tabulação, quebra de linha e acentos (RN-04).
- [ ] **CA-06** (evento): QUANDO o provedor enviar marcas de palavra, O SISTEMA DEVE devolvê-las na ordem de fala, com `startMs` e `endMs` convertidos de unidades de 100 ns para milissegundos (RN-07).
- [ ] **CA-07** (indesejado): SE a conexão com o provedor cair antes do fim do turno de fala, ou o áudio vier vazio, ENTÃO O SISTEMA DEVE responder 502 `speech-provider-failed` e NÃO DEVE devolver áudio parcial (RN-06).
- [ ] **CA-08** (indesejado): SE a síntese passar do prazo, ENTÃO O SISTEMA DEVE responder 504 `speech-timeout` e fechar a conexão com o provedor (RN-05).
- [ ] **CA-09** (indesejado): SE a voz não pertencer à lista permitida, ENTÃO O SISTEMA DEVE responder 400 `validation-error`; QUANDO a voz estiver ausente, DEVE usar `pt-BR-FranciscaNeural` (RN-03).
- [ ] **CA-10** (indesejado): SE não houver sessão, ENTÃO O SISTEMA DEVE responder 401 `not-authenticated` sem chamar o provedor.
- [ ] **CA-11** (estado): ENQUANTO houver 4 sínteses em andamento, O SISTEMA DEVE responder 503 `speech-busy` a uma nova requisição, sem enfileirá-la (RN-08).
- [ ] **CA-12** (indesejado): SE um usuário passar de 20 requisições por minuto, ENTÃO O SISTEMA DEVE responder 429 `rate-limited` com `Retry-After` (RN-08).
- [ ] **CA-13** (indesejado): SE o provedor estiver inalcançável, ENTÃO O SISTEMA DEVE responder 503 `speech-unavailable`, e a plataforma DEVE continuar atendendo as demais rotas.
- [ ] **CA-14** (ubíquo): O SISTEMA NÃO DEVE registrar o texto da síntese em nenhum log, apenas tamanho, voz e duração (seção 3.2).

## 8. Plano de Testes (Test Plan)

- **Backend (service):** testes de unidade com um provedor de teste escrito à mão sobre a interface que o service declara, sem rede. Cobrem RN-01 a RN-04 e RN-08: texto vazio, limite de 2000 caracteres com e sem acentos, voz padrão e voz inválida, escape e remoção de caracteres (entradas com `&`, `<`, `>`, aspas, `</voice>` e caracteres de controle, comparando o SSML recebido pelo provedor de teste), limite de concorrência. Cobrem CA-02, CA-03, CA-04, CA-05, CA-09 e CA-11.
- **Backend (handler):** `httptest` contra o roteador Gin real, com service de teste. Conferem status HTTP e envelope RFC 7807 de cada erro da seção 5.1, os campos da resposta de sucesso e a ausência de sessão. Cobrem CA-01, CA-02, CA-03, CA-09, CA-10, CA-12 e o mapeamento de erros de CA-07, CA-08 e CA-13.
- **Backend (adaptador `platform/speech`):** servidor WebSocket local de teste (`httptest` com upgrade) que reproduz os quadros do provedor a partir de arquivos de exemplo: áudio em partes, metadados com marcas de palavra e fim de turno. Cenários: fluxo completo (CA-01, CA-06), queda no meio (CA-07), prazo estourado (CA-08), provedor inalcançável (CA-13) e áudio vazio (CA-07). A conversão de quadros é testada como função pura.
- **Log:** teste que captura a saída do logger em memória e confirma que o texto enviado não aparece (CA-14).
- **Manual (uma vez, fora da suíte):** com o backend rodando e acesso à internet, chamar a rota com um parágrafo de um módulo real, tocar o áudio decodificado e conferir que as marcas de palavra acompanham a fala. Registrar o resultado no histórico. Este roteiro valida o provedor real, que os testes automatizados não acessam.
- **Cobertura:** meta acima de 80% em `domain`, `service` e `handler` do módulo `tts` (`ARCHITECTURE.md`, seção 5), medida com `go test -cover`. `platform/speech` fica fora do limite, mas leva os testes acima.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md` (seções 3 e 5), `specs/GLOSSARY.md`; do código: `backend/internal/modules/content/handler/handler.go` (padrão de handler, `authn` e `fail`), `backend/internal/platform/problem/problem.go`, `backend/internal/platform/ratelimit`, `backend/internal/platform/config/config.go` e `backend/cmd/api/main.go`.
2. **Ordem de execução:**
   1. verificar a API da biblioteca (P-01) e o protocolo o protocolo do provedor com quadros reais (gravar os exemplos de teste);
   2. `domain`: entidades, vozes, limites e erros;
   3. `platform/speech`: adaptador do provedor e conversão de quadros;
   4. `service`: RN-01 a RN-08, com a interface do provedor declarada no próprio service;
   5. `handler`: rota 5.1 e tradução de erros;
   6. `platform/config`: `TTS_TIMEOUT` e `TTS_MAX_CONCURRENT`;
   7. composition root em `cmd/api/main.go`;
   8. glossário: os termos `SpeechSynthesis`, `WordTiming` e `Voice` já estão na seção 3.2 como Proposto; já Decidido.
3. **Arquivos e diretórios a criar ou alterar:**
   - criar `backend/internal/modules/tts/{domain,service,handler}/` com seus testes;
   - criar `backend/internal/platform/speech/` com seus testes e quadros de exemplo;
   - alterar `backend/internal/platform/config/config.go` (e o teste), `backend/cmd/api/main.go`, `backend/go.mod` e `backend/go.sum`;
   - alterar `specs/GLOSSARY.md` (seção 3.2) e `.env.example` (as duas variáveis novas).
   Qualquer outro arquivo exige justificativa no resumo da entrega.
4. **Definição de pronto:** CA-01 a CA-14 verificados, testes da seção 8 passando, cobertura acima de 80% nos pacotes indicados, nenhuma violação de `ARCHITECTURE.md` (sem logger global, sem `fmt.Print`, erro registrado uma só vez, mensagens e identificadores em inglês), roteiro manual registrado e status atualizado para `Implementada`.

## 10. Pendências para aprovação

Nenhuma. P-01 a P-05 aprovadas pelo Tech Lead em 09/10/2026, nas recomendações:

- **P-01:** dependências `github.com/acheong08/edge-tts-go` e `github.com/gorilla/websocket`, em versão fixa e restritas ao pacote `platform/speech`. Se a API real da biblioteca divergir da assumida, o implementador para e pergunta.
- **P-02:** rota só para usuários autenticados.
- **P-03:** 2000 caracteres, 20 requisições por minuto por usuário, 4 sínteses simultâneas e prazo de 15 s.
- **P-04:** a interface (botão "Ouvir", player e destaque da palavra) fica para a SPEC-018.
- **P-05:** risco do endpoint não oficial aceito enquanto o uso for acadêmico (TCC).

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 09/10/2026 | Implementador (Claude) | Criação, a pedido do Tech Lead, a partir da proposta de serviço de leitura colada na conversa. Adaptações ao padrão do repositório: módulo `tts` em Gin com adaptador em `platform/speech` (em vez de serviço separado em `net/http`), rota em `/api/v1/speech-syntheses`, campos em camelCase com tempos em milissegundos inteiros, escape de SSML e remoção de caracteres inválidos (RN-04), voz de lista fechada, resposta completa ou erro (RN-06), limites de taxa e concorrência, sem CORS próprio (o frontend acessa pelo proxy do Next.js, como as demais rotas). Pendências P-01 a P-05 |
| 09/10/2026 | Tech Lead | Aprovação de P-01 a P-05 nas recomendações. Status: `Aprovada` |
| 09/10/2026 | Implementador (Claude) | Implementação concluída; status `Implementada`. **Verificação:** cobertura de 100% em `tts/domain` e `tts/handler`, 97,4% em `tts/service` e 92,6% em `platform/speech`; suíte completa do backend (`go test -race ./...`) sem falhas e `go vet` limpo. **CA → testes:** CA-01 `TestSynthesizeSuccess` (handler e service) e `TestSynthesizeFullTurn`; CA-02, CA-03 e CA-09 `TestSynthesizeValidation` (service e handler) e `TestSynthesizeLimitCountsRunes`; CA-04 e CA-05 `TestBuildSSMLEscapesAndSanitizes`; CA-06 `TestSynthesizeFullTurn`; CA-07 `TestSynthesizeFailures` e `TestSynthesizeRejectsOversizedAudio`; CA-08 `TestSynthesizeDeadline` e `TestSynthesizeProviderErrors`; CA-10 `TestSynthesizeRequiresSession`; CA-11 `TestSynthesizeConcurrencyLimit`; CA-12 `TestSynthesizeRateLimit`; CA-13 `TestSynthesizeUnreachable`; CA-14 `TestSynthesizeDoesNotLogText`. **Roteiro manual** (provedor real, internet): síntese de um texto com `</voice><voice name="x"> & a < b` pela pilha service + adaptador devolveu 41 KB de áudio MP3 e 15 marcas de palavra em ordem, e o texto hostil foi falado literalmente, sem alterar a voz. Tocar o áudio no navegador fica para a SPEC-018. **Desvios:** (1) a biblioteca `edge-tts-go` da P-01 não existe; `github.com/lib-x/edgetts` (v0.3.10) foi inspecionada e só expõe o áudio, sem `WordBoundary` nem `context` (tudo em `internal/`), então, com a autorização do Tech Lead, foi usada a Opção B: protocolo direto com `gorilla/websocket` v1.5.3 (única dependência nova), com a biblioteca só como referência do handshake (token `Sec-MS-GEC`), sem copiar código; (2) a mensagem de configuração, o formato `{"Metadata":[...]}` dos metadados e o texto da palavra com escape XML (`&amp;`, desfeito no adaptador) foram verificados contra o serviço real; (3) os `type` de erro seguem os helpers existentes do repositório: `validation-error` também para corpo inválido e `rate-limited` no lugar de `too-many-requests` (tabela 5.1 e CA-12 corrigidos); (4) `.env.example` alterado para documentar `TTS_TIMEOUT` e `TTS_MAX_CONCURRENT`; (5) o limite de 20 por minuto fica fixo no `main.go`, como nas outras rotas, e só prazo e concorrência são configuráveis. **Risco novo:** a versão do Chromium e o token do handshake são constantes do adaptador; se a Microsoft passar a recusar (403), é lá que se atualiza |
