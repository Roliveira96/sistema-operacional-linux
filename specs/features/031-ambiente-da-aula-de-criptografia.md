# SPEC-031: Ambiente da aula de criptografia (comandos de criptografia no terminal e módulo de ensino)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-031 |
| **Status** | Rascunho |
| **Data de criação** | 10/10/2026 |
| **Última revisão** | 10/10/2026 |
| **Autor** | Aruna Architect (redigida por agente de IA a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend (motor do terminal) e conteúdo (módulo de ensino pelo servidor MCP) |
| **Módulo** | `engine` (adaptador do motor em `frontend/src/engine/`) e o módulo de ensino "Criptografia no Linux" |
| **Contexto de tela** | Terminal dos cards e dos exercícios; nenhuma tela nova |
| **Prioridade** | Média |
| **Depende de** | SPEC-014, SPEC-020, SPEC-021, SPEC-022, SPEC-023, SPEC-024, SPEC-027, SPEC-028, SPEC-030 |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead de 10/10/2026 (preparar o ambiente para a aula de criptografia). `docs/arquitetura/transicao-backend.md` não trata do motor do terminal. |

---

## 1. Contexto e Problema (Context & Problem Statement)

A docente vai dar uma aula de criptografia na disciplina de Sistemas Operacionais, e quer que os estudantes pratiquem no terminal do navegador, sem instalar nada. Hoje o motor não permite isso:

- o `openssl` só responde a `openssl version`;
- existem `md5sum` e `sha256sum` (SPEC-028), mas não os outros resumos (`sha1sum`, `sha512sum`);
- não existem `ssh-keygen`, `gpg`, `base32`, `od` nem `hexdump`;
- não há um módulo de ensino com o cenário da aula (arquivos de exemplo, usuários que trocam mensagens, listas de somas publicadas).

Resultado: a aula teria de ser teórica, ou feita fora da plataforma, sem a correção automática dos exercícios.

## 2. Objetivos (Goals)

- Os estudantes conseguem, no terminal do navegador, praticar os temas da aula: resumo (hash) e integridade, codificação (que não é criptografia), criptografia simétrica, criptografia de chave pública, assinatura digital, certificados, chaves SSH e senhas armazenadas como hash.
- Os comandos fazem a criptografia **de verdade** (não uma imitação), com o formato de arquivo do Ubuntu, de modo que o que o estudante gera aqui é reconhecido por uma máquina real.
- Existe um módulo de ensino "Criptografia no Linux" com o cenário pronto, cards explicados e exercícios práticos corrigidos pelo sistema.
- Cada comando novo traz ajuda (`--help`, SPEC-027) e entra no manifesto de conformidade (SPEC-030).

### 2.1. Fora de escopo (Non-Goals)

- Qualquer alteração em `legacy/` (os comandos entram em `frontend/src/engine/`, como na SPEC-028).
- GnuPG (`gpg`), `b2sum`, `shasum`, `mkpasswd`, `age` e `ssh-add`: ficam fora desta spec (decisão do Tech Lead).
- Rede real: `openssl s_client`, `ssh` para outra máquina e `gpg --recv-keys` não saem do navegador. O `ssh-copy-id` e a troca de chaves entre estudantes se fazem pelas abas do terminal (várias contas na mesma máquina simulada).
- Compatibilidade com algoritmos antigos e inseguros por padrão (DES, RC4, MD4): quando existirem, vêm com aviso (RN-07).
- Chaves de produção: o ambiente é de aula, e as chaves geradas valem só dentro do simulador (RN-08).
- Criar uma tela nova ou mudar o terminal.
- Um sistema de correção que verifique a validade criptográfica das chaves no servidor. A correção usa as condições que já existem (arquivo, permissão e conteúdo) e a condição "conteúdo contém `-----BEGIN ...`" (RN-13).

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Não há tela nova. Os comandos aparecem em todo terminal que usa o motor. Todos são feitos por código novo em `frontend/src/engine/` (um grupo por arquivo), registrados como na SPEC-028.

**Entrega A: resumos e codificação**

| Comando | Opções aceitas | Comportamento |
| :--- | :--- | :--- |
| `sha1sum`, `sha224sum`, `sha384sum`, `sha512sum` | `-c` (conferir), arquivos ou entrada padrão | Como o `sha256sum` da SPEC-028: soma verdadeira, dois espaços, nome. Com `-c`, "OK" ou "FALHOU". |
| `sha256sum` (ajuste) | já existe | Passa a aceitar `--check` e `--ignore-missing`, para conferir listas de somas publicadas (por exemplo, a de uma ISO). |
| `cksum` | arquivos ou entrada padrão | CRC e tamanho em bytes, no formato do `cksum` do Ubuntu. |
| `base32` | `-d`, `-w` | Codifica e decodifica em base32. |
| `od` | `-A` (base do endereço), `-t` (formato: `x1`, `c`, `d1`), `-N` | Despejo octal e hexadecimal de um arquivo. |
| `hexdump` | `-C` | Despejo hexadecimal com o texto ao lado. |

**Entrega B: openssl**

| Subcomando do `openssl` | Opções aceitas | Comportamento |
| :--- | :--- | :--- |
| `version` | `-a` | Versão e dados de compilação (já existe a primeira forma). |
| `rand` | `-hex N`, `-base64 N`, `-out ARQUIVO` | N bytes aleatórios de verdade. |
| `dgst` | `-md5`, `-sha1`, `-sha256`, `-sha512`, `-hmac CHAVE`, `-sign CHAVE`, `-verify CHAVEPUB`, `-signature ARQUIVO`, `-out` | Resumo, HMAC, assinatura e verificação. Saída no formato `SHA2-256(arquivo)= soma`. |
| `enc` | `-aes-128-cbc`, `-aes-256-cbc`, `-aes-256-ctr`, `-pbkdf2`, `-iter N`, `-salt`, `-S`, `-K`, `-iv`, `-pass pass:SENHA`, `-k`, `-a`, `-d`, `-in`, `-out` | Cifra e decifra. Com `-pbkdf2`, o arquivo cifrado começa com `Salted__` e é compatível com o `openssl enc` do Ubuntu. Com `-K` e `-iv` o resultado é determinístico, para ensinar e testar. |
| `genpkey`, `genrsa` | `-algorithm RSA`, `-pkeyopt rsa_keygen_bits:N`, `-algorithm ED25519`, `N`, `-out` | Gera a chave privada em PEM (`BEGIN PRIVATE KEY`). RSA de 2048 e 4096 bits. |
| `rsa`, `pkey` | `-in`, `-pubout`, `-text`, `-noout`, `-modulus`, `-out` | Mostra a chave, extrai a pública (`BEGIN PUBLIC KEY`) e dá os detalhes. |
| `pkeyutl` | `-encrypt`, `-decrypt`, `-sign`, `-verify`, `-pubin`, `-inkey`, `-in`, `-out`, `-sigfile` | Cifra e decifra com chave pública e privada; assina e verifica. |
| `req` | `-x509`, `-newkey rsa:N`, `-nodes`, `-keyout`, `-out`, `-days`, `-subj`, `-new`, `-key`, `-text`, `-noout` | Cria pedido de certificado e certificado autoassinado. |
| `x509` | `-in`, `-text`, `-noout`, `-subject`, `-issuer`, `-dates`, `-enddate`, `-fingerprint`, `-req`, `-CA`, `-CAkey`, `-CAcreateserial`, `-days`, `-out` | Mostra e assina certificados. |
| `verify` | `-CAfile`, certificado | Confere a cadeia: "OK" ou o motivo da falha. |
| `passwd` | `-1`, `-5`, `-6`, `-salt`, senha | Gera o hash de senha no formato de `/etc/shadow` (`$6$sal$...`). |
| `speed`, `s_client`, `s_server` | nenhuma | Respondem "o simulador não abre conexões de rede" e terminam com 1. |

**Entrega C: chaves SSH**

| Comando | Opções aceitas | Comportamento |
| :--- | :--- | :--- |
| `ssh-keygen` | `-t rsa\|ed25519`, `-b`, `-f`, `-N`, `-C`, `-l -f`, `-y -f`, `-q`, `-R` | Cria o par de chaves no formato OpenSSH, grava `arquivo` com modo 600 e `arquivo.pub` com modo 644, mostra a impressão digital e a arte "randomart". |
| `ssh-copy-id` | `-i`, `usuario@destino` | Acrescenta a chave pública ao `~/.ssh/authorized_keys` de uma conta da própria máquina simulada, com as permissões certas (pasta 700, arquivo 600). |

**Entrega D: GnuPG (fica para depois, decisão do Tech Lead)**

| Comando | Opções aceitas | Comportamento |
| :--- | :--- | :--- |
| `gpg` | `--batch`, `--gen-key`, `--quick-generate-key`, `--list-keys`, `--list-secret-keys`, `--fingerprint`, `--armor`, `--export`, `--import`, `--encrypt -r`, `--decrypt`, `--symmetric`, `--sign`, `--detach-sign`, `--verify`, `--output`, `--passphrase` | Chaveiro por usuário em `~/.gnupg`. Formato ASCII armored. Esta entrega não é implementada nesta spec: fica para uma revisão futura, se a aula pedir. |

**Entrega E: módulo de ensino e exercícios**

O módulo "Criptografia no Linux" é montado pelo servidor MCP (SPEC-024), depois que as entregas A a C passarem, com estes cards, cada um com texto, comandos para rodar e pelo menos um exercício prático:

| Card | Tema |
| :--- | :--- |
| 1 | O que é criptografia e para que serve no sistema operacional |
| 2 | Resumo (hash) e integridade: `sha256sum` e conferência de lista publicada |
| 3 | Codificar não é cifrar: base64, base32, hexadecimal |
| 4 | Criptografia simétrica: `openssl enc` com AES |
| 5 | Criptografia de chave pública: RSA com `openssl` |
| 6 | Assinatura digital: assinar e verificar |
| 7 | Certificados: autoridade certificadora, certificado autoassinado, cadeia |
| 8 | Chaves SSH: `ssh-keygen`, `authorized_keys` e permissões |
| 9 | Senhas no sistema: hash, sal e `/etc/shadow` |
| 10 | Boas práticas: tamanho de chave, permissões, descarte seguro |

**Cenário do módulo (estado inicial da máquina):** a pasta `/home/aluno/cripto` com mensagem, contrato e relatório de exemplo; uma lista de somas publicada (`SHA256SUMS`) e um arquivo de "imagem de disco" pequeno cujo conteúdo bate (ou, de propósito, não bate) com a soma; as contas `alice` e `bob`, com pasta pessoal, para o exercício de troca de mensagens cifradas em duas abas do terminal.

### 3.2. Backend (Go — Camada de Módulo/Service)

Não se aplica nesta spec: o terminal roda no cliente e a entrega E usa só ferramentas MCP já existentes (SPEC-024). Nenhuma rota, tabela ou regra de servidor muda (a correção está na RN-13).

**Regras de negócio**

- **RN-01 (criptografia verdadeira):** hash, HMAC, cifras, RSA, Ed25519 e derivação de chave usam a criptografia real do navegador (interface padrão de criptografia da plataforma web), e saem nos formatos do Ubuntu: PEM (PKCS#8 para a chave privada e SPKI para a pública), o cabeçalho `Salted__` do `openssl enc`, o formato OpenSSH das chaves SSH. O que o estudante gera aqui é aceito por uma máquina real, e o contrário também.
- **RN-02 (determinismo quando o aluno pede):** com `-K` e `-iv` (e `-S`), o `openssl enc` dá sempre a mesma saída, para o professor mostrar a diferença entre cifrar com e sem sal e para os testes terem valor fixo. Sem eles, o sal e o vetor são sorteados.
- **RN-03 (registro sem tocar no motor):** os comandos são registrados e ganham binário no `PATH` como na SPEC-028 (RN-01), em `/usr/bin` (`openssl`, `ssh-keygen`, `gpg`, resumos) e nunca em `legacy/`. O `openssl` já existente passa a ser substituído por um novo, que mantém `openssl version` como hoje.
- **RN-04 (ajuda e manifesto):** todo comando novo traz ajuda estruturada (SPEC-027, RN-14 da SPEC-028) e um item no manifesto de conformidade no mesmo commit (SPEC-030, RN-08).
- **RN-05 (arquivos e permissões como no Linux):** `ssh-keygen` e `openssl genpkey` gravam a chave privada com modo 600; a pública, com 644. Uma chave privada com modo aberto faz o `ssh` e o `ssh-keygen -y` avisarem "unprotected private key file" e recusarem, como no Ubuntu. A pasta `~/.ssh` nasce com modo 700.
- **RN-06 (tamanho e tempo):** o RSA aceita 1024 (com aviso), 2048 e 4096 bits. A geração de 4096 bits mostra que pode demorar e não trava a tela. Chave de tamanho maior ou abaixo de 1024 é recusada. Cada comando termina em até 30 segundos ou avisa que passou do limite e termina com erro.
- **RN-07 (aviso de algoritmos fracos):** MD5 e SHA-1 funcionam (a aula os ensina), e a ajuda e o card avisam que não servem para segurança. Algoritmos quebrados e removidos (MD4, RC4, DES simples) respondem "algoritmo desconhecido no simulador".
- **RN-08 (chaves de aula):** as chaves são guardadas no estado da máquina simulada. A tela do módulo e o primeiro card avisam em destaque que são chaves de treino, para nunca usar as mesmas em sistemas reais.
- **RN-09 (mensagens no estilo do Ubuntu):** erro de arquivo, de senha errada (`bad decrypt`), de chave inválida e de opção desconhecida usa o texto e o código de saída do comando real. O texto fixo fica em arquivo de mensagens do adaptador (como na SPEC-028, RN-06).
- **RN-10 (sem rede):** nenhum comando abre conexão. Os que dependeriam de rede respondem como na lista da seção 3.1 e terminam com erro.
- **RN-11 (senhas na linha de comando):** `-pass pass:SENHA` e `-k` funcionam para o estudante praticar, e o card ensina que isso deixa a senha no histórico do shell. Sem a opção, o comando pergunta a senha duas vezes (cifrar) ou uma (decifrar), pelo mesmo mecanismo de perguntas do terminal.
- **RN-13 (correção dos exercícios):** os exercícios usam só as condições existentes: o arquivo existe, o modo é o esperado e o conteúdo contém um trecho fixo, como `-----BEGIN PRIVATE KEY-----`, `-----BEGIN CERTIFICATE-----`, `Verified OK` ou `Salted__`. Condições novas no servidor ficam para uma spec futura, se a docente precisar.
- **RN-14 (algoritmos suportados):** RSA e Ed25519. O Ed25519 funciona onde o navegador o oferece; onde não, o comando responde "algoritmo não disponível neste navegador" e orienta usar RSA, e a aula funciona só com RSA. O RSA aceita 1024 (com aviso), 2048 e 4096 bits (RN-06).
- **RN-12 (sobrevive ao recomeçar):** chaves, certificados e arquivos cifrados entram no estado serializado (SPEC-014, SPEC-021) e voltam iguais ao recomeçar ou restaurar a máquina.

## 4. Modelo de Dados (Data Model)

Não há mudança de schema, entidade ou migração. Os dados criados pelo estudante são arquivos comuns da máquina simulada (chaves PEM, certificados, arquivos cifrados, chaveiro do GnuPG), dentro do formato de estado já definido na SPEC-014 e na SPEC-021. O tamanho do estado continua limitado a 2 MB (SPEC-014); as chaves e arquivos de aula ficam muito abaixo disso.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: nenhuma rota REST ou evento de tempo real é criado ou alterado.

## 6. Impacto e Riscos (Impact & Risks)

- **Risco: o estudante usar uma chave de aula em sistema real.** *Mitigação:* RN-08, com aviso no primeiro card e na ajuda do `ssh-keygen` e do `openssl genpkey`.
- **Risco: lentidão ao gerar RSA no navegador (principalmente 4096 bits), em máquina fraca.** *Mitigação:* RN-06: padrão de 2048, aviso, limite de tempo e tamanho máximo.
- **Risco: saída aleatória atrapalhar a correção e os testes.** *Mitigação:* RN-02 (determinismo opcional); as condições dos exercícios olham arquivo, modo e formato, nunca o valor sorteado; testes usam vetores conhecidos e ida e volta (cifrar e decifrar).
- **Risco: suporte do navegador a algoritmos específicos (Ed25519).** *Mitigação:* RN-14; o RSA é suportado em todos os navegadores atuais.
- **Risco: chave privada guardada no estado enviado ao servidor na conferência.** São chaves de treino, sem valor. *Mitigação:* RN-08 e a regra de nunca usar chaves reais.
- **Risco: o `openssl` novo mudar o que já funcionava (`openssl version`).** *Mitigação:* teste de regressão da saída atual.
- **Risco: GnuPG ser grande demais para a aula.** *Mitigação:* a entrega D (GnuPG) ficou de fora desta spec.
- **Impacto em `legacy/`:** nenhum arquivo alterado. **Impacto no manifesto de conformidade (SPEC-030):** cada comando novo exige o seu item.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (evento): QUANDO o estudante rodar `sha1sum`, `sha512sum`, `sha224sum`, `sha384sum`, `cksum`, `base32`, `od` ou `hexdump`, O SISTEMA DEVE produzir o mesmo resultado que o Ubuntu para o mesmo conteúdo (vetores conhecidos).
- [ ] **CA-02** (evento): QUANDO o estudante conferir uma lista de somas com `sha256sum -c` (ou `--check`), O SISTEMA DEVE mostrar "OK" por arquivo íntegro e "FALHOU" por arquivo alterado, e terminar com 1 se algum falhar.
- [ ] **CA-03** (evento): QUANDO o estudante rodar `openssl dgst` com `-sha256`, `-sha512`, `-md5`, `-sha1` ou `-hmac`, O SISTEMA DEVE imprimir o resumo ou o HMAC igual ao do Ubuntu (vetores da RFC 4231 para o HMAC).
- [ ] **CA-04** (evento): QUANDO o estudante cifrar com `openssl enc -aes-256-cbc -pbkdf2` e decifrar com `-d` e a mesma senha, O SISTEMA DEVE devolver exatamente o texto original; E QUANDO a senha estiver errada, ENTÃO O SISTEMA DEVE falhar com `bad decrypt` e código 1.
- [ ] **CA-05** (evento): QUANDO o estudante usar `-K` e `-iv` com `openssl enc`, O SISTEMA DEVE gerar sempre o mesmo arquivo cifrado, igual ao resultado conhecido do `openssl` do Ubuntu (RN-02).
- [ ] **CA-06** (evento): QUANDO o estudante gerar uma chave com `openssl genpkey` ou `genrsa`, extrair a pública com `openssl rsa -pubout` e cifrar com `pkeyutl -encrypt`, O SISTEMA DEVE decifrar com `pkeyutl -decrypt` e a chave privada, devolvendo o texto original, com os arquivos em PEM e modos 600 e 644.
- [ ] **CA-07** (evento): QUANDO o estudante assinar um arquivo com `openssl dgst -sign` (ou `pkeyutl -sign`) e verificar com a chave pública, O SISTEMA DEVE responder "Verified OK"; E QUANDO o arquivo for alterado depois de assinado, ENTÃO O SISTEMA DEVE responder "Verification failure" e terminar com 1.
- [ ] **CA-08** (evento): QUANDO o estudante criar um certificado com `openssl req -x509` e ler com `openssl x509 -text`, O SISTEMA DEVE mostrar o assunto, o emissor, as datas e a impressão digital; E QUANDO assinar um pedido com uma autoridade criada por ele e rodar `openssl verify -CAfile`, ENTÃO O SISTEMA DEVE responder "OK".
- [ ] **CA-09** (evento): QUANDO o estudante rodar `openssl passwd -6 -salt SAL SENHA`, O SISTEMA DEVE imprimir o hash no formato `$6$SAL$...`, igual ao do Ubuntu para os mesmos dados.
- [ ] **CA-10** (evento): QUANDO o estudante rodar `ssh-keygen -t ed25519` (ou `rsa -b 2048`) com `-f`, O SISTEMA DEVE criar `arquivo` com modo 600 e `arquivo.pub` com modo 644, mostrar a impressão digital e a arte randomart, e `ssh-keygen -l -f arquivo.pub` DEVE mostrar a mesma impressão digital.
- [ ] **CA-11** (evento): QUANDO o estudante usar `ssh-copy-id` para uma conta da máquina, O SISTEMA DEVE gravar a chave em `~/.ssh/authorized_keys` dessa conta, com a pasta `.ssh` em 700 e o arquivo em 600.
- [ ] **CA-12** (indesejado): SE a chave privada tiver permissão aberta, ENTÃO O SISTEMA DEVE avisar "unprotected private key file" e recusar o uso (RN-05).
- [ ] **CA-13** (indesejado): SE o estudante pedir RSA com tamanho fora de 1024, 2048 ou 4096 bits, ou um algoritmo removido, ENTÃO O SISTEMA DEVE recusar com mensagem clara e código 1 (RN-06, RN-07).
- [ ] **CA-14** (indesejado): SE o estudante pedir `openssl s_client`, `s_server` ou `speed`, ENTÃO O SISTEMA DEVE responder que o simulador não abre conexões de rede e terminar com 1 (RN-10).
- [ ] **CA-15** (ubíquo): O SISTEMA DEVE manter `openssl version` com a saída de antes (regressão), e todo comando novo DEVE responder a `--help` com o uso começando pelo nome (SPEC-027).
- [ ] **CA-16** (estado): ENQUANTO a máquina for serializada e restaurada, O SISTEMA DEVE manter chaves, certificados e arquivos cifrados iguais (RN-12).
- [ ] **CA-17** (ubíquo): O SISTEMA DEVE ter um item no manifesto de conformidade para cada comando novo, e o teste da SPEC-030 DEVE passar (RN-04).
- [ ] **CA-18** (evento): QUANDO a docente abrir o módulo "Criptografia no Linux", O SISTEMA DEVE mostrar os cards da seção 3.1 com o cenário (pasta `/home/aluno/cripto`, `SHA256SUMS`, contas `alice` e `bob`), com pelo menos um exercício prático por card, e o teste do módulo e o do banco de exercícios DEVEM passar.
- [ ] **CA-19** (ubíquo): O SISTEMA NÃO DEVE alterar nenhum arquivo de `legacy/` nem abrir conexão de rede.

## 8. Plano de Testes (Test Plan)

- **Backend:** não se aplica nesta spec.
- **Frontend (Vitest):** testes de cada comando contra o motor real, no estilo dos testes de `frontend/src/engine/commands/*.engine.test.ts`, com vetores conhecidos (NIST para os resumos, RFC 4231 para o HMAC, resultados do `openssl` do Ubuntu para o AES com `-K` e `-iv`) e testes de ida e volta (cifrar e decifrar, assinar e verificar, gerar e carregar chave).

| Teste | Cobre |
| :--- | :--- |
| Vetores dos resumos, `cksum`, `base32`, `od`, `hexdump` | CA-01 |
| `sha256sum -c` com lista íntegra e com arquivo alterado | CA-02 |
| `openssl dgst` em cada algoritmo e o HMAC | CA-03 |
| `openssl enc`: ida e volta, senha errada, entrada e saída em base64 | CA-04 |
| `openssl enc` com `-K` e `-iv`: saída fixa | CA-05 |
| RSA: gerar, extrair a pública, cifrar e decifrar, modos dos arquivos | CA-06 |
| Assinatura: verificar, alterar o arquivo, verificar de novo | CA-07 |
| Certificados: autoassinado, autoridade, pedido, assinatura, `verify` | CA-08 |
| `openssl passwd` com sal fixo | CA-09 |
| `ssh-keygen`: arquivos, modos, impressão digital igual e randomart | CA-10 |
| `ssh-copy-id` e as permissões de `.ssh` | CA-11 |
| Chave com modo aberto recusada | CA-12 |
| Tamanhos e algoritmos recusados | CA-13 |
| `s_client`, `s_server` e `speed` recusados | CA-14 |
| Regressão do `openssl version` e `--help` de cada comando | CA-15 |
| Serializar e restaurar a máquina com chaves e certificados | CA-16 |
| O teste do manifesto da SPEC-030 passa com os itens novos | CA-17 |
| Teste do módulo e do banco de exercícios, executados pela docente no sistema | CA-18 |
| Nenhuma mudança em `legacy/` e nenhuma conexão de rede | CA-19 |

- **Manual:** a docente roda, em duas abas, o exercício de troca de mensagens entre `alice` e `bob`, confere um certificado gerado aqui numa máquina real (`openssl x509 -text`) e roda o teste do módulo (CA-18).
- **Cobertura:** meta acima de 80% de linhas e ramos no código novo de `frontend/src/engine/commands/` (SPEC-028, seção 8).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`; SPEC-014, SPEC-020, SPEC-021, SPEC-024, SPEC-027, SPEC-028 (e o código de `frontend/src/engine/commands/`, que é o modelo de como registrar comandos e dar binário no `PATH`), SPEC-029 e SPEC-030 (o manifesto de conformidade); `legacy/src/shell/comandos/Programas.ts` (o `openssl` atual, só para leitura).
2. **Ordem de execução:**
   1. Entrega A (resumos e codificação), com testes e itens no manifesto.
   2. Entrega B (`openssl`), por subcomando: `rand`, `dgst`, `enc`, `genpkey` e `genrsa`, `rsa` e `pkey`, `pkeyutl`, `req`, `x509`, `verify`, `passwd`.
   3. Entrega C (`ssh-keygen`, `ssh-copy-id`).
   4. Entrega E: o módulo de ensino pelo MCP (cards, cenário, exercícios), validar, e a docente roda os dois testes.
3. **Arquivos e diretórios a criar ou alterar:**
   - Criar, em `frontend/src/engine/commands/`, um arquivo por grupo (resumos e codificação, openssl, ssh), os testes ao lado e as mensagens.
   - Alterar o ponto de registro e a lista de binários da SPEC-028 para incluir os novos nomes.
   - Alterar o manifesto de conformidade da SPEC-030.
   - Alterar o histórico desta spec e, na entrega, o status. Alterar qualquer outro arquivo exige justificativa no resumo. **Não alterar nada em `legacy/`.**
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, cobertura acima de 80% no código novo, `tsc`, ESLint e `next build` limpos, manifesto atualizado e teste da SPEC-030 passando, nenhuma violação de `specs/ARCHITECTURE.md`, módulo de ensino validado pela docente, status atualizado para `Implementada`.

## 10. Pendências para aprovação

Nenhuma pendência em aberto. As pendências P-01 a P-07 foram decididas em 10/10/2026, com as recomendações propostas, e incorporadas às seções 2.1, 3.1, 3.2 e 9 (ver histórico).

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 10/10/2026 | Aruna Architect (agente de IA, a pedido do Tech Lead) | Criação. Requisitos do ambiente da aula de criptografia: comandos de resumo, codificação, `openssl`, chaves SSH e GnuPG (opcional), cenário e módulo de ensino |
| 10/10/2026 | Aruna Architect (agente de IA, a pedido do Tech Lead) | Tech Lead aprovou as recomendações das pendências P-01 a P-07, que viraram regras: criptografia verdadeira (RN-01); Ed25519 onde o navegador oferecer, RSA sempre (RN-14); GnuPG fora desta spec (entrega D e card 11 retirados); correção só com as condições atuais e "conteúdo contém `-----BEGIN`" (RN-13); RSA de 1024 (com aviso), 2048 e 4096 (RN-06); `b2sum`, `shasum`, `mkpasswd`, `age` e `ssh-add` fora; módulo de ensino dentro desta spec. Seção 10 vazia |
