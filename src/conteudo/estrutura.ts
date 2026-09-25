import type { Topico } from './Topico';
import { Verificar } from './Verificar';

/** 02 · Estrutura de pastas (FHS): para que serve cada diretório da raiz. */
export const estrutura: Topico = {
  id: 'estrutura',
  numero: 2,
  titulo: 'Estrutura de pastas do Linux',
  subtitulo: '/etc · /home · /var · /usr · /tmp · /boot · /dev · /proc · /opt · /mnt',
  icone: '🌳',
  cor: '--cor-est',
  resumo: 'Um passeio guiado pela árvore do sistema: o que mora em cada pasta e por que ela importa.',
  conceitos:
    '<h3>🌳 Uma árvore só, começando em /</h3>' +
    '<p>No Windows cada disco tem uma letra (C:, D:). No Linux existe <b>uma única árvore</b> que começa na raiz <code>/</code>; discos, pendrives e partições são <b>"montados"</b> em alguma pasta dela.</p>' +
    '<p>A organização segue um padrão chamado <b>FHS</b> (Filesystem Hierarchy Standard). Por isso, em qualquer distribuição, as configurações estão em <code>/etc</code>, os logs em <code>/var/log</code> e as casas dos usuários em <code>/home</code>.</p>' +
    '<table class="tabela">' +
    '<tr><td><code>/etc</code></td><td>configurações</td><td><code>/var</code></td><td>dados que mudam (logs, sites, filas)</td></tr>' +
    '<tr><td><code>/home</code></td><td>pastas dos usuários</td><td><code>/root</code></td><td>pasta do administrador</td></tr>' +
    '<tr><td><code>/usr/bin</code></td><td>programas</td><td><code>/usr/sbin</code></td><td>programas de administração</td></tr>' +
    '<tr><td><code>/boot</code></td><td>kernel e inicialização</td><td><code>/dev</code></td><td>dispositivos (discos, terminais)</td></tr>' +
    '<tr><td><code>/proc</code> <code>/sys</code></td><td>informações do kernel, ao vivo</td><td><code>/tmp</code></td><td>temporários (apagados no boot)</td></tr>' +
    '<tr><td><code>/opt</code></td><td>programas de terceiros</td><td><code>/srv</code></td><td>dados servidos (sites, FTP)</td></tr>' +
    '<tr><td><code>/media</code></td><td>pendrives (automático)</td><td><code>/mnt</code></td><td>montagens manuais</td></tr></table>' +
    '<p class="conceitos-dica">💡 Na linha do <code>ls -l /</code>, <code>bin -&gt; usr/bin</code> é um <b>link simbólico</b> (um atalho): no Ubuntu moderno, <code>/bin</code>, <code>/sbin</code> e <code>/lib</code> apontam para dentro de <code>/usr</code>.</p>',
  naPratica: 'Conhecer a árvore é o que faz você achar qualquer coisa num servidor desconhecido: "o site caiu" → <code>/var/log</code>; "trocar a porta do SSH" → <code>/etc/ssh</code>; ' +
    '"o disco encheu" → quase sempre <code>/var</code> (logs) ou <code>/home</code>; "onde está o programa?" → <code>/usr/bin</code>.',
  demonstracao: [
    { comando: 'cd /', explicacao: 'vamos para a raiz' },
    { comando: 'ls', explicacao: 'as pastas do primeiro nível' },
    { comando: 'ls -l', explicacao: 'repare nos links: bin -> usr/bin' },
  ],

  preparar(): void {
    // máquina padrão
  },

  licoes: [
    {
      comando: '/etc',
      titulo: 'Configurações do sistema',
      descricao: 'Tudo que configura o sistema e os serviços são <b>arquivos de texto</b> em <code>/etc</code>: nome da máquina, usuários, rede, SSH, agendamentos. ' +
        'Não há "painel de controle": configurar o Linux é editar arquivos aqui.',
      sintaxe: 'ls /etc  |  cat /etc/ARQUIVO',
      opcoes: [
        ['/etc/hostname', 'nome da máquina'],
        ['/etc/hosts', 'nomes → IPs locais (antes do DNS)'],
        ['/etc/passwd, group, shadow', 'usuários, grupos e senhas'],
        ['/etc/fstab', 'quais discos montar no boot e onde'],
        ['/etc/ssh/sshd_config', 'configuração do servidor SSH'],
        ['/etc/apt/', 'de onde o apt baixa os pacotes'],
        ['/etc/crontab', 'tarefas agendadas do sistema'],
      ],
      exemplos: [
        { comando: 'cd /etc' },
        { comando: 'ls' },
        { comando: 'cat hostname' },
        { comando: 'cat hosts' },
        { comando: 'cat fstab', explicacao: 'a partição sda2 é montada em /' },
        { comando: 'grep Port ssh/sshd_config', explicacao: 'o SSH escuta na porta 22' },
      ],
      dicas: [
        '<b>[LPIC-1 104.7 / Linux Essentials 4.3]:</b> Pelo padrão FHS, o <code>/etc</code> guarda EXCLUSIVAMENTE arquivos de configuração em texto puro do sistema (nunca binários).',
      ],
      pegadinha: '<b>[LPIC-1 104.7]:</b> Em provas, lembre-se: nenhum executável binário deve residir em <code>/etc</code>; binários ficam em <code>/bin</code>, <code>/sbin</code>, <code>/usr/bin</code> ou <code>/usr/sbin</code>.',
      naPratica: 'Antes de editar qualquer arquivo em <code>/etc</code>, faça uma cópia (<code>cp arquivo arquivo.bak</code>). Muitas empresas versionam o <code>/etc</code> inteiro (ferramenta <i>etckeeper</i>) para saber quem mudou o quê. ' +
        'E backup do servidor sem o <code>/etc</code> é backup incompleto: é ali que está todo o trabalho de configuração.',
    },
    {
      comando: '/home e /root',
      titulo: 'As casas dos usuários',
      descricao: 'Cada usuário comum tem sua pasta em <code>/home/nome</code>: documentos, configurações pessoais (arquivos ocultos como <code>.bashrc</code>) e chaves SSH. ' +
        'O administrador <b>root</b> mora separado, em <code>/root</code>, protegido com permissão 700.',
      sintaxe: 'cd ~  |  echo $HOME',
      exemplos: [
        { comando: 'ls -l /home', explicacao: 'cada pasta pertence ao seu usuário (750)' },
        { comando: 'ls -la /root', explicacao: 'a casa do root' },
        { comando: 'ls -ld /root', explicacao: 'drwx------: só o root entra' },
        { comando: 'echo $HOME' },
      ],
      dicas: [
        '<b>[LPIC-1 104.7]:</b> Diretórios de usuários normais ficam sob <code>/home</code>, geralmente em partições separadas com cotas de disco.',
      ],
      pegadinha: '<b>[LPIC-1 104.7 / Linux Essentials 4.3]:</b> A casa do root é <code>/root</code> e NUNCA <code>/home/root</code>! O root fica isolado para permitir boot e recuperação caso <code>/home</code> esteja desmontado.',
      naPratica: 'Em servidores, é comum colocar o <code>/home</code> numa partição ou disco separado: se o sistema precisar ser reinstalado, os dados dos usuários ficam intactos. ' +
        'Cotas de disco (limitar quanto cada usuário pode usar) também são aplicadas no <code>/home</code>.',
    },
    {
      comando: '/usr/bin e /usr/sbin',
      titulo: 'Onde ficam os programas',
      descricao: 'Cada comando que você digita é um <b>arquivo executável</b>. <code>/usr/bin</code> tem os programas de todos (ls, cp, nano); <code>/usr/sbin</code> tem os de <b>administração</b> (useradd, sshd). ' +
        'O shell procura os programas nas pastas listadas na variável <b>PATH</b>. <code>/bin</code> e <code>/sbin</code> são atalhos para essas pastas.',
      sintaxe: 'which programa',
      exemplos: [
        { comando: 'which ls useradd', explicacao: 'onde cada programa está' },
        { comando: 'ls -l /bin /sbin', explicacao: 'atalhos para /usr' },
        { comando: 'ls /usr/sbin' },
        { comando: 'ls -l /usr/bin/ls', explicacao: 'um programa é um arquivo com x' },
        { comando: '/usr/bin/whoami', explicacao: 'chamar pelo caminho completo também funciona' },
      ],
      dicas: [
        '<b>[LPIC-1 104.7]:</b> <code>/usr/sbin</code> e <code>/sbin</code> concentram os comandos exclusivos do superusuário (root). Programas comuns de usuários ficam em <code>/usr/bin</code>.',
      ],
      naPratica: 'Programas instalados pelo <code>apt</code> vão para <code>/usr/bin</code>. Scripts e programas que <b>você</b> instala à mão devem ir para <code>/usr/local/bin</code>: ' +
        'o apt nunca mexe lá, então uma atualização do sistema não apaga o seu trabalho.',
    },
    {
      comando: '/usr',
      titulo: 'Os recursos do sistema (Unix System Resources)',
      descricao: 'O <code>/usr</code> é a maior pasta do sistema: programas (<code>bin</code>, <code>sbin</code>), <b>bibliotecas</b> compartilhadas (<code>lib</code>, as "DLLs" do Linux), ' +
        'documentação e manuais (<code>share</code>) e o <code>/usr/local</code>, reservado ao que o administrador instala por conta própria.',
      sintaxe: 'ls /usr',
      exemplos: [
        { comando: 'cd /usr' },
        { comando: 'ls' },
        { comando: 'ls lib/x86_64-linux-gnu', explicacao: 'bibliotecas: libc é usada por quase todo programa' },
        { comando: 'ls /usr/local/bin', explicacao: 'vazia: aqui entram os seus scripts' },
      ],
      dicas: [
        '<b>[LPIC-1 104.7]:</b> Segundo o FHS, <code>/usr</code> é compartilhável e somente leitura (read-only). O que o sysadmin compila/instala manualmente fica em <code>/usr/local</code>.',
      ],
      naPratica: 'Em servidores muito grandes o <code>/usr</code> pode ser montado como <b>somente leitura</b>: como ele só muda quando se instala pacotes, isso impede que um invasor troque programas do sistema.',
    },
    {
      comando: '/var',
      titulo: 'Dados que variam: logs, sites, filas',
      descricao: '<code>/var</code> guarda o que <b>muda o tempo todo</b>. Os mais importantes: <code>/var/log</code> (registros de tudo que acontece), ' +
        '<code>/var/www</code> (sites), <code>/var/lib</code> (bancos de dados e estado dos programas), <code>/var/cache</code> e <code>/var/spool</code> (filas de e-mail e impressão).',
      sintaxe: 'ls /var/log  |  tail /var/log/ARQUIVO',
      opcoes: [
        ['/var/log/syslog', 'mensagens gerais do sistema'],
        ['/var/log/auth.log', 'logins, sudo, tentativas de invasão'],
        ['/var/log/apt/history.log', 'o que foi instalado/removido e quando'],
        ['/var/lib/dpkg/status', 'lista de pacotes instalados'],
      ],
      exemplos: [
        { comando: 'cd /var' },
        { comando: 'ls' },
        { comando: 'ls -l log', explicacao: 'grupo adm: quem está nele lê os logs' },
        { comando: 'tail -3 log/syslog' },
        { comando: 'grep Failed log/auth.log', explicacao: 'alguém tentando adivinhar a senha do root!' },
      ],
      dicas: [
        '<b>[LPIC-1 104.7 / 108.2]:</b> Questão certa de prova: arquivos de log de auditoria e de serviços residem obrigatoriamente sob <code>/var/log</code>.',
      ],
      naPratica: '<b>"Disco cheio" quase sempre é o /var</b>: um log que cresceu sem controle ou um banco de dados em <code>/var/lib/mysql</code>. ' +
        'O <i>logrotate</i> existe para girar e compactar os logs. E o <code>auth.log</code> é o primeiro lugar a olhar numa suspeita de invasão.',
    },
    {
      comando: '/tmp',
      titulo: 'Arquivos temporários',
      descricao: 'Qualquer usuário e programa pode gravar em <code>/tmp</code> (por isso ele tem o <b>sticky bit</b>: cada um só apaga o que é seu). ' +
        'O conteúdo é <b>apagado a cada reinicialização</b>. Existe também o <code>/var/tmp</code>, que sobrevive ao reboot.',
      sintaxe: 'ls -ld /tmp /var/tmp',
      exemplos: [
        { comando: 'ls -ld /tmp /var/tmp', explicacao: 'drwxrwxrwt: todos escrevem, o t protege' },
        { comando: 'echo "rascunho" > /tmp/teste.txt' },
        { comando: 'ls -l /tmp' },
      ],
      dicas: [
        '<b>[LPIC-1 104.7 / 104.5]:</b> <code>/tmp</code> tem a permissão octal <code>1777</code> (Sticky bit <code>+t</code>). Qualquer usuário pode criar arquivos lá.',
      ],
      pegadinha: '<b>[LPIC-1 104.7]:</b> Diferença clássica de exame: <code>/tmp</code> é limpo na reinicialização; <code>/var/tmp</code> preserva arquivos temporários entre boots.',
      naPratica: 'Nunca guarde nada importante em <code>/tmp</code>: depois do próximo reboot, sumiu. Por outro lado, é o lugar certo para arquivos de trabalho de scripts ' +
        '(ex.: um backup montando um arquivo antes de enviar). Como todos escrevem lá, também é um lugar clássico para invasores deixarem arquivos: vale ficar de olho.',
    },
    {
      comando: '/boot',
      titulo: 'Kernel e inicialização',
      descricao: 'Tem o necessário para o computador <b>ligar</b>: o kernel (<code>vmlinuz</code>), o disco de inicialização em memória (<code>initrd.img</code>) ' +
        'e o carregador <b>GRUB</b>, que mostra o menu de boot.',
      sintaxe: 'ls -l /boot',
      exemplos: [
        { comando: 'ls -l /boot', explicacao: 'vmlinuz aponta para a versão atual do kernel' },
        { comando: 'uname -r', explicacao: 'a mesma versão que está rodando' },
        { comando: 'cat /boot/grub/grub.cfg', explicacao: '"NÃO EDITE": gerado automaticamente' },
      ],
      dicas: [
        '<b>[LPIC-1 101.2 / 102.2]:</b> Em <code>/boot</code> residem o kernel <code>vmlinuz</code>, a imagem <code>initramfs</code> (ou <code>initrd</code>) e o arquivo de configuração do bootloader <code>grub.cfg</code>.',
      ],
      naPratica: 'Em servidores antigos, a partição <code>/boot</code> era pequena e enchia com kernels antigos, impedindo atualizações. A solução: <code>apt autoremove</code>, que apaga os kernels que não são mais usados.',
    },
    {
      comando: '/dev',
      titulo: 'Dispositivos: o hardware como arquivo',
      descricao: '"No Linux tudo é arquivo": cada dispositivo aparece em <code>/dev</code>. No <code>ls -l</code>, <b>b</b> = dispositivo de bloco (discos) e <b>c</b> = de caractere (terminais). ' +
        '<code>sda</code> é o primeiro disco, <code>sda1</code> e <code>sda2</code> suas partições. <code>/dev/null</code> é o "buraco negro": tudo que entra some.',
      sintaxe: 'ls -l /dev  |  lsblk',
      exemplos: [
        { comando: 'ls -l /dev', explicacao: 'repare no b e no c no começo das linhas' },
        { comando: 'lsblk', explicacao: 'os discos e onde cada partição está montada' },
        { comando: 'echo "isto some" > /dev/null' },
        { comando: 'ls /nada 2> /dev/null', explicacao: 'jogar erros fora: uso clássico do /dev/null' },
      ],
      dicas: [
        '<b>[LPIC-1 104.1 / Linux Essentials 4.2]:</b> Dispositivos especiais: <code>/dev/sda</code> (disco físico SCSI/SATA), <code>/dev/null</code> (bit bucket/descarta dados), <code>/dev/zero</code> (gera bytes nulos) e <code>/dev/urandom</code> (gerador de números pseudoaleatórios).',
      ],
      naPratica: 'Ao adicionar um disco novo num servidor, ele aparece como <code>/dev/sdb</code>; você cria a partição, formata e monta numa pasta (e registra no <code>/etc/fstab</code> para montar sozinho no boot). ' +
        'Em scripts do cron, <code>&gt; /dev/null 2&gt;&amp;1</code> é usado para descartar toda a saída.',
    },
    {
      comando: '/proc e /sys',
      titulo: 'Janelas para dentro do kernel',
      descricao: 'Pastas <b>virtuais</b>: nada ali está gravado no disco. Os arquivos são gerados pelo kernel na hora em que você lê, com informações <b>ao vivo</b> ' +
        'sobre processador, memória, processos (<code>/proc/NÚMERO</code>) e hardware (<code>/sys</code>).',
      sintaxe: 'cat /proc/ARQUIVO',
      exemplos: [
        { comando: 'ls /proc' },
        { comando: 'grep "model name" /proc/cpuinfo', explicacao: 'qual processador (uma linha por núcleo)' },
        { comando: 'cat /proc/meminfo' },
        { comando: 'free -h', explicacao: 'o free lê o /proc/meminfo e formata' },
        { comando: 'cat /proc/loadavg', explicacao: 'a carga do servidor' },
      ],
      dicas: [
        '<b>[LPIC-1 101.1 / 104.7]:</b> <code>/proc</code> e <code>/sys</code> são pseudossistemas de arquivos (virtual filesystems) mantidos diretamente na memória RAM pelo kernel (tamanho 0 bytes no disco).',
      ],
      pegadinha: '<b>[LPIC-1 101.1]:</b> Se perguntarem em qual pasta virtual checar dados de CPU ou memória do hardware sem instalar ferramentas extras, a resposta é <code>/proc</code> (<code>/proc/cpuinfo</code> e <code>/proc/meminfo</code>).',
      naPratica: 'Ferramentas de monitoramento (htop, top, free, Zabbix, Prometheus) leem justamente o <code>/proc</code>. ' +
        'Quando alguém pergunta "quantos núcleos tem esse servidor?", <code>grep -c processor /proc/cpuinfo</code> responde.',
    },
    {
      comando: '/opt e /srv',
      titulo: 'Programas de terceiros e dados servidos',
      descricao: '<code>/opt</code> (<i>optional</i>) recebe programas de fornecedores que vêm "em um pacote só", fora do apt (ex.: Google Chrome, programas comerciais). ' +
        '<code>/srv</code> (<i>service</i>) guarda os <b>dados que o servidor oferece</b>: sites, arquivos de FTP, repositórios.',
      sintaxe: 'ls /opt /srv',
      exemplos: [
        { comando: 'ls -ld /opt /srv', explicacao: 'vazias numa instalação nova' },
        { comando: 'mkdir -p /srv/site', explicacao: 'lugar organizado para os arquivos de um site' },
      ],
      dicas: [
        '<b>[LPIC-1 104.7]:</b> <code>/opt</code> guarda aplicações autônomas e pacotes add-on de terceiros; <code>/srv</code> armazena dados de serviços atendidos pelo sistema (web, ftp, etc.).',
      ],
      naPratica: 'Organização vale ouro quando outra pessoa assume o servidor: sites em <code>/srv</code> ou <code>/var/www</code>, softwares comerciais em <code>/opt</code>. ' +
        'Quem chega sabe onde procurar sem precisar perguntar.',
    },
    {
      comando: '/media e /mnt',
      titulo: 'Pendrives e montagens',
      descricao: 'Montar = "encaixar" um disco numa pasta da árvore. <code>/media</code> é usado <b>automaticamente</b> no desktop quando você pluga um pendrive (<code>/media/usuario/PENDRIVE</code>). ' +
        '<code>/mnt</code> é para montagens <b>manuais e temporárias</b> feitas pelo administrador.',
      sintaxe: 'df -h  |  mount /dev/sdb1 /mnt',
      exemplos: [
        { comando: 'ls -ld /media /mnt' },
        { comando: 'df -h', explicacao: 'cada linha: um disco e a pasta onde está montado' },
      ],
      dicas: [
        '<b>[LPIC-1 104.3 / 104.7]:</b> Padrão FHS: <code>/media</code> para mídias removíveis montadas automaticamente pelo sistema; <code>/mnt</code> para pontos de montagem manuais e temporários do sysadmin.',
      ],
      naPratica: 'Para recuperar arquivos de um disco de outro computador, o administrador pluga o disco e monta em <code>/mnt</code> (<code>mount /dev/sdb1 /mnt</code>). ' +
        'Discos de backup e compartilhamentos de rede (NFS, Samba) também costumam ser montados em pastas como <code>/mnt/backup</code>.',
    },
  ],

  desafios: [
    {
      id: 'est-1',
      enunciado: 'Faça um <b>backup</b> da configuração do SSH: copie <code>/etc/ssh/sshd_config</code> para <code>/root/backup/sshd_config.bak</code>.',
      dica: 'Crie a pasta /root/backup antes (mkdir) e use cp.',
      solucao: [{ comando: 'mkdir -p /root/backup' }, { comando: 'cp /etc/ssh/sshd_config /root/backup/sshd_config.bak' }],
      verificar: (m) => Verificar.contem(m, '/root/backup/sshd_config.bak', 'PermitRootLogin'),
    },
    {
      id: 'est-2',
      enunciado: 'Descubra quem tentou invadir o servidor: salve as linhas de <b>senha errada</b> do log de autenticação em <code>/root/invasores.txt</code>.',
      dica: 'O log fica em /var/log. Procure por "Failed" com o grep e redirecione para o arquivo.',
      solucao: [{ comando: 'grep Failed /var/log/auth.log > /root/invasores.txt' }],
      verificar: (m) => {
        const texto: string = Verificar.conteudo(m, '/root/invasores.txt') ?? '';
        return texto.includes('45.155.205.12') && !texto.includes('Accepted');
      },
    },
    {
      id: 'est-3',
      enunciado: 'Salve em <code>/root/cpu.txt</code> o <b>modelo do processador</b> do servidor, lido da pasta virtual do kernel.',
      dica: 'grep "model name" /proc/cpuinfo &gt; /root/cpu.txt',
      solucao: [{ comando: 'grep "model name" /proc/cpuinfo > /root/cpu.txt' }],
      verificar: (m) => Verificar.contem(m, '/root/cpu.txt', 'Xeon'),
    },
    {
      id: 'est-4',
      enunciado: 'Crie o comando <code>boasvindas</code> para todos os usuários: um script em <code>/usr/local/bin/boasvindas</code> com a linha <code>echo Bem-vindo ao servidor</code>, executável por todos. Teste digitando só <code>boasvindas</code>.',
      dica: 'echo "echo Bem-vindo ao servidor" &gt; /usr/local/bin/boasvindas e depois chmod 755. Como /usr/local/bin está no PATH, o nome sozinho funciona.',
      solucao: [
        { comando: 'echo "echo Bem-vindo ao servidor" > /usr/local/bin/boasvindas' },
        { comando: 'chmod 755 /usr/local/bin/boasvindas' },
        { comando: 'boasvindas' },
      ],
      verificar: (m) => Verificar.modo(m, '/usr/local/bin/boasvindas', 0o755) && Verificar.contem(m, '/usr/local/bin/boasvindas', 'echo'),
    },
    {
      id: 'est-5',
      enunciado: 'Anote em <code>/root/raiz.txt</code> a linha do <code>df -h</code> que mostra qual partição está montada na raiz <code>/</code>.',
      dica: 'df -h | grep sda2 &gt; /root/raiz.txt',
      solucao: [{ comando: 'df -h | grep sda2 > /root/raiz.txt' }],
      verificar: (m) => Verificar.contem(m, '/root/raiz.txt', '/dev/sda2'),
    },
  ],
};
