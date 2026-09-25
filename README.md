<div align="center">

# 🐧 Linux na prática

### Material de estudo + servidor Ubuntu simulado no navegador

**Os comandos que caem na prova, um a um, com dicas e pegadinhas, e um terminal Ubuntu ao lado executando cada comando.**
Assista ao comando sendo digitado, depois pratique você mesmo em até **3 terminais** conectados por "SSH" à mesma máquina: um como `root` e os outros como usuários comuns.

![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Sem frameworks](https://img.shields.io/badge/sem-frameworks-3ddc97)
![Ubuntu](https://img.shields.io/badge/simula-Ubuntu%2024.04-E95420?logo=ubuntu&logoColor=white)

**Aluno:** Ricardo Martins de Oliveira · [GitHub](https://github.com/Roliveira96) · [LinkedIn](https://www.linkedin.com/in/ricardodeoliveira96/) · [rmo.dev.br](https://rmo.dev.br)
**Professora:** Sediane Carmem Lunardi Hernandes (UTFPR · Campus Guarapuava) · Avaliação de suficiência de Sistema Operacional Linux

</div>

---

## 🚀 Como rodar

Pré-requisito: [Node.js](https://nodejs.org) 20.19+ ou 22.12+.

```bash
npm install
npm run dev
```

Abra o endereço que o Vite mostrar (ex.: **http://localhost:5173**).

## 📚 Conteúdo (o que a prova cobre)

| # | Tópico | Comandos |
|---|--------|----------|
| 01 | 📁 Navegação e diretórios | `pwd` `ls` `cd` `mkdir` `tree` `rmdir` |
| 02 | 📄 Arquivos | `touch` `echo > >>` `cat` `head` `tail` `grep` `wc` `cp` `mv` `nano` `vim` |
| 03 | 🗑️ Exclusão | `rm` `rm -r` `rm -i` `rm -f` curingas `*` `?`, sticky bit do `/tmp` |
| 04 | 🔐 Permissões e segurança de acesso | `ls -l` `chmod` (letras e números) `chown` `chgrp` `umask` `chmod 1777` |
| 05 | 👥 Usuários e grupos | `whoami` `id` `useradd` `passwd` `adduser` `su` `sudo` `usermod -aG` `groupadd` `gpasswd` `userdel` `groupdel` |
| 06 | 📝 Simulado | 12 tarefas encadeadas no estilo da prova prática |

Cada comando tem um **card** com: descrição, sintaxe, tabela de opções, exemplos clicáveis (▶ executa no terminal), 💡 dicas e ⚠️ "cai na prova".
Cada tópico tem **🎯 desafios** que se corrigem sozinhos: depois de cada comando, o site confere o estado real da máquina (o arquivo existe? a permissão é 750? a maria está no grupo?).

## 🖥️ Como usar

- **▶ nos exemplos**: digita e executa aquele comando no terminal indicado (T1 = root; T2/T3 = outros usuários, com login automático).
- **Reprodutor no topo**: ▶ executa o roteiro inteiro, ⏭ só o próximo, ⏮ volta um passo (reinicia a máquina e refaz até o anterior). Teclas: `←` `espaço` `→`.
- **＋ na janela do terminal**: abre outra conexão SSH (`login as:` / senha). **⊞ Lado a lado** mostra todas juntas.
- **Senhas**: `root` = `123`, `ricardo` = `123`. Usuários criados só conseguem logar depois do `passwd`.
- **Atalhos**: `Tab` completa, `↑ ↓` histórico, `Ctrl+C` cancela, `Ctrl+L` limpa.
- **💾 / 📂**: exporta e importa a máquina em JSON. Tudo também fica salvo no navegador automaticamente.
- **🖥️ Laboratório livre**: a máquina sem roteiro, para treinar à vontade.

## 🏗️ Arquitetura

```
src/
├── linux/            ← o "kernel": sistema de arquivos virtual, contas e sessões
│   ├── No.ts             Arquivo, Diretorio, ArquivoGerado (/etc/passwd...), Buraco (/dev/null)
│   ├── SistemaDeArquivos resolução de caminhos (/, ./, ../, ~) e checagem rwx
│   ├── Permissoes.ts     octal ⇄ texto ⇄ simbólico (u+x,g-w,o=)
│   ├── Contas.ts         Usuario, Grupo e geração de passwd/group/shadow
│   ├── Sessao.ts         pilha de shells (su/sudo -i empilham, exit desempilha)
│   ├── Maquina.ts        junta tudo; várias sessões = vários terminais
│   └── Serializador.ts   máquina ⇄ JSON
├── shell/            ← o "bash"
│   ├── Analisador.ts     aspas, escapes, $VAR, ~, ; && || | > >> 2> <
│   ├── Interpretador.ts  curingas, pipes, redirecionamentos, ./scripts
│   └── comandos/         +50 comandos, um por classe
├── terminal/         ← a interface
│   ├── TerminalUbuntu    GNOME Terminal: prompt, histórico, Tab, login SSH
│   ├── JanelaDeTerminais até 3 abas / lado a lado
│   ├── EditorNano        ^O grava, ^X sai, ^K/^U recorta/cola
│   └── EditorVim         modos NORMAL / INSERÇÃO / COMANDO (:w :q :wq :q!)
├── conteudo/         ← o material de estudo (um arquivo por tópico)
└── app/              ← telas: menu, tópico, laboratório
```

### Permissões (regra do kernel)

`SistemaDeArquivos.pode(no, credencial, 'r'|'w'|'x')`: root pode tudo; se o UID é o dono, valem **só** os bits do dono; senão, se algum GID da sessão é o grupo do arquivo, valem os do grupo; senão, os de outros. Para **entrar** em cada diretório do caminho é preciso `x`; para **criar/apagar** é preciso `w`+`x` no diretório pai, e o sticky bit restringe a exclusão ao dono.

Os grupos da sessão são lidos **no login**, como no Linux real: depois de um `usermod -aG`, o usuário precisa logar de novo.

### Schema JSON (persistência)

```jsonc
{
  "formato": "exame-so/maquina",
  "versao": 1,
  "hostname": "servidor",
  "contas": {
    "usuarios": [
      { "nome": "maria", "uid": 1001, "gid": 1001, "comentario": "Maria Silva",
        "home": "/home/maria", "shell": "/bin/bash", "senha": "123", "bloqueado": false }
    ],
    "grupos": [ { "nome": "financeiro", "gid": 1002, "membros": ["maria"] } ]
  },
  "raiz": {
    "nome": "", "tipo": "diretorio", "dono": 0, "grupo": 0,
    "permissoes": "755", "modificadoEm": "2026-09-25T12:00:00.000Z",
    "filhos": [
      { "nome": "etc", "tipo": "diretorio", "dono": 0, "grupo": 0, "permissoes": "755", "modificadoEm": "…",
        "filhos": [ { "nome": "passwd", "tipo": "gerado", "dono": 0, "grupo": 0, "permissoes": "644", "modificadoEm": "…" } ] },
      { "nome": "tmp", "tipo": "diretorio", "dono": 0, "grupo": 0, "permissoes": "1777", "modificadoEm": "…", "filhos": [] },
      { "nome": "notas.txt", "tipo": "arquivo", "dono": 1001, "grupo": 1001, "permissoes": "644",
        "modificadoEm": "…", "conteudo": "texto do arquivo\n" }
    ]
  }
}
```

- `tipo`: `diretorio` (tem `filhos`), `arquivo` (tem `conteudo`), `gerado` (`/etc/passwd`, `/etc/group` e `/etc/shadow`, recalculados a partir de `contas`) e `nulo` (`/dev/null`).
- `permissoes` é octal em texto (`"755"`, `"1777"`); `dono`/`grupo` são UID/GID numéricos, como no inode real (por isso um usuário apagado aparece como número no `ls -l`).
- A senha fica em texto puro porque é um simulador didático; o `/etc/shadow` exibe um hash fictício.

### Modo linha × tela cheia (nano e vim)

O comando `nano`/`vim` não desenha nada: ele monta um `PedidoDeEdicao` (caminho, conteúdo, se é somente leitura e uma função `gravar()` que aplica as **mesmas regras de permissão** do redirecionamento `>`) e chama `interacao.editar(pedido)`, que devolve uma `Promise`.
O terminal então esconde a área de linhas, monta o editor no lugar e só resolve a Promise quando o editor fecha, e assim o shell fica "parado" no comando, exatamente como no Linux. O teclado também muda de dono: enquanto o editor está aberto, o terminal ignora as teclas.

## 📖 Referências

- `man` do Ubuntu 24.04: coreutils (`ls`, `cp`, `mv`, `rm`, `chmod`, `chown`), shadow-utils (`useradd`, `usermod`, `userdel`, `groupadd`, `passwd`) e `adduser(8)`.
- NEMETH, E. et al. *Manual de Administração do Sistema Unix e Linux*. Pearson.
- [Ubuntu Server documentation: user management](https://documentation.ubuntu.com/server/how-to/security/user-management/).
