# SPEC-028: Ampliação dos comandos do terminal do navegador (os 200 comandos mais comuns do Ubuntu)

| Campo | Valor |
| :--- | :--- |
| **ID** | SPEC-028 |
| **Status** | Rascunho |
| **Data de criação** | 10/10/2026 |
| **Última revisão** | 10/10/2026 |
| **Autor** | Aruna Architect (redigida por agente de IA a pedido do Tech Lead) |
| **Aprovador** | Tech Lead (Ricardo Martins de Oliveira) |
| **Escopo** | Frontend |
| **Módulo** | `engine` (adaptador do motor em `frontend/src/engine/`) |
| **Contexto de tela** | Terminal do exercício, terminal do card e teste do card na autoria (todas as telas que usam o motor) |
| **Prioridade** | Média |
| **Depende de** | SPEC-014, SPEC-020, SPEC-027 (ajuda `--help` dos comandos) |
| **Substitui** | Nenhuma |
| **Fontes canônicas** | Pedido do Tech Lead de 10/10/2026 (levantamento dos 200 comandos mais comuns do Ubuntu); medição feita no módulo de teste "Laboratório: 200 comandos do Ubuntu (teste do motor)". `docs/arquitetura/transicao-backend.md` não trata do catálogo de comandos. |

---

## 1. Contexto e Problema (Context & Problem Statement)

O terminal do navegador roda um motor POSIX/VFS herdado do simulador "Linux na Prática" (`legacy/`), congelado e importado somente para leitura (SPEC-014). O motor reconhece cerca de 125 comandos.

A docente e os estudantes querem praticar com os comandos mais comuns do Ubuntu. Foi montado um card de teste com 200 comandos e executado no motor em 10/10/2026: 148 rodam sem erro e 40 não existem ou não aceitam a opção usada. O resultado é que o aluno digita um comando de uso corriqueiro (`nproc`, `seq`, `basename`, `diff`, `ping`) e recebe "comando não encontrado", o que passa a falsa ideia de que o comando não existe no Linux, e a docente não consegue escrever exercícios com eles.

Além dos comandos que faltam, o `du` existe mas está incompleto. Uma segunda medição, de 10/10/2026, mostrou que ele: não lista os arquivos passados como argumento (`du -sh *` e `du a.txt b.txt` só mostram pastas), aceita `-c` sem imprimir a linha de total e recusa as opções `-k`, `-m`, `-b`, `-x`, `-S`, `-L`, `-0`, `-B`, `--total`, `--apparent-size`, `--exclude`, `--block-size`, `--si` e `--help`, tratando-as como nome de arquivo.

Como `legacy/` é congelado e a SPEC-014 proíbe alterá-lo, os comandos que faltam e a correção do `du` precisam entrar por código novo do frontend, sem editar o motor original.

## 2. Objetivos (Goals)

- Acrescentar ao terminal 32 comandos que hoje não existem, agrupados em texto, informação do sistema, processos, rede e disco (seção 3.1).
- Fazer o `curl` responder a `--version` e `-V`.
- Completar o `du`: listar os arquivos dados como argumento, imprimir o total com `-c` e `--total`, e aceitar as opções de unidade, de filtro e de ajuda listadas na seção 3.1, sem mudar o que ele já mostra hoje nos casos que funcionam.
- Entregar os comandos como código novo em `frontend/src/engine/`, em inglês, com testes, sem alterar nenhum arquivo de `legacy/`.
- Fazer o card de 200 comandos do módulo de teste rodar sem erro no motor, com exceção dos três itens fora de escopo (seção 2.1).
- Manter as saídas coerentes com a máquina simulada (mesmo sistema, mesmo kernel, mesmos processadores e mesmo endereço IP que os comandos já existentes mostram).

### 2.1. Fora de escopo (Non-Goals)

- Qualquer alteração em `legacy/`.
- Link duro (`ln` sem `-s`): o sistema de arquivos do motor só representa links simbólicos e o comando continua respondendo como hoje.
- Compiladores (`gcc`, `make`): exigem pacotes instaláveis sob demanda, que fazem parte do catálogo do `apt` do motor (em `legacy/`). Continuam como hoje.
- Comandos interativos de tela cheia além dos que já existem (`less`, `more`, `watch`, `screen`, `tmux`).
- Rede real: nenhuma conexão sai do navegador. Os comandos de rede respondem de forma simulada e previsível (RN-07).
- `ping`, `nice`, `pstree` e `pidof`: ficam com a SPEC-029 (simulador de controle de processos), que os trata com comportamento ao vivo e que foi escrita em paralelo. Este spec não os implementa, para as duas não registrarem o mesmo nome.
- Os subcomandos de `git` além de `git --version` e `git init`: o motor os deixa de fora de propósito (o Git de verdade se estuda à parte).
- Outros comandos do Ubuntu além dos listados na seção 3.1. Novos comandos pedem revisão desta spec.
- Mudança de backend, API ou banco de dados.

## 3. Proposta de Solução (Proposed Solution)

### 3.1. Frontend (Next.js & SCSS Modules)

Não há tela nova. Os comandos aparecem em todos os terminais que usam o motor. Os textos que o comando imprime seguem o idioma e o estilo dos comandos que já existem no motor (Ubuntu em português do Brasil, RN-06).

**Comandos novos**

| Grupo | Comandos |
| :--- | :--- |
| Texto e arquivos (15) | `tac`, `paste`, `diff`, `nl`, `rev`, `xxd`, `base64`, `md5sum`, `sha256sum`, `seq`, `shuf`, `expr`, `basename`, `dirname`, `file` |
| Informação do sistema (7) | `nproc`, `lscpu`, `cal`, `tty`, `hostnamectl`, `whereis`, `whatis` |
| Processos (1) | `time` |
| Rede (7) | `ip`, `ss`, `ifconfig`, `nslookup`, `wget`, `ssh`, `ufw` |
| Disco (2) | `dd`, `swapon` |

**Comandos existentes que mudam (2):** `curl` (ganha `--version` e `-V`) e `du` (reescrito, RN-13).

**Comportamento de cada comando**

| Comando | Opções e operandos aceitos | Saída e código de saída |
| :--- | :--- | :--- |
| `tac` | arquivos ou entrada padrão | Linhas em ordem inversa. 0; arquivo inexistente: mensagem de erro e 1. |
| `paste` | `-d` (delimitador, padrão tabulação), `-s` (serial), arquivos ou entrada padrão | Junta linhas correspondentes. 0; arquivo inexistente: 1. |
| `diff` | `-u` (unificado, 3 linhas de contexto), `-q` (só informa se diferem), dois arquivos | Formato normal por padrão. 0 se iguais, 1 se diferentes, 2 se houver erro (arquivo inexistente). |
| `nl` | `-b a` ou `-b t` (padrão: só linhas não vazias), `-w`, `-s`, `-v` | Linhas numeradas com largura 6 e tabulação por padrão. 0. |
| `rev` | arquivos ou entrada padrão | Cada linha invertida caractere a caractere. 0. |
| `xxd` | `-p` (simples), `-l` (limite de bytes), `-c` (colunas), arquivo ou entrada padrão | Despejo hexadecimal no formato do `xxd`: endereço, grupos de 2 bytes, texto à direita. 0; arquivo inexistente: 1. |
| `base64` | `-d` (decodificar), `-w` (quebra de linha, padrão 76; 0 sem quebra), arquivo ou entrada padrão | Codifica ou decodifica. 0; entrada inválida com `-d`: mensagem e 1. |
| `md5sum`, `sha256sum` | `-c` (conferir arquivo de somas), arquivos ou entrada padrão | Linha "soma, dois espaços, nome" (nome `-` para a entrada padrão). Com `-c`, "OK" ou "FALHOU" por arquivo. 0; arquivo inexistente ou soma divergente: 1. A soma é a verdadeira do conteúdo (RN-04). |
| `seq` | `ÚLTIMO`; `PRIMEIRO ÚLTIMO`; `PRIMEIRO PASSO ÚLTIMO`; `-s` (separador), `-w` (largura igual) | Sequência numérica, inteiros ou decimais. 0; operando inválido: mensagem e 1. |
| `shuf` | `-n`, `-e` (argumentos como linhas), `-i LO-HI`, arquivo ou entrada padrão | Linhas em ordem aleatória, a única saída não determinística (RN-08). 0. |
| `expr` | `+ - \* / %`, `= != < > <= >=`, `length`, `substr` | Resultado na saída. Código 0 se o resultado não é zero nem vazio, 1 se é zero ou vazio, 2 em erro de sintaxe ou divisão por zero. |
| `basename` | `NOME [SUFIXO]`, `-s`, `-a` | Nome sem o caminho (e sem o sufixo). 0. |
| `dirname` | um ou mais caminhos | Pasta do caminho (`.` se não houver). 0. |
| `file` | um ou mais caminhos, `-b` (sem o nome) | Tipo: vazio, texto ASCII, texto UTF-8, pasta, link simbólico para destino, script de shell executável, dados compactados gzip, arquivo zip, dados. 0; inexistente: "não é possível abrir", e 0 (como o `file` real). |
| `nproc` | `--all`, `--ignore=N` | Número de processadores, igual ao de `/proc/cpuinfo`. 0. |
| `lscpu` | sem opções | Quadro com arquitetura, número de CPUs, modelo e fabricante lidos de `/proc/cpuinfo`. 0. |
| `cal` | sem argumentos (mês atual); `MÊS ANO`; `ANO` | Calendário com nomes em português, semana começando no domingo, data atual da máquina simulada. 0; mês ou ano inválido: mensagem e 1. |
| `tty` | `-s` | Imprime o terminal em uso (`/dev/pts/N`, com N = aba − 1). Sem terminal na entrada (entrada vinda de pipe): "não é um tty" e 1. |
| `hostnamectl` | `status` (padrão) | Quadro com nome da máquina, tipo (máquina virtual), sistema operacional, kernel e arquitetura, lidos dos dados da máquina. 0; outro subcomando: "operação não suportada pelo simulador" e 1. |
| `whereis` | um ou mais nomes | Caminho do programa e da página de manual de comandos existentes; só "nome:" para nomes desconhecidos. 0. |
| `whatis` | um ou mais nomes | Uma linha "nome (1) - resumo" por comando existente, usando o resumo de ajuda do comando. Nome desconhecido: "nome: nada apropriado." e 16. |
| `time` | comando e argumentos | Executa o comando e imprime `real`, `user` e `sys` ao final. O código de saída é o do comando. |
| `ip` | `a`, `addr`, `address` (com ou sem `show`); `route` e `r`; `link`; `-br` (resumo) | Interfaces `lo` e `eth0` e a rota padrão, coerentes com `hostname -I` (RN-07). 0; objeto desconhecido: mensagem e 1. |
| `ss` | `-t`, `-u`, `-l`, `-n`, `-a`, `-p` combináveis | Sockets de escuta derivados dos serviços ativos da máquina (RN-07). 0. |
| `ifconfig` | sem argumentos ou nome da interface | Quadro das interfaces no formato do `net-tools`. 0; interface inexistente: mensagem e 1. |
| `nslookup` | nome | Resposta simulada do servidor de nomes da máquina (RN-07). 0; nome desconhecido: "NXDOMAIN" e 1. |
| `wget` | `--version`, `-V`, `-q`, `-O` e uma URL | Versão. Com URL: simula a falha de conexão ou o download de endereços locais conforme RN-07. 0 na versão; 4 em falha de rede. |
| `ssh` | `-V` | Versão do cliente. Qualquer tentativa de conexão: "o simulador abre conexões SSH pelas abas do terminal" e 255. |
| `ufw` | `status`, `status verbose`, `status numbered`, `enable`, `disable`, `allow PORTA[/protocolo]`, `deny PORTA[/protocolo]`, `delete allow PORTA`, `default allow\|deny` | Estado e regras do firewall, gravados em arquivos de `/etc/ufw` para entrarem no estado serializado da máquina (RN-05). Sem root: "ERRO: Você precisa ser root" e 1. |
| `dd` | `if=`, `of=`, `bs=`, `count=` | Copia bytes de um arquivo ou de `/dev/zero` para o arquivo de destino e imprime o resumo de registros no erro padrão. Tamanho máximo de 64 KiB (RN-09). 0; arquivo de origem inexistente ou limite excedido: mensagem e 1. |
| `swapon` | `--show` | Tabela com nome, tipo, tamanho, uso e prioridade do swap, com os mesmos números do `free`. Sem swap: saída vazia. 0. |
| `curl` (opção nova) | `--version`, `-V` | Linha de versão e lista de protocolos. 0. O resto do comportamento é o do `curl` existente. |
| `du` (reescrito) | `-a`, `-s`, `-h`, `-c` e `--total` (linha de total), `-d N` e `--max-depth=N`, `-k`, `-m`, `-b` e `--bytes`, `--apparent-size`, `-B TAMANHO` e `--block-size=TAMANHO`, `--si`, `-x`, `-L`, `-S`, `--exclude=PADRÃO`, `-0`, `--help`; letras combináveis (`-sh`, `-shc`, `-sx`, `-ah`, `-hL`); vários caminhos | Uma linha "tamanho, tabulação, caminho" por pasta e, nos argumentos, por arquivo. Tamanho em KB por padrão; com `-h` no formato do Ubuntu com vírgula decimal (`8,0K`). `-c` e `--total` acrescentam a linha `total`. `-b` e `--apparent-size` usam o tamanho do conteúdo em vez dos blocos de 4 KB. `-S` não soma as subpastas. `--exclude` ignora o que casa com o padrão. 0; caminho inexistente ou pasta sem permissão: mensagem e 1, sem interromper os demais caminhos; opção desconhecida: mensagem e 1. |

### 3.2. Backend (Go — Camada de Módulo/Service)

Não se aplica nesta spec: o terminal do navegador roda inteiramente no cliente (SPEC-014). Nenhuma rota, tabela ou regra de servidor muda.

**Regras de negócio**

- **RN-01 (registro sem tocar no motor):** os comandos novos são registrados no catálogo de comandos do motor pelo adaptador, uma única vez quando o motor é carregado, usando o ponto de registro que o motor já oferece. Nenhum arquivo de `legacy/` é alterado. Cada comando novo tem nome, resumo de ajuda de uma linha (usado por `help`, `man` e `whatis`) e execução, seguindo o mesmo contrato dos comandos existentes.
- **RN-02 (fronteira do motor):** só `frontend/src/engine/` importa o motor (SPEC-014, CA-08). O código novo não importa classes do legado como valor: usa apenas tipos declarados na fronteira tipada do adaptador, e se comporta como um comando do motor sem herdar dele. Se, durante a implementação, algum ponto do shell (autocompletar, `sudo`, `xargs`, `nohup`, `find -exec`) exigir a classe do legado como valor, o implementador para e pergunta ao Tech Lead; a alternativa seria um alias exato novo no Next.js, sem editar `legacy/`. A primeira etapa confirma que o registro funciona em todos esses pontos.
- **RN-03 (substituição do curl):** para tratar `--version`, o adaptador registra um `curl` que responde a `--version` e `-V` e repassa todo o resto ao `curl` original, sem alterar o comportamento dele.
- **RN-13 (du reescrito):** como a delegação não consegue produzir o total nem tratar as opções novas, o `du` passa a ser implementado no código novo e registrado com o mesmo nome, no lugar do original. O novo `du` preserva o que o original já fazia certo: tamanho em múltiplos de 4 KB por arquivo, 4 KB por pasta, formato `8,0K` com vírgula decimal, ordem alfabética dos itens e a pasta antes do total. Os arquivos informados como argumento sempre aparecem; os de dentro de pastas só com `-a`. Um teste de regressão fixa as saídas atuais dos casos que hoje funcionam.
- **RN-14 (ajuda dos comandos novos):** todo comando novo, e o `du` reescrito, nasce com a ajuda estruturada que a SPEC-027 exige (uso, descrição, opções e exemplos, em português, listando só as opções que ele implementa) e declara se o seu `-h` é ajuda ou outra opção, conforme a tabela da seção 3.4 daquela spec (`du -h` continua sendo tamanho legível). O teste do motor da SPEC-027 (RN-09) passa a cobrir também estes comandos, e esta spec tem testes próprios para isso.
- **RN-04 (somas verdadeiras):** `md5sum` e `sha256sum` calculam a soma real do conteúdo do arquivo, igual à do Ubuntu. O mesmo vale para `base64` e `xxd`. Os testes comparam com valores conhecidos de referência.
- **RN-05 (estado do firewall):** o estado do `ufw` fica em arquivos do sistema de arquivos da máquina, de modo que entra no estado serializado, é recuperado ao recomeçar e participa da correção por condições de arquivo.
- **RN-06 (idioma da saída):** o texto que cada comando imprime reproduz o Ubuntu em português do Brasil, como os comandos existentes (decisão do Tech Lead). Os textos ficam concentrados em um arquivo de mensagens do adaptador, não espalhados pelos comandos. Todo identificador, comentário e mensagem interna do código é em inglês.
- **RN-07 (rede simulada e previsível):** nenhuma conexão real é aberta. A topologia simulada reaproveita os dados que a máquina já expõe: interface `lo` com 127.0.0.1, interface `eth0` com o endereço que `hostname -I` já mostra, rota padrão e servidor de nomes lidos de `/etc/resolv.conf` e de `/etc/hosts` da própria máquina. Destinos que respondem: `localhost`, `127.0.0.1`, o nome e o endereço da máquina, o gateway e os nomes de `/etc/hosts`. Destinos de internet respondem de forma simulada, com latência fixa, só para uma lista curta e fixa (`8.8.8.8`, `1.1.1.1`, `google.com`, `ubuntu.com`); os demais nomes ficam como não resolvidos. `ifconfig` e `nslookup` ficam sempre disponíveis, embora no Ubuntu real dependam de pacotes que não vêm instalados (`net-tools` e `dnsutils`): é uma simplificação aceita, porque o catálogo de instalação sob demanda está em `legacy/`. As latências são constantes. `ss` lista as portas dos serviços que a máquina marca como ativos (por exemplo, SSH na 22 e nginx na 80).
- **RN-08 (determinismo):** com a mesma máquina e a mesma entrada, a saída é a mesma. Exceções: `shuf` (aleatório por definição) e `time` (mede o tempo decorrido, com `user` e `sys` fixos em zero). `cal` usa a data da máquina simulada.
- **RN-09 (limite de `dd`):** o arquivo gerado por `dd` não passa de 64 KiB, para o estado serializado respeitar o limite de 2 MB da SPEC-014 e o navegador não travar. Acima disso o comando falha com mensagem clara e não grava nada.
- **RN-10 (comando que executa outro comando):** `time` roda o comando indicado pelo mesmo executor do shell, com o mesmo usuário e a mesma pasta, e devolvem o código de saída dele.
- **RN-11 (erros no estilo do Ubuntu):** operando faltando, opção desconhecida, arquivo inexistente e permissão negada geram a mensagem e o código de saída do comando real, no erro padrão.
- **RN-12 (entrada padrão):** os comandos de texto e de soma (`tac`, `paste`, `nl`, `rev`, `xxd`, `base64`, `md5sum`, `sha256sum`, `file`, `shuf`) leem a entrada padrão quando não recebem arquivo, para funcionarem em pipes e com redirecionamento.

## 4. Modelo de Dados (Data Model)

Não há mudança de schema, entidade ou migração. O único dado persistido é o estado do firewall, gravado como arquivos no sistema de arquivos simulado da máquina (RN-05), dentro do formato de estado já definido na SPEC-014 e na SPEC-021.

| Arquivo da máquina | Conteúdo | Quem grava |
| :--- | :--- | :--- |
| `/etc/ufw/ufw.conf` | Se o firewall está habilitado | `ufw enable` e `ufw disable` |
| `/etc/ufw/user.rules` | Política padrão e regras de permissão e bloqueio, uma por linha | `ufw allow`, `deny`, `delete` e `default` |

Política de exclusão: física; `ufw delete` remove a linha da regra.

## 5. Contrato de API (API Contract)

Não se aplica nesta spec: nenhuma rota REST ou evento de tempo real é criado ou alterado.

## 6. Impacto e Riscos (Impact & Risks)

- **Risco: divergência de comportamento em relação ao Ubuntu real.** Um aluno pode ver uma saída diferente da de uma máquina de verdade. *Mitigação:* cada comando reproduz o formato e o código de saída do original para o conjunto de opções da seção 3.1; opção não suportada responde com erro claro, nunca com saída enganosa.
- **Risco: colisão com comandos existentes ou com o `curl`.** *Mitigação:* os 32 nomes não existem hoje no catálogo (verificado na medição de 10/10/2026); o `curl` é tratado por delegação (RN-03), com teste de regressão do comportamento atual.
- **Risco: regressão ao trocar o `du`.** Exercícios publicados que usam `du` podem mudar de saída. *Mitigação:* teste de regressão que fixa a saída atual dos casos que funcionam (CA-16) e conferência pela docente dos exercícios que usam `du`.
- **Risco: estado serializado maior com `dd`.** *Mitigação:* limite de 64 KiB (RN-09).
- **Risco: o catálogo do motor ser privado ou mudar.** O registro depende de um método público do motor que existe hoje. *Mitigação:* teste de integração falha se o registro deixar de funcionar; se o ponto de registro mudar, a spec volta para revisão.
- **Risco: dados de rede e de CPU divergentes de `neofetch`, `free`, `hostname -I` e `/proc`.** *Mitigação:* RN-07 e a seção 3.1 mandam derivar os números dos mesmos dados da máquina, e há teste de coerência (CA-10).
- **Impacto em `legacy/`:** nenhum arquivo é alterado. O módulo de teste dos 200 comandos continua falhando só nos itens da seção 2.1, de propósito, para acompanhar o que falta.
- **Impacto em exercícios publicados:** nenhum. Comandos que antes davam "não encontrado" passam a existir; exercícios que contavam com o erro (modo de erro esperado, SPEC-020) devem ser revistos pela docente.
- **Segurança:** os comandos operam só sobre a máquina simulada, no navegador; nenhum acessa a rede ou o disco real do aluno.

## 7. Critérios de Aceite (Acceptance Criteria)

- [ ] **CA-01** (ubíquo): O SISTEMA DEVE reconhecer os 32 comandos novos da seção 3.1 e o `du` reescrito pelo nome, com resumo de ajuda, de modo que `help`, `which`, `type`, `man` e `whatis` os encontrem.
- [ ] **CA-02** (evento): QUANDO o aluno rodar cada comando da seção 3.1 com o caso básico do card de 200 comandos, O SISTEMA DEVE terminar com código de saída 0 e imprimir a saída esperada.
- [ ] **CA-03** (evento): QUANDO o aluno rodar `curl --version` ou `curl -V`, O SISTEMA DEVE imprimir a versão e os protocolos e terminar com 0, e QUANDO usar o `curl` de outras formas, O SISTEMA DEVE manter o comportamento atual.
- [ ] **CA-04** (evento): QUANDO o aluno usar as opções listadas na seção 3.1, O SISTEMA DEVE aplicá-las como no Ubuntu (por exemplo, `seq -w`, `nl -b a`, `diff -u`, `xxd -p`, `base64 -d`).
- [ ] **CA-05** (indesejado): SE o comando receber operando faltando, opção desconhecida ou arquivo inexistente, ENTÃO O SISTEMA DEVE imprimir a mensagem no erro padrão e terminar com o código de saída definido na seção 3.1.
- [ ] **CA-06** (evento): QUANDO `md5sum`, `sha256sum`, `base64` ou `xxd` receberem conteúdo de referência, O SISTEMA DEVE produzir o mesmo resultado que o Ubuntu (RN-04).
- [ ] **CA-07** (evento): QUANDO um comando de texto ou de soma não receber arquivo, O SISTEMA DEVE ler a entrada padrão, em pipe e em redirecionamento (RN-12).
- [ ] **CA-08** (evento): QUANDO o aluno rodar `time` com outro comando, O SISTEMA DEVE executá-lo com o mesmo usuário e pasta e devolver o código de saída dele (RN-10).
- [ ] **CA-09** (evento): QUANDO o aluno rodar `ufw enable`, `allow`, `deny`, `delete` ou `default` como root, O SISTEMA DEVE gravar o estado em `/etc/ufw`, mostrá-lo em `ufw status` e mantê-lo ao serializar e restaurar a máquina; SE não for root, ENTÃO O SISTEMA DEVE recusar com código 1.
- [ ] **CA-10** (estado): ENQUANTO a máquina simulada for a mesma, O SISTEMA DEVE manter coerentes `nproc`, `lscpu`, `hostnamectl`, `ip`, `ifconfig` e `swapon` com `/proc/cpuinfo`, `uname`, `hostname -I` e `free`.
- [ ] **CA-11** (evento): QUANDO o aluno rodar `dd` com tamanho acima de 64 KiB, O SISTEMA DEVE falhar com mensagem clara e não gravar arquivo (RN-09).
- [ ] **CA-12** (ubíquo): O SISTEMA DEVE produzir a mesma saída para a mesma máquina e a mesma entrada, exceto `shuf` e o tempo medido por `time` (RN-08).
- [ ] **CA-13** (ubíquo): O SISTEMA NÃO DEVE alterar nenhum arquivo de `legacy/` nem importar o motor fora de `frontend/src/engine/`.
- [ ] **CA-14** (evento): QUANDO o card de 200 comandos do módulo de teste for executado no motor, O SISTEMA DEVE terminar com sucesso todos os comandos, exceto `ln` sem `-s`, `gcc` e `make` (seção 2.1).
- [ ] **CA-15** (ubíquo): O SISTEMA DEVE manter a serialização e a reconciliação do estado da máquina (SPEC-021) sem diferenças para arquivos criados pelos comandos novos (`dd`, redirecionamentos, `ufw`).
- [ ] **CA-16** (evento): QUANDO o aluno rodar `du` com arquivos como argumento (`du -sh *`, `du a.txt b.txt`), com `-c` ou `--total`, ou com as opções `-k`, `-m`, `-b`, `--apparent-size`, `-x`, `-S`, `-L`, `-0`, `-B`, `--block-size`, `--si`, `--exclude` e `--help`, O SISTEMA DEVE listar os arquivos, imprimir a linha de total quando pedida e aplicar a opção como no Ubuntu; e QUANDO usar os casos que já funcionam hoje (`du`, `-h`, `-s`, `-sh`, `-a`, `-d`, `--max-depth`), O SISTEMA DEVE manter exatamente a saída atual (RN-13).
- [ ] **CA-17** (ubíquo): TODO comando novo e o `du` reescrito DEVEM ter ajuda (`--help`) que começa pelo nome do comando no uso e lista só as opções implementadas (RN-14).

## 8. Plano de Testes (Test Plan)

- **Backend:** não se aplica nesta spec (sem mudança de servidor).
- **Frontend (Vitest):** testes de unidade de cada comando contra o motor real, no estilo dos testes `*.engine.test.ts` existentes; testes de integração do registro e do `curl`.

| Teste | Cobre |
| :--- | :--- |
| Registro: os 32 nomes existem e aparecem em `help`, `which`, `type`, `man`, `whatis` | CA-01 |
| Caso básico de cada comando, com o valor esperado, e código de saída 0 | CA-02 |
| `curl --version` e `-V`; regressão dos usos atuais do `curl` | CA-03 |
| `du`: cada opção nova, arquivos como argumento, `-c`, vários caminhos, caminho inexistente; regressão das saídas atuais de `du`, `-h`, `-s`, `-sh`, `-a`, `-d` e `--max-depth` | CA-16 |
| Opções por comando (tabela de casos por comando) | CA-04 |
| Casos de erro por comando: operando faltando, opção inválida, arquivo inexistente | CA-05 |
| Valores de referência de MD5, SHA-256, Base64 e `xxd` | CA-06 |
| Cada comando de texto lendo de pipe e de redirecionamento | CA-07 |
| `time` executando comando, com usuário e pasta | CA-08 |
| `ufw`: habilitar, regras, exclusão, política, recusa sem root, sobrevive a serializar e restaurar | CA-09 |
| Coerência de `nproc`, `lscpu`, `hostnamectl`, `ip`, `ifconfig` e `swapon` com os dados da máquina | CA-10 |
| `dd` no limite e acima dele | CA-11 |
| Duas execuções iguais produzem a mesma saída (menos `shuf` e `time`) | CA-12 |
| `git diff` sem alterações em `legacy/` e regra do ESLint de importação do motor | CA-13 |
| Execução da lista de 200 comandos (arquivo de dados do teste) com os três itens fora de escopo marcados como esperados | CA-14 |
| Reconciliação de estado após `dd`, redirecionamento e `ufw` | CA-15 |
| `--help` de cada comando novo e do `du`: uso começa pelo nome, só opções implementadas, `-h` conforme a SPEC-027 | CA-17 |

- **Manual:** abrir o card de 200 comandos na autoria, rodar "Testar" e conferir que só os três itens fora de escopo falham; rodar `ip a`, `ufw status` e `ss -tuln` no terminal de um exercício e comparar a aparência com a de um Ubuntu de verdade (cobre CA-02 e CA-10).
- **Cobertura:** meta acima de 80% de linhas e ramos no código novo de `frontend/src/engine/commands/`, medida com o Vitest em modo de cobertura. Como esse diretório não está no escopo atual de cobertura (`ARCHITECTURE.md`, seção 5), a configuração passa a incluí-lo, sem mudar a regra geral (decisão do Tech Lead).

## 9. Contexto Final da IA (AI Final Context Execution)

1. **Pré-leitura obrigatória:** `specs/AI_INSTRUCTIONS.md`, `specs/ARCHITECTURE.md`, `specs/GLOSSARY.md`, SPEC-014 inteira (seção do motor e CA-08), SPEC-020, SPEC-021 (serialização e reconciliação); `legacy/src/shell/Shell.ts`, `RegistroDeComandos.ts`, `Comando.ts`, `Contexto.ts`, `Interpretador.ts` e os comandos de `legacy/src/shell/comandos/` (como referência de comportamento e de textos, somente leitura); `frontend/src/engine/terminalWindow.ts` e `legacy-engine.d.ts`.
2. **Ordem de execução:**
   1. Medir de novo o card de 200 comandos no motor atual e guardar a lista como dado de teste (CA-14).
   2. Criar o arquivo de mensagens do adaptador e o ponto de registro (RN-01, RN-02, RN-06).
   3. Implementar e testar o grupo de texto (RN-04, RN-12), depois informação do sistema, processos, disco e rede, nessa ordem.
   4. Implementar a delegação do `curl` (RN-03) e o novo `du` (RN-13), com o teste de regressão escrito antes, contra o `du` original.
   5. Implementar o estado do `ufw` em arquivos (RN-05) e testar serialização e reconciliação (CA-15).
   6. Rodar a lista de 200 comandos (CA-14), a cobertura, o `tsc`, o ESLint e o build.
3. **Arquivos e diretórios a criar ou alterar:**
   - Criar `frontend/src/engine/commands/` com um arquivo por grupo (texto, sistema, processos, rede, disco), o arquivo de mensagens, o ponto de registro e os testes ao lado de cada arquivo.
   - Criar o arquivo de dados de teste com os 200 comandos e os três itens esperados como falha.
   - Alterar `frontend/src/engine/terminalWindow.ts` (chamar o registro na carga do motor) e `frontend/src/engine/legacy-engine.d.ts` (tipos do catálogo de comandos e do contexto, apenas o que o código novo usa).
   - Alterar `frontend/vitest.config.ts` (incluir `src/engine/commands/**` na cobertura).
   - Alterar o histórico desta spec e, na entrega, o status. Alterar qualquer outro arquivo exige justificativa no resumo. **Não alterar nada em `legacy/`.**
4. **Definição de pronto:** todos os CA marcados, testes da seção 8 passando, cobertura acima de 80% no código novo, `tsc`, ESLint e build limpos, nenhuma violação de `specs/ARCHITECTURE.md`, `git diff` sem alterações em `legacy/`, status atualizado para `Implementada`. Todo comando ou programa novo, renomeado ou removido atualiza o manifesto de conformidade no mesmo commit (SPEC-030, RN-08).

## 10. Pendências para aprovação

Nenhuma pendência em aberto. As pendências P-01 a P-07 foram decididas em 10/10/2026 e incorporadas às seções 2.1, 3.2 e 8 (ver histórico).

| ID | Pendência | Recomendação |
| :--- | :--- | :--- |

---

## Histórico de revisões

| Data | Autor | Alteração |
| :--- | :--- | :--- |
| 10/10/2026 | Aruna Architect (agente de IA, a pedido do Tech Lead) | Criação. Escopo definido a partir da medição dos 200 comandos mais comuns do Ubuntu no motor (148 rodam, 40 faltam). Decisões do Tech Lead na conversa: a spec é redigida em Rascunho e os comandos ficam em `frontend/src/engine/`, sem editar `legacy/` |
| 10/10/2026 | Aruna Architect (agente de IA, a pedido do Tech Lead) | Inclusão do `du` completo (RN-13, CA-16, P-07): medição mostrou que ele não lista arquivos dados como argumento, ignora `-c` e recusa `-k`, `-m`, `-b`, `-x`, `-S`, `-L`, `-0`, `-B`, `--total`, `--apparent-size`, `--exclude`, `--block-size`, `--si` e `--help` |
| 10/10/2026 | Aruna Architect (agente de IA, a pedido do Tech Lead) | Pendências P-01 a P-07 resolvidas com as recomendações propostas e incorporadas ao texto: saída em português do Brasil (RN-06); internet simulada só para `8.8.8.8`, `1.1.1.1`, `google.com` e `ubuntu.com`, e `ifconfig` e `nslookup` sempre disponíveis (RN-07); cobertura do Vitest inclui `src/engine/commands/**` (seção 8); registro sem herdar do legado, com parada e pergunta se algum ponto exigir o contrário (RN-02); exclusão de `ln` sem `-s`, `gcc` e `make` (seção 2.1); substituição do `du` (RN-13). Seção 10 vazia. Status segue `Rascunho`: aguarda a aprovação do Tech Lead |
| 10/10/2026 | Aruna Architect (agente de IA, a pedido do Tech Lead) | Renumerada de SPEC-027 para SPEC-028: o ID 027 já pertence à spec de ajuda `--help` dos comandos do simulador, criada em paralelo por outra sessão. Passa a depender da SPEC-027 e ganha RN-14 e CA-17 (ajuda estruturada nos comandos novos) |
| 10/10/2026 | Aruna Architect (agente de IA, a pedido do Tech Lead) | Escopo reduzido de 36 para 32 comandos novos: `ping`, `nice`, `pstree` e `pidof` passaram para a SPEC-029 (controle de processos), escrita em paralelo, para as duas não registrarem o mesmo nome. Fora de escopo também os subcomandos de `git`, que o motor omite de propósito |
