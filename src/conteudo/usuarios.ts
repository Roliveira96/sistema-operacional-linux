import type { Topico } from './Topico';
import type { Maquina } from '../linux/Maquina';
import { Verificar } from './Verificar';

/** 05 · Usuários e grupos: contas, senhas, troca de usuário, sudo e grupos. */
export const usuarios: Topico = {
  id: 'usuarios',
  numero: 5,
  titulo: 'Usuários e grupos',
  subtitulo: 'useradd · passwd · su · sudo · usermod · groupadd · gpasswd · userdel',
  icone: '👥',
  cor: '--cor-usr',
  resumo: 'Criar contas, definir senhas, trocar de usuário, dar poder de sudo e organizar em grupos.',
  conceitos:
    '<h3>🧾 Onde o Linux guarda as contas</h3>' +
    '<table class="tabela">' +
    '<tr><td><code>/etc/passwd</code></td><td>todas as contas (qualquer um lê). Uma linha por usuário.</td></tr>' +
    '<tr><td><code>/etc/shadow</code></td><td>as <b>senhas</b> criptografadas (só o root lê)</td></tr>' +
    '<tr><td><code>/etc/group</code></td><td>os grupos e quem participa de cada um</td></tr></table>' +
    '<p>Anatomia de uma linha do <code>/etc/passwd</code>:</p>' +
    '<pre class="anatomia-linha"><span class="an-dono">maria</span>:<span class="an-tipo">x</span>:<span class="an-outros">1001</span>:<span class="an-grupo">1001</span>:<span class="an-links">Maria Silva</span>:<span class="an-nome">/home/maria</span>:<span class="an-dono">/bin/bash</span></pre>' +
    '<p><b>login</b> : <b>x</b> (a senha está no shadow) : <b>UID</b> : <b>GID</b> do grupo principal : <b>comentário</b> (nome completo) : <b>home</b> : <b>shell</b></p>' +
    '<h3>🆔 UID e tipos de conta</h3>' +
    '<p><b>UID 0</b> = root (pode tudo). <b>1 a 999</b> = contas de sistema (serviços). <b>1000+</b> = pessoas. ' +
    'Cada usuário tem um <b>grupo principal</b> (no Ubuntu, um grupo com o mesmo nome dele) e pode estar em vários <b>grupos suplementares</b>.</p>' +
    '<h3>🖥️ Três terminais, três sessões</h3>' +
    '<p>O terminal 1 é o <b>root</b>. Crie usuários aqui, defina a senha e abra o terminal 2 ou 3 (botão ＋) para entrar como eles, como se fosse outro computador conectando por SSH.</p>' +
    '<p class="conceitos-dica">💡 <b>Sem senha, sem login.</b> O <code>useradd</code> cria a conta <b>bloqueada</b> (sem senha). Só depois do <code>passwd</code> ela consegue entrar.</p>',

  naPratica: 'Num servidor, cada pessoa e cada serviço tem sua conta: o nginx roda como <code>www-data</code> e o PostgreSQL como <code>postgres</code>. Isso limita o estrago: se o site for invadido, o invasor fica preso às permissões do www-data, não do root. Boa prática: ninguém trabalha como root no dia a dia; cada administrador tem seu usuário e usa <code>sudo</code>.',
  demonstracao: [
    { comando: 'tail -3 /etc/passwd', explicacao: 'as contas' },
    { comando: 'tail -3 /etc/group', explicacao: 'os grupos' },
    { comando: 'ls -l /etc/shadow', explicacao: 'as senhas: só root lê' },
    { comando: 'id', explicacao: 'root = uid 0' },
    { comando: 'id ricardo', explicacao: 'usuário comum, no grupo sudo' },
  ],

  preparar(maquina: Maquina): void {
    maquina.criarUsuario('estagiario', '123');
    maquina.criarUsuario('temporario', '123');
  },

  licoes: [
    {
      comando: 'whoami / id',
      titulo: 'Quem sou eu?',
      descricao: '<code>whoami</code> mostra o usuário atual. <code>id</code> mostra UID, GID e todos os grupos. <code>groups</code> lista só os nomes dos grupos.',
      sintaxe: 'whoami  |  id [usuário]  |  groups [usuário]',
      naPratica: 'Antes de rodar algo importante, confirme quem você é (principalmente depois de vários su/sudo). O <code>id</code> também resolve o clássico "por que não consigo acessar esta pasta?": mostra se você realmente está no grupo necessário.',
      exemplos: [
        { comando: 'whoami' },
        { comando: 'id', explicacao: 'root: uid=0' },
        { comando: 'id ricardo', explicacao: 'ricardo está no grupo sudo' },
        { comando: 'groups ricardo' },
      ],
    },
    {
      comando: 'cat /etc/passwd',
      titulo: 'Os arquivos de contas',
      descricao: 'Tudo o que os comandos de usuário fazem aparece nestes arquivos. Ler o <code>/etc/passwd</code> e o <code>/etc/group</code> é o melhor jeito de conferir.',
      sintaxe: 'cat /etc/passwd  |  cat /etc/group  |  sudo cat /etc/shadow',
      naPratica: 'Auditoria de segurança: listar quem tem shell de login (<code>grep bash /etc/passwd</code>), achar contas esquecidas de ex-funcionários e conferir quem tem poder de administrador (<code>grep sudo /etc/group</code>).',
      exemplos: [
        { comando: 'tail -3 /etc/passwd', explicacao: 'os usuários criados ficam no fim' },
        { comando: 'cut -d: -f1 /etc/passwd', explicacao: 'só os nomes (campo 1, separador :)' },
        { comando: 'grep sudo /etc/group', explicacao: 'quem está no grupo sudo' },
        { comando: 'getent passwd ricardo', explicacao: 'consulta um só' },
        { comando: 'ls -l /etc/passwd /etc/shadow', explicacao: 'shadow: só root e o grupo shadow leem' },
      ],
    },
    {
      comando: 'useradd',
      titulo: 'Criar usuário (jeito "cru")',
      descricao: 'Cria a conta. No Ubuntu, <b>sem opções</b> ele não cria a pasta pessoal e usa o shell <code>/bin/sh</code>. Por isso quase sempre se usa <code>-m -s /bin/bash</code>.',
      sintaxe: 'useradd [opções] usuário',
      naPratica: 'Criar a conta de um novo desenvolvedor, ou uma conta de serviço sem login para rodar uma aplicação: <code>useradd -r -s /usr/sbin/nologin app</code> (-r = conta de sistema). Por não fazer perguntas, o useradd é o preferido em scripts de automação.',
      opcoes: [
        ['-m', 'cria a home (/home/usuário) copiando o /etc/skel'],
        ['-s /bin/bash', 'define o shell'],
        ['-G grupo1,grupo2', 'grupos suplementares'],
        ['-g grupo', 'grupo principal'],
        ['-c "Nome"', 'comentário (nome completo)'],
        ['-d /caminho', 'home em outro lugar'],
      ],
      exemplos: [
        { comando: 'useradd maria -m -s /bin/bash -c "Maria Silva"' },
        { comando: 'tail -1 /etc/passwd' },
        { comando: 'ls -la /home/maria', explicacao: 'home criada com os arquivos do /etc/skel' },
        { comando: 'useradd pedro', explicacao: 'sem -m...' },
        { comando: 'ls /home', explicacao: '... não tem /home/pedro!' },
      ],
      pegadinha: 'Esquecer o <code>-m</code>: a conta existe, mas sem pasta pessoal. No login aparece "Could not chdir to home directory".',
    },
    {
      comando: 'passwd',
      titulo: 'Definir ou trocar senha',
      descricao: 'Como root, <code>passwd usuário</code> define a senha de qualquer um. Um usuário comum só troca a própria (e precisa digitar a atual). ' +
        'Nada aparece enquanto você digita a senha, e isso é normal.',
      sintaxe: 'passwd [usuário]',
      naPratica: 'Definir a senha inicial de um colaborador novo, resetar a de quem esqueceu, ou bloquear na hora uma conta suspeita com <code>passwd -l</code>. Muitas empresas obrigam a troca no primeiro acesso com <code>passwd -e usuario</code>.',
      opcoes: [
        ['passwd', 'troca a SUA senha'],
        ['passwd maria', '(root) define a senha da maria'],
        ['passwd -l maria', 'bloqueia (lock) a senha'],
        ['passwd -u maria', 'desbloqueia (unlock)'],
        ['passwd -S maria', 'status: P = tem senha, L = bloqueada'],
      ],
      exemplos: [
        { comando: 'passwd -S maria', explicacao: 'L: ainda sem senha' },
        { comando: 'passwd maria', respostas: ['123', '123'], explicacao: 'digitamos 123 duas vezes' },
        { comando: 'passwd -S maria', explicacao: 'P: pronta para logar' },
      ],
    },
    {
      comando: 'login SSH',
      titulo: 'Entrar como o novo usuário',
      descricao: 'Com a senha definida, a conta pode logar. O terminal 2 conecta como <b>maria</b>. Repare que o prompt termina com <code>$</code> (usuário comum).',
      sintaxe: 'ssh maria@192.168.0.10  (botão ＋ no simulador)',
      naPratica: 'É exatamente assim que se administra servidor: <code>ssh maria@192.168.0.10</code> de outro computador. Em produção, costuma-se proibir o login do root por SSH e trocar senha por chave SSH.',
      exemplos: [
        { comando: 'whoami', terminal: 2, login: { usuario: 'maria', senha: '123' } },
        { comando: 'pwd', terminal: 2, explicacao: 'caiu na home dela' },
        { comando: 'ls /root', terminal: 2, explicacao: 'usuário comum não bisbilhota o root' },
        { comando: 'who', explicacao: 'no root: quem está conectado' },
      ],
    },
    {
      comando: 'su',
      titulo: 'Trocar de usuário no mesmo terminal',
      descricao: '<b>s</b>ubstitute <b>u</b>ser. <code>su - maria</code> vira a maria (pede a senha <b>dela</b>). O <code>-</code> faz um login completo: vai para a home e carrega o ambiente dela. <code>exit</code> volta.',
      sintaxe: 'su [-] [usuário]',
      naPratica: 'Assumir a conta de um serviço para administrá-lo: <code>sudo su - postgres</code> para mexer no banco como o usuário postgres. Ou reproduzir um problema vendo exatamente o que o usuário vê.',
      opcoes: [
        ['su - maria', 'vira maria com login completo (recomendado)'],
        ['su maria', 'vira maria mas continua na pasta atual'],
        ['su -', 'vira root (pede a senha do ROOT)'],
        ['exit', 'volta para quem você era'],
      ],
      exemplos: [
        { comando: 'su - maria', explicacao: 'root não precisa de senha' },
        { comando: 'whoami' },
        { comando: 'su - ricardo', respostas: ['123'], explicacao: 'maria → ricardo: pede a senha do ricardo' },
        { comando: 'whoami' },
        { comando: 'exit', explicacao: 'volta para maria' },
        { comando: 'exit', explicacao: 'volta para root' },
      ],
      pegadinha: '<code>su</code> pede a senha do usuário de <b>destino</b>; o <code>sudo</code> pede a <b>sua</b> senha.',
    },
    {
      comando: 'sudo',
      titulo: 'Executar como root, sendo usuário comum',
      descricao: 'Quem está no grupo <b>sudo</b> pode rodar comandos de administrador colocando <code>sudo</code> na frente, digitando a <b>própria</b> senha. ' +
        'O ricardo já está no grupo; a maria, não.',
      sintaxe: 'sudo comando  |  sudo -i (vira root)',
      naPratica: 'É o padrão do Ubuntu: o root nem tem senha e os administradores usam <code>sudo</code>. Cada comando fica registrado em <code>/var/log/auth.log</code> com quem executou, o que permite auditar. Tirar alguém do grupo sudo é como retirar os poderes de administrador.',
      exemplos: [
        { comando: 'cat /etc/shadow', terminal: 2, explicacao: 'maria: Permissão negada' },
        { comando: 'sudo cat /etc/shadow', terminal: 2, respostas: ['123'], explicacao: 'maria não está no sudoers' },
        { comando: 'usermod -aG sudo maria', explicacao: 'root coloca maria no grupo sudo' },
        { comando: 'exit', terminal: 2, explicacao: 'grupo novo só vale depois de logar de novo' },
        { comando: 'sudo cat /etc/shadow', terminal: 2, login: { usuario: 'maria', senha: '123' }, respostas: ['123'], explicacao: 'agora funciona' },
      ],
      dicas: [
        'Também é possível com <code>gpasswd -a maria sudo</code> ou <code>adduser maria sudo</code>.',
        '<code>sudo -i</code> abre um shell de root (sai com <code>exit</code>).',
      ],
      pegadinha: 'Adicionou ao grupo e "não funcionou"? A sessão antiga ainda usa os grupos do login. Saia (<code>exit</code>) e entre de novo.',
    },
    {
      comando: 'groupadd',
      titulo: 'Criar grupos',
      descricao: 'Grupos servem para dar a mesma permissão a várias pessoas de uma vez: você dá a permissão ao grupo e coloca as pessoas nele.',
      sintaxe: 'groupadd grupo',
      naPratica: 'Organizar o acesso por equipe: grupos <code>devs</code>, <code>suporte</code>, <code>financeiro</code>. Em vez de dar permissão pessoa por pessoa, você dá ao grupo e só controla quem entra e quem sai.',
      exemplos: [
        { comando: 'groupadd desenvolvimento' },
        { comando: 'tail -2 /etc/group', explicacao: 'grupo novo, ainda sem membros' },
      ],
    },
    {
      comando: 'usermod -aG',
      titulo: 'Colocar usuário em grupos',
      descricao: '<code>usermod -aG grupo usuário</code> <b>adiciona</b> o usuário ao grupo, mantendo os que ele já tinha. O <code>gpasswd -a</code> faz o mesmo.',
      sintaxe: 'usermod -aG grupo usuário  |  gpasswd -a usuário grupo',
      naPratica: 'Deixar um usuário usar o Docker: <code>usermod -aG docker maria</code>. Dar acesso aos arquivos do site: <code>usermod -aG www-data maria</code>. Promover a administrador: <code>usermod -aG sudo maria</code>.',
      opcoes: [
        ['-aG', 'a = append (acrescenta), G = grupos suplementares'],
        ['-G', 'SEM o -a: substitui a lista toda (tira dos outros grupos!)'],
        ['gpasswd -d u g', 'remove o usuário do grupo'],
      ],
      exemplos: [
        { comando: 'usermod -aG desenvolvimento maria' },
        { comando: 'gpasswd -a ricardo desenvolvimento' },
        { comando: 'groups maria', explicacao: 'maria: sudo e desenvolvimento' },
        { comando: 'grep desenvolvimento /etc/group' },
        { comando: 'gpasswd -d ricardo desenvolvimento', explicacao: 'tira o ricardo' },
      ],
      pegadinha: '<code>usermod -G desenvolvimento maria</code> (sem o <b>-a</b>) tira a maria do <b>sudo</b> e de todos os outros grupos.',
    },
    {
      comando: 'adduser',
      titulo: 'Criar usuário do jeito "amigável" (Debian/Ubuntu)',
      descricao: 'O <code>adduser</code> faz tudo numa tacada: cria grupo, home, copia o skel, pede a senha e o nome completo. É interativo.',
      sintaxe: 'adduser usuário  |  adduser usuário grupo',
      naPratica: 'Criar manualmente a conta de uma pessoa no Ubuntu/Debian: já sai com home, grupo e senha prontos. Para scripts e automação, prefira o <code>useradd</code>, que não faz perguntas.',
      exemplos: [
        { comando: 'adduser carlos', respostas: ['123', '123', 'Carlos Souza', '', '', '', '', 'S'], explicacao: 'senha, nome completo e ENTER no resto' },
        { comando: 'adduser carlos desenvolvimento', explicacao: 'forma curta de pôr num grupo' },
        { comando: 'id carlos' },
      ],
      dicas: ['Em outras distribuições (CentOS, Fedora) o <code>adduser</code> é só um apelido do <code>useradd</code>. Na prova, saiba os dois.'],
    },
    {
      comando: 'usermod',
      titulo: 'Alterar usuários',
      descricao: 'Muda qualquer dado da conta.',
      sintaxe: 'usermod [opções] usuário',
      naPratica: 'Funcionário mudou de setor: trocam-se os grupos. Saiu de férias ou está sob suspeita: <code>usermod -L</code> bloqueia sem apagar nada. Conta de serviço criada com bash por engano: <code>usermod -s /usr/sbin/nologin app</code>.',
      opcoes: [
        ['-s /bin/bash', 'troca o shell'],
        ['-l novo', 'renomeia o login'],
        ['-L / -U', 'bloqueia / desbloqueia a conta'],
        ['-c "Nome"', 'troca o comentário'],
        ['-d /nova -m', 'muda a home (e move os arquivos)'],
      ],
      exemplos: [
        { comando: 'usermod -s /bin/bash pedro', explicacao: 'pedro foi criado com /bin/sh' },
        { comando: 'usermod -L estagiario', explicacao: 'bloqueia: não consegue mais logar' },
        { comando: 'passwd -S estagiario' },
        { comando: 'usermod -U estagiario' },
      ],
    },
    {
      comando: 'userdel / groupdel',
      titulo: 'Remover usuários e grupos',
      descricao: '<code>userdel</code> apaga a conta; com <code>-r</code> apaga também a home. <code>groupdel</code> apaga um grupo, desde que não seja o grupo principal de alguém.',
      sintaxe: 'userdel [-r] usuário  |  groupdel grupo',
      naPratica: 'Desligamento de funcionário: bloqueie primeiro (<code>usermod -L</code>), faça backup da home se precisar e depois <code>userdel -r</code>. Contas de ex-funcionários ainda ativas são uma das falhas de segurança mais comuns em auditorias.',
      exemplos: [
        { comando: 'userdel -r pedro', explicacao: '-r leva a home junto' },
        { comando: 'userdel temporario', explicacao: 'sem -r a home fica...' },
        { comando: 'ls -l /home', explicacao: '... com dono "órfão" (só o número do UID)' },
        { comando: 'groupdel desenvolvimento' },
        { comando: 'userdel maria', explicacao: 'maria está logada no terminal 2: recusa' },
      ],
      pegadinha: 'Não dá para apagar um usuário logado. Feche a sessão dele (<code>exit</code> no terminal dele) antes.',
    },
  ],

  desafios: [
    {
      id: 'usr-1',
      enunciado: 'Crie o usuário <code>lucas</code> com pasta pessoal e shell <code>/bin/bash</code>.',
      dica: 'useradd com -m e -s.',
      solucao: [{ comando: 'useradd -m -s /bin/bash lucas' }],
      verificar: (m) => Verificar.usuario(m, 'lucas')?.shell === '/bin/bash' && Verificar.diretorio(m, '/home/lucas'),
    },
    {
      id: 'usr-2',
      enunciado: 'Defina uma senha para o <code>lucas</code>.',
      dica: 'passwd lucas (digite a senha duas vezes; ela não aparece).',
      solucao: [{ comando: 'passwd lucas', respostas: ['123', '123'] }],
      verificar: (m) => { const u = Verificar.usuario(m, 'lucas'); return u !== undefined && u.senha !== null && u.senha !== ''; },
    },
    {
      id: 'usr-3',
      enunciado: 'Crie o grupo <code>suporte</code> e coloque o <code>lucas</code> nele.',
      dica: 'groupadd e depois usermod -aG (ou gpasswd -a).',
      solucao: [{ comando: 'groupadd suporte' }, { comando: 'usermod -aG suporte lucas' }],
      verificar: (m) => Verificar.membro(m, 'lucas', 'suporte'),
    },
    {
      id: 'usr-4',
      enunciado: 'Dê ao <code>lucas</code> o poder de usar <code>sudo</code>.',
      dica: 'Qual grupo dá acesso ao sudo no Ubuntu?',
      solucao: [{ comando: 'usermod -aG sudo lucas' }],
      verificar: (m) => Verificar.membro(m, 'lucas', 'sudo') && Verificar.membro(m, 'lucas', 'suporte'),
    },
    {
      id: 'usr-5',
      enunciado: 'Faça login como <code>lucas</code> em outro terminal (＋) e, <b>como ele, usando sudo</b>, crie o diretório <code>/opt/suporte</code>.',
      dica: 'Terminal 2 → login lucas → <code>sudo mkdir /opt/suporte</code> (digite a senha do lucas).',
      solucao: [{ comando: 'sudo mkdir /opt/suporte', terminal: 2, login: { usuario: 'lucas', senha: '123' }, respostas: ['123'] }],
      verificar: (m) => Verificar.diretorio(m, '/opt/suporte') && m.usuariosNasConexoes().includes('lucas'),
    },
    {
      id: 'usr-6',
      enunciado: 'Bloqueie a conta <code>estagiario</code> (ela não deve mais conseguir entrar).',
      dica: 'usermod -L ou passwd -l.',
      solucao: [{ comando: 'usermod -L estagiario' }],
      verificar: (m) => Verificar.usuario(m, 'estagiario')?.bloqueado === true,
    },
    {
      id: 'usr-7',
      enunciado: 'Remova o usuário <code>temporario</code> <b>e</b> a pasta pessoal dele.',
      dica: 'userdel com a opção que remove a home.',
      solucao: [{ comando: 'userdel -r temporario' }],
      verificar: (m) => Verificar.usuario(m, 'temporario') === undefined && Verificar.naoExiste(m, '/home/temporario'),
    },
  ],
};
