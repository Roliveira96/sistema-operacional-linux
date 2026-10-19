# SPEC-068: Envio de PDF e imagens pelo professor durante a aula ao vivo

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-068 |
| **Status** | Implementada |
| **Data de criação** | 15/10/2026 |
| **Última revisão** | 15/10/2026 (implementada) |
| **Autor** | Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classroom` (backend) e `Classroom` (frontend) |
| **Contexto de tela** | Painel do professor da sala ao vivo (`/app/classes/[id]/live`) e janela de apresentação |
| **Prioridade** | Alta |
| **Depende de** | SPEC-051, SPEC-053, SPEC-055, SPEC-057 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead em 15/10/2026: durante uma aula ativa, o professor deve poder subir arquivos (apresentação, PDF, imagens e o que mais ajude a dar a aula) sem sair da plataforma; decisão do Tech Lead no mesmo dia: por enquanto, somente PDF e imagens |

---

## 1. Contexto e Problema (Context & Problem Statement)

Hoje o professor só consegue enviar uma apresentação ao iniciar a aula (formulário "Iniciar aula") ou no conteúdo da aula da agenda, e só em PDF. A apresentação da sala é escolhida na abertura: com a sala ativa, o painel não tem como enviar um arquivo novo nem trocar a apresentação que está no palco. Imagens não são aceitas. Quando o professor lembra de um material no meio da aula, precisa sair da plataforma e recomeçar a aula.

## 2. Objetivos (Goals)

- Com a sala ativa, o professor envia um PDF ou uma imagem pelo painel, sem sair da aula e sem encerrá-la.
- São aceitos PDF e imagem (PNG, JPEG e WebP).
- O arquivo enviado pode ser projetado na hora: os estudantes aceitos passam a ver o arquivo no palco, na lâmina 1.
- O professor também pode trocar, durante a aula, para qualquer apresentação já enviada à turma.

### 2.1. Fora de escopo (Non-Goals)

- **PowerPoint (`.pptx`) e outros formatos de apresentação:** exigem conversão no servidor, que é dependência nova de infraestrutura. Ficam para uma spec futura; enquanto isso, o painel orienta a exportar o PowerPoint para PDF.
- Arquivos para os estudantes baixarem, vídeo, áudio, Word, Excel e outros formatos.
- Editar o arquivo ou anotar dentro dele além do que o palco já faz (ponteiro e caneta).
- Envio de arquivos por estudantes.
- Várias imagens numa só apresentação: cada envio é um arquivo.
- Mudar o limite de 100 apresentações por turma (SPEC-053) e o de 25 MB do PDF (SPEC-051), e o palco padronizado (SPEC-057).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Painel do professor:** nova seção **Arquivos da aula**, com o botão **Enviar arquivo** (e arrastar e soltar) e a lista das apresentações da turma, a mais recente primeiro. Cada item mostra o nome, o tipo (PDF ou imagem) e o número de lâminas. Um texto de ajuda diz que PowerPoint deve ser exportado para PDF.
- **Projetar:** cada item tem o botão **Projetar**; o envio tem a opção **Projetar ao terminar** (ligada por padrão). Projetar leva o palco para o modo de apresentação com aquele arquivo na lâmina 1, e a apresentação que estava no palco continua na lista.
- **PDF:** o navegador lê o número de páginas e envia, como hoje. **Imagem:** o navegador envia o arquivo; ela vale uma lâmina.
- **Envio:** o item aparece como **Enviando** e depois fica pronto. Formato não aceito, arquivo grande demais, limite de 100 apresentações e queda de conexão aparecem no próprio item, em português, com o botão de tentar de novo, sem tirar o professor da aula.
- **Estudante e janela de apresentação:** veem a troca no palco sem fazer nada, como já veem a troca de lâmina; a lâmina de imagem é desenhada inteira no palco, centralizada, sem cortar.
- Textos no arquivo de mensagens; cores só dos tokens; tema claro e escuro; teclado completo e alvo de toque de no mínimo 44 px.

### 3.2. Backend (Go — Camada de Módulo/Service)

- **RN-01 (quem envia):** só o professor dono da turma ou o administrador (SPEC-051 RN-01). O envio vale com a sala ativa ou sem ela.
- **RN-02 (formatos):** PDF, PNG, JPEG e WebP. O tipo é conferido pelo conteúdo do arquivo (assinatura), não pelo nome nem pelo tipo informado.
- **RN-03 (limites):** PDF até 25 MB e 100 páginas (SPEC-051); imagem até 10 MB. Cada envio ocupa uma das 100 apresentações da turma (SPEC-051 `UploadSlideDeck`, com o limite de 100 da SPEC-053).
- **RN-04 (imagem):** uma imagem é uma apresentação de uma lâmina, do tipo `IMAGE`, que o palco desenha inteira. O tipo do arquivo gravado no bucket é o da imagem, para o navegador a mostrar.
- **RN-05 (projetar):** o professor manda trocar a apresentação do palco para uma apresentação da turma; a sala passa a ter essa apresentação, na lâmina 1, e avisa todos os conectados (aceitos, painel e janela de apresentação). Apresentação de outra turma ou apagada é recusada.
- **RN-06 (tempo real):** a troca de apresentação chega a todos por evento da sala, sem recarregar. Quem entra ou reconecta recebe a apresentação atual no instantâneo (SPEC-051 RN-07).
- **RN-07 (segurança):** nomes de arquivo nunca entram em caminho do bucket (a chave é gerada); arquivos são servidos por URL pré-assinada de 15 minutos (SPEC-051); o tamanho é limitado enquanto o arquivo é lido, não depois.

## 4. Modelo de Dados (Data Model)

Tabela alterada: `slide_decks`.

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `kind` | texto | Sim | `PDF` ou `IMAGE`; padrão `PDF` | Como o palco desenha a apresentação |

- Apresentações existentes ficam `PDF`, sem migração de dados além do valor padrão.
- `page_count` continua de 1 a 100; `IMAGE` tem sempre 1.
- Exclusão continua lógica (SPEC-051).

## 5. Contrato de API (API Contract)

**`POST /api/v1/classes/{id}/live/decks`** (já existe): passa a aceitar imagens além de PDF.

- **Papéis autorizados:** `TEACHER` dono da turma e `ADMIN`.
- **Corpo (multipart):**

| Campo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| `file` | arquivo | Sim | PDF, PNG, JPEG ou WebP, dentro dos limites da RN-03 |
| `title` | texto | Sim | De 1 a 120 caracteres |
| `pageCount` | inteiro | Só para PDF | De 1 a 100, lido pelo navegador (SPEC-051); ignorado para imagem |

- **Resposta de sucesso:** 201 com `id`, `title`, `kind`, `pageCount` e `downloadUrl`.
- **Erros (RFC 7807):**

| HTTP | `type` | Quando ocorre |
| :--- | :--- | :--- |
| 400 | `invalid-file` | Conteúdo que não é de um formato aceito |
| 400 | `invalid-pdf` | PDF com `pageCount` fora de 1 a 100 (como hoje) |
| 403 | `forbidden` | Não é o dono da turma nem administrador |
| 409 | `deck-limit-exceeded` | A turma já tem 100 apresentações |
| 413 | `file-too-large` | Acima do limite do formato |

**`GET /api/v1/classes/{id}/live/decks`** (já existe): cada item passa a trazer também `kind`.

**Evento `live:deck:select`** (cliente → servidor, só o painel do professor): `deckId`. O servidor aplica a RN-05 e responde com `live:deck:changed` a todos os conectados da sala, com a apresentação nova e `currentSlide` 1; a recusa não envia nada e é registrada no log, como as demais rejeições da sala.

## 6. Impacto e Riscos (Impact & Risks)

- **Arquivo malicioso ou grande demais:** Mitigação: RN-02 (assinatura), RN-03 (limites lidos durante o envio), RN-07 (chave gerada, URL de 15 minutos).
- **Troca de apresentação no meio da aula:** estudantes veem o palco mudar de repente. Mitigação: só o professor troca, e a troca é um evento claro da sala; a apresentação anterior continua na lista.
- **Professor com PowerPoint:** precisa exportar para PDF. Mitigação: o texto de ajuda do painel; PowerPoint fica para spec futura.
- **Armazenamento:** o limite de 20 por turma continua, e vale também para as imagens. Imagens de 10 MB podem consumir o limite rápido; aceito, pelo uso esperado.
- **Dublês dos testes da sala:** a interface do serviço cresce; os testes existentes não mudam o que verificam.

## 7. Critérios de Aceite (Acceptance Criteria)

- [x] **CA-01** (evento): QUANDO o professor dono da turma envia um PDF válido com a sala ativa, O SISTEMA DEVE gravar a apresentação sem encerrar nem interromper a sala.
- [x] **CA-02** (evento): QUANDO o professor envia uma imagem PNG, JPEG ou WebP de até 10 MB, O SISTEMA DEVE gravar uma apresentação `IMAGE` de 1 lâmina, com o tipo da imagem no bucket.
- [x] **CA-03** (indesejado): SE o conteúdo do arquivo não for de um formato aceito, mesmo com nome ou tipo informado de formato aceito, ENTÃO O SISTEMA DEVE recusar com 400 `invalid-file`.
- [x] **CA-04** (indesejado): SE o arquivo passar do limite do seu formato, ENTÃO O SISTEMA DEVE recusar com 413 `file-too-large`; SE a turma já tem 100 apresentações, ENTÃO 409 `deck-limit-exceeded`.
- [x] **CA-05** (indesejado): SE quem envia não é o professor dono da turma nem administrador, ENTÃO O SISTEMA DEVE recusar com 403 `forbidden`.
- [x] **CA-06** (evento): QUANDO o painel manda `live:deck:select` com uma apresentação da turma, O SISTEMA DEVE passar o palco para ela na lâmina 1 e enviar `live:deck:changed` a todos os conectados da sala.
- [x] **CA-07** (indesejado): SE `live:deck:select` traz apresentação de outra turma ou que não existe, ENTÃO O SISTEMA DEVE recusar sem mudar o palco; E SE vem de quem não é o painel do professor, DEVE descartá-lo.
- [x] **CA-08** (estado): ENQUANTO a sala está ativa, O SISTEMA DEVE dar a quem entra ou reconecta a apresentação atual e a lâmina atual no instantâneo.
- [x] **CA-09** (evento): QUANDO o professor envia um arquivo com "Projetar ao terminar" ligado, O SISTEMA DEVE projetá-lo assim que o envio terminar, e NÃO DEVE projetar um envio que falhou.
- [x] **CA-10** (estado): ENQUANTO uma apresentação é `IMAGE`, O SISTEMA DEVE desenhá-la inteira e centralizada no palco, para o professor, a janela de apresentação e os estudantes.
- [x] **CA-11** (ubíquo): O painel DEVE mostrar, para cada apresentação, nome, tipo e lâminas, o estado do envio (Enviando ou pronto) e os erros no próprio item, em português, e o texto que orienta a exportar o PowerPoint para PDF.

## 8. Plano de Testes (Test Plan)

- **Backend, domain:** detecção do formato pela assinatura e limites por formato (CA-02, CA-03, CA-04).
- **Backend, service (armazenamento substituído por implementação de teste):** envio de PDF e de imagem com a sala ativa (CA-01, CA-02); recusa por conteúdo, tamanho, limite da turma e papel (CA-03, CA-04, CA-05); seleção para projetar, com as recusas (CA-06, CA-07); instantâneo com a apresentação atual (CA-08).
- **Backend, handler:** rota de envio com os formatos novos, os códigos 201, 400, 403, 409 e 413 e o campo novo da lista; eventos `live:deck:select` e `live:deck:changed` na sala com painel, janela de apresentação, aluno aceito e aluno em espera (CA-06, CA-07).
- **Backend, repository (integração com PostgreSQL):** o campo novo de `slide_decks`, o valor padrão das linhas existentes e a contagem do limite de 20 com os dois tipos.
- **Frontend:** seção Arquivos da aula (CA-11); envio de PDF e de imagem e os estados Enviando e erro; "Projetar" e "Projetar ao terminar" (CA-09); o palco com lâmina de imagem (CA-10); a troca de apresentação chegando ao estudante e à janela de apresentação (CA-06).
- **Manual:** enviar um PDF e uma imagem com a sala ativa e dois estudantes conectados; conferir a projeção e a troca; repetir nos temas claro e escuro e no celular. Justificativa: a leitura visual do palco não é automatizável.
- **Cobertura:** acima de 80% no escopo da spec (`go test -cover` e Vitest em modo de cobertura).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-051, SPEC-053, SPEC-055, SPEC-057; `backend/internal/modules/classroom/` (`UploadDeck`, `SwitchMode`, instantâneo, `ws.go`); `frontend/src/components/Classroom/TeacherPanel/`, `LiveClassPanel/`, `SlidePresenter/`, `PresenterStage/` e `ModuleStage/`.
2. **Ordem de execução:** (1) testes da seção 8, vermelhos, e commit `test`; (2) migração do campo `kind`; (3) domínio, serviço e rota de envio com imagens; (4) evento de troca de apresentação e instantâneo; (5) seção Arquivos da aula e palco com imagem; (6) mensagens; (7) verificação e commit `feat`; (8) status `Implementada`.
3. **Arquivos e diretórios a criar ou alterar:** nova migração em `backend/migrations/`; `backend/internal/modules/classroom/**`; `frontend/src/components/Classroom/**`; `frontend/src/hooks/useLiveClassroom.ts`; `frontend/src/services/classroomService.ts`; `frontend/src/messages/pt-BR.ts`. Qualquer outro arquivo exige justificativa na entrega.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, cobertura acima de 80%, ESLint e Stylelint sem erros, nenhuma violação de `specs/ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma. Decisão do Tech Lead em 15/10/2026: por enquanto, somente PDF e imagens (PowerPoint fica para uma spec futura). Assumidas por recomendação, a confirmar na aprovação: arquivos para download dos estudantes ficam fora desta spec; limites de 10 MB para imagem, 25 MB para PDF e 100 apresentações por turma; uma imagem por envio.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 15/10/2026 | Aruna Architect | Criação em Rascunho, a pedido do Tech Lead, com PowerPoint, imagem e PDF |
| 15/10/2026 | Aruna Architect | Escopo reduzido por decisão do Tech Lead: somente PDF e imagens por enquanto; saem a conversão de PowerPoint, os estados de conversão, o evento de status e os campos `status`, `source_format` e `failure_reason`; P-01 a P-04 resolvidas |
| 15/10/2026 | Aruna Architect | Aprovada pelo Tech Lead ("Sim chat, pode ir fazendo em ordem"); o limite por turma passa de 20 para 100 apresentações, que é o que o código e a SPEC-053 já têm (a SPEC-051 dizia 20 e foi superada nesse ponto) |
| 15/10/2026 | Implementador | Implementada. Backend: migração `00036` (`slide_decks.kind`), `domain.ClassifyUpload`, `Service.SelectDeck`, rota de envio com imagem, `live:deck:select` e `live:deck:changed`. Frontend: `FilesPanel`, `imageLoader`, `selectDeck` no hook e a seção no painel; com uma imagem no palco o painel mostra a imagem no lugar das miniaturas de PDF. Os 11 critérios têm teste automatizado; a leitura visual do palco com imagem, o envio real a um MinIO e o celular ficam para o roteiro manual do Tech Lead |
| 19/10/2026 | Aruna Architect (Claude, a pedido do Tech Lead) | A SPEC-074 (D-08) acrescenta ao painel Arquivos o bloco "Materiais da aula" com Projetar e a rota `POST /live/decks/from-material`, que cria ou reaproveita uma apresentação da turma a partir de um material; nenhuma regra desta spec muda |
