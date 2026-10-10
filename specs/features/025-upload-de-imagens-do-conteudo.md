# SPEC-025: Upload de Imagens do Conteúdo (conversão para AVIF)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-025 |
| **Status** | Rascunho (aguardando aprovação) |
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
- O servidor valida que o arquivo é mesmo uma imagem, **converte para AVIF**, **limita a largura a 1220 px sem ampliar** imagens menores (proporção mantida) e **remove metadados** (EXIF, localização).
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
4. Codifica em **AVIF** e calcula o nome pelo conteúdo do resultado (P-01).
5. Grava no bucket (se já existir um objeto com o mesmo nome, não regrava) e devolve a URL pública, a largura, a altura e o tamanho.
6. O card guarda a URL no elemento. A legenda continua sendo texto livre.

### 3.2. Regras de negócio

| ID | Regra |
| :--- | :--- |
| RN-01 | Só `TEACHER` (dono do módulo) e `ADMIN` enviam imagens; há limite de envios por minuto |
| RN-02 | Formatos de entrada aceitos: JPEG, PNG, WebP, GIF e AVIF, até 10 MB. SVG é recusado (pode carregar script) |
| RN-03 | A decodificação é que decide: um arquivo que não decodifica como imagem é recusado com erro de validação, qualquer que seja a extensão |
| RN-04 | Largura máxima de saída 1220 px; imagem menor ou igual mantém a largura; a proporção é sempre mantida e a imagem nunca é ampliada |
| RN-05 | A saída é sempre AVIF, sem metadados; GIF animado vira a imagem do primeiro quadro (P-03) |
| RN-06 | O nome do objeto vem do conteúdo da saída, então a mesma imagem enviada de novo reaproveita o objeto |
| RN-07 | Imagens do conteúdo ficam sob o prefixo próprio do bucket e são legíveis publicamente, para o estudante ver sem sessão no arquivo (P-02) |
| RN-08 | Excluir o elemento ou o card não apaga o objeto do bucket, que pode ser usado por outro card (P-04) |

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
- [ ] **CA-06** (ubíquo): A imagem gravada NÃO DEVE conter metadados (EXIF, localização) e DEVE respeitar a orientação original.
- [ ] **CA-07** (evento): QUANDO o elemento Imagem recebe o envio, O SISTEMA DEVE mostrar a prévia, preencher o endereço sozinho e permitir trocar a imagem.
- [ ] **CA-08** (estado): ENQUANTO um card tem imagem por URL externa, O SISTEMA DEVE continuar mostrando-a como antes.
- [ ] **CA-09** (indesejado): SE quem envia não é `TEACHER` do módulo nem `ADMIN`, ENTÃO O SISTEMA DEVE responder 403.

## 8. Plano de Testes (Test Plan)

- **Domínio/serviço (Go):** redimensiona acima de 1220 e mantém abaixo; proporção; sem ampliar; recusa de SVG, arquivo não imagem, acima do limite e acima da dimensão máxima; remoção de metadados; orientação EXIF; nome estável para o mesmo conteúdo; GIF animado vira o primeiro quadro.
- **Handler (Go):** 201 com o corpo esperado, 400, 413, 429, 403 e 503, com o bucket simulado.
- **Frontend:** o elemento Imagem envia o arquivo, mostra prévia, preenche o endereço, troca a imagem, mostra o erro do servidor e mantém a URL externa antiga; o serviço chama a rota com `multipart`.
- **Integração:** um envio de verdade contra o MinIO local confere que o objeto é AVIF, com a largura certa.

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `ARCHITECTURE.md`, `GLOSSARY.md`, SPEC-019; no código, `platform/storage`, o fluxo de envio da foto do aluno (`student`) e `CardBuilder.tsx` (elemento Imagem).
2. **Ordem de execução:** (1) domínio da imagem (validação, redimensionamento, AVIF, nome); (2) rota e serviço; (3) serviço do frontend; (4) elemento Imagem com envio e prévia; (5) testes.
3. **Arquivos a criar ou alterar:** a definir na aprovação.
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, nenhuma violação de `specs/ARCHITECTURE.md`, status `Implementada`.

## 10. Pendências (com recomendação)

| ID | Pergunta | Recomendação |
| :--- | :--- | :--- |
| P-01 | "O nome deve ser conteúdo": é o **nome pelo conteúdo** (hash do arquivo) ou a pasta/prefixo `conteudo`? | Os dois: `conteudo/<hash-sha256>.avif`. O prefixo `conteudo/` separa essas imagens das outras do bucket e o hash dá nome estável, sem repetição e sem colisão |
| P-02 | Como o estudante lê a imagem? | Leitura pública só do prefixo `conteudo/*`, com cache longo (o nome por conteúdo nunca muda) |
| P-03 | GIF animado? | Vira a imagem do primeiro quadro; animação fica fora do escopo |
| P-04 | Apagar do bucket quando o elemento sai do card? | Não: o objeto pode estar em outro card; limpeza de órfãos fica para uma spec futura |
| P-05 | Onde converter para AVIF e com qual biblioteca? | No **servidor**, com uma biblioteca AVIF sem cgo (WebAssembly), para não depender de o navegador da docente codificar AVIF (nem todos codificam). Exige aprovar a dependência nova |
| P-06 | Manter também o campo de URL externa? | Sim, como segunda opção ("usar endereço"), para não quebrar o que já existe; o envio vira o caminho principal |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 10/10/2026 | Implementador (Claude) | Criação do rascunho a partir do pedido do Tech Lead; pendências P-01 a P-06 abertas com recomendação |
