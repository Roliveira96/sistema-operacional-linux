# Lacunas do motor do terminal (levantadas na SPEC-030)

Ao escrever os 8.209 casos da verificação de conformidade (SPEC-030), foram achados comandos e opções que um aluno avançado digitaria e que o motor **não faz como o Linux**. Nenhum deles virou caso de sucesso; ficaram de fora. Esta lista é a base de uma spec futura de correção (o motor original está congelado em `legacy/`, então a correção entra como código novo em `frontend/src/engine/`, como nas SPEC-028 e SPEC-029).

Levantamento de 11/10/2026, com o motor no estado do commit da SPEC-030. Prioridade sugerida: **A** (quebra aula típica), **B** (opção comum que falha), **C** (raro).

## A. Falhas que um aluno vai notar

| Área | O que se digita | O que o motor faz |
| :--- | :--- | :--- |
| shell | `bash -c 'exit 3'`, `sh -c 'exit 4'`, `nohup bash -c 'exit N'` | "erro interno do simulador: [object Object]" |
| shell | `x=$(exit 3)` | fecha o terminal |
| shell | `( ... )`, `{ ...; }`, `f() { ...; }`, `case`, `!` | "comando não encontrado" |
| shell | `${X:-d}`, `${#X}`, `${X%.txt}`, `${X^^}`, `${X/a/b}` | imprime o texto cru |
| shell | `set -- a b c`, `set a b c` | não define `$1`, `$2`, `$#` |
| shell | `cd /tmp/lab && echo $PWD`, `$(pwd)` em lista `&&` | expande antes da cadeia: mostra a pasta antiga |
| shell | `bash -c 'cd d'`, script com `cd` | muda a pasta do shell que chamou (sem isolamento de subshell) |
| shell | `echo cmd \| bash`, `bash < arquivo` | "O simulador não abre um shell dentro do shell" |
| shell | here-string `<<<` e here-doc `<<EOF` | erro de sintaxe |
| processos | `pkill -n`, `-o`, `-l` sem padrão | mata o próprio shell e fecha o terminal |
| processos | `watch --opcao-invalida`, `yes --opcao-invalida`, `ssh-keygen -F`, `openssl passwd` sem argumento | travam até o limite de tempo |
| arquivos | `unzip -t`, `-p`, `-q` | esperam confirmação e travam |
| arquivos | `gzip -c arq > saida.gz` | gera arquivo inválido e apaga a origem |
| arquivos | `ln origem destino` (link duro) | recusa ("só links simbólicos") |
| arquivos | `readlink`, `cmp`, `bc`, `timeout`, `pstree`, `dig`, `ping` | "comando não encontrado" |
| rede | `curl -X`, `-H`, `-d`, `-u`, `-w`, `-m`, `-A` | o valor da opção vira nome de host |
| rede | `curl -o`, `-O`, `wget -O arq` quando o arquivo some | não criam o arquivo / criam em outro lugar |
| texto | `awk` com `printf`, `for`, `if`, arrays, `gsub`, `&&`, `-v`, `OFS` | não suportado ou ignorado (`$2>25 && ...` imprime tudo) |
| texto | `sed` com `i`, `a`, `c`, `y`, `q`, `{}`, endereços `/a/,/b/`, `-i.bak` | não suportado |
| texto | `grep -o`, `-x`, `-A/-B/-C`, `-q`, `-m`, vários `-e`, classes `[[:digit:]]`, regex inválida | ignorados ou errados (regex inválida sai 1, não 2) |
| texto | `sort -k`, `-o`, `-h`, `-V` | sem efeito |
| texto | `printf '%x'`, `%05d`, `%c`, `%u`, `\x41` | imprime literal ou errado |
| texto | `seq 1 1000000` | para em 100001 |
| usuários | `sudo -l`, `-v`, `-n`, `-E`, `-H`, `-g`, `--`, `-uana` | "opção inválida" |
| usuários | `su -c cmd user`, `su -s shell user` | o valor vira nome de usuário |
| usuários | `sudo -u ana sh -c 'echo $HOME'` | roda como root |
| usuários | `adduser` com `--system`, `--home`, `--ingroup`, `--uid`, `--gecos` | travam ou são lidos errado |
| sistema | `systemctl mask`, `unmask`, `daemon-reload`, `list-unit-files`, `is-failed`, `cat`, `show`, `kill` | "Unknown command verb" |
| sistema | `apt policy`, `depends`, `dist-upgrade`, `clean`; `dpkg -r`, `-P`, `-S`, `--get-selections` | mostram o uso / "é preciso uma ação" |
| sistema | `date +%Y`, `date -d`, `uname -v`, `free -m`, `lsb_release -s` | ignorados ou sem saída |

## B. Opções comuns que falham ou são ignoradas (resumo por comando)

- **`ls`:** `-F -p -i -s -m -n -g -o -q -b`, `--time-style` ignorados; `-r -t -S -X -U --sort=` não mudam a ordem; opção inválida sai 0.
- **`find`:** `-name '*.[ch]'`, `-perm /u+x`, `-print0 -regex -prune -depth -printf -quit -inum` ("predicado desconhecido").
- **`cp`/`mv`:** `-i` com `n` ainda sobrescreve; `-n` sobrescreve; `-p -l -s -t -T -b -u --parents` ignorados; `cp a a` sai 0.
- **`tar`:** opções longas (`--create`, `--list`, `--extract`, `--file=`), `-r -u -A -d --delete`, `--exclude`, `--strip-components`, `-j`, `-J` (grava sem compressão).
- **`chmod`:** `g=u`, `--reference`, `-h`; `+x` sem quem ignora o `umask`.
- **`stat`:** `-c '%F'` imprime o literal; `stat` de link não mostra "link simbólico".
- **`df`/`du`/`lsblk`/`blkid`/`fdisk`/`mkfs`/`mount`:** argumentos de caminho ignorados, opções ignoradas, `fdisk` ignora o tamanho `+100M`, `mkfs -t xfs` faz ext4, `mount -o loop` não existe.
- **`head`/`tail`/`cat`/`wc`/`cut`/`uniq`/`nl`/`paste`/`tr`/`xargs`:** `head -c`, `cut -c`, `tail -n +N`, `cat -n/-b/-s/-A`, `wc -m/-L`, `uniq -i/-f/-s`, `nl -n`, `xargs -I`/`-n1`/`-0`, `tr -d '[:alpha:]'` não funcionam como no GNU.
- **`ps`:** `-ax`, `-A`, `-C`, `--sort`, `--no-headers`, `-eo pid,comm`, `-o rss,vsz,etime` errados; `ps -p 99999` sai 0.
- **`pgrep`/`pkill`/`killall`/`kill`/`renice`/`nice`/`top`:** `-f`, `-x`, `-a`, `-c`, `-n`, `-o` ignorados ou errados; `kill -USR1 pid` mata; `renice` de PID inexistente sai 0; `top -u -o -H` ignorados.
- **`ip`/`ss`/`ifconfig`/`hostname`/`hostnamectl`/`nslookup`/`ufw`/`ssh-keygen`/`openssl`/`wget`:** `ss -s -4 -6 -x`, `ip -4`, `ip route get`, `ifconfig eth0 up`, `hostname -i`, `hostnamectl set-hostname`, `ufw reject/limit/reset/insert` e faixas de porta, `ssh-keygen -t ecdsa -p -l`, `openssl enc -base64`, `wget -S --spider -P -c -r`.
- **`journalctl`/`logger`/`uname`/`free`/`uptime`/`lscpu`/`lspci`/`dmesg`/`nvidia-smi`:** muitas opções aceitas em silêncio, saída igual com ou sem a opção.
- **Usuários e grupos:** `useradd -d -e -p -u` (duplicado), `usermod -u -e -l -d -m`, `groupadd -f`, `groupmod -g` duplicado, `passwd -x -n -w -i`, `getent` com várias chaves ou `hosts`, `deluser --backup-to`, `delgroup --only-if-empty`.
- **Programas:** `apache2`, `apachectl`, `sshd`, `cron`, `mysqld` não imprimem nada para `-v -V -t -S -M -l -T`; `apachectl stop` não muda o serviço; a porta 80 do Apache não aparece em `ss -tln`.
- **Shell (builtins):** faltam `eval`, `exec`, `command`, `builtin`, `let`, `declare`, `local`, `readonly`, `trap`, `ulimit`, `getopts`, `pushd`, `popd`, `dirs`, `disown`, `times`, `type -t`, `history !!`.

## C. Diferenças de código de saída e mensagens

Comandos que respondem 0 onde o Linux responde erro: `ls --foo`, `uname -z`, `date --x`, `free -z`, `who -q`, `touch -c`, `wget` de página inexistente (Linux: 8), `cp a nao-dir/` (cria arquivo), `cd a.txt` ("inexistente" em vez de "Não é um diretório"), `curl` em porta fechada ("não resolve o host" em vez de "conexão recusada").

## Como usar esta lista

1. Escolher o que entra em uma spec de correção (sugestão: tudo da tabela A, depois as opções mais usadas em aula de B).
2. Cada correção ganha o caso de sucesso correspondente no manifesto de conformidade (`frontend/src/engine/conformance/suites/`), no mesmo commit (SPEC-030, RN-08).
3. Os casos de **erro** que hoje só documentam o comportamento do motor (por exemplo, `ls index.html` com código 2) continuam valendo enquanto a correção não entra.
