import type { Topico } from './Topico';
import { Verificar } from './Verificar';

/** 02 · Estrutura de pastas (FHS): para que serve cada diretório da raiz. */
export const estrutura: Topico = {
  id: 'estrutura',
  numero: 2,
  titulo: 'Estrutura de pastas do Linux (FHS)',
  subtitulo: '/etc · /home · /root · /var · /usr · /tmp · /boot · /dev · /proc · /opt · /mnt',
  icone: '🌳',
  cor: '--cor-est',
  resumo: 'O mapa da árvore do Linux: o que cada pasta guarda, os porquês da sua existência e como achar qualquer coisa num servidor rapidamente.',
  conceitos:
    '<h3>🌳 O Modelo Mental: Uma Única Raiz (/)</h3>' +
    '<p>No Windows cada disco tem uma letra (<code>C:</code>, <code>D:</code>). No Linux <b>não existem letras</b>: tudo faz parte de <b>uma única árvore</b> que começa na raiz <code>/</code>.</p>' +

    '<div class="fhs-analogia">' +
    '  <div class="fhs-analogia-titulo">💡 A Metáfora dos Enxertos</div>' +
    '  <p>Pense na raiz <code>/</code> como o tronco de uma árvore. Ao plugar um pendrive ou instalar um segundo SSD, você não planta outra árvore ao lado: você "enxerta" esse disco em uma pasta existente (processo chamado de <b>montagem</b>). Para os programas, todos os arquivos parecem estar na mesma árvore contínua!</p>' +
    '</div>' +

    '<div class="fhs-arvore-bloco">' +
    '<b>/ (Raiz - O topo de toda a hierarquia)</b><br>' +
    '├── <span class="dir">etc/</span>        <span class="coment">⚙️ Configurações em texto puro (o painel de controle)</span><br>' +
    '├── <span class="dir">home/</span>       <span class="coment">🏠 Pastas particulares dos usuários comuns (/home/maria)</span><br>' +
    '├── <span class="dir">root/</span>       <span class="coment">👑 Residência isolada do Administrador (root)</span><br>' +
    '├── <span class="dir">usr/</span>        <span class="coment">📦 Programas, bibliotecas e recursos da distribuição</span><br>' +
    '│   ├── <span class="dir">bin/</span>    <span class="coment">Comandos para todos os usuários (ls, cp, grep)</span><br>' +
    '│   └── <span class="dir">sbin/</span>   <span class="coment">Comandos do administrador (fdisk, useradd)</span><br>' +
    '├── <span class="dir">var/</span>        <span class="coment">📈 Dados variáveis que mudam sempre (logs, bancos, filas)</span><br>' +
    '│   └── <span class="dir">log/</span>    <span class="coment">A caixa-preta do sistema (syslog, auth.log)</span><br>' +
    '├── <span class="dir">tmp/</span>        <span class="coment">⏳ Temporários efêmeros (limpos a cada reboot)</span><br>' +
    '├── <span class="dir">boot/</span>       <span class="coment">🚀 Arquivos de partida: Kernel (vmlinuz) e GRUB</span><br>' +
    '├── <span class="dir">dev/</span>        <span class="coment">🔌 Hardware exposto como arquivos (discos, telas)</span><br>' +
    '├── <span class="dir">proc/</span> & <span class="dir">sys/</span> <span class="coment">🧠 Memória ao vivo do Kernel gerada na RAM (0 bytes em disco)</span><br>' +
    '├── <span class="dir">opt/</span>        <span class="coment">🏢 Softwares de terceiros em pacote único (Chrome, etc.)</span><br>' +
    '├── <span class="dir">srv/</span>        <span class="coment">🌐 Dados que este servidor entrega para a rede (sites, FTP)</span><br>' +
    '└── <span class="dir">mnt/</span> & <span class="dir">media/</span><span class="coment">🔌 Pontos de montagem: manual (/mnt) e automático (/media)</span>' +
    '</div>' +

    '<p class="conceitos-dica">💡 <b>O que é o FHS?</b> É o padrão oficial (<i>Filesystem Hierarchy Standard</i>) que obriga todas as distribuições (Ubuntu, Debian, Fedora, RedHat) a usarem as mesmas pastas. Aprendendo uma vez, você sabe usar qualquer Linux no mundo!</p>',

  naPratica: 'Saber onde mora cada pasta economiza horas de suporte num servidor:' +
    '<br>• 🚨 <b>O site caiu?</b> Olhe os logs em <code>/var/log/nginx</code> ou <code>/var/log/apache2</code>.' +
    '<br>• 🔒 <b>Precisa mudar a porta do SSH?</b> O arquivo de texto fica em <code>/etc/ssh/sshd_config</code>.' +
    '<br>• 💾 <b>Disco 100% cheio?</b> Quase sempre são logs acumulados em <code>/var/log</code> ou downloads em <code>/home</code>.' +
    '<br>• 🛠️ <b>Onde colocar scripts próprios da empresa?</b> Em <code>/usr/local/bin</code> (o sistema nunca apaga o que está lá).',

  demonstracao: [
    { comando: 'cd /', explicacao: 'vamos para a raiz absoluta (/), o início de tudo' },
    { comando: 'ls -F', explicacao: 'veja os galhos principais: / indica pasta e @ indica atalho' },
    { comando: 'ls -l', explicacao: 'note os links: bin -> usr/bin e sbin -> usr/sbin' },
    { comando: 'df -h /', explicacao: 'qual partição física está montada na raiz' },
  ],

  preparar(): void {
    // máquina padrão
  },

  licoes: [
    {
      comando: '/etc',
      titulo: 'Configurações do sistema',
      descricao: '<p><b>O que é:</b> O centro de controle do sistema operacional e de todos os serviços instalados.</p>' +
        '<div class="fhs-porque"><b>❓ Por que é desse jeito?</b> No Linux, configurações são <b>arquivos de texto puro</b> (editáveis com nano ou vim) em vez de um banco de dados binário como o Registro do Windows. Se a interface gráfica falhar ou o sistema quebrar, qualquer administrador consegue consertar o servidor direto pelo terminal lendo esses arquivos de texto.</div>',
      sintaxe: 'cat /etc/ARQUIVO  |  nano /etc/ARQUIVO',
      opcoes: [
        ['/etc/hostname', 'Nome oficial do computador na rede'],
        ['/etc/hosts', 'Mapeamento local de nomes para IPs (DNS caseiro consultado antes da internet)'],
        ['/etc/passwd', 'Lista de contas de usuários (UID, GID, pasta pessoal e shell padrão)'],
        ['/etc/shadow', 'Senhas criptografadas dos usuários (acesso restrito ao root por segurança)'],
        ['/etc/fstab', 'Tabela de partições que devem ser montadas automaticamente no boot'],
        ['/etc/ssh/sshd_config', 'Regras de segurança do servidor SSH (porta, chaves, bloqueios)'],
      ],
      exemplos: [
        { comando: 'cd /etc' },
        { comando: 'cat hostname', explicacao: 'o nome desta máquina' },
        { comando: 'cat hosts', explicacao: 'localhost sempre aponta para 127.0.0.1' },
        { comando: 'cat fstab', explicacao: 'a partição sda2 é montada na raiz /' },
        { comando: 'grep -E "^(Port|PermitRootLogin)" ssh/sshd_config', explicacao: 'porta e permissão de login do SSH' },
      ],
      dicas: [
        '<b>Regra de Ouro do Sysadmin:</b> Antes de editar qualquer arquivo em <code>/etc</code>, faça uma cópia preventiva: <code>cp arquivo.conf arquivo.conf.bak</code>. Se o serviço falhar, você restaura o original imediatamente.',
      ],
      pegadinha: '<b>[LPIC-1 104.7]:</b> Em <code>/etc</code> residem EXCLUSIVAMENTE arquivos de configuração em texto puro. Nenhum executável binário deve ser guardado aqui!',
      naPratica: 'Empresas usam ferramentas como o <i>etckeeper</i> para versionar a pasta <code>/etc</code> inteira com Git, registrando exatamente quem alterou cada parâmetro do servidor.',
    },
    {
      comando: '/home e /root',
      titulo: 'As casas dos usuários e do administrador',
      descricao: '<p><b>O que é:</b> <code>/home/usuario</code> é a pasta pessoal de cada usuário comum. <code>/root</code> é a residência privada do administrador supremo.</p>' +
        '<div class="fhs-porque"><b>❓ Por que o root não mora em /home/root?</b> Em servidores reais, a pasta <code>/home</code> frequentemente fica em outro disco físico ou montada pela rede (NFS). Se esse disco falhar ou a rede cair, o <code>/home</code> não estará disponível. O <code>/root</code> fica garantido na partição raiz <code>/</code> para que o administrador sempre consiga fazer login de emergência e consertar o sistema!</div>',
      sintaxe: 'cd ~  |  echo $HOME  |  ls -ld /root',
      exemplos: [
        { comando: 'ls -l /home', explicacao: 'cada usuário comum tem sua própria pasta' },
        { comando: 'ls -ld /root', explicacao: 'drwx------: somente o root tem permissão para entrar' },
        { comando: 'echo $HOME', explicacao: 'variável que aponta para a casa do usuário atual' },
        { comando: 'ls -la /root', explicacao: 'arquivos ocultos com ponto (.bashrc) guardam configurações' },
      ],
      dicas: [
        '<b>Por que arquivos ocultos começam com ponto?</b> No Linux, nomes iniciados por <code>.</code> (como <code>.bashrc</code>) não aparecem no <code>ls</code> comum para não poluir sua tela. Para vê-los, use <code>ls -a</code>.',
      ],
      pegadinha: '<b>[LPIC-1 104.7]:</b> A casa do root é <code>/root</code> e NUNCA <code>/home/root</code>! Uma das pegadinhas mais clássicas de provas de certificação.',
      naPratica: 'Colocar o <code>/home</code> em uma partição separada é uma prática recomendada: se o sistema operacional precisar ser reinstalado do zero, os arquivos e projetos dos usuários não são perdidos.',
    },
    {
      comando: '/usr/bin e /usr/sbin',
      titulo: 'Onde ficam os programas',
      descricao: '<p><b>O que é:</b> Os arquivos executáveis dos comandos do Linux. <code>bin</code> contém comandos de uso geral; <code>sbin</code> contém comandos exclusivos de administração do sistema.</p>' +
        '<div class="fhs-porque"><b>❓ Por que separar bin de sbin?</b> Por segurança e proteção contra acidentes. Comandos em <code>sbin</code> (<i>System Binaries</i>), como <code>fdisk</code>, <code>mkfs</code> e <code>reboot</code>, podem formatar discos ou desligar o servidor. Eles ficam isolados para que usuários comuns não os executem sem querer e para manter organizadas as ferramentas que exigem poder de root.</div>',
      sintaxe: 'which comando  |  echo $PATH',
      opcoes: [
        ['/usr/bin', 'Comandos comuns para todos os usuários (ls, cat, nano, grep, python3)'],
        ['/usr/sbin', 'Comandos do sistema para administração, discos e rede (fdisk, useradd, iptables)'],
        ['/usr/local/bin', 'Scripts e programas que você instala manualmente (o apt nunca mexe aqui)'],
        ['$PATH', 'A lista ordenada de pastas onde o terminal procura o comando que você digitou'],
      ],
      exemplos: [
        { comando: 'which ls useradd nano', explicacao: 'onde cada executável está gravado no disco' },
        { comando: 'echo $PATH', explicacao: 'as pastas consultadas em ordem pelo shell' },
        { comando: 'ls -l /bin /sbin', explicacao: 'atalhos modernos que apontam para /usr' },
        { comando: 'ls -l /usr/bin/ls', explicacao: 'um comando nada mais é que um arquivo com permissão x' },
        { comando: '/usr/bin/whoami', explicacao: 'chamar pelo caminho completo também funciona' },
      ],
      dicas: [
        '<b>Scripts da sua equipe:</b> Sempre salve seus scripts e executáveis personalizados em <code>/usr/local/bin</code>. O gerenciador <code>apt</code> nunca toca nessa pasta, então uma atualização do sistema jamais apagará o seu trabalho.',
      ],
      pegadinha: '<b>[LPIC-1 104.7]:</b> Programas de administração do sistema ficam em <code>sbin</code> (tanto em <code>/sbin</code> quanto em <code>/usr/sbin</code>), e não em <code>bin</code>.',
    },
    {
      comando: '/usr',
      titulo: 'Recursos compartilhados do sistema',
      descricao: '<p><b>O que é:</b> <i>Unix System Resources</i>: a maior pasta do Linux, onde ficam guardados os programas, bibliotecas e manuais instalados pela distribuição.</p>' +
        '<div class="fhs-porque"><b>❓ Por que existe uma pasta só para o /usr?</b> Para separar o que pertence aos softwares da distribuição daquilo que muda com o uso da máquina. Como o <code>/usr</code> só é alterado ao instalar ou atualizar pacotes, ele pode ser montado como <b>somente leitura</b> (Read-Only) e até compartilhado via rede por vários computadores ao mesmo tempo sem risco de corrupção.</div>',
      sintaxe: 'ls /usr  |  ls /usr/lib',
      opcoes: [
        ['/usr/lib', 'Bibliotecas compartilhadas (arquivos .so - Shared Objects, as "DLLs" do Linux)'],
        ['/usr/share', 'Dados independentes de arquitetura: documentação, manuais man e tabelas de fusos'],
        ['/usr/local', 'Espaço reservado para o administrador instalar softwares próprios sem conflito com o apt'],
      ],
      exemplos: [
        { comando: 'cd /usr' },
        { comando: 'ls', explicacao: 'as subpastas de recursos do sistema' },
        { comando: 'ls lib/x86_64-linux-gnu', explicacao: 'bibliotecas dinâmicas: a libc é usada por quase todo programa' },
        { comando: 'ls /usr/local/bin', explicacao: 'inicialmente vazia: aqui entram os utilitários da sua equipe' },
      ],
      dicas: [
        '<b>[LPIC-1 104.7]:</b> Segundo o FHS, o <code>/usr</code> é classificado como <b>estático e compartilhável</b>.',
      ],
      naPratica: 'Em empresas e laboratórios acadêmicos, o <code>/usr</code> pode ser compartilhado via rede (NFS) entre dezenas de máquinas clientes, garantindo que todas usem exatamente a mesma versão dos programas e economizando disco.',
    },
    {
      comando: '/var',
      titulo: 'Dados variáveis: logs, sites e filas',
      descricao: '<p><b>O que é:</b> <i>Variable Data</i>: a pasta que guarda tudo aquilo que <b>muda constantemente</b> durante a operação do computador (logs, bancos de dados e filas de e-mail).</p>' +
        '<div class="fhs-porque"><b>❓ Por que o /var fica separado do /usr?</b> Se os logs e bancos fossem gravados dentro de <code>/usr</code>, um log gigantesco poderia encher a partição do sistema e travar os programas. Ao isolar dados variáveis em <code>/var</code>, o sistema operacional continua funcionando mesmo se os logs crescerem demais.</div>',
      sintaxe: 'ls /var/log  |  tail -f /var/log/syslog',
      opcoes: [
        ['/var/log/syslog', 'Diário geral com mensagens e avisos do sistema operacional'],
        ['/var/log/auth.log', 'Log de segurança: logins, tentativas de invasão e execuções com sudo'],
        ['/var/lib', 'Dados persistentes de programas em execução (ex: bancos MySQL/PostgreSQL)'],
        ['/var/spool', 'Filas de espera de processos (e-mails aguardando envio, fila de impressão)'],
      ],
      exemplos: [
        { comando: 'cd /var' },
        { comando: 'ls -l log', explicacao: 'pasta protegida para o grupo adm ler logs' },
        { comando: 'tail -n 3 log/syslog', explicacao: 'as últimas linhas do diário de bordo do sistema' },
        { comando: 'grep Failed log/auth.log', explicacao: 'auditoria de segurança: tentativas de senha incorreta no SSH' },
      ],
      dicas: [
        '<b>[LPIC-1 104.7]:</b> Arquivos de log de auditoria do sistema residem obrigatoriamente sob <code>/var/log</code>.',
      ],
      pegadinha: '<b>[LPIC-1 104.7]:</b> "Disco 100% cheio às 3h da manhã": na esmagadora maioria dos casos, o culpado é um arquivo de log descontrolado em <code>/var/log</code>. O utilitário <i>logrotate</i> é quem compacta e remove logs antigos.',
      naPratica: 'O arquivo <code>/var/log/auth.log</code> é o primeiro lugar onde analistas de segurança olham ao investigar suspeitas de invasão ou problemas de acesso remoto.',
    },
    {
      comando: '/tmp e /var/tmp',
      titulo: 'Arquivos temporários e o Sticky Bit',
      descricao: '<p><b>O que é:</b> Onde programas e usuários gravam arquivos de rascunho enquanto executam tarefas.</p>' +
        '<div class="fhs-porque"><b>❓ Por que existem duas pastas temporárias?</b> Porque elas têm prazos de vida diferentes: ' +
        '<br>• <code>/tmp</code>: É <b>volátil</b> e limpo a cada reinicialização da máquina (frequentemente roda na memória RAM para ser ultra-rápido). ' +
        '<br>• <code>/var/tmp</code>: É <b>persistente</b> no disco e sobrevive ao reboot (para tarefas longas ou instaladores que precisam reiniciar o servidor).</div>',
      sintaxe: 'ls -ld /tmp /var/tmp',
      exemplos: [
        { comando: 'ls -ld /tmp /var/tmp', explicacao: 'permissão drwxrwxrwt: o t no final é o Sticky Bit' },
        { comando: 'echo "rascunho de trabalho" > /tmp/teste.txt', explicacao: 'qualquer usuário pode criar arquivos aqui' },
        { comando: 'ls -l /tmp/teste.txt', explicacao: 'o arquivo pertence a quem o criou' },
      ],
      dicas: [
        '<b>O enigma do Sticky Bit (modo 1777):</b> Como a pasta <code>/tmp</code> é pública, o Sticky Bit (letra <code>t</code>) garante uma regra de ouro: todos podem criar arquivos, mas <b>somente o criador do arquivo (ou o root) pode apagá-lo</b>! Ninguém consegue apagar o arquivo do colega.',
      ],
      pegadinha: '<b>[LPIC-1 104.7]:</b> Questão garantida de exame: <code>/tmp</code> é esvaziado no reboot; <code>/var/tmp</code> preserva arquivos temporários entre reinicializações!',
      naPratica: 'Nunca guarde nada importante em <code>/tmp</code>: na próxima manutenção do servidor ele sumirá. Por ser aberto para todos, também é o local preferido de invasores para baixar scripts maliciosos.',
    },
    {
      comando: '/boot',
      titulo: 'Kernel e inicialização',
      descricao: '<p><b>O que é:</b> O pacote essencial para o computador ligar e dar a partida no Linux.</p>' +
        '<div class="fhs-porque"><b>❓ Por que o /boot fica isolado?</b> Na hora em que você liga o PC, o hardware ainda não entende sistemas de arquivos complexos, criptografia ou discos virtuais. O <code>/boot</code> precisa ficar num local simples e acessível para que a placa-mãe (BIOS/UEFI) consiga carregar o Kernel na memória RAM sem depender do resto do sistema.</div>',
      sintaxe: 'ls -l /boot  |  uname -r',
      opcoes: [
        ['vmlinuz', 'O coração executável do Kernel Linux, compactado para carregar rápido na RAM'],
        ['initrd.img', 'Minidisco em memória RAM com os drivers básicos para o Kernel conseguir ler o disco principal'],
        ['grub/grub.cfg', 'Configuração do menu de inicialização do GRUB'],
      ],
      exemplos: [
        { comando: 'ls -l /boot', explicacao: 'vmlinuz é o kernel e initrd.img é o disco de boot em RAM' },
        { comando: 'uname -r', explicacao: 'a versão exata do kernel Linux em execução' },
        { comando: 'head -n 8 /boot/grub/grub.cfg', explicacao: 'aviso explícito: "DO NOT EDIT" - gerado automaticamente' },
      ],
      dicas: [
        '<b>[LPIC-1 101.2 / 102.2]:</b> Em <code>/boot</code> residem o kernel <code>vmlinuz</code>, a imagem de boot em RAM <code>initramfs</code>/<code>initrd</code> e a configuração do bootloader <code>grub.cfg</code>.',
      ],
      pegadinha: '<b>[LPIC-1 101.2]:</b> NUNCA edite <code>/boot/grub/grub.cfg</code> manualmente! Ele é gerado de forma automatizada pelo comando <code>update-grub</code> a partir de <code>/etc/default/grub</code>.',
    },
    {
      comando: '/dev',
      titulo: 'Dispositivos: o hardware como arquivo',
      descricao: '<p><b>O que é:</b> No Linux cumpre-se a máxima: <b>"Tudo é um arquivo"</b>. Discos, telas e periféricos aparecem como arquivos especiais aqui dentro.</p>' +
        '<div class="fhs-porque"><b>❓ Por que tratar hardware como arquivo?</b> É a elegância do Unix: você não precisa de APIs ou programas complicados para falar com uma tela ou disco. Para enviar dados para um terminal ou descartar erros, você usa os mesmos operadores de texto comuns: <code>echo "oi" > /dev/tty1</code> ou <code>comando 2> /dev/null</code>.</div>',
      sintaxe: 'ls -l /dev  |  lsblk',
      opcoes: [
        ['b (Block device)', 'Dispositivo de bloco: discos e pendrives com leitura/escrita em blocos de dados (/dev/sda)'],
        ['c (Character device)', 'Dispositivo de caractere: terminais com fluxo contínuo de caracteres byte a byte (/dev/tty)'],
        ['/dev/null', 'O "buraco negro": qualquer informação redirecionada para cá é destruída sem ocupar espaço'],
        ['/dev/zero', 'Fornecedor infinito de bytes nulos (\\0): usado para criar arquivos vazios ou formatar partições'],
        ['/dev/urandom', 'Gerador de números pseudoaleatórios alimentado pelo ruído do hardware'],
      ],
      exemplos: [
        { comando: 'ls -l /dev', explicacao: 'repare na primeira letra: b para bloco (discos) e c para caractere (terminais)' },
        { comando: 'lsblk', explicacao: 'árvore visual de todos os discos e partições montadas' },
        { comando: 'echo "isto some no buraco negro" > /dev/null', explicacao: 'descartando dados sem ocupar espaço' },
        { comando: 'ls /pasta-fantasma 2> /dev/null', explicacao: 'silenciando erros: técnica clássica em scripts de automação' },
      ],
      dicas: [
        '<b>[LPIC-1 104.1]:</b> Dispositivos especiais clássicos: <code>/dev/null</code> (descarta dados), <code>/dev/zero</code> (gera bytes zero), <code>/dev/urandom</code> (números aleatórios) e <code>/dev/sda</code> (primeiro disco SCSI/SATA).',
      ],
    },
    {
      comando: '/proc e /sys',
      titulo: 'Janelas ao vivo para a mente do Kernel',
      descricao: '<p><b>O que é:</b> Informações em tempo real sobre os processos em execução e o hardware do servidor.</p>' +
        '<div class="fhs-porque"><b>❓ Por que esses arquivos têm 0 bytes de tamanho?</b> Porque eles <b>não existem no seu disco físico</b>! São pseudossistemas virtuais gerados na memória RAM pelo Kernel Linux. Quando você executa <code>cat /proc/cpuinfo</code>, o Kernel gera o texto naquele exato milissegundo com os dados de telemetria ao vivo da máquina.</div>',
      sintaxe: 'cat /proc/cpuinfo  |  cat /proc/meminfo  |  free -h',
      opcoes: [
        ['/proc/cpuinfo', 'Relatório completo de núcleos, modelo e frequência do processador'],
        ['/proc/meminfo', 'Telemetria detalhada de consumo de memória RAM e swap'],
        ['/proc/loadavg', 'Média de estresse e carga de processamento da máquina (1, 5 e 15 minutos)'],
        ['/proc/[PID]', 'Pastas numeradas com as entranhas e memória de cada processo ativo no sistema'],
        ['/sys', 'Visão hierárquica unificada de hardware, barramentos físicos (PCI, USB) e drivers'],
      ],
      exemplos: [
        { comando: 'ls /proc', explicacao: 'pastas com números são processos vivos e arquivos são dados de telemetria' },
        { comando: 'grep "model name" /proc/cpuinfo', explicacao: 'lendo o modelo da CPU diretamente do Kernel' },
        { comando: 'cat /proc/meminfo | head -n 4', explicacao: 'leitura bruta da memória física disponível' },
        { comando: 'free -h', explicacao: 'o comando free nada mais faz do que ler o /proc/meminfo e formatar bonito!' },
        { comando: 'cat /proc/loadavg', explicacao: 'a carga de processamento atual da máquina' },
      ],
      dicas: [
        '<b>Desmistificando comandos:</b> Ferramentas como <code>top</code>, <code>htop</code>, <code>ps</code> e <code>uptime</code> não têm mágica: elas simplesmente abrem arquivos dentro de <code>/proc</code>, calculam os números e exibem na tela.',
      ],
      pegadinha: '<b>[LPIC-1 101.1]:</b> Se perguntarem como checar modelo de processador ou memória sem instalar nenhum programa extra, a resposta oficial é: ler <code>/proc/cpuinfo</code> e <code>/proc/meminfo</code>.',
    },
    {
      comando: '/opt e /srv',
      titulo: 'Programas de terceiros e dados de serviços',
      descricao: '<p><b>O que é:</b> <code>/opt</code> guarda programas externos completos. <code>/srv</code> guarda os dados que o servidor oferece para a rede externa.</p>' +
        '<div class="fhs-porque"><b>❓ Por que o /opt existe se já temos o /usr?</b> O Linux nativo espalha os arquivos de um programa em várias pastas (binários em <code>/usr/bin</code>, bibliotecas em <code>/usr/lib</code>). Mas softwares comerciais e de fornecedores externos (como Google Chrome ou bancos de dados fechados) preferem vir numa caixa única: <code>/opt/google/chrome</code>. Se você quiser desinstalar o programa, basta apagar essa única pasta sem deixar vestígios pelo sistema!</div>',
      sintaxe: 'ls -ld /opt /srv',
      exemplos: [
        { comando: 'ls -ld /opt /srv', explicacao: 'pastas limpas em uma instalação nova' },
        { comando: 'mkdir -p /srv/site-institucional', explicacao: 'local padronizado pelo FHS para os arquivos do site' },
        { comando: 'ls -l /srv', explicacao: 'conferindo a pasta criada' },
      ],
      dicas: [
        '<b>[LPIC-1 104.7]:</b> <code>/opt</code> guarda aplicações autônomas de terceiros; <code>/srv</code> armazena dados de serviços atendidos pelo sistema (web, ftp, etc.).',
      ],
      pegadinha: '<b>[LPIC-1 104.7]:</b> Softwares de terceiros que não seguem a divisão clássica do Linux pertencem a <code>/opt</code>, e não a <code>/usr/bin</code>.',
    },
    {
      comando: '/media e /mnt',
      titulo: 'Pendrives e montagens de discos',
      descricao: '<p><b>O que é:</b> Onde discos e pendrives são "encaixados" na árvore para que você possa acessar seus arquivos.</p>' +
        '<div class="fhs-porque"><b>❓ Por que existem duas pastas de montagem?</b> Para separar o automático do manual: ' +
        '<br>• <code>/media</code>: É gerenciado pelo <b>sistema automático</b> (quando você pluga um pendrive no desktop, ele monta sozinho aqui em <code>/media/usuario/DISCO</code>). ' +
        '<br>• <code>/mnt</code>: É a bancada de trabalho do <b>administrador</b> (quando você usa o comando <code>mount /dev/sdb1 /mnt</code> na mão para socorrer um HD com defeito ou restaurar um backup).</div>',
      sintaxe: 'df -h  |  mount /dev/sdb1 /mnt',
      exemplos: [
        { comando: 'ls -ld /media /mnt', explicacao: 'pontos de montagem com finalidades distintas' },
        { comando: 'df -h', explicacao: 'mostra os discos conectados e onde cada um está montado' },
      ],
      dicas: [
        '<b>[LPIC-1 104.3 / 104.7]:</b> <code>/media</code> = mídias removíveis automáticas; <code>/mnt</code> = montagens manuais e temporárias do administrador.',
      ],
      pegadinha: '<b>[LPIC-1 104.3]:</b> Nunca use <code>/mnt</code> para pendrives automáticos nem jogue montagens temporárias de resgate em <code>/media</code>.',
      naPratica: 'Quando o sistema de outra máquina falha, o administrador conecta o disco na máquina de reparo e roda <code>mount /dev/sdb2 /mnt</code> para acessar os dados e recuperar backups.',
    },
  ],

  desafios: [
    {
      id: 'est-1',
      enunciado: 'Em servidores de produção, a regra número 1 antes de modificar configurações é a segurança: faça um <b>backup preventivo</b> da configuração do servidor SSH copiando o arquivo <code>/etc/ssh/sshd_config</code> para <code>/root/backup/sshd_config.bak</code>.',
      dica: 'Crie a pasta de destino com <code>mkdir -p /root/backup</code> e copie o arquivo com <code>cp /etc/ssh/sshd_config /root/backup/sshd_config.bak</code>.',
      solucao: [{ comando: 'mkdir -p /root/backup' }, { comando: 'cp /etc/ssh/sshd_config /root/backup/sshd_config.bak' }],
      verificar: (m) => Verificar.contem(m, '/root/backup/sshd_config.bak', 'PermitRootLogin'),
    },
    {
      id: 'est-2',
      enunciado: 'Auditoria de segurança em tempo real: localize as tentativas de invasão com <b>senha errada</b> no log de autenticação <code>/var/log/auth.log</code> (linhas com "Failed") e salve esse relatório em <code>/root/invasores.txt</code>.',
      dica: 'Filtre as falhas com <code>grep Failed /var/log/auth.log</code> e redirecione a saída com o operador <code>&gt;</code> para <code>/root/invasores.txt</code>.',
      solucao: [{ comando: 'grep Failed /var/log/auth.log > /root/invasores.txt' }],
      verificar: (m) => {
        const texto: string = Verificar.conteudo(m, '/root/invasores.txt') ?? '';
        return texto.includes('45.155.205.12') && !texto.includes('Accepted');
      },
    },
    {
      id: 'est-3',
      enunciado: 'Auditoria de hardware direto do Kernel: descubra o <b>modelo do processador</b> do servidor lendo a pasta virtual <code>/proc/cpuinfo</code> e salve a linha informativa em <code>/root/cpu.txt</code>.',
      dica: 'O Kernel expõe dados da CPU em <code>/proc/cpuinfo</code>. Filtre a linha com <code>grep "model name" /proc/cpuinfo &gt; /root/cpu.txt</code>.',
      solucao: [{ comando: 'grep "model name" /proc/cpuinfo > /root/cpu.txt' }],
      verificar: (m) => Verificar.contem(m, '/root/cpu.txt', 'Xeon'),
    },
    {
      id: 'est-4',
      enunciado: 'Crie um comando global disponível para todos os usuários: crie um script em <code>/usr/local/bin/boasvindas</code> com a linha <code>echo Bem-vindo ao servidor</code>. Torne-o executável (<code>chmod 755</code>) e teste digitando apenas <code>boasvindas</code>.',
      dica: 'Crie o arquivo com <code>echo "echo Bem-vindo ao servidor" &gt; /usr/local/bin/boasvindas</code>, dê permissão de execução com <code>chmod 755 /usr/local/bin/boasvindas</code> e execute chamando <code>boasvindas</code>.',
      solucao: [
        { comando: 'echo "echo Bem-vindo ao servidor" > /usr/local/bin/boasvindas' },
        { comando: 'chmod 755 /usr/local/bin/boasvindas' },
        { comando: 'boasvindas' },
      ],
      verificar: (m) => Verificar.modo(m, '/usr/local/bin/boasvindas', 0o755) && Verificar.contem(m, '/usr/local/bin/boasvindas', 'echo'),
    },
    {
      id: 'est-5',
      enunciado: 'Mapeamento de armazenamento: inspecione as partições montadas com <code>df -h</code>, localize a linha da partição <code>sda2</code> que está montada na raiz <code>/</code> e salve-a no arquivo <code>/root/raiz.txt</code>.',
      dica: 'Execute <code>df -h | grep sda2 &gt; /root/raiz.txt</code> para registrar a partição raiz montada.',
      solucao: [{ comando: 'df -h | grep sda2 > /root/raiz.txt' }],
      verificar: (m) => Verificar.contem(m, '/root/raiz.txt', '/dev/sda2'),
    },
  ],
};
