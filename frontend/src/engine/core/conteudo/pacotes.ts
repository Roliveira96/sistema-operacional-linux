import type { Topico } from './Topico';
import { Verificar } from './Verificar';
import { GerenciadorDePacotes, Servicos } from '../linux/Pacotes';

/** 08 · Instalar e atualizar programas (apt, apt-get, dpkg) e controlar serviços (systemctl). */
export const pacotes: Topico = {
  id: 'pacotes',
  numero: 8,
  titulo: 'Pacotes, atualizações e serviços',
  subtitulo: 'apt update · upgrade · install · remove · purge · search · apt-get · dpkg · systemctl',
  icone: '📦',
  cor: '--cor-pac',
  resumo: 'Instalar, atualizar e remover programas com apt, e ligar um servidor web de verdade com systemctl.',
  conceitos:
    '<h3>📦 Pacote, repositório e dependência</h3>' +
    '<p>No Linux você quase nunca baixa instalador de site. Os programas vêm em <b>pacotes</b> (<code>.deb</code> no Ubuntu/Debian) guardados em <b>repositórios</b>: ' +
    'servidores oficiais da distribuição, com tudo testado e assinado. O gerenciador de pacotes baixa, instala, resolve as <b>dependências</b> (o que o programa precisa para funcionar) e atualiza tudo de uma vez.</p>' +
    '<table class="tabela"><tr><th>Ferramenta</th><th>Papel</th></tr>' +
    '<tr><td><code>apt</code></td><td>o jeito moderno e amigável, para usar no terminal (tem cores e barra de progresso)</td></tr>' +
    '<tr><td><code>apt-get</code> / <code>apt-cache</code></td><td>as ferramentas clássicas; saída estável, preferidas em <b>scripts</b></td></tr>' +
    '<tr><td><code>dpkg</code></td><td>o nível mais baixo: instala um <code>.deb</code> e consulta o que está instalado, mas não resolve dependências</td></tr></table>' +
    '<h3>🔁 O ritual de sempre</h3>' +
    '<p><b>1.</b> <code>apt update</code> baixa a <b>lista</b> do que existe e das versões novas (não instala nada). ' +
    '<b>2.</b> <code>apt upgrade</code> instala as atualizações. <b>3.</b> <code>apt install</code> instala algo novo. Tudo isso exige <b>root</b> (ou <code>sudo</code>).</p>' +
    '<h3>⚙️ Serviços</h3>' +
    '<p>Programas que ficam rodando em segundo plano (servidor web, SSH, banco de dados) são <b>serviços</b>, controlados pelo <b>systemd</b> com o comando <code>systemctl</code>. ' +
    '<b>start/stop</b> liga e desliga agora; <b>enable/disable</b> decide se liga sozinho no boot.</p>' +
    '<p class="conceitos-dica">💡 Outras famílias: Red Hat/Rocky/Fedora usam <code>dnf install</code> (antigo <code>yum</code>), Arch usa <code>pacman -S</code>, Alpine usa <code>apk add</code>. A lógica é a mesma.</p>',
  naPratica: 'Manter o servidor atualizado é a defesa número 1 contra invasões: a maioria dos ataques explora falhas que já tinham correção publicada. ' +
    'Em produção, o Ubuntu costuma ter o <i>unattended-upgrades</i> ligado para instalar sozinho as atualizações de segurança todo dia.',
  demonstracao: [
    { comando: 'cat /etc/apt/sources.list.d/ubuntu.sources', explicacao: 'de onde o apt baixa: os repositórios' },
    { comando: 'dpkg -l | wc -l', explicacao: 'quantas linhas tem a lista de instalados' },
    { comando: 'systemctl', explicacao: 'os serviços desta máquina' },
  ],

  preparar(): void {
    // servidor padrão: lista de pacotes "velha" (openssl, tzdata e openssh-server com atualização pendente)
  },

  licoes: [
    {
      comando: 'apt update',
      titulo: 'Atualizar a lista de pacotes',
      descricao: 'Baixa dos repositórios a lista atualizada de pacotes e versões. <b>Não instala nem atualiza nada</b>: só descobre o que existe de novo. Sempre o primeiro passo.',
      sintaxe: 'sudo apt update',
      exemplos: [
        { comando: 'apt upgrade', explicacao: 'sem update antes, o apt nem sabe que existem versões novas' },
        { comando: 'apt update', explicacao: 'agora sim: "3 pacotes podem ser atualizados"' },
        { comando: 'apt list --upgradable', explicacao: 'quais são e de qual para qual versão' },
      ],
      dicas: [
        '<b>[LPIC-1 102.4]:</b> <code>apt update</code> consulta as URLs cadastradas em <code>/etc/apt/sources.list</code> e <code>/etc/apt/sources.list.d/</code> para atualizar os índices locais.',
      ],
      pegadinha: '<b>[LPIC-1 102.4]:</b> <code>apt update</code> NÃO instala nada! Ele apenas sincroniza a lista de versões mais recentes dos repositórios. Quem instala as atualizações é o <code>apt upgrade</code>.',
      naPratica: 'Todo tutorial de servidor começa com <code>sudo apt update &amp;&amp; sudo apt upgrade -y</code>. O <code>&amp;&amp;</code> garante que o upgrade só roda se o update deu certo.',
    },
    {
      comando: 'apt upgrade',
      titulo: 'Instalar as atualizações',
      descricao: 'Atualiza todos os pacotes instalados para as versões que o <code>apt update</code> encontrou. Pergunta antes de continuar; o <code>-y</code> responde "sim" automaticamente.',
      sintaxe: 'sudo apt upgrade [-y]',
      opcoes: [
        ['-y', 'responde "sim" para tudo (útil em scripts)'],
        ['full-upgrade', 'atualiza mesmo que precise remover/instalar pacotes (troca de kernel, por exemplo)'],
        ['do-release-upgrade', '(Ubuntu real) sobe de versão: 22.04 → 24.04'],
      ],
      exemplos: [
        { comando: 'apt upgrade', respostas: ['S'], explicacao: 'respondemos S na pergunta' },
        { comando: 'apt list --upgradable', explicacao: 'nada mais pendente' },
        { comando: 'tail -5 /var/log/apt/history.log', explicacao: 'o apt registra tudo que fez' },
      ],
      dicas: [
        '<b>[LPIC-1 102.4]:</b> Diferença de prova: <code>upgrade</code> atualiza pacotes sem desinstalar nada; <code>full-upgrade</code> (ou <code>dist-upgrade</code>) pode remover dependências antigas para instalar novas versões de pacotes essenciais como o kernel.',
      ],
      naPratica: 'Em servidores de produção, atualizações grandes são testadas antes num servidor de homologação e aplicadas numa "janela de manutenção" (madrugada). ' +
        'Atualizações de segurança são exceção: entram o quanto antes.',
    },
    {
      comando: 'apt search / show',
      titulo: 'Procurar pacotes',
      descricao: '<code>apt search</code> procura nos nomes e descrições; <code>apt show</code> mostra os detalhes de um pacote (versão, tamanho, dependências) antes de instalar.',
      sintaxe: 'apt search PALAVRA  |  apt show PACOTE',
      exemplos: [
        { comando: 'apt search web', explicacao: 'servidores web disponíveis' },
        { comando: 'apt show nginx' },
      ],
      dicas: [
        '<b>[LPIC-1 102.4]:</b> <code>apt show pacote</code> exibe arquitetura, versão, maintainer e dependências de pacotes do repositório antes da instalação.',
      ],
      naPratica: 'Nem sempre o nome do pacote é óbvio: o servidor SSH é <code>openssh-server</code>, o MySQL é <code>mysql-server</code>. O search evita adivinhar.',
    },
    {
      comando: 'apt install',
      titulo: 'Instalar programas',
      descricao: 'Baixa e instala o pacote e as dependências. Se um comando não existe, o Ubuntu já sugere qual pacote instalar.',
      sintaxe: 'sudo apt install PACOTE [PACOTE...] [-y]',
      exemplos: [
        { comando: 'tree', explicacao: 'não vem instalado: o Ubuntu sugere o pacote' },
        { comando: 'apt install tree' },
        { comando: 'tree -L 1 /etc | head -8', explicacao: 'funcionando' },
        { comando: 'apt install -y htop neofetch cowsay', explicacao: 'vários de uma vez, sem perguntar' },
        { comando: 'neofetch' },
        { comando: 'cowsay "Passei na prova de Linux!"' },
        { comando: 'htop' },
      ],
      dicas: [
        '<b>[LPIC-1 102.4]:</b> O APT resolve automaticamente a árvore de dependências. O parâmetro <code>-y</code> confirma automaticamente os downloads para automações.',
        'Instalar o que já está instalado não dá erro: o apt diz "já é a versão mais recente".',
      ],
      naPratica: 'Um servidor novo recebe logo os pacotes de trabalho: <code>apt install -y nginx git curl htop</code>. Em nuvem, esse comando costuma ficar num script de inicialização (cloud-init) que roda sozinho quando a máquina é criada.',
    },
    {
      comando: 'sudo apt',
      titulo: 'Instalar como usuário comum',
      descricao: 'Instalar mexe no sistema inteiro, então exige root. Um usuário do grupo <b>sudo</b> (o ricardo) instala colocando <code>sudo</code> na frente.',
      sintaxe: 'sudo apt install PACOTE',
      exemplos: [
        { comando: 'apt install git', terminal: 2, login: { usuario: 'ricardo', senha: '123' }, explicacao: 'sem sudo: não consegue a "trava" do dpkg' },
        { comando: 'sudo apt install -y git', terminal: 2, respostas: ['123'], explicacao: 'com sudo: pede a senha do ricardo' },
        { comando: 'git --version', terminal: 2 },
      ],
      dicas: [
        '<b>[LPIC-1 102.4 / 107.1]:</b> O banco de dados do dpkg cria travas em <code>/var/lib/dpkg/lock</code> para evitar execuções concorrentes corrompendo a base de pacotes.',
      ],
      pegadinha: 'A mensagem "Não foi possível obter trava... você é root?" quase sempre significa só uma coisa: faltou o <code>sudo</code>.',
      naPratica: 'Em empresas, só alguns administradores estão no grupo sudo. Cada <code>sudo apt install</code> fica registrado em <code>/var/log/auth.log</code> com o nome de quem fez.',
    },
    {
      comando: 'which / dpkg',
      titulo: 'O que está instalado e onde',
      descricao: '<code>which</code> mostra onde está o programa. <code>dpkg -l</code> lista os pacotes instalados (<b>ii</b> = instalado). <code>dpkg -L</code> mostra os arquivos que um pacote colocou no sistema.',
      sintaxe: 'which PROGRAMA  |  dpkg -l [PACOTE]  |  dpkg -L PACOTE  |  apt list --installed',
      exemplos: [
        { comando: 'which tree htop' },
        { comando: 'dpkg -l tree' },
        { comando: 'dpkg -L htop', explicacao: 'os arquivos do pacote' },
        { comando: 'apt list --installed | grep tree' },
      ],
      dicas: [
        '<b>[LPIC-1 102.4]:</b> Comandos dpkg chave: <code>dpkg -l</code> (lista instalados), <code>dpkg -L pacote</code> (lista arquivos de um pacote) e <code>dpkg -i arq.deb</code> (instala arquivo local).',
      ],
      pegadinha: '<b>[LPIC-1 102.4]:</b> Questão clássica de prova: para descobrir QUAL pacote instalou um arquivo específico no disco, use <code>dpkg -S /caminho/arquivo</code>. No Red Hat/RPM, o equivalente é <code>rpm -qf /caminho/arquivo</code>.',
      naPratica: 'Auditoria: "que versão do openssl está nesse servidor?" → <code>dpkg -l openssl</code>. Quando sai uma falha de segurança famosa, é assim que se confere quais servidores estão vulneráveis.',
    },
    {
      comando: 'servidor web',
      titulo: 'Na prática: instalando um servidor web (nginx)',
      descricao: 'Juntando tudo: instalar o <b>nginx</b> faz o Ubuntu criar o serviço, a configuração em <code>/etc/nginx</code>, a pasta do site em <code>/var/www/html</code> e os logs em <code>/var/log/nginx</code>. ' +
        'O <code>curl</code> faz o papel do navegador, direto no terminal.',
      sintaxe: 'sudo apt install nginx  →  curl http://localhost',
      exemplos: [
        { comando: 'curl http://localhost', explicacao: 'nenhum servidor web: conexão recusada' },
        { comando: 'apt install nginx', respostas: ['S'], explicacao: 'traz junto o nginx-common' },
        { comando: 'curl http://localhost', explicacao: 'a página padrão "Welcome to nginx!"' },
        { comando: 'ls -l /var/www/html' },
        { comando: 'echo "<h1>Meu servidor Linux</h1>" > /var/www/html/index.html', explicacao: 'publicando a nossa página' },
        { comando: 'curl localhost' },
        { comando: 'tail -2 /var/log/nginx/access.log', explicacao: 'cada acesso fica registrado' },
      ],
      naPratica: 'É exatamente assim que se sobe um site num servidor (VPS) na nuvem: <code>apt install nginx</code>, arquivos em <code>/var/www</code>, configuração em <code>/etc/nginx/sites-available</code>. ' +
        'O nginx roda como o usuário <code>www-data</code>, por isso as permissões dos arquivos do site importam.',
    },
    {
      comando: 'systemctl',
      titulo: 'Controlar serviços',
      descricao: 'O <b>systemd</b> gerencia os serviços. <code>status</code> mostra se está rodando; <code>start</code>/<code>stop</code>/<code>restart</code> liga, desliga e reinicia; ' +
        '<code>enable</code>/<code>disable</code> define se liga sozinho no boot.',
      sintaxe: 'sudo systemctl status|start|stop|restart|enable|disable SERVIÇO',
      opcoes: [
        ['status', 'estado atual (● verde = rodando)'],
        ['start / stop', 'liga / desliga agora'],
        ['restart', 'reinicia (depois de mudar a configuração)'],
        ['enable / disable', 'liga / não liga automaticamente no boot'],
        ['enable --now', 'habilita e já liga'],
        ['is-active', 'responde só active/inactive (bom para scripts)'],
      ],
      exemplos: [
        { comando: 'systemctl status nginx' },
        { comando: 'systemctl stop nginx' },
        { comando: 'curl localhost', explicacao: 'site fora do ar' },
        { comando: 'systemctl start nginx' },
        { comando: 'systemctl is-enabled nginx', explicacao: 'enabled: volta sozinho se o servidor reiniciar' },
        { comando: 'systemctl status ssh', explicacao: 'o serviço que permite você estar conectado' },
        { comando: 'systemctl restart nginx', terminal: 2, explicacao: 'usuário comum não controla serviços' },
      ],
      dicas: [
        '<b>[LPIC-1 101.3 / 108.1 & CompTIA Linux+]:</b> No systemd, <code>start</code> e <code>stop</code> gerenciam o serviço agora; <code>enable</code> e <code>disable</code> criam/removem symlinks em <code>/etc/systemd/system/</code> para o boot.',
        'O comando antigo <code>service nginx status</code> ainda funciona e chama o systemctl por baixo.',
      ],
      pegadinha: '<b>[LPIC-1 101.3 / RHCSA EX200]:</b> <code>systemctl start servico</code> NÃO habilita o serviço para os próximos reboots! Para iniciar e habilitar no boot em um comando só: <code>systemctl enable --now servico</code>.',
      naPratica: 'Mudou a configuração do nginx? Primeiro <code>nginx -t</code> (testa se está certa), depois <code>systemctl reload nginx</code>. ' +
        'Um erro de digitação na configuração seguido de restart derruba o site: por isso o teste antes.',
    },
    {
      comando: 'permissões na web',
      titulo: 'Quando a permissão derruba o site: 403',
      descricao: 'O nginx lê os arquivos como o usuário <b>www-data</b>. Se ele não tiver permissão de leitura, o site responde <b>403 Forbidden</b>. É o encontro dos tópicos Permissões e Serviços.',
      sintaxe: 'curl -I http://localhost',
      exemplos: [
        { comando: 'chmod 600 /var/www/html/index.html', explicacao: 'só o root lê...' },
        { comando: 'curl -I localhost', explicacao: '...então o www-data recebe 403' },
        { comando: 'chmod 644 /var/www/html/index.html', explicacao: 'devolve a leitura para "outros"' },
        { comando: 'curl -I localhost', explicacao: '200 OK' },
      ],
      dicas: [
        '<b>[LPIC-1 104.5]:</b> O servidor Web roda sob a conta de serviço <code>www-data</code>. Se ele não tiver leitura nos arquivos ou execução nas pastas pai, responderá com HTTP 403.',
      ],
      naPratica: 'É um dos chamados mais comuns: "subi os arquivos novos e o site deu 403". A causa costuma ser o upload feito como root com permissão fechada. A correção: <code>chmod 644</code> nos arquivos, <code>755</code> nas pastas, ou <code>chown -R www-data:www-data</code>.',
    },
    {
      comando: 'apt remove / purge',
      titulo: 'Remover programas',
      descricao: '<code>remove</code> apaga o programa mas <b>mantém as configurações</b> em <code>/etc</code> (caso reinstale). <code>purge</code> apaga <b>tudo</b>. ' +
        '<code>autoremove</code> limpa as dependências que ficaram sem uso.',
      sintaxe: 'sudo apt remove PACOTE  |  sudo apt purge PACOTE  |  sudo apt autoremove',
      exemplos: [
        { comando: 'apt remove -y cowsay' },
        { comando: 'cowsay oi', explicacao: 'sumiu' },
        { comando: 'apt remove nginx', respostas: ['S'], explicacao: 'repare no aviso sobre o nginx-common' },
        { comando: 'ls /etc/nginx', explicacao: 'remove: a configuração continua aqui' },
        { comando: 'apt autoremove -y', explicacao: 'tira o nginx-common, que ficou sem uso' },
        { comando: 'dpkg -l nginx-common', explicacao: 'rc = removido, mas com configuração' },
        { comando: 'apt purge -y nginx-common', explicacao: 'agora apaga até o /etc/nginx' },
        { comando: 'ls /etc/nginx' },
      ],
      dicas: [
        '<b>[LPIC-1 102.4]:</b> Equivalente no dpkg: <code>dpkg -r</code> (remove programa) e <code>dpkg -P</code> (purge: remove programa e arquivos de configuração). Pacotes com configs remanescentes aparecem como <code>rc</code> no <code>dpkg -l</code>.',
      ],
      pegadinha: '<b>[LPIC-1 102.4]:</b> Reinstalou e voltou com configuração antiga? O pacote foi removido com <code>remove</code>. Para apagar completamente até os arquivos em <code>/etc</code>, a prova exige <code>purge</code>.',
      naPratica: 'Menos programas instalados = menos coisas para atualizar e menos portas para invasão. Remover o que não se usa (e rodar <code>autoremove</code>) faz parte da rotina de segurança.',
    },
    {
      comando: 'apt-get / apt-cache',
      titulo: 'As ferramentas clássicas (scripts)',
      descricao: 'Antes do <code>apt</code> existiam o <code>apt-get</code> (instalar/atualizar) e o <code>apt-cache</code> (pesquisar). Fazem o mesmo, mas a saída não muda entre versões, então são as preferidas em <b>scripts</b> e Dockerfiles.',
      sintaxe: 'apt-get update  |  apt-get install -y PACOTE  |  apt-cache search PALAVRA',
      exemplos: [
        { comando: 'apt-get update' },
        { comando: 'apt-get install -y cowsay' },
        { comando: 'apt-cache search cow' },
        { comando: 'apt-cache policy openssl', explicacao: 'versão instalada × disponível' },
      ],
      dicas: [
        '<b>[LPIC-1 102.4]:</b> <code>apt-get</code> e <code>apt-cache</code> são os utilitários clássicos estáveis para automação e scripts. <code>apt</code> foi desenvolvido para uso interativo humano no terminal.',
      ],
      naPratica: 'Todo Dockerfile baseado em Ubuntu tem uma linha como <code>RUN apt-get update &amp;&amp; apt-get install -y curl</code>. Se o apt reclamar "WARNING: apt does not have a stable CLI interface", é porque deveria ser apt-get.',
    },
  ],

  desafios: [
    {
      id: 'pac-1',
      enunciado: 'Deixe o sistema <b>totalmente atualizado</b>: atualize a lista de pacotes e instale todas as atualizações pendentes.',
      dica: 'Dois comandos: apt update e apt upgrade (use -y para não perguntar).',
      solucao: [{ comando: 'apt update' }, { comando: 'apt upgrade -y' }],
      verificar: (m) => { const g = new GerenciadorDePacotes(m); return g.listasAtualizadas() && g.atualizaveis().length === 0; },
    },
    {
      id: 'pac-2',
      enunciado: 'Instale o pacote <code>tree</code> e o <code>htop</code>.',
      dica: 'Um apt install com os dois nomes.',
      solucao: [{ comando: 'apt install -y tree htop' }],
      verificar: (m) => { const g = new GerenciadorDePacotes(m); return g.instalado('tree') && g.instalado('htop'); },
    },
    {
      id: 'pac-3',
      enunciado: 'Coloque um servidor web no ar: o nginx deve estar <b>rodando</b> e a página <code>/var/www/html/index.html</code> deve mostrar <code>Prova de Linux</code>. Confira com <code>curl localhost</code>.',
      dica: 'apt install nginx, depois echo "Prova de Linux" &gt; /var/www/html/index.html.',
      solucao: [
        { comando: 'apt install -y nginx' },
        { comando: 'echo "Prova de Linux" > /var/www/html/index.html' },
        { comando: 'curl localhost' },
      ],
      verificar: (m) => new Servicos(m).ativo('nginx') && Verificar.contem(m, '/var/www/html/index.html', 'Prova de Linux'),
    },
    {
      id: 'pac-4',
      enunciado: 'Instale o <code>mysql-server</code>, mas deixe o serviço <code>mysql</code> <b>parado</b> e <b>sem iniciar sozinho</b> no boot.',
      dica: 'Depois de instalar: systemctl stop mysql e systemctl disable mysql (ou disable --now).',
      solucao: [{ comando: 'apt install -y mysql-server' }, { comando: 'systemctl disable --now mysql' }],
      verificar: (m) => { const s = new Servicos(m); return new GerenciadorDePacotes(m).instalado('mysql-server') && !s.ativo('mysql') && !s.habilitado('mysql'); },
    },
    {
      id: 'pac-5',
      enunciado: 'Como <b>ricardo</b> (terminal 2, senha 123), usando sudo, instale o pacote <code>cowsay</code>.',
      dica: 'Abra o terminal 2, entre como ricardo e rode sudo apt install cowsay.',
      solucao: [{ comando: 'sudo apt install -y cowsay', terminal: 2, login: { usuario: 'ricardo', senha: '123' }, respostas: ['123'] }],
      verificar: (m) => new GerenciadorDePacotes(m).instalado('cowsay'),
    },
    {
      id: 'pac-6',
      enunciado: 'Remova o <code>htop</code> <b>junto com as configurações</b> (remoção completa).',
      dica: 'Qual subcomando do apt apaga tudo? (Instale o htop antes, se ainda não tiver.)',
      solucao: [{ comando: 'apt install -y htop' }, { comando: 'apt purge -y htop' }],
      verificar: (m) => new GerenciadorDePacotes(m).estado().get('htop') === undefined && Verificar.naoExiste(m, '/usr/bin/htop') &&
        (Verificar.conteudo(m, '/var/log/apt/history.log') ?? '').includes('Purge: htop'),
    },
  ],
};
