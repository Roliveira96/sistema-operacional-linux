# SPEC-071: Sistema Dinâmico de Caderno de Anotações Discente em Aula

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-071 |
| **Status** | Aprovada |
| **Data de criação** | 16/10/2026 |
| **Última revisão** | 16/10/2026 |
| **Autor** | Autoria trazida pelo Tech Lead; adequação ao padrão arquitetural por Aruna Architect |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `classroom` (backend) e `frontend/src/components/Classroom/StudentNotesPanel/` |
| **Contexto de tela** | Sala ao vivo do estudante (`/app/classes/:classId/live`) e consulta de aulas anteriores na página da turma (`/app/classes/:classId`) |
| **Prioridade** | Alta |
| **Depende de** | SPEC-004 (MinIO), SPEC-025 (pipeline AVIF), SPEC-051 (sala de aula síncrona e caderno de anotações), SPEC-054 (admissão na sala), SPEC-057 (palco padronizado), SPEC-063 (conversa da aula) |
| **Substitui** | Nenhuma (evolui o caderno de anotações da SPEC-051 para estrutura atômica baseada em blocos com suporte a Markdown, imagens privadas e widget flutuante) |
| **Fontes canônicas** | Especificação técnica trazida pelo Tech Lead em 16/10/2026 ("Sistema Dinâmico de Caderno de Anotações Discente em Aula") e aprovação em 16/10/2026 |

---

## 1. Contexto e Problema (Context & Problem Statement)

Na implementação inicial da sala ao vivo (SPEC-051), o caderno de anotações do estudante consiste em um único campo de texto plano salvo por inteiro. Durante uma aula prática de Sistemas Operacionais, esse modelo único traz três limitações pedagógicas e de usabilidade:

1. **Risco de perda acidental e falta de cronologia:** um único campo de texto longo favorece sobrescritas ou exclusões acidentais por seleção indevida e não registra o instante de cada anotação ao longo da explicação docente.
2. **Ausência de formatação rápida e de capturas visuais:** o estudante não consegue destacar comandos inline, listas e trechos em negrito/itálico nem colar capturas de tela da lousa/terminal diretamente da área de transferência.
3. **Rigidez espacial durante a prática:** o estudante precisa posicionar ou minimizar seu caderno livremente para acompanhar o terminal e a aula síncrona, mantendo a posição escolhida entre recargas.

Além disso, como capturas de tela do estudante podem conter dados sensíveis do seu ambiente local, as imagens anexadas às anotações jamais podem ficar em endereços públicos do bucket: todo acesso precisa ser mediado por proxy autenticado no servidor Go, restrito exclusivamente ao autor da anotação.

## 2. Objetivos (Goals)

- Estruturar o caderno de anotações do estudante em **blocos atômicos cronológicos** com criação, edição individual, carimbo temporal de criação e de última atualização e exclusão lógica individual com confirmação.
- Oferecer no caderno de anotações o comportamento de **widget flutuante arrastável e minimizável** (com aceleração de hardware via translação 3D, colapso em pílula com contador de notas da aula e persistência de posição e estado no armazenamento local do navegador).
- Disponibilizar editor com barra de ferramentas compacta, atalhos de teclado (negrito, itálico, código inline e lista de marcadores) e colagem direta de imagens da área de transferência.
- Redimensionar proporcionalmente no navegador imagens com largura superior a 1220 pixels (preservando as dimensões originais quando menores ou iguais a 1220 pixels) e codificá-las em AVIF (com alternativa automática em WebP quando o navegador não suportar codificação AVIF).
- Armazenar as imagens das anotações de forma estritamente privada no MinIO e servi-las exclusivamente por rota proxy autenticada no backend Go, que valida a posse do discente antes de transmitir os bytes.
- Renderizar o conteúdo Markdown dos blocos com sanitização estrita contra XSS e enquadramento responsivo das imagens dentro do caderno.

### 2.1. Fora de escopo (Non-Goals)

- Compartilhamento de anotações entre estudantes ou leitura das anotações do estudante pelo docente ou administrador.
- Upload de vídeos, áudios, documentos PDF ou formatos executáveis/vetoriais (como SVG) nas anotações.
- Exclusão física de blocos ou objetos no MinIO (toda exclusão segue a política de exclusão lógica da plataforma).
- Edição colaborativa em tempo real via WebSocket (as anotações são estritamente individuais e trafegam via API REST).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

- **Widget Flutuante Arrastável e Minimizável (`StudentNotesPanel`):**
  - Renderizado com suporte a arraste livre pela área útil da janela utilizando translação 3D acelerada por hardware (`transform: translate3d`) para manter 60 quadros por segundo sem impactar o terminal.
  - Possui botão de minimizar que colapsa o caderno em uma pílula flutuante compacta contendo o ícone de caderno e o contador de blocos de anotação da aula; clicar na pílula restaura o caderno expandido.
  - Persiste a posição (`x`, `y`) e o estado (`minimized`) no `localStorage` do navegador, restaurando-os ao reabrir a aula.
  - Na listagem de "Aulas anteriores" da página da turma (`LiveClassPanel`), os blocos de anotação da aula encerrada continuam acessíveis ao estudante autor.
- **Lista de Blocos Atômicos:**
  - Exibe os blocos em ordem cronológica de criação, cada um em seu cartão independente.
  - Mostra o horário de criação formatado (`HH:mm`) e, quando o bloco tiver sido editado após a criação, exibe também a indicação do horário da última edição.
  - Cada bloco oferece as ações **Editar** (abre o conteúdo do bloco para edição e salvamento) e **Excluir** (abre confirmação rápida antes de remover o bloco).
- **Editor Rico em Markdown e Colagem de Imagens:**
  - Barra de ferramentas compacta com botões para **Negrito**, **Itálico**, **Código inline** e **Lista**, além dos atalhos de teclado `Ctrl+B` / `Cmd+B` (negrito) e `Ctrl+I` / `Cmd+I` (itálico).
  - Escuta o evento `paste` no editor: quando o conteúdo da área de transferência contém uma imagem bitmap, executa o pipeline local de otimização (`optimizeNoteImage`), envia o arquivo otimizado para a rota de upload da aula e insere no texto a referência Markdown relativa apontando para a rota proxy (`/api/v1/media/notes/{imageId}`). Também permite anexar imagem por botão na barra de ferramentas.
- **Pipeline de Otimização no Cliente (`optimizeNoteImage`):**
  - Carrega a imagem em memória; se a largura ultrapassar 1220 pixels, calcula a nova largura (1220 px) e altura proporcional mantendo o *aspect-ratio*. Imagens com largura menor ou igual a 1220 pixels mantêm suas dimensões originais.
  - Desenha em `HTMLCanvasElement` com suavização de alta qualidade e exporta via `toBlob` em `image/avif` (qualidade 0.85), com fallback automático para `image/webp` (qualidade 0.85) caso o navegador retorne nulo ou outro formato não suportado.
- **Renderização Segura e Enquadramento Responsivo (`NoteMarkdown`):**
  - Converte o Markdown de cada bloco (negrito, itálico, código inline, listas e imagens) em elementos React sanitizados, escapando qualquer tag HTML bruta (`<script>`, `<img onerror>`, atributos de evento) e aceitando imagens exclusivamente quando o endereço corresponder à rota proxy relativa `/api/v1/media/notes/{id}`.
  - Toda imagem renderizada no bloco recebe estilo com largura máxima de 100% do widget, altura automática e `object-fit: contain`.

### 3.2. Backend (Go — Camada de Módulo/Service)

- **RN-01 (privacidade estrita do autor):** apenas um usuário com papel `STUDENT` matriculado com status `ACTIVE` na turma (e com admissão `ADMITTED` enquanto a sala estiver `ACTIVE`, conforme SPEC-054 RN-03) pode criar, listar, editar, excluir blocos de anotação ou enviar imagens na sessão da sala ao vivo. Docentes, administradores e outros estudantes nunca leem nem alteram anotações ou imagens alheias (recebem `403 forbidden`).
- **RN-02 (granularidade e validação do bloco):** cada bloco de anotação pertence a uma sessão de sala ao vivo (`session_id`) e a um estudante (`student_id`), com conteúdo Markdown obrigatório entre 1 e 20.000 caracteres (após remoção de espaços nas extremidades). A listagem retorna os blocos não excluídos do estudante naquela sessão em ordem cronológica crescente (`created_at ASC`).
- **RN-03 (edição e posse):** a edição (`PATCH`) altera apenas `content_markdown` e `updated_at` do bloco indicado, validando que o bloco pertence à sessão informada e ao `student_id` autenticado. Se o bloco pertencer a outro estudante, retorna `403 forbidden`; se não existir ou já estiver excluído, retorna `404 note-block-not-found`.
- **RN-04 (exclusão lógica e revogação de imagens):** a exclusão (`DELETE`) aplica exclusão lógica (`deleted_at`) no bloco após validar a posse (`student_id == actor.UserID`) e revoga (marca com `deleted_at`) todas as imagens associadas àquele bloco na tabela `live_classroom_note_images`, impedindo acessos posteriores pelo proxy.
- **RN-05 (upload privado de imagem da anotação):** o endpoint de upload recebe o arquivo multipart, limita a leitura a no máximo 5 MB (`MaxNoteImageBytes = 5 << 20`), valida pelos bytes de assinatura (magic bytes) que o conteúdo é `image/avif` ou `image/webp`, grava no MinIO sob a chave privada `notes/{student_id}/{image_id}.avif` (ou `.webp`) sem política pública, persiste os metadados em `live_classroom_note_images` e retorna o identificador e a rota proxy relativa `/api/v1/media/notes/{image_id}`.
- **RN-06 (vínculo entre bloco e imagens):** ao criar ou atualizar um bloco cujo Markdown referencie endereços `/api/v1/media/notes/{image_id}`, o serviço vincula esses registros de `live_classroom_note_images` (desde que pertençam ao mesmo `student_id` e `session_id`) ao `note_block_id` do bloco.
- **RN-07 (proxy autenticado de mídia):** a rota `GET /api/v1/media/notes/:imageId` exige sessão autenticada, consulta `live_classroom_note_images` e verifica se o registro existe e não foi excluído (`404 note-image-not-found` caso contrário) e se `image.student_id == actor.UserID` (`403 forbidden` para qualquer outro usuário). Quando autorizado, faz o streaming dos bytes do objeto a partir do MinIO com cabeçalhos `Content-Type` correspondente ao `mime_type` salvo, `Cache-Control: private, max-age=86400` e `X-Content-Type-Options: nosniff`.
- **RN-08 (indicador `hasNotes` nas sessões):** a listagem de sessões da turma (`ListSessions`) considera que o estudante possui anotações na aula (`hasNotes = true`) quando existir ao menos um bloco ativo em `live_classroom_note_blocks` (ou registro legado em `live_classroom_notes`) para aquele estudante e sessão.

## 4. Modelo de Dados (Data Model)

Duas novas tabelas no schema `linux_lab`, versionadas em nova migração goose (`00037_note_blocks_and_images.sql`):

### 4.1. Tabela `live_classroom_note_blocks` (`LiveClassroomNoteBlock`)

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | Sim | PK (UUIDv7 via GORM hook) | Identificador único do bloco de anotação |
| `session_id` | `uuid` | Sim | FK `live_classroom_sessions(id)` | Sessão da sala ao vivo a que o bloco pertence |
| `student_id` | `uuid` | Sim | FK `users(id)` | Estudante autor e único proprietário do bloco |
| `content_markdown` | `text` | Sim | `char_length BETWEEN 1 AND 20000` | Conteúdo em Markdown do bloco |
| `created_at` | `timestamptz` | Sim | `NOT NULL` | Horário exato de criação do bloco no servidor |
| `updated_at` | `timestamptz` | Sim | `NOT NULL` | Horário da última atualização do bloco |
| `deleted_at` | `timestamptz` | Não | Anulável | Data/hora da exclusão lógica |

- **Índice:** `live_classroom_note_blocks_session_student_idx` sobre `(session_id, student_id, created_at) WHERE deleted_at IS NULL`.

### 4.2. Tabela `live_classroom_note_images` (`LiveClassroomNoteImage`)

| Campo | Tipo | Obrigatório | Restrições | Descrição / Regra |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | Sim | PK (UUIDv7 via GORM hook) | Identificador único da imagem |
| `session_id` | `uuid` | Sim | FK `live_classroom_sessions(id)` | Sessão da sala ao vivo em que a imagem foi enviada |
| `note_block_id` | `uuid` | Não | FK anulável `live_classroom_note_blocks(id)` | Bloco de anotação ao qual a imagem está associada |
| `student_id` | `uuid` | Sim | FK `users(id)` | Estudante proprietário exclusivo da imagem |
| `object_key` | `text` | Sim | `NOT NULL` | Caminho privado no MinIO (`notes/{student_id}/{id}.avif` ou `.webp`) |
| `original_name` | `text` | Sim | Até 255 caracteres | Nome original informado no envio |
| `mime_type` | `text` | Sim | `image/avif` ou `image/webp` | Tipo MIME validado pela assinatura binária |
| `width` | `integer` | Sim | `0 <= width <= 1220` | Largura da imagem em pixels (quando informada) |
| `height` | `integer` | Sim | `height >= 0` | Altura da imagem em pixels (quando informada) |
| `size_bytes` | `bigint` | Sim | `1 <= size_bytes <= 5242880` | Tamanho do arquivo em bytes (máximo 5 MB) |
| `created_at` | `timestamptz` | Sim | `NOT NULL` | Horário do envio |
| `updated_at` | `timestamptz` | Sim | `NOT NULL` | Horário da última atualização |
| `deleted_at` | `timestamptz` | Não | Anulável | Data/hora da revogação/exclusão lógica |

- **Índices:**
  - `live_classroom_note_images_auth_idx` sobre `(id, student_id) WHERE deleted_at IS NULL`.
  - `live_classroom_note_images_block_idx` sobre `(note_block_id) WHERE deleted_at IS NULL`.

## 5. Contrato de API (API Contract)

### 5.1. Listar blocos de anotação da aula

**`GET /api/v1/classes/:id/live/sessions/:sessionId/note-blocks`**: retorna os blocos de anotação do estudante logado naquela aula, em ordem cronológica.

- **Papéis autorizados:** `STUDENT` com matrícula `ACTIVE` na turma (e admitido na sala se ela estiver aberta).
- **Resposta de sucesso (200 OK):** lista `items`, onde cada item contém:

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `id` | `string` (UUID) | Sim | Identificador do bloco |
| `contentMarkdown` | `string` | Sim | Texto em Markdown com referências relativas às imagens |
| `createdAt` | `string` (ISO 8601) | Sim | Horário de criação no servidor |
| `updatedAt` | `string` (ISO 8601) | Sim | Horário da última edição no servidor |

- **Erros (RFC 7807):** 401 `not-authenticated`; 403 `forbidden`; 404 `class-not-found`; 404 `session-not-found`.

### 5.2. Criar bloco de anotação

**`POST /api/v1/classes/:id/live/sessions/:sessionId/note-blocks`**: cria um novo bloco atômico de anotação com o horário do servidor.

- **Papéis autorizados:** `STUDENT` com matrícula `ACTIVE` (e admitido se a sala estiver aberta).
- **Corpo da requisição:**

| Campo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| `contentMarkdown` | `string` | Sim | Não vazio após trim, até 20.000 caracteres |

- **Resposta de sucesso (201 Created):** `id`, `contentMarkdown`, `createdAt`, `updatedAt`.
- **Erros (RFC 7807):** 400 `validation-error` (vazio); 400 `content-too-long` (acima de 20.000 caracteres); 403 `forbidden`; 404 `class-not-found`; 404 `session-not-found`.

### 5.3. Editar bloco de anotação

**`PATCH /api/v1/classes/:id/live/sessions/:sessionId/note-blocks/:blockId`**: atualiza o texto Markdown de um bloco existente do próprio estudante.

- **Papéis autorizados:** `STUDENT` autor do bloco.
- **Corpo da requisição:**

| Campo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| `contentMarkdown` | `string` | Sim | Não vazio após trim, até 20.000 caracteres |

- **Resposta de sucesso (200 OK):** `id`, `contentMarkdown`, `createdAt`, `updatedAt`.
- **Erros (RFC 7807):** 400 `validation-error`; 400 `content-too-long`; 403 `forbidden` (outro usuário ou não autor); 404 `note-block-not-found`.

### 5.4. Excluir bloco de anotação

**`DELETE /api/v1/classes/:id/live/sessions/:sessionId/note-blocks/:blockId`**: exclui logicamente o bloco e revoga as imagens associadas.

- **Papéis autorizados:** `STUDENT` autor do bloco.
- **Resposta de sucesso (204 No Content):** sem corpo.
- **Erros (RFC 7807):** 403 `forbidden` (não autor); 404 `note-block-not-found`.

### 5.5. Upload de imagem otimizada da anotação

**`POST /api/v1/classes/:id/live/sessions/:sessionId/note-images`**: recebe a imagem otimizada (`multipart/form-data`), valida formato (`image/avif` ou `image/webp`) e tamanho (até 5 MB), grava de forma privada no MinIO e registra os metadados.

- **Papéis autorizados:** `STUDENT` com matrícula `ACTIVE` (e admitido se a sala estiver aberta).
- **Corpo da requisição (`multipart/form-data`):**

| Campo | Tipo | Obrigatório | Regra / Validação |
| :--- | :--- | :--- | :--- |
| `file` | arquivo binário | Sim | Assinatura binária `image/avif` ou `image/webp`, até 5 MB |
| `width` | inteiro | Não | De 0 a 1220 |
| `height` | inteiro | Não | Maior ou igual a 0 |

- **Resposta de sucesso (201 Created):**

| Campo | Tipo | Sempre presente | Descrição |
| :--- | :--- | :--- | :--- |
| `imageId` | `string` (UUID) | Sim | Identificador da imagem registrada |
| `accessUrl` | `string` | Sim | Rota relativa do proxy (`/api/v1/media/notes/{imageId}`) |

- **Erros (RFC 7807):** 400 `invalid-file` (ausente, formato não suportado ou dimensões inválidas); 403 `forbidden`; 404 `session-not-found`; 413 `file-too-large` (acima de 5 MB).

### 5.6. Proxy autenticado de mídia de anotação

**`GET /api/v1/media/notes/:imageId`**: valida que a sessão autenticada pertence ao estudante dono da imagem e transmite os bytes do MinIO.

- **Papéis autorizados:** `STUDENT` proprietário da imagem (`image.student_id == actor.UserID`).
- **Resposta de sucesso (200 OK):** stream binário da imagem com `Content-Type` (`image/avif` ou `image/webp`), `Cache-Control: private, max-age=86400` e `X-Content-Type-Options: nosniff`.
- **Erros (RFC 7807):** 401 `not-authenticated`; 403 `forbidden` (usuário autenticado que não é o dono da imagem); 404 `note-image-not-found` (inexistente ou revogada por exclusão do bloco).

## 6. Impacto e Riscos (Impact & Risks)

| Risco | Mitigação |
| :--- | :--- |
| Vazamento de prints contendo credenciais ou dados sensíveis do aluno | Bucket MinIO sem política pública no prefixo `notes/`; acesso exclusivamente via rota proxy autenticada que exige `student_id == actor.UserID` (RN-05, RN-07). |
| Injeção de scripts (XSS) via Markdown nas anotações | Renderização React estruturada sem `dangerouslySetInnerHTML`, descartando tags HTML brutas e permitindo apenas URLs de imagem da rota proxy `/api/v1/media/notes/` (RNF-03). |
| Degradação de performance do terminal durante o arraste do widget | Uso de `transform: translate3d(x, y, 0)` para composição em GPU sem reflow do palco nem do terminal (RNF-02). |
| Navegador sem suporte nativo a encode `image/avif` no Canvas | Fallback transparente para `image/webp` no cliente e aceitação de ambos os formatos (`image/avif` e `image/webp`) pela validação de assinatura binária no servidor (RF-09, RN-05). |
| Compatibilidade com testes existentes da sala ao vivo | As rotas legadas `PUT/GET /notes` e o contrato do `StudentNotesPanel` dentro de `LiveClassroom` permanecem íntegros; `SessionsWithNotes` considera blocos novos e notas legadas. |

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (ubíquo): O caderno de anotações DEVE funcionar como widget flutuante arrastável (usando `transform: translate3d`) e minimizável em pílula com contador de notas, mantendo posição e estado (`expanded`/`minimized`) salvos no `localStorage`.
- [ ] **CA-02** (evento): QUANDO o estudante criar um bloco de anotação, O SISTEMA DEVE persistir um registro independente em `live_classroom_note_blocks` com o horário do servidor (`created_at`) e exibi-lo na lista cronológica com o horário formatado (`HH:mm`).
- [ ] **CA-03** (evento): QUANDO o estudante editar um bloco de anotação existente, O SISTEMA DEVE atualizar `content_markdown` e `updated_at` no servidor e exibir no cartão do bloco a marcação de atualização.
- [ ] **CA-04** (evento): QUANDO o estudante acionar a exclusão de um bloco e confirmar no diálogo de confirmação, O SISTEMA DEVE realizar a exclusão lógica do bloco e revogar o acesso às imagens associadas a ele.
- [ ] **CA-05** (evento): QUANDO o estudante usar a barra de ferramentas ou os atalhos `Ctrl+B` e `Ctrl+I`, O SISTEMA DEVE aplicar a formatação Markdown correspondente (negrito, itálico, código inline e lista de marcadores).
- [ ] **CA-06** (evento): QUANDO o estudante colar (`paste`) uma imagem do clipboard no editor, O SISTEMA DEVE otimizá-la no cliente, fazer o upload para `/note-images` e inserir a referência Markdown `/api/v1/media/notes/{imageId}` no editor sem exigir salvamento prévio em disco.
- [ ] **CA-07** (evento): QUANDO uma imagem com largura maior que 1220 pixels passar pelo pipeline do cliente, O SISTEMA DEVE redimensioná-la proporcionalmente para largura 1220 pixels; ENQUANTO a largura for menor ou igual a 1220 pixels, DEVE manter as dimensões originais.
- [ ] **CA-08** (evento): QUANDO o cliente codificar a imagem no Canvas, O SISTEMA DEVE exportar em `image/avif` e, SE o navegador não suportar codificação AVIF, DEVE usar `image/webp` como fallback transparente.
- [ ] **CA-09** (ubíquo): As imagens renderizadas nos blocos de anotação DEVEM ser enquadradas de forma responsiva (`max-width: 100%`, `height: auto`, `object-fit: contain`) e todo conteúdo Markdown DEVE ser sanitizado contra XSS (rejeitando HTML arbitrário e URLs externas).
- [ ] **CA-10** (indesejado): SE outro estudante, docente ou administrador tentar listar, criar, editar ou excluir blocos de anotação de um estudante, ou acessar `/api/v1/media/notes/:imageId` de uma imagem pertencente a outro estudante, ENTÃO O SISTEMA DEVE responder `403 forbidden` (RFC 7807).
- [ ] **CA-11** (evento): QUANDO o próprio estudante autor requisitar `GET /api/v1/media/notes/:imageId` de uma imagem ativa sua, O SISTEMA DEVE fazer o streaming dos bytes do MinIO com `Content-Type` da imagem e `Cache-Control: private, max-age=86400`.
- [ ] **CA-12** (indesejado): SE o arquivo enviado em `POST /note-images` passar de 5 MB ou não tiver assinatura binária válida de AVIF ou WebP, ENTÃO O SISTEMA DEVE recusar com `413 file-too-large` ou `400 invalid-file` sem gravar no MinIO.

## 8. Plano de Testes (Test Plan)

- **Backend, domain (`classroom/domain/notes_test.go`):**
  - `TestValidateNoteBlock`: valida limites de texto (vazio, válido, > 20.000 runes) e extração de IDs de imagens proxy do Markdown (cobre CA-02, CA-03).
  - `TestClassifyNoteImage`: valida assinatura binária de AVIF (`ftypavif` / `ftypavis`) e WebP (`RIFF....WEBP`), recusa PNG/JPEG/PDF/lixo com `ErrInvalidFile`, recusa > 5 MB com `ErrFileTooLarge` e valida dimensões máximas de 1220 px (cobre CA-08, CA-12).
- **Backend, service (`classroom/service/service_notes_test.go`):**
  - `TestNoteBlocksCRUDAndPrivacy`: criação, listagem cronológica, edição e exclusão lógica pelo autor; recusa com `ErrForbidden` quando outro estudante, docente ou admin tenta editar/excluir/listar (cobre CA-02, CA-03, CA-04, CA-10).
  - `TestNoteImagesUploadAndProxyAuth`: upload grava em `notes/{student_id}/{id}.avif`, vincula imagem ao bloco e libera streaming no proxy apenas ao autor; outro estudante/docente recebe `ErrForbidden`; exclusão do bloco revoga a imagem (`ErrNoteImageNotFound`) (cobre CA-04, CA-10, CA-11, CA-12).
- **Backend, handler (`classroom/handler/handler_notes_test.go`):**
  - `TestNoteBlocksRoutes`: `GET`, `POST`, `PATCH`, `DELETE` em `/classes/:id/live/sessions/:sessionId/note-blocks`, conferindo status 200/201/204 e erros RFC 7807 (400, 403, 404) (cobre CA-02, CA-03, CA-04, CA-10).
  - `TestNoteImagesUploadAndMediaProxyRoutes`: `POST /note-images` (201, 400, 403, 413) e `GET /media/notes/:imageId` (200 com `Cache-Control: private, max-age=86400`, 401, 403 para outro discente, 404 para revogada) (cobre CA-10, CA-11, CA-12).
- **Backend, repository (`classroom/repository/repository_notes_test.go`):**
  - `TestNoteBlocksAndImagesRepository`: persistência no PostgreSQL real via testcontainers, ordem cronológica, atualização de `updated_at`, exclusão lógica do bloco com revogação das imagens associadas e reflexo em `SessionsWithNotes` (cobre CA-02, CA-03, CA-04).
- **Frontend (`StudentNotesPanel.test.tsx`, `noteImageOptimizer.test.ts`):**
  - `noteImageOptimizer.test.ts`: redimensiona imagem > 1220 px mantendo proporção, preserva dimensões <= 1220 px, codifica em `image/avif` e faz fallback para `image/webp` quando AVIF falha (cobre CA-07, CA-08).
  - `StudentNotesPanel.test.tsx`:
    - arraste com `translate3d`, botão de minimizar em pílula com contador de notas e persistência no `localStorage` (cobre CA-01);
    - criação de bloco com timestamp, edição com indicação de atualizado e exclusão com confirmação (cobre CA-02, CA-03, CA-04);
    - barra de formatação e atalhos `Ctrl+B` e `Ctrl+I` (cobre CA-05);
    - evento `paste` com imagem do clipboard acionando otimização, upload e inserção da URL proxy no editor (cobre CA-06);
    - renderização segura do Markdown (negrito, itálico, código, lista e imagem com classe responsiva) e bloqueio de tags HTML/XSS e URLs externas (cobre CA-09).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, `SPEC-051`; `backend/internal/modules/classroom/`; `frontend/src/components/Classroom/StudentNotesPanel/`.
2. **Ordem de execução:**
   - Passo 1 (Backend TDD): escrever os testes vermelhos de `domain`, `service`, `handler` e `repository` do módulo `classroom`, commitar `test(classroom): ...` e implementar migração `00037_note_blocks_and_images.sql`, domínio, repositório, serviço, rotas e método `GetObject` no `platform/storage`, commitando `feat(classroom): ...`.
   - Passo 2 (Frontend TDD): escrever os testes vermelhos de `noteImageOptimizer`, `classroomService` e `StudentNotesPanel`, commitar `test(classroom): ...` e implementar o otimizador de imagem, o renderizador Markdown sanitizado e o widget flutuante arrastável/minimizável em `StudentNotesPanel`, commitando `feat(classroom): ...`.
3. **Arquivos e diretórios a criar ou alterar:**
   - `specs/GLOSSARY.md`
   - `specs/features/071-caderno-dinamico-de-anotacoes-em-aula.md`
   - `backend/migrations/00037_note_blocks_and_images.sql`
   - `backend/internal/platform/storage/minio.go`
   - `backend/internal/modules/classroom/domain/notes.go` e `notes_test.go`
   - `backend/internal/modules/classroom/repository/notes.go` e `repository_notes_test.go`
   - `backend/internal/modules/classroom/service/notes.go`, `service.go` e `service_notes_test.go`
   - `backend/internal/modules/classroom/handler/notes.go`, `handler.go` e `handler_notes_test.go`
   - `frontend/src/services/classroomService.ts` e `classroomService.test.ts`
   - `frontend/src/components/Classroom/StudentNotesPanel/noteImageOptimizer.ts` e `noteImageOptimizer.test.ts`
   - `frontend/src/components/Classroom/StudentNotesPanel/NoteMarkdown.tsx`
   - `frontend/src/components/Classroom/StudentNotesPanel/StudentNotesPanel.tsx`, `StudentNotesPanel.module.scss` e `StudentNotesPanel.test.tsx`
   - `frontend/src/messages/pt-BR.ts`
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, cobertura acima de 80%, ESLint e Stylelint sem erros, nenhuma violação de `specs/ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências para aprovação

Nenhuma.

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 16/10/2026 | Aruna Architect | Criação e adequação às regras de `ARCHITECTURE.md` e `GLOSSARY.md` a partir da especificação técnica fornecida pelo Tech Lead |
| 16/10/2026 | Tech Lead (Ricardo Martins de Oliveira) | Aprovada para implementação ("Pode fazer sim chat") |
