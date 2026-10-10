# SPEC-025: Upload de Imagens do Conteúdo (conversão para AVIF)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-025 |
| **Status** | Implementada (revisões 1 e 2) |
| **Data de criação** | 10/10/2026 |
| **Última revisão** | 10/10/2026 |
| **Autor** | Implementador (Claude), a pedido do Tech Lead |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Ambos |
| **Módulo** | `content` (autoria de blocos), `platform/storage` (bucket); elemento Imagem do editor de cards |
| **Contexto de tela** | `/app/modules/[id]/cards/[cardId]`, elemento "Imagem" do card |
| **Prioridade** | Média |
| **Depende de** | SPEC-019 (autoria de blocos), SPEC-021 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead de 10/10/2026 |

---

## 1. Contexto e Problema (Context & Problem Statement)

Hoje o elemento **Imagem** do card pede só o "Endereço da imagem" (uma URL) e a legenda. A docente precisa hospedar a imagem em outro lugar e colar o endereço, o que quebra quando o link some, não controla peso nem tamanho e deixa o conteúdo dependente de terceiros.

O pedido do Tech Lead: a docente **envia a imagem para o sistema**; o sistema a **converte para AVIF**, **reduz a largura a no máximo 1220 px** (e mantém o tamanho original se ela for menor) e a **guarda no bucket**, com o nome dado pelo conteúdo.

## 2. Objetivos (Goals)

- O elemento Imagem passa a ter **envio de arquivo** (escolher ou arrastar), com prévia e botão para trocar.
- O servidor valida que o arquivo é mesmo uma imagem, **converte para AVIF**, **limita a largura a 1220 px sem ampliar** imagens menores (proporção mantida) e **remove metadados** (EXIF, localização). **GIF é exceção: mantém o formato e o arquivo originais** (D-01).
- A imagem é salva no bucket do sistema com um **nome determinado pelo conteúdo** (P-01) e o card passa a apontar para a URL dela.
- As imagens já cadastradas por URL continuam funcionando.

### 2.1. Fora de escopo (Non-Goals)

- Edição da imagem no navegador (recorte, rotação, filtros).
- Biblioteca de imagens reutilizável entre módulos (a mesma imagem enviada duas vezes já é guardada uma vez, pelo nome por conteúdo).
- Migração automática das imagens que hoje são URLs externas.
- Imagens da foto do aluno (já têm fluxo próprio).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Fluxo

1. A docente escolhe um arquivo no elemento Imagem. O navegador confere tipo e tamanho e envia (`multipart/form-data`).
2. O servidor lê o arquivo **decodificando-o** (a extensão e o tipo informado não bastam), recusa o que não for imagem aceita, aplica a orientação do EXIF e descarta os metadados.
3. Se a largura passa de **1220 px**, reduz para 1220 mantendo a proporção; se for menor ou igual, mantém. Nunca amplia.
4. Codifica em **AVIF** (exceto GIF, que segue como veio) e calcula o nome pelo conteúdo do arquivo que será guardado (P-01).
5. Grava no bucket (se já existir um objeto com o mesmo nome, não regrava) e devolve a URL pública, a largura, a altura e o tamanho.
6. O card guarda a URL no elemento. A legenda continua sendo texto livre.

### 3.2. Regras de negócio

| ID | Regra |
| :--- | :--- |
| RN-01 | Só `TEACHER` (dono do módulo) e `ADMIN` enviam imagens; há limite de envios por minuto |
| RN-02 | Formatos de entrada aceitos: JPEG, PNG, WebP, GIF e AVIF, até 10 MB. SVG é recusado (pode carregar script) |
| RN-03 | A decodificação é que decide: um arquivo que não decodifica como imagem é recusado com erro de validação, qualquer que seja a extensão |
| RN-04 | Largura máxima de saída 1220 px; imagem menor ou igual mantém a largura; a proporção é sempre mantida e a imagem nunca é ampliada |
| RN-04a | **GIF** (animado ou não) não é convertido nem redimensionado: é guardado como veio, com a extensão `.gif` (D-01). Vale o limite de 10 MB e o de dimensão decodificada |
| RN-05 | A saída dos demais formatos é sempre AVIF, sem metadados |
| RN-06 | O nome do objeto vem do conteúdo da saída, então a mesma imagem enviada de novo reaproveita o objeto |
| RN-07 | Imagens do conteúdo ficam sob o prefixo próprio do bucket e são legíveis publicamente, para o estudante ver sem sessão no arquivo (P-02) |
| RN-08 | As imagens **ficam sempre no bucket**: excluir o elemento ou o card não apaga o objeto, porque o sistema usa exclusão lógica (soft delete) e o conteúdo pode voltar ou ser usado por outro card (D-02) |

## 4. Modelo de Dados (Data Model)

Sem migração: a imagem é um objeto no bucket e o elemento Imagem já guarda uma URL. O payload do elemento continua `{ url, caption }`.

## 5. Contrato de API (API Contract)

`POST /api/v1/teacher/content/images` (`multipart/form-data`, campo `file`), autenticado, `TEACHER` ou `ADMIN`.

- **201** `{ "url": "http://…/conteudo/<nome>.avif", "width": 1220, "height": 686, "bytes": 48213 }`
- **400** (RFC 7807, `validation-error`) arquivo ausente, não é imagem, formato não aceito.
- **413** acima de 10 MB. **429** limite de envios. **403** perfil sem permissão. **503** bucket indisponível.

No frontend, `contentAuthoringService.uploadImage(file)` chama a rota e o elemento Imagem grava a `url` devolvida.

## 6. Impacto e Riscos (Impact & Risks)

- **Codificação AVIF no servidor (P-05):** o Go não tem codificador AVIF na biblioteca padrão. Exige uma dependência nova; a recomendação é uma biblioteca sem cgo (WebAssembly), para rodar igual no Windows de desenvolvimento e no contêiner. Custo: o primeiro uso é mais lento e cada conversão consome CPU, por isso o limite de envios e de 10 MB.
- **Segurança:** arquivo hostil (bomba de descompressão, imagem enorme em pixels): limitar também a **dimensão decodificada** (por exemplo 12.000 × 12.000) antes de decodificar tudo. SVG fica de fora de propósito.
- **Leitura pública do prefixo:** só o prefixo das imagens do conteúdo, nunca o bucket todo (P-02).
- **Compatibilidade:** navegadores atuais mostram AVIF; os antigos sem suporte não veriam a imagem. Aceito pelo pedido.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO a docente envia uma imagem JPEG, PNG, WebP, GIF ou AVIF válida, O SISTEMA DEVE guardar uma imagem AVIF no bucket e devolver a URL, a largura, a altura e o tamanho.
- [ ] **CA-02** (evento): QUANDO a imagem tem mais de 1220 px de largura, O SISTEMA DEVE reduzi-la a 1220 px mantendo a proporção.
- [ ] **CA-03** (estado): ENQUANTO a imagem tem 1220 px ou menos de largura, O SISTEMA DEVE manter a largura e NÃO DEVE ampliá-la.
- [ ] **CA-04** (indesejado): SE o arquivo não decodifica como imagem, é SVG ou passa de 10 MB, ENTÃO O SISTEMA DEVE recusá-lo com o motivo e não gravar nada no bucket.
- [ ] **CA-05** (evento): QUANDO a mesma imagem é enviada duas vezes, O SISTEMA DEVE reaproveitar o mesmo objeto, com o mesmo nome.
- [ ] **CA-06** (ubíquo): A imagem AVIF gravada NÃO DEVE conter metadados (EXIF, localização) e DEVE respeitar a orientação original.
- [ ] **CA-10** (evento): QUANDO o arquivo enviado é um GIF, O SISTEMA DEVE guardá-lo no formato original, sem converter nem redimensionar, preservando a animação.
- [ ] **CA-11** (estado): ENQUANTO um elemento ou card é excluído, O SISTEMA NÃO DEVE apagar a imagem do bucket.
- [ ] **CA-07** (evento): QUANDO o elemento Imagem recebe o envio, O SISTEMA DEVE mostrar a prévia, preencher o endereço sozinho e permitir trocar a imagem.
- [ ] **CA-08** (estado): ENQUANTO um card tem imagem por URL externa, O SISTEMA DEVE continuar mostrando-a como antes.
- [ ] **CA-09** (indesejado): SE quem envia não é `TEACHER` do módulo nem `ADMIN`, ENTÃO O SISTEMA DEVE responder 403.

## 8. Plano de Testes (Test Plan)

- **Domínio/serviço (Go):** redimensiona acima de 1220 e mantém abaixo; proporção; sem ampliar; recusa de SVG, arquivo não imagem, acima do limite e acima da dimensão máxima; remoção de metadados; orientação EXIF; nome estável para o mesmo conteúdo; GIF guardado byte a byte, com `.gif` e animação intacta.
- **Handler (Go):** 201 com o corpo esperado, 400, 413, 429, 403 e 503, com o bucket simulado.
- **Frontend:** o elemento Imagem envia o arquivo, mostra prévia, preenche o endereço, troca a imagem, mostra o erro do servidor e mantém a URL externa antiga; o serviço chama a rota com `multipart`.
- **Integração:** um envio de verdade contra o MinIO local confere que o objeto é AVIF, com a largura certa.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-019; no código, `platform/storage`, o fluxo de envio da foto do aluno (`student`) e `CardBuilder.tsx` (elemento Imagem).
2. **Ordem de execução:** (1) domínio da imagem (validação, redimensionamento, AVIF, nome); (2) rota e serviço; (3) serviço do frontend; (4) elemento Imagem com envio e prévia; (5) testes.
3. **Arquivos a criar ou alterar:** a definir na aprovação.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, status `Implementada`.

## 10. Decisões e pendências

### Decisões do Tech Lead (10/10/2026)

| ID | Decisão |
| :--- | :--- |
| D-01 | GIF mantém o formato original: não é convertido para AVIF nem redimensionado (substitui a recomendação P-03, de virar um quadro estático) |
| D-02 | As imagens são mantidas no bucket, pois o sistema faz exclusão lógica (substitui P-04) |

| D-03 | Nome do objeto: `conteudo/<sha-256 do arquivo guardado>.avif` (ou `.gif`) |
| D-04 | Leitura pública apenas do prefixo `conteudo/`, com cache longo e imutável |
| D-05 | Conversão para AVIF no servidor, com uma biblioteca sem cgo (WebAssembly): `github.com/gen2brain/avif`, com `github.com/disintegration/imaging` para orientação e redimensionamento |
| D-06 | O campo de endereço externo continua, como segunda opção |

### Pendências

Nenhuma em aberto: P-01, P-02, P-05 e P-06 viraram as decisões D-03 a D-06.

### Ajustes de implementação (sem desvio de escopo)

| ID | Ajuste |
| :--- | :--- |
| A-01 | O sanitizador do servidor e a verificação do editor só aceitavam imagem `https://`, e o bucket de uma máquina de desenvolvimento serve em `http`. Passam a aceitar também o endereço **no formato exato do nome que o sistema gera** (`<host>/<bucket>/conteudo/<sha-256>.avif` ou `.gif`, em http ou https); qualquer outro endereço http continua recusado |
| A-02 | A rota é aberta a qualquer `TEACHER` ou `ADMIN`, e não só ao dono de um módulo, porque o envio não pertence a um módulo (CA-09 vale para quem não tem um desses perfis) |
| A-03 | A leitura pública do prefixo `conteudo/` é **acrescentada** à política que o bucket já tem (e não a substitui), a cada inicialização do servidor, para não derrubar o que já estava liberado |
| A-04 | Limites: 30 envios por minuto por usuário, 2 conversões ao mesmo tempo, até 12.000 px de lado e 64 milhões de pixels decodificados; arquivos com cabeçalho acima disso são recusados antes de decodificar |
| A-05 | Um elemento Imagem vazio pede "Envie uma imagem ou informe o endereço"; o campo de endereço continua disponível como segunda opção (P-06) |
| A-06 | O teste de integração com o MinIO só roda quando as variáveis `MINIO_*` estão no ambiente |

---

## 11. Revisão 2: galeria de imagens e envio como único caminho

Pedido do Tech Lead de 10/10/2026, sobre a revisão 1 implementada. **O código só muda depois da aprovação.**

### 11.1. O que muda

- **Sem campo de endereço.** O elemento Imagem deixa de ter o campo "Endereço da imagem": a imagem entra **só por envio de arquivo**. Isso **substitui** a decisão D-06 (endereço externo como segunda opção) e a regra do CA-08 para a edição; a docente não digita mais URL.
- **Galeria.** O elemento passa a guardar **uma ou mais imagens**, cada uma com a sua legenda, e se mostra ao estudante como galeria. O elemento passa a se chamar **"Imagens"** (a docente insere um elemento e envia quantas imagens quiser, até o limite).

### 11.2. Regras de negócio

| ID | Regra |
| :--- | :--- |
| RN-09 | Um elemento Imagens tem de 1 a 12 imagens (P-07). Cada imagem tem a sua legenda e a sua prévia |
| RN-10 | A docente envia vários arquivos de uma vez (seleção múltipla) ou um por vez; cada arquivo segue as regras de 1 a 8 (conversão, 1220 px, GIF intacto, limite de 10 MB por arquivo). Os envios de um mesmo gesto correm um de cada vez, e cada imagem mostra o seu estado (enviando, pronta, com erro) |
| RN-11 | A docente reordena (↑ ↓), remove e troca cada imagem, e edita a legenda. Remover tira a imagem do card, não do bucket (RN-08) |
| RN-12 | Uma imagem sem arquivo enviado (ainda enviando ou com erro) não deixa salvar o card, com a mensagem do motivo. Um elemento sem nenhuma imagem também não |
| RN-13 | Com **1 imagem** o estudante vê uma figura simples, como hoje. Com **2 ou mais**, vê uma grade que se ajusta à largura da tela, com a legenda sob cada imagem (P-08) |
| RN-14 | **Compatibilidade:** o card que já tem uma imagem (`<figure class="md-image">`) abre como um elemento Imagens com 1 imagem e continua igual para o estudante. Uma imagem que veio de um endereço externo continua sendo mostrada e pode ser trocada por um envio, mas não se cadastra mais endereço novo |
| RN-15 | A legenda de cada imagem é também o texto alternativo dela (acessibilidade) |

### 11.3. Como fica guardado

Continua sendo HTML do bloco, sem mudança de API nem de migração. Uma imagem é a figura de hoje; uma galeria é um contêiner com várias figuras:

```html
<div class="md-gallery">
  <figure class="md-image"><img src="…/conteudo/<hash>.avif" alt="Legenda"><figcaption>Legenda</figcaption></figure>
  <figure class="md-image">…</figure>
</div>
```

O sanitizador já aceita `div`, `figure`, `figcaption` e `img` com o endereço do sistema; só a classe `md-gallery` entra na lista de classes (as classes já são livres por padrão de nome).

### 11.4. Critérios de aceite da revisão 2

- [ ] **CA-12** (ubíquo): O elemento Imagens NÃO DEVE ter campo para digitar o endereço da imagem; a imagem só entra por envio de arquivo.
- [ ] **CA-13** (evento): QUANDO a docente escolhe vários arquivos, O SISTEMA DEVE enviar e converter um de cada vez e mostrar o estado de cada imagem, sem perder as que deram certo se uma falhar.
- [ ] **CA-14** (evento): QUANDO a docente reordena, remove, troca uma imagem ou edita uma legenda, O SISTEMA DEVE refletir na prévia na hora e guardar na ordem mostrada.
- [ ] **CA-15** (indesejado): SE o elemento não tem imagem, ou alguma imagem ainda não foi enviada, ENTÃO O SISTEMA DEVE impedir o salvamento do card e dizer o motivo.
- [ ] **CA-16** (estado): ENQUANTO o elemento tem 1 imagem, O SISTEMA DEVE mostrá-la como figura simples ao estudante, e com 2 ou mais, como galeria.
- [ ] **CA-17** (indesejado): SE o elemento já tem 12 imagens, ENTÃO O SISTEMA DEVE recusar novas e dizer o limite.
- [ ] **CA-18** (estado): ENQUANTO um card tem a imagem única da revisão 1 (de envio ou de endereço externo), O SISTEMA DEVE abri-la como Imagens com 1 imagem e mostrá-la ao estudante como antes.

### 11.5. Plano de testes da revisão 2

Modelo do card (ler e escrever uma e várias imagens, a imagem antiga, o limite, a legenda como alt, a validação de 1 a 12 e de imagem pendente), o elemento no editor (vários envios em ordem, falha de uma sem perder as outras, reordenar, remover, trocar, legenda, sem campo de endereço, limite), a exibição ao estudante (figura simples e grade) e o sanitizador com a classe `md-gallery`.

### 11.6. Decisões da revisão 2 (aprovadas pelo Tech Lead em 10/10/2026, as recomendações do rascunho)

| ID | Decisão |
| :--- | :--- |
| D-07 | No máximo 12 imagens por elemento: cabe folgado no limite de 50.000 caracteres do bloco e evita uma página pesada |
| D-08 | O estudante vê a galeria numa grade que se ajusta à tela, com a legenda sob cada imagem e **clique para ampliar** numa janela, com setas para passar de uma à outra e Esc para fechar |
| D-09 | Sem legenda geral do conjunto: cada imagem tem a sua, e uma legenda geral pode ser um elemento de texto antes ou depois |

### 11.7. Ajustes de implementação da revisão 2 (sem desvio de escopo)

| ID | Ajuste |
| :--- | :--- |
| A-07 | O elemento é chamado "Imagens (galeria)" no editor. Os envios de um mesmo gesto entram na lista de uma vez, esperando, e seguem um de cada vez; um que falha fica marcado e não derruba os outros; remover o que ainda espera na fila cancela o envio dele |
| A-08 | A grade usa `object-fit: contain` num quadro 4:3, para não cortar capturas de tela; as imagens da galeria ficam alcançáveis pelo teclado (Enter ou Espaço amplia) e anunciadas como botões, e o foco volta à imagem ao fechar |
| A-09 | O estilo da grade usa o seletor de atributo `[class~="md-gallery"]`, porque a regra de estilo do projeto proíbe `:global` |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 10/10/2026 | Implementador (Claude) | Criação do rascunho a partir do pedido do Tech Lead; pendências P-01 a P-06 abertas com recomendação |
| 10/10/2026 | Tech Lead | GIF mantém o formato original (D-01); as imagens ficam sempre no bucket, porque o sistema faz exclusão lógica (D-02) |
| 10/10/2026 | Tech Lead | Aprovada, aceitas as recomendações de P-01, P-02, P-05 e P-06 (viram D-03 a D-06) |
| 10/10/2026 | Implementador (Claude) | Implementada: domínio da imagem (AVIF, 1220 px, GIF intacto), rota de envio, armazenamento com nome por conteúdo e leitura pública do prefixo, elemento Imagem com envio e prévia. Ajustes A-01 a A-06 |
| 10/10/2026 | Tech Lead | Pedido de revisão 2: tirar o campo de endereço da imagem (substitui D-06) e permitir várias imagens por elemento, estilo galeria. Pendências P-07 a P-09 |
| 10/10/2026 | Tech Lead | Aprovada a revisão 2, aceitas as recomendações de P-07 a P-09 (viram D-07 a D-09) |
| 10/10/2026 | Implementador (Claude) | Implementada a revisão 2: elemento Imagens com várias imagens (envio em fila, legenda, ordem, troca, limite de 12), sem campo de endereço, galeria com ampliação para o estudante, leitura das imagens da revisão 1 como galeria de uma. Ajustes A-07 a A-09 |
