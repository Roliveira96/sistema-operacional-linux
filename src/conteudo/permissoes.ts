import type { Topico } from './Topico';
import type { Maquina } from '../linux/Maquina';
import { Verificar } from './Verificar';

/** 06 · Segurança de acesso: ler permissões, chmod, chown, chgrp, umask e testes com outros usuários. */
export const permissoes: Topico = {
  id: 'permissoes',
  numero: 6,
  titulo: 'Permissões e segurança de acesso',
  subtitulo: 'ls -l · chmod (letras e números) · chown · chgrp · umask · sticky bit',
  icone: '🔐',
  cor: '--cor-perm',
  resumo: 'Quem pode ler, escrever e executar: rwx, 755/644, dono e grupo, e testando com usuários diferentes.',
  conceitos:
    '<h3>👥 Três classes de pessoas × três permissões</h3>' +
    '<p>Cada arquivo tem um <b>dono</b> (u = user), um <b>grupo</b> (g = group) e o resto do mundo, os <b>outros</b> (o = others). ' +
    'Para cada classe há três permissões:</p>' +
    '<table class="tabela"><tr><th></th><th>no ARQUIVO</th><th>no DIRETÓRIO</th><th>valor</th></tr>' +
    '<tr><td><b>r</b> read</td><td>ler o conteúdo (cat)</td><td>listar o que tem dentro (ls)</td><td><b>4</b></td></tr>' +
    '<tr><td><b>w</b> write</td><td>alterar o conteúdo</td><td>criar, apagar e renomear coisas dentro</td><td><b>2</b></td></tr>' +
    '<tr><td><b>x</b> execute</td><td>rodar como programa</td><td>entrar (cd) e acessar o que tem dentro</td><td><b>1</b></td></tr></table>' +
    '<h3>🔢 Do texto para o número</h3>' +
    '<p>Some os valores de cada trio: <code>rwx</code> = 4+2+1 = <b>7</b>, <code>r-x</code> = 4+1 = <b>5</b>, <code>r--</code> = <b>4</b>, <code>---</code> = <b>0</b>. ' +
    'Então <code>rwxr-xr--</code> = <b>754</b>.</p>' +
    '<table class="tabela">' +
    '<tr><td><code>755</code></td><td><code>rwxr-xr-x</code></td><td>programas/scripts e pastas: todos leem e entram, só o dono altera</td></tr>' +
    '<tr><td><code>644</code></td><td><code>rw-r--r--</code></td><td>arquivos comuns: todos leem, só o dono altera</td></tr>' +
    '<tr><td><code>700</code></td><td><code>rwx------</code></td><td>pasta privada: só o dono</td></tr>' +
    '<tr><td><code>600</code></td><td><code>rw-------</code></td><td>arquivo privado (chaves, senhas)</td></tr>' +
    '<tr><td><code>770</code></td><td><code>rwxrwx---</code></td><td>pasta de equipe: dono e grupo fazem tudo, outros nada</td></tr>' +
    '<tr><td><code>777</code></td><td><code>rwxrwxrwx</code></td><td>todos fazem tudo: <b>evite</b></td></tr></table>' +
    '<p class="conceitos-dica">💡 O Linux olha só <b>uma</b> classe: se você é o dono, valem os bits do dono (mesmo que "outros" tenha mais). ' +
    'Senão, se está no grupo, valem os do grupo. Senão, os de outros. O <b>root</b> ignora tudo isso.</p>' +
    '<p>Nesta máquina já existem os usuários <b>maria</b> (grupo <b>financeiro</b>) e <b>joao</b>, ambos com senha <code>123</code>, e a pasta <code>/srv/empresa</code> para os testes.</p>',

  naPratica: 'Permissão errada é uma das maiores causas de problemas e de invasões em servidores. Um <code>.env</code> com a senha do banco legível por todos (644) expõe credenciais; um site com pastas 777 deixa qualquer processo invadido gravar código malicioso. E permissão fechada demais faz o site responder <b>403 Forbidden</b>.',
  demonstracao: [
    { comando: 'ls -l /srv/empresa' },
    { comando: 'id maria', explicacao: 'maria está no grupo financeiro' },
    { comando: 'id joao', explicacao: 'joao não está' },
    { comando: 'stat -c "%A = %a  dono: %U  grupo: %G" /srv/empresa/salarios.txt', explicacao: 'texto e número lado a lado' },
  ],

  preparar(maquina: Maquina): void {
    maquina.criarUsuario('maria', '123', ['financeiro']);
    maquina.criarUsuario('joao', '123');
    maquina.criarDiretorio('/srv/empresa', 0, 0, 0o755);
    maquina.criarDiretorio('/srv/empresa/privado', 0, 0, 0o755);
    maquina.criarArquivo('/srv/empresa/privado/senhas.txt', 'wifi: linux2026\n', 0, 0, 0o644);
    maquina.criarArquivo('/srv/empresa/relatorio.txt', 'Relatório anual: tudo certo.\n', 0, 0, 0o644);
    maquina.criarArquivo('/srv/empresa/script.sh', '#!/bin/bash\necho "Olá do script!"\n', 0, 0, 0o644);
    const financeiro: number = maquina.contas.grupo('financeiro')?.gid ?? 0;
    maquina.criarArquivo('/srv/empresa/salarios.txt', 'maria: R$ 5.000\njoao: R$ 4.000\n', 0, financeiro, 0o640);
  },

  licoes: [
    {
      comando: 'ls -l',
      titulo: 'Ler as permissões',
      descricao: 'O primeiro campo do <code>ls -l</code> é a permissão: 1 caractere de tipo + 3 trios (dono, grupo, outros). Depois vêm o dono e o grupo.',
      sintaxe: 'ls -l arquivo  |  ls -ld diretório  |  stat arquivo',
      naPratica: 'Primeiro passo quando aparece "Permission denied" ou o site dá 403: <code>ls -l /var/www/html</code> para ver dono, grupo e permissões. Quase sempre o culpado é um arquivo que ficou do root em vez do usuário do servidor web (<code>www-data</code>).',
      extra: 'anatomia-ls',
      exemplos: [
        { comando: 'cd /srv/empresa' },
        { comando: 'ls -l', explicacao: 'salarios.txt é do grupo financeiro, com 640' },
        { comando: 'ls -ld privado', explicacao: '-d: a permissão da própria pasta' },
        { comando: 'stat salarios.txt', explicacao: 'mostra em número (0640) e em texto' },
      ],
      dicas: [
        '<b>[LPIC-1 104.5 / Linux Essentials 5.3]:</b> O primeiro caractere indica o tipo: <code>-</code> (arquivo regular), <code>d</code> (diretório), <code>l</code> (link simbólico), <code>c</code> (caractere), <code>b</code> (bloco). Seguem os trios: Dono (u), Grupo (g) e Outros (o).',
      ],
    },
    {
      comando: 'chmod (letras)',
      titulo: 'Mudar permissões no modo simbólico',
      descricao: 'Diga <b>quem</b> (u, g, o ou a = todos), a <b>operação</b> (+ adiciona, - tira, = define exatamente) e <b>quais</b> permissões (r, w, x).',
      sintaxe: 'chmod [ugoa][+-=][rwx] arquivo',
      naPratica: 'Tornar executável um script de backup recém-criado: <code>chmod +x backup.sh</code>. Tirar a leitura dos outros num arquivo com senhas: <code>chmod o-r .env</code>. O modo simbólico é ideal para mudar UM bit sem mexer nos demais.',
      opcoes: [
        ['u+x', 'dá execução ao dono'],
        ['g-w', 'tira a escrita do grupo'],
        ['o=', 'zera tudo dos outros'],
        ['a+r', 'todos podem ler (a = all)'],
        ['u=rw,g=r,o=', 'várias de uma vez, separadas por vírgula SEM espaço'],
        ['-v', 'mostra o antes e o depois'],
      ],
      exemplos: [
        { comando: './script.sh', explicacao: 'sem x ninguém executa: Permissão negada' },
        { comando: 'chmod -v u+x script.sh', explicacao: 'dono ganha execução' },
        { comando: './script.sh', explicacao: 'agora roda (./ = "o arquivo daqui")' },
        { comando: 'chmod -v go-r relatorio.txt', explicacao: 'grupo e outros perdem leitura' },
        { comando: 'chmod -v a+r relatorio.txt', explicacao: 'todos voltam a ler' },
        { comando: 'chmod -v u=rw,g=r,o= relatorio.txt', explicacao: '= define exatamente: vira 640' },
        { comando: 'ls -l' },
      ],
      dicas: [
        '<b>[LPIC-1 104.5]:</b> Classes: <code>u</code> (user/dono), <code>g</code> (group), <code>o</code> (others), <code>a</code> (all/todos). Operadores: <code>+</code> adiciona, <code>-</code> retira, <code>=</code> fixa. Sem letra de classe, <code>chmod +x</code> aplica a todos (<code>a+x</code>).',
      ],
    },
    {
      comando: 'chmod (números)',
      titulo: 'Mudar permissões no modo octal',
      descricao: 'Três dígitos: <b>dono</b>, <b>grupo</b>, <b>outros</b>. Cada dígito é a soma r=4, w=2, x=1. Brinque com a calculadora:',
      sintaxe: 'chmod 755 arquivo',
      naPratica: 'Os valores clássicos de um servidor web: pastas <code>755</code>, arquivos <code>644</code>, arquivos com senha (<code>.env</code>, <code>wp-config.php</code>) <code>600</code> ou <code>640</code>. A chave SSH privada (<code>~/.ssh/id_ed25519</code>) precisa ser <code>600</code>: se estiver mais aberta, o próprio ssh se recusa a usá-la.',
      extra: 'calculadora-permissoes',
      exemplos: [
        { comando: 'chmod 755 script.sh', explicacao: 'rwxr-xr-x: todos executam, só o dono altera' },
        { comando: 'chmod 600 salarios.txt', explicacao: 'rw-------: só o dono (root)' },
        { comando: 'chmod 640 salarios.txt', explicacao: 'rw-r-----: dono altera, grupo lê' },
        { comando: 'chmod 700 privado', explicacao: 'pasta privada: só o dono entra' },
        { comando: 'ls -l' },
      ],
      dicas: [
        '<b>[LPIC-1 104.5 / Linux Essentials 5.3]:</b> Tabela octal: r=4, w=2, x=1. Padrões de prova: <code>755</code> (scripts e pastas), <code>644</code> (arquivos de texto comuns), <code>600</code> (senhas e chaves privadas).',
      ],
      pegadinha: '<b>[LPIC-1 104.5 / RHCSA EX200]:</b> Em DIRETÓRIOS, o bit <code>x</code> (1) é o direito de ENTRAR (cd) e acessar seus arquivos. Sem <code>x</code>, mesmo tendo <code>r</code>, o usuário lista os nomes pelo <code>ls</code> mas recebe "Permissão negada" ao tentar ler qualquer arquivo interno!',
    },
    {
      comando: 'chmod -R',
      titulo: 'Aplicar numa pasta inteira',
      descricao: 'Com <code>-R</code> (maiúsculo!) a mudança vale para a pasta e tudo que estiver dentro dela.',
      sintaxe: 'chmod -R modo diretório',
      naPratica: 'Corrigir as permissões de um site inteiro depois de um upload feito errado. No Ubuntu real, o jeito seguro separa pastas e arquivos: <code>find /var/www/html -type d -exec chmod 755 {} \\;</code> e <code>find /var/www/html -type f -exec chmod 644 {} \\;</code>.',
      exemplos: [
        { comando: 'chmod -Rv 750 privado', explicacao: 'repare: senhas.txt ganhou x sem precisar' },
        { comando: 'chmod -Rv u=rwX,g=rX,o= privado', explicacao: 'X maiúsculo: x só em pastas (e no que já era executável)' },
      ],
      dicas: [
        '<b>[LPIC-1 104.5]:</b> O caractere especial <code>X</code> maiúsculo (ex.: <code>chmod -R a+rX pasta</code>) aplica execução somente a pastas e a arquivos que já eram executáveis, evitando dar <code>x</code> a arquivos comuns.',
      ],
      pegadinha: '<b>[LPIC-1 104.5]:</b> No chmod/chown/chgrp o recursivo é <b>-R maiúsculo</b>. No rm e no cp é -r minúsculo (o cp aceita os dois).',
    },
    {
      comando: 'chown',
      titulo: 'Mudar o dono (e o grupo)',
      descricao: '<b>ch</b>ange <b>own</b>er. Só o <b>root</b> pode dar um arquivo para outra pessoa. Com <code>dono:grupo</code> troca os dois de uma vez.',
      sintaxe: 'chown dono[:grupo] arquivo',
      naPratica: 'Depois de copiar os arquivos de um site como root, eles ficam do root e o nginx/apache não consegue gravar os uploads. A correção clássica: <code>chown -R www-data:www-data /var/www/html</code>.',
      opcoes: [
        ['maria arq', 'só o dono'],
        ['maria:financeiro arq', 'dono e grupo'],
        [':financeiro arq', 'só o grupo (igual ao chgrp)'],
        ['-R', 'recursivo'],
      ],
      exemplos: [
        { comando: 'chown maria relatorio.txt' },
        { comando: 'chown -v maria:financeiro relatorio.txt' },
        { comando: 'mkdir /srv/equipe' },
        { comando: 'chown -R maria:financeiro /srv/equipe' },
        { comando: 'ls -ld /srv/equipe' },
      ],
      dicas: [
        '<b>[LPIC-1 104.5]:</b> <code>chown usuario:grupo arquivo</code> troca dono e grupo de uma só vez. <code>chown :grupo arquivo</code> altera apenas o grupo.',
      ],
      pegadinha: '<b>[LPIC-1 104.5 / Linux Essentials 5.3]:</b> Apenas o superusuário <b>root</b> tem permissão para alterar o dono (owner) de um arquivo no Linux. Usuários comuns não podem doar arquivos para outros.',
    },
    {
      comando: 'chgrp',
      titulo: 'Mudar só o grupo',
      descricao: '<b>ch</b>ange <b>gr</b>ou<b>p</b>. O dono do arquivo também pode usar, mas só para um grupo do qual ele participa.',
      sintaxe: 'chgrp grupo arquivo',
      naPratica: 'Dar acesso a uma pasta para uma equipe inteira: <code>chgrp -R devs /srv/projeto</code> e <code>chmod 770</code>. Quem entrar no grupo <code>devs</code> ganha acesso na hora, sem ninguém mexer em permissão de novo.',
      opcoes: [['-R', 'recursivo']],
      exemplos: [
        { comando: 'chgrp -v financeiro script.sh' },
        { comando: 'ls -l script.sh' },
      ],
      dicas: [
        '<b>[LPIC-1 104.5]:</b> O usuário dono de um arquivo pode usar <code>chgrp</code> para alterar o grupo, mas somente para grupos aos quais ele próprio pertença.',
      ],
    },
    {
      comando: 'testando o acesso',
      titulo: 'Provar que funciona: outros usuários',
      descricao: 'A melhor forma de entender permissão é tentar acessar como outra pessoa. O terminal <b>2</b> entra como <b>maria</b> (grupo financeiro) e o <b>3</b> como <b>joao</b> (fora do grupo).',
      sintaxe: 'ssh maria@servidor  (ou: su - maria)',
      naPratica: 'Antes de liberar um servidor, o administrador testa como o usuário final: <code>su - usuario</code> (ou <code>sudo -u www-data cat arquivo</code>) para confirmar que ele acessa o que deve e, principalmente, NÃO acessa o que não deve.',
      exemplos: [
        { comando: 'cat /srv/empresa/salarios.txt', terminal: 2, login: { usuario: 'maria', senha: '123' }, explicacao: 'maria está no grupo financeiro: o r do grupo deixa ler' },
        { comando: 'echo "maria: R$ 9.000" >> /srv/empresa/salarios.txt', terminal: 2, explicacao: 'mas o grupo não tem w: Permissão negada' },
        { comando: 'cat /srv/empresa/salarios.txt', terminal: 3, login: { usuario: 'joao', senha: '123' }, explicacao: 'joao é "outros": 0 = nada' },
        { comando: 'cd /srv/empresa/privado', terminal: 3, explicacao: 'sem x na pasta: não entra' },
        { comando: 'cat /srv/empresa/relatorio.txt', terminal: 3, explicacao: 'relatorio.txt é 640 e joao não é do grupo: negado' },
        { comando: 'ls -l /srv/empresa', terminal: 3, explicacao: 'listar a pasta ele pode (a pasta é 755)' },
      ],
      dicas: [
        '<b>[LPIC-1 104.5]:</b> O kernel avalia apenas uma classe na ordem: Dono → Grupo → Outros. Se o usuário for o dono, valem exclusivamente os bits do dono.',
        'Mudou algo como root? Rode de novo no terminal do usuário: o efeito é imediato para permissões. Para <b>grupos novos</b>, o usuário precisa logar de novo.',
      ],
    },
    {
      comando: 'umask',
      titulo: 'A permissão padrão dos arquivos novos',
      descricao: 'O <b>umask</b> é uma máscara que <b>tira</b> permissões de tudo que é criado. Arquivos partem de 666 e pastas de 777; o umask subtrai.',
      sintaxe: 'umask  |  umask 027',
      naPratica: 'Em servidores compartilhados, um umask <code>027</code> faz tudo que os usuários criam já nascer fechado para os outros. Serviços como servidores de arquivos (Samba, SFTP) também configuram umask para os uploads terem a permissão certa.',
      opcoes: [
        ['umask 022', '(root) arquivos 644, pastas 755'],
        ['umask 002', '(usuários no Ubuntu) arquivos 664, pastas 775'],
        ['umask 027', 'arquivos 640, pastas 750: outros não veem nada'],
        ['umask -S', 'mostra no formato u=rwx,g=rx,o=rx'],
      ],
      exemplos: [
        { comando: 'umask', explicacao: 'root: 0022' },
        { comando: 'cd /root && touch antes.txt && mkdir antes' },
        { comando: 'umask 027' },
        { comando: 'touch depois.txt && mkdir depois' },
        { comando: 'ls -l', explicacao: 'compare antes (644/755) e depois (640/750)' },
      ],
      dicas: [
        '<b>[LPIC-1 104.5 & CompTIA Linux+]:</b> Base de cálculo do umask: diretórios partem de <code>777</code> e arquivos partem de <code>666</code> (nenhum arquivo comum nasce executável por padrão).',
        'O umask vale só para o shell atual. Para ficar permanente, coloque o comando no <code>~/.bashrc</code>.',
      ],
      pegadinha: '<b>[LPIC-1 104.5]:</b> O umask SUBTRAI permissões: umask <code>022</code> resulta em <code>644</code> para arquivos (666 - 022) e <code>755</code> para pastas (777 - 022). Um umask <code>027</code> gera arquivos <code>640</code> e pastas <code>750</code>.',
    },
    {
      comando: 'chmod +t',
      titulo: 'Sticky bit: pasta compartilhada segura',
      descricao: 'Numa pasta onde todos escrevem (777), qualquer um apagaria o arquivo dos outros. O <b>sticky bit</b> (o <code>t</code>, ou o <b>1</b> na frente do número) impede: cada um só apaga o que é seu. É assim no <code>/tmp</code>.',
      sintaxe: 'chmod 1777 pasta  |  chmod +t pasta',
      naPratica: 'Pastas de upload compartilhadas e o próprio <code>/tmp</code>. O SUID aparece no <code>/usr/bin/passwd</code>: ele precisa gravar no <code>/etc/shadow</code> (que é do root) mesmo quando um usuário comum troca a própria senha.',
      exemplos: [
        { comando: 'mkdir /srv/publico' },
        { comando: 'chmod 1777 /srv/publico' },
        { comando: 'ls -ld /srv/publico /tmp', explicacao: 'drwxrwxrwt: o t no lugar do último x' },
      ],
      dicas: [
        '<b>[LPIC-1 104.6 / Linux Essentials 5.4]:</b> Permissões especiais (4º dígito octal): <b>4000 = SUID</b> (executa como dono, ex: <code>/usr/bin/passwd</code>), <b>2000 = SGID</b> (arquivos herdam grupo da pasta), <b>1000 = Sticky Bit</b> (exclusão restrita ao dono, ex: <code>/tmp</code> 1777).',
        '<b>[LPIC-1 104.6]:</b> Se aparecer <code>S</code> ou <code>T</code> maiúsculo no <code>ls -l</code>, significa que o bit especial está ativo mas o bit <code>x</code> correspondente está DESLIGADO! Com <code>x</code> ligado, eles aparecem minúsculos: <code>s</code> e <code>t</code>.',
      ],
      pegadinha: '<b>[LPIC-1 104.6 / RHCSA EX200]:</b> Para pastas colaborativas compartilhadas entre membros de um mesmo grupo, a prova exige o <b>SGID</b> (<code>chmod 2770 pasta</code> ou <code>chmod g+s pasta</code>): novos arquivos herdam automaticamente o grupo da pasta.',
    },
  ],

  desafios: [
    {
      id: 'perm-1',
      enunciado: 'Deixe <code>/srv/empresa/script.sh</code> com permissão <code>rwxr-x---</code>.',
      dica: 'rwx = 7, r-x = 5, --- = 0.',
      solucao: [{ comando: 'chmod 750 /srv/empresa/script.sh' }],
      verificar: (m) => Verificar.modo(m, '/srv/empresa/script.sh', 0o750),
    },
    {
      id: 'perm-2',
      enunciado: 'Faça com que <b>somente o dono</b> consiga ler e alterar <code>/srv/empresa/privado/senhas.txt</code> (ninguém executa).',
      dica: 'rw------- = ?',
      solucao: [{ comando: 'chmod 600 /srv/empresa/privado/senhas.txt' }],
      verificar: (m) => Verificar.modo(m, '/srv/empresa/privado/senhas.txt', 0o600),
    },
    {
      id: 'perm-3',
      enunciado: 'Transforme <code>/srv/empresa/relatorio.txt</code> em arquivo da <b>maria</b> e do grupo <b>financeiro</b>.',
      dica: 'chown dono:grupo arquivo.',
      solucao: [{ comando: 'chown maria:financeiro /srv/empresa/relatorio.txt' }],
      verificar: (m) => Verificar.dono(m, '/srv/empresa/relatorio.txt', 'maria', 'financeiro'),
    },
    {
      id: 'perm-4',
      enunciado: 'Crie a pasta <code>/srv/financeiro</code> do grupo <b>financeiro</b>, onde dono e grupo fazem tudo e os outros <b>não entram</b>.',
      dica: 'mkdir, chgrp (ou chown :grupo) e chmod 770.',
      solucao: [{ comando: 'mkdir /srv/financeiro' }, { comando: 'chgrp financeiro /srv/financeiro' }, { comando: 'chmod 770 /srv/financeiro' }],
      verificar: (m) => Verificar.grupoDoNo(m, '/srv/financeiro', 'financeiro') && Verificar.modo(m, '/srv/financeiro', 0o770),
    },
    {
      id: 'perm-5',
      enunciado: 'Prove que funcionou: logada como <b>maria</b> no terminal 2, crie o arquivo <code>/srv/financeiro/balanco.txt</code>.',
      dica: 'Depois do desafio 4, abra o terminal 2, entre como maria (senha 123) e use touch ou echo.',
      solucao: [{ comando: 'touch /srv/financeiro/balanco.txt', terminal: 2, login: { usuario: 'maria', senha: '123' } }],
      verificar: (m) => Verificar.dono(m, '/srv/financeiro/balanco.txt', 'maria'),
    },
    {
      id: 'perm-6',
      enunciado: 'Crie <code>/srv/uploads</code> onde <b>todos</b> escrevem, mas ninguém apaga o arquivo dos outros.',
      dica: 'Sticky bit: 1777.',
      solucao: [{ comando: 'mkdir /srv/uploads' }, { comando: 'chmod 1777 /srv/uploads' }],
      verificar: (m) => Verificar.no(m, '/srv/uploads')?.modo === 0o1777,
    },
  ],
};
