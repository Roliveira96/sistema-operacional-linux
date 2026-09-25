import type { Topico } from './Topico';
import { Verificar } from './Verificar';

/** 01 · História do Linux: Unix, GNU, Linus, kernel × distribuição, famílias e onde o Linux está. */
export const historia: Topico = {
  id: 'historia',
  numero: 1,
  titulo: 'História do Linux',
  subtitulo: 'Unix · GNU · Linus Torvalds · kernel × distribuição · famílias de distros',
  icone: '📜',
  cor: '--cor-hist',
  resumo: 'De onde veio o Linux, por que ele domina os servidores e o que muda de uma distribuição para outra.',
  conceitos:
    '<h3>🐧 Linux em uma frase</h3>' +
    '<p><b>Linux é o kernel</b> (o núcleo que conversa com o hardware) criado por <b>Linus Torvalds em 1991</b>. ' +
    'Junto com as ferramentas do projeto <b>GNU</b> e um gerenciador de pacotes, ele vira um sistema operacional completo: uma <b>distribuição</b> (Ubuntu, Debian, Fedora...).</p>' +
    '<h3>🗓️ Linha do tempo</h3>' +
    '<table class="tabela">' +
    '<tr><td><b>1969</b></td><td>Ken Thompson e Dennis Ritchie criam o <b>Unix</b> nos laboratórios Bell (AT&amp;T).</td></tr>' +
    '<tr><td><b>1972</b></td><td>Ritchie cria a <b>linguagem C</b> e o Unix é reescrito nela: fica portável para outras máquinas.</td></tr>' +
    '<tr><td><b>1983</b></td><td>Richard Stallman anuncia o <b>projeto GNU</b>: um sistema "tipo Unix" 100% livre.</td></tr>' +
    '<tr><td><b>1985</b></td><td>Nasce a <b>Free Software Foundation</b> (FSF).</td></tr>' +
    '<tr><td><b>1989</b></td><td>Primeira versão da licença <b>GPL</b>.</td></tr>' +
    '<tr><td><b>1991</b></td><td>Linus Torvalds, estudante em Helsinque, anuncia seu kernel "só um hobby". Em setembro sai a versão 0.01.</td></tr>' +
    '<tr><td><b>1992</b></td><td>O Linux passa a usar a GPL: GNU + Linux = um sistema operacional livre completo.</td></tr>' +
    '<tr><td><b>1993</b></td><td>Surgem Slackware e <b>Debian</b>, das distribuições mais antigas ainda vivas.</td></tr>' +
    '<tr><td><b>1996</b></td><td>O pinguim <b>Tux</b> vira o mascote.</td></tr>' +
    '<tr><td><b>2004</b></td><td>A Canonical lança o <b>Ubuntu</b> (baseado no Debian): Linux fácil para todos.</td></tr>' +
    '<tr><td><b>2008</b></td><td>Chega o <b>Android</b>, que usa o kernel Linux.</td></tr>' +
    '<tr><td><b>2017</b></td><td>Os <b>500 supercomputadores</b> mais rápidos do mundo passam a rodar Linux (100% da lista TOP500).</td></tr></table>',
  naPratica: 'Quando alguém diz "o servidor é Linux", quase sempre quer dizer uma distribuição como Ubuntu Server, Debian ou Rocky Linux. ' +
    'Saber qual é importa na hora de instalar programas: no Ubuntu/Debian é <code>apt</code>, no Red Hat/Rocky é <code>dnf</code>. ' +
    'Por isso o primeiro comando de quem chega num servidor desconhecido costuma ser <code>cat /etc/os-release</code>.',
  demonstracao: [
    { comando: 'uname -o', explicacao: 'o nome do sistema: GNU/Linux' },
    { comando: 'uname -r', explicacao: 'a versão do kernel Linux' },
    { comando: 'cat /etc/os-release', explicacao: 'qual distribuição e versão' },
  ],

  preparar(): void {
    // máquina padrão
  },

  licoes: [
    {
      comando: 'Unix',
      titulo: 'Antes do Linux: o Unix (1969)',
      descricao: 'O Unix nasceu na AT&amp;T e trouxe ideias que o Linux herdou e que você usa em todo comando: ' +
        '<b>tudo é arquivo</b> (até discos e o teclado), <b>programas pequenos que fazem uma coisa bem feita</b> e que se <b>combinam</b> com o pipe <code>|</code>, ' +
        'e o sistema <b>multiusuário</b> com permissões. O Unix era caro e fechado, o que motivou a busca por uma alternativa livre.',
      sintaxe: 'programa1 | programa2 | programa3',
      exemplos: [
        { comando: 'ls /etc | wc -l', explicacao: 'filosofia Unix: um lista, o outro conta' },
        { comando: 'cat /etc/passwd | cut -d: -f1 | sort | head -3', explicacao: 'quatro programas pequenos em sequência' },
        { comando: 'ls -l /dev/sda', explicacao: '"tudo é arquivo": o disco inteiro é um arquivo' },
      ],
      naPratica: 'Descendentes diretos do Unix ainda estão por aí: o <b>macOS</b> é um Unix certificado e o <b>FreeBSD</b> roda em servidores e até no PlayStation. ' +
        'Por isso quem sabe Linux se vira bem no terminal do Mac.',
    },
    {
      comando: 'GNU',
      titulo: 'GNU e o software livre (1983)',
      descricao: 'Richard Stallman criou o projeto <b>GNU</b> ("GNU is Not Unix") para construir um sistema tipo Unix totalmente livre. ' +
        'Em 1991 o GNU já tinha quase tudo: o shell <b>bash</b>, os comandos básicos (<code>ls</code>, <code>cp</code>, <code>mv</code>: o pacote <b>coreutils</b>), ' +
        'o <b>grep</b>, o compilador <b>gcc</b>... Só faltava o <b>kernel</b>. Por isso muita gente chama o sistema de <b>GNU/Linux</b>.',
      sintaxe: '',
      exemplos: [
        { comando: 'apt show coreutils', explicacao: 'ls, cp, mv, rm... são "GNU core utilities"' },
        { comando: 'apt show bash', explicacao: 'o shell que você está usando: GNU Bourne Again SHell' },
      ],
      dicas: [
        'As <b>4 liberdades</b> do software livre: <b>0</b> usar para qualquer fim; <b>1</b> estudar o código e adaptá-lo; <b>2</b> redistribuir cópias; <b>3</b> distribuir suas melhorias.',
        'A <b>GPL</b> é "copyleft": quem distribui uma versão modificada precisa manter o código aberto com a mesma licença.',
      ],
      naPratica: 'Software livre não é "de graça": é sobre <b>liberdade</b>. Empresas como Red Hat e Canonical vendem suporte e serviços em cima de software livre. ' +
        'Para uma empresa, isso significa não depender de um único fornecedor e poder auditar o código (importante em segurança).',
    },
    {
      comando: 'Linux',
      titulo: '1991: Linus Torvalds e o kernel',
      descricao: 'Em 25 de agosto de 1991, o finlandês <b>Linus Torvalds</b>, com 21 anos, postou num fórum: ' +
        '"estou fazendo um sistema operacional (gratuito), é só um hobby, não será grande e profissional como o GNU". ' +
        'O <b>kernel</b> é o núcleo: gerencia a memória, os processos, os discos e a rede. Hoje o Linux tem milhares de colaboradores e Linus ainda coordena o projeto.',
      sintaxe: 'uname -r  |  uname -a  |  cat /proc/version',
      exemplos: [
        { comando: 'uname -r', explicacao: 'versão do kernel' },
        { comando: 'uname -a', explicacao: 'tudo: kernel, máquina, arquitetura' },
        { comando: 'cat /proc/version', explicacao: 'o próprio kernel respondendo' },
        { comando: 'ls -l /boot', explicacao: 'o arquivo do kernel (vmlinuz) fica aqui' },
      ],
      naPratica: 'Atualizações de segurança do kernel são frequentes. Depois de um <code>apt upgrade</code> que troca o kernel, o servidor precisa ser reiniciado para usar a versão nova: ' +
        'o Ubuntu avisa com a mensagem "*** System restart required ***" ao fazer login.',
    },
    {
      comando: 'distribuição',
      titulo: 'Kernel × distribuição',
      descricao: 'Ninguém instala "só o Linux". Uma <b>distribuição</b> junta: o <b>kernel Linux</b> + as <b>ferramentas GNU</b> + um <b>gerenciador de pacotes</b> + ' +
        'um instalador + configurações padrão (e às vezes uma interface gráfica). Cada distribuição escolhe esses ingredientes de um jeito.',
      sintaxe: 'cat /etc/os-release  |  lsb_release -a',
      exemplos: [
        { comando: 'lsb_release -a' },
        { comando: 'grep ID_LIKE /etc/os-release', explicacao: 'o Ubuntu é "parecido com" o Debian' },
        { comando: 'which apt dpkg', explicacao: 'o gerenciador de pacotes da família Debian' },
      ],
      naPratica: 'Scripts de instalação "para Linux" costumam começar lendo o <code>/etc/os-release</code> para decidir se usam <code>apt</code> ou <code>dnf</code>. ' +
        'Imagens Docker também são distribuições: <code>ubuntu</code>, <code>debian</code>, <code>alpine</code>.',
    },
    {
      comando: 'famílias',
      titulo: 'As famílias de distribuições',
      descricao: 'As distribuições se agrupam em "famílias" que compartilham o formato de pacote e as ferramentas:' +
        '<table class="tabela" style="margin-top:8px"><tr><th>Família</th><th>Distribuições</th><th>Pacotes</th><th>Onde aparece</th></tr>' +
        '<tr><td><b>Debian</b></td><td>Debian, <b>Ubuntu</b>, Linux Mint, Kali, Raspberry Pi OS</td><td><code>.deb</code> · <code>apt</code></td><td>servidores, desktop, ensino</td></tr>' +
        '<tr><td><b>Red Hat</b></td><td>RHEL, Fedora, CentOS Stream, Rocky, AlmaLinux</td><td><code>.rpm</code> · <code>dnf</code> (antigo <code>yum</code>)</td><td>empresas, bancos, governo</td></tr>' +
        '<tr><td><b>SUSE</b></td><td>SUSE Linux Enterprise, openSUSE</td><td><code>.rpm</code> · <code>zypper</code></td><td>empresas (forte na Europa)</td></tr>' +
        '<tr><td><b>Arch</b></td><td>Arch Linux, Manjaro</td><td><code>pacman</code></td><td>entusiastas, sempre atualizado</td></tr>' +
        '<tr><td><b>Alpine</b></td><td>Alpine Linux</td><td><code>apk</code></td><td>containers Docker (imagem de ~5 MB)</td></tr></table>',
      sintaxe: '',
      exemplos: [],
      dicas: [
        '<b>Ubuntu</b>: versões <b>AA.MM</b> (24.04 = abril de 2024). A cada 2 anos, em abril, sai uma <b>LTS</b> (Long Term Support) com 5 anos de atualizações. É a escolha padrão para servidores.',
        'Os codinomes seguem o alfabeto com um animal: 20.04 Focal Fossa, 22.04 Jammy Jellyfish, <b>24.04 Noble Numbat</b>.',
        '<b>Rolling release</b> (Arch): não há "versão nova", o sistema vai sendo atualizado continuamente.',
      ],
      naPratica: 'Em vagas de emprego aparecem muito "Linux (Ubuntu/Debian ou RHEL/Rocky)". Os comandos deste material (arquivos, permissões, usuários) são iguais em todas; ' +
        'o que muda de uma família para outra é principalmente o gerenciador de pacotes e onde ficam algumas configurações.',
    },
    {
      comando: 'onde está',
      titulo: 'Onde o Linux está (e por que ele importa)',
      descricao: 'Você usa Linux todo dia, mesmo sem ver:' +
        '<ul class="lista-simples">' +
        '<li><b>Servidores e nuvem:</b> a grande maioria dos sites e das máquinas na AWS, Google Cloud e Azure roda Linux.</li>' +
        '<li><b>Supercomputadores:</b> 100% dos 500 mais rápidos do mundo, desde 2017.</li>' +
        '<li><b>Celulares:</b> o Android usa o kernel Linux.</li>' +
        '<li><b>Embarcados:</b> roteadores, smart TVs, carros, caixas eletrônicos, Raspberry Pi.</li>' +
        '<li><b>Containers:</b> Docker e Kubernetes são tecnologias do kernel Linux.</li></ul>' +
        'Por quê? É <b>estável</b> (servidores ficam meses sem reiniciar), <b>seguro</b> (permissões e usuários desde o Unix), <b>leve</b> (roda sem interface gráfica), ' +
        '<b>gratuito</b> e <b>automatizável</b> pela linha de comando.',
      sintaxe: '',
      exemplos: [
        { comando: 'who', explicacao: 'multiusuário: quem está conectado agora' },
        { comando: 'free -h', explicacao: 'um servidor inteiro usando pouco mais de 1 GB de RAM' },
      ],
      naPratica: 'Profissões que exigem Linux no dia a dia: administrador de sistemas, DevOps/SRE, engenharia de nuvem, segurança da informação (pentest usa Kali Linux), ' +
        'desenvolvimento backend e ciência de dados.',
    },
    {
      comando: 'terminal',
      titulo: 'Por que aprender a linha de comando?',
      descricao: 'Servidores normalmente <b>não têm interface gráfica</b>: você se conecta por <b>SSH</b> e faz tudo digitando comandos, como no simulador ao lado. ' +
        'O terminal também permite <b>automatizar</b> (um script repete 100 tarefas sem erro), funciona em conexões lentas e é igual em qualquer distribuição.',
      sintaxe: 'ssh usuario@servidor',
      exemplos: [
        { comando: 'hostname', explicacao: 'em qual máquina estou' },
        { comando: 'hostname -I', explicacao: 'o IP dela' },
        { comando: 'whoami', explicacao: 'com qual usuário' },
      ],
      naPratica: 'Um administrador cuida de dezenas ou centenas de servidores. Ninguém faria isso clicando: as tarefas são feitas por SSH e, cada vez mais, ' +
        'por ferramentas de automação (Ansible, scripts shell) que no fundo executam os mesmos comandos que você está aprendendo.',
    },
  ],

  desafios: [
    {
      id: 'hist-1',
      enunciado: 'Salve a <b>versão do kernel</b> no arquivo <code>/root/kernel.txt</code> (sem digitar a versão na mão).',
      dica: 'Redirecione a saída do comando que mostra a versão do kernel: <code>uname -r &gt; arquivo</code>.',
      solucao: [{ comando: 'uname -r > /root/kernel.txt' }],
      verificar: (m) => Verificar.contem(m, '/root/kernel.txt', '6.8.0-45-generic'),
    },
    {
      id: 'hist-2',
      enunciado: 'Salve em <code>/root/distro.txt</code> as informações da distribuição lidas do arquivo de identificação do sistema.',
      dica: 'O arquivo é o <code>/etc/os-release</code>; use cat com redirecionamento (ou cp).',
      solucao: [{ comando: 'cat /etc/os-release > /root/distro.txt' }],
      verificar: (m) => Verificar.contem(m, '/root/distro.txt', 'ubuntu') && Verificar.contem(m, '/root/distro.txt', '24.04'),
    },
  ],
};
