import type { Desafio, ModalidadeSimulado, QuestaoQuiz, Topico } from './Topico';
import { Verificar } from './Verificar';
import { GerenciadorDePacotes, Servicos } from '../linux/Pacotes';

const questoesCertificacao: QuestaoQuiz[] = [
  {
    id: 'quiz-1',
    certificacao: 'LPI Linux Essentials 1.1 / LPIC-1 101.1',
    pergunta: 'Qual componente é o núcleo central do sistema operacional responsável por gerenciar a memória, o escalonamento de processos e a comunicação com o hardware?',
    opcoes: ['Bash Shell', 'Kernel Linux', 'GNU Coreutils', 'Systemd'],
    correta: 1,
    explicacao: 'O Kernel Linux é o núcleo do sistema operacional. O Bash é o interpretador de comandos (shell), o GNU Coreutils fornece utilitários de espaço do usuário e o Systemd gerencia serviços e inicialização.',
  },
  {
    id: 'quiz-2',
    certificacao: 'LPIC-1 103.3 / Linux Essentials 2.4',
    pergunta: 'Qual comando deve ser utilizado para remover um diretório não vazio e todo o seu conteúdo recursivamente sem pedir confirmação individual?',
    opcoes: ['rmdir -r pasta', 'rm -rf pasta', 'del /s pasta', 'rmdir --force pasta'],
    correta: 1,
    explicacao: 'O comando <code>rm -rf</code> (recursive + force) remove diretórios e arquivos recursivamente. O comando <code>rmdir</code> aceita remover apenas diretórios que já estejam totalmente vazios.',
  },
  {
    id: 'quiz-3',
    certificacao: 'LPIC-1 104.5 / Linux Essentials 5.3',
    pergunta: 'Qual representação numérica octal corresponde exatamente às permissões <code>rwxr-xr--</code>?',
    opcoes: ['754', '751', '644', '775'],
    correta: 0,
    explicacao: 'Cálculo octal (r=4, w=2, x=1): Dono: rwx = 4+2+1 = 7. Grupo: r-x = 4+0+1 = 5. Outros: r-- = 4+0+0 = 4. Portanto: 754.',
  },
  {
    id: 'quiz-4',
    certificacao: 'LPIC-1 107.1',
    pergunta: 'Ao analisar o arquivo <code>/etc/passwd</code>, você encontra a linha: <code>maria:x:1001:1001:Maria Silva:/home/maria:/bin/bash</code>. O que indica a letra "x" no segundo campo?',
    opcoes: [
      'A conta está expirada ou bloqueada',
      'A senha está vazia (sem senha configurada)',
      'A senha criptografada está armazenada com segurança no arquivo /etc/shadow',
      'O usuário possui privilégios de execução no sistema',
    ],
    correta: 2,
    explicacao: 'Por questões de segurança, os hashes de senhas foram movidos do <code>/etc/passwd</code> (legível por todos) para o <code>/etc/shadow</code> (legível apenas pelo root). O caractere "x" indica que o hash real está no shadow.',
  },
  {
    id: 'quiz-5',
    certificacao: 'LPIC-1 104.6 / Linux Essentials 5.4',
    pergunta: 'Em um diretório com o Sticky Bit configurado (permissão 1777, como no diretório <code>/tmp</code>), quem tem permissão para apagar ou renomear um arquivo existente nele?',
    opcoes: [
      'Qualquer usuário com permissão de escrita no diretório',
      'Apenas membros do grupo dono do diretório',
      'Apenas o dono do arquivo ou o superusuário (root)',
      'Nenhum usuário comum, apenas tarefas automáticas do sistema',
    ],
    correta: 2,
    explicacao: 'O Sticky Bit (t) em pastas públicas impede que usuários apaguem arquivos alheios. Apenas o proprietário do arquivo ou o root têm autorização para remover ou renomear o item.',
  },
  {
    id: 'quiz-6',
    certificacao: 'LPIC-1 102.4',
    pergunta: 'Em sistemas baseados em Debian e Ubuntu, qual comando deve ser usado para desinstalar um pacote removendo também todos os seus arquivos de configuração do sistema?',
    opcoes: ['apt remove pacote', 'apt purge pacote', 'apt clean pacote', 'dpkg -r pacote'],
    correta: 1,
    explicacao: 'O <code>apt remove</code> apaga os binários mas mantém as configurações em <code>/etc</code>. O <code>apt purge</code> (ou <code>dpkg -P</code>) remove o pacote e expurga todos os arquivos de configuração.',
  },
  {
    id: 'quiz-7',
    certificacao: 'LPIC-1 107.1 / RHCSA EX200',
    pergunta: 'Qual comando adiciona o usuário "joao" ao grupo suplementar "docker" MANTENDO todos os outros grupos secundários dos quais ele já é membro?',
    opcoes: ['usermod -G docker joao', 'usermod -aG docker joao', 'groupadd -u joao docker', 'chown joao:docker'],
    correta: 1,
    explicacao: 'A flag <code>-a</code> (append) acompanhada de <code>-G</code> é obrigatória. Executar <code>usermod -G docker joao</code> sem o <code>-a</code> remove o usuário de todos os demais grupos secundários!',
  },
  {
    id: 'quiz-8',
    certificacao: 'LPI Linux Essentials 4.3 / LPIC-1 104.7',
    pergunta: 'De acordo com o padrão FHS (Filesystem Hierarchy Standard), qual diretório é destinado a armazenar arquivos de configuração específicos do host?',
    opcoes: ['/var', '/usr', '/etc', '/opt'],
    correta: 2,
    explicacao: 'O diretório <code>/etc</code> é reservado exclusivamente para configurações do sistema e serviços. O <code>/var</code> armazena dados variáveis (logs, spools) e o <code>/usr</code> armazena programas e bibliotecas.',
  },
  {
    id: 'quiz-9',
    certificacao: 'LPIC-1 103.1 / Linux Essentials 2.4',
    pergunta: 'Qual é a diferença fundamental entre o operador de redirecionamento <code>&gt;</code> e o operador <code>&gt;&gt;</code> no shell Bash?',
    opcoes: [
      '> anexa ao final e >> sobrescreve o arquivo',
      '> sobrescreve o arquivo existente e >> anexa o conteúdo ao final',
      '> redireciona erros (stderr) e >> redireciona a saída padrão (stdout)',
      '> executa em segundo plano e >> executa sequencialmente',
    ],
    correta: 1,
    explicacao: 'O operador <code>&gt;</code> trunca/sobrescreve o destino. Já o operador <code>&gt;&gt;</code> opera em modo append, adicionando novas linhas ao fim do arquivo sem apagar o conteúdo existente.',
  },
  {
    id: 'quiz-10',
    certificacao: 'LPIC-1 107.1',
    pergunta: 'Qual comando deve ser utilizado para excluir uma conta de usuário e automaticamente apagar o seu diretório pessoal (/home/usuario) e sua caixa de correio?',
    opcoes: ['userdel usuario', 'userdel -r usuario', 'rmuser -f usuario', 'deluser --clean usuario'],
    correta: 1,
    explicacao: 'O comando <code>userdel -r</code> (remove) deleta a conta em <code>/etc/passwd</code> e expurga conjuntamente a pasta home do usuário e o spool de e-mails.',
  },
];

const desafiosBasico: Desafio[] = [
  {
    id: 'bas-1',
    enunciado: 'Crie a estrutura de diretórios aninhada <code>/home/ricardo/workspace/projeto1</code> em um único comando.',
    dica: '<b>[LPIC-1 103.3]:</b> Use <code>mkdir -p</code> para criar todas as pastas pai intermediárias automaticamente.',
    solucao: [{ comando: 'mkdir -p /home/ricardo/workspace/projeto1' }],
    verificar: (m) => Verificar.diretorio(m, '/home/ricardo/workspace/projeto1'),
  },
  {
    id: 'bas-2',
    enunciado: 'Crie o arquivo <code>/home/ricardo/workspace/projeto1/notas.txt</code> contendo o texto <code>Inicio dos estudos Linux</code>.',
    dica: '<b>[LPIC-1 103.4]:</b> Redirecione a saída de echo com <code>&gt;</code> para gravar o novo arquivo.',
    solucao: [{ comando: 'echo "Inicio dos estudos Linux" > /home/ricardo/workspace/projeto1/notas.txt' }],
    verificar: (m) => Verificar.contem(m, '/home/ricardo/workspace/projeto1/notas.txt', 'inicio dos estudos'),
  },
  {
    id: 'bas-3',
    enunciado: 'Anexe a linha <code>Pratica diaria no terminal</code> ao final do arquivo <code>notas.txt</code> sem apagar o texto anterior.',
    dica: '<b>[LPIC-1 103.4]:</b> O operador de append é <code>&gt;&gt;</code>.',
    solucao: [{ comando: 'echo "Pratica diaria no terminal" >> /home/ricardo/workspace/projeto1/notas.txt' }],
    verificar: (m) =>
      Verificar.contem(m, '/home/ricardo/workspace/projeto1/notas.txt', 'inicio dos estudos') &&
      Verificar.contem(m, '/home/ricardo/workspace/projeto1/notas.txt', 'pratica diaria'),
  },
  {
    id: 'bas-4',
    enunciado: 'Copie <code>notas.txt</code> para <code>/home/ricardo/workspace/notas.backup</code>.',
    dica: '<b>[LPIC-1 103.3]:</b> Utilize <code>cp /home/ricardo/workspace/projeto1/notas.txt /home/ricardo/workspace/notas.backup</code>.',
    solucao: [{ comando: 'cp /home/ricardo/workspace/projeto1/notas.txt /home/ricardo/workspace/notas.backup' }],
    verificar: (m) =>
      Verificar.arquivo(m, '/home/ricardo/workspace/notas.backup') &&
      Verificar.contem(m, '/home/ricardo/workspace/notas.backup', 'inicio dos estudos'),
  },
  {
    id: 'bas-5',
    enunciado: 'Renomeie <code>/home/ricardo/workspace/notas.backup</code> para <code>/home/ricardo/workspace/notas.old</code>.',
    dica: '<b>[LPIC-1 103.3]:</b> O comando <code>mv</code> renomeia arquivos quando o destino está na mesma pasta.',
    solucao: [{ comando: 'mv /home/ricardo/workspace/notas.backup /home/ricardo/workspace/notas.old' }],
    verificar: (m) =>
      Verificar.naoExiste(m, '/home/ricardo/workspace/notas.backup') &&
      Verificar.arquivo(m, '/home/ricardo/workspace/notas.old'),
  },
];

const desafiosMedio: Desafio[] = [
  {
    id: 'med-1',
    enunciado: 'Crie o grupo de trabalho chamado <code>suporte</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> Utilize o comando <code>groupadd suporte</code>.',
    solucao: [{ comando: 'groupadd suporte' }],
    verificar: (m) => Verificar.grupo(m, 'suporte') !== undefined,
  },
  {
    id: 'med-2',
    enunciado: 'Crie o usuário <code>carlos</code> (com home e bash), associado ao grupo suplementar <code>suporte</code>, e defina uma senha para ele.',
    dica: '<b>[LPIC-1 107.1 / RHCSA EX200]:</b> <code>useradd -m -s /bin/bash -G suporte carlos</code> e configure com <code>passwd carlos</code>.',
    solucao: [
      { comando: 'useradd -m -s /bin/bash -G suporte carlos' },
      { comando: 'passwd carlos', respostas: ['123', '123'] },
    ],
    verificar: (m) =>
      Verificar.membro(m, 'carlos', 'suporte') &&
      Verificar.diretorio(m, '/home/carlos') &&
      (Verificar.usuario(m, 'carlos')?.senha ?? null) !== null,
  },
  {
    id: 'med-3',
    enunciado: 'Crie a pasta <code>/srv/suporte</code> e configure para que pertença ao usuário <code>carlos</code> e ao grupo <code>suporte</code>.',
    dica: '<b>[LPIC-1 104.5]:</b> <code>mkdir -p /srv/suporte</code> seguido de <code>chown carlos:suporte /srv/suporte</code>.',
    solucao: [{ comando: 'mkdir -p /srv/suporte' }, { comando: 'chown carlos:suporte /srv/suporte' }],
    verificar: (m) => Verificar.dono(m, '/srv/suporte', 'carlos', 'suporte'),
  },
  {
    id: 'med-4',
    enunciado: 'Ajuste a permissão de <code>/srv/suporte</code> para <code>770</code> (acesso total para dono e grupo, nenhum para outros).',
    dica: '<b>[LPIC-1 104.5]:</b> Execute <code>chmod 770 /srv/suporte</code>.',
    solucao: [{ comando: 'chmod 770 /srv/suporte' }],
    verificar: (m) => Verificar.modo(m, '/srv/suporte', 0o770),
  },
  {
    id: 'med-5',
    enunciado: 'Crie o arquivo <code>/srv/suporte/atendimento.log</code> com permissão <code>640</code> pertencente a <code>carlos:suporte</code>.',
    dica: '<b>[LPIC-1 104.5]:</b> <code>touch</code> para criar, <code>chown carlos:suporte</code> e <code>chmod 640</code>.',
    solucao: [
      { comando: 'touch /srv/suporte/atendimento.log' },
      { comando: 'chown carlos:suporte /srv/suporte/atendimento.log' },
      { comando: 'chmod 640 /srv/suporte/atendimento.log' },
    ],
    verificar: (m) =>
      Verificar.arquivo(m, '/srv/suporte/atendimento.log') &&
      Verificar.dono(m, '/srv/suporte/atendimento.log', 'carlos', 'suporte') &&
      Verificar.modo(m, '/srv/suporte/atendimento.log', 0o640),
  },
];

const desafiosAvancado: Desafio[] = [
  {
    id: 'av-1',
    enunciado: 'Atualize os repositórios com <code>apt update</code> e instale o servidor web <code>nginx</code>.',
    dica: '<b>[LPIC-1 102.4 / 108.1]:</b> Execute <code>apt update</code> e depois <code>apt install -y nginx</code>.',
    solucao: [{ comando: 'apt update' }, { comando: 'apt install -y nginx' }],
    verificar: (m) => new Servicos(m).ativo('nginx'),
  },
  {
    id: 'av-2',
    enunciado: 'Configure a página web padrão em <code>/var/www/html/index.html</code> para exibir <code>Servidor Avancado Pronto</code>.',
    dica: '<b>[LPIC-1 103.4]:</b> Redirecione a mensagem com <code>echo "Servidor Avancado Pronto" &gt; /var/www/html/index.html</code>.',
    solucao: [{ comando: 'echo "Servidor Avancado Pronto" > /var/www/html/index.html' }],
    verificar: (m) => Verificar.contem(m, '/var/www/html/index.html', 'Servidor Avancado Pronto'),
  },
  {
    id: 'av-3',
    enunciado: 'Crie o diretório compartilhado <code>/srv/upload</code> com Sticky Bit (<code>1777</code>).',
    dica: '<b>[LPIC-1 104.5]:</b> <code>mkdir -p /srv/upload</code> e <code>chmod 1777 /srv/upload</code>.',
    solucao: [{ comando: 'mkdir -p /srv/upload' }, { comando: 'chmod 1777 /srv/upload' }],
    verificar: (m) => Verificar.no(m, '/srv/upload')?.modo === 0o1777,
  },
  {
    id: 'av-4',
    enunciado: 'Crie o script <code>/usr/local/bin/status-rede.sh</code> com permissão de execução <code>755</code> contendo a linha <code>ip route</code>.',
    dica: '<b>[LPIC-1 103.3 / 104.5]:</b> Grave com echo, aplique <code>chmod 755</code> e teste.',
    solucao: [
      { comando: 'echo "ip route" > /usr/local/bin/status-rede.sh' },
      { comando: 'chmod 755 /usr/local/bin/status-rede.sh' },
    ],
    verificar: (m) =>
      Verificar.modo(m, '/usr/local/bin/status-rede.sh', 0o755) &&
      Verificar.contem(m, '/usr/local/bin/status-rede.sh', 'ip route'),
  },
  {
    id: 'av-5',
    enunciado: 'Crie um link simbólico <code>/srv/upload/site</code> apontando para o diretório <code>/var/www/html</code>.',
    dica: '<b>[LPIC-1 104.6]:</b> A sintaxe é <code>ln -s ALVO NOME_DO_LINK</code>.',
    solucao: [{ comando: 'ln -s /var/www/html /srv/upload/site' }],
    verificar: (m) => Verificar.link(m, '/srv/upload/site'),
  },
];

const desafiosEssentials: Desafio[] = [
  {
    id: 'lpi-ess-1',
    enunciado: 'Crie o arquivo de ambiente oculto <code>/home/ricardo/.bash_custom</code> contendo a linha <code>export PROVA="Linux Essentials"</code>.',
    dica: '<b>[LPI Linux Essentials 2.4]:</b> Arquivos que começam com ponto são ocultos por padrão. Crie com redirecionamento <code>&gt;</code>.',
    solucao: [{ comando: 'echo \'export PROVA="Linux Essentials"\' > /home/ricardo/.bash_custom' }],
    verificar: (m) =>
      Verificar.arquivo(m, '/home/ricardo/.bash_custom') &&
      Verificar.contem(m, '/home/ricardo/.bash_custom', 'Linux Essentials'),
  },
  {
    id: 'lpi-ess-2',
    enunciado: 'Respeitando o padrão FHS para dados variáveis, crie o arquivo de log <code>/var/log/app-monitor.log</code>.',
    dica: '<b>[LPI Linux Essentials 4.3 / FHS]:</b> O diretório <code>/var/log</code> guarda os registros de eventos do sistema.',
    solucao: [{ comando: 'touch /var/log/app-monitor.log' }],
    verificar: (m) => Verificar.arquivo(m, '/var/log/app-monitor.log'),
  },
  {
    id: 'lpi-ess-3',
    enunciado: 'Crie o diretório <code>/tmp/lpi-lab</code> com permissão <code>755</code> (rwxr-xr-x).',
    dica: '<b>[LPI Linux Essentials 5.3]:</b> Crie a pasta e aplique <code>chmod 755 /tmp/lpi-lab</code>.',
    solucao: [{ comando: 'mkdir -p /tmp/lpi-lab' }, { comando: 'chmod 755 /tmp/lpi-lab' }],
    verificar: (m) => Verificar.diretorio(m, '/tmp/lpi-lab') && Verificar.modo(m, '/tmp/lpi-lab', 0o755),
  },
  {
    id: 'lpi-ess-4',
    enunciado: 'Grave a contagem de linhas do arquivo <code>/etc/passwd</code> dentro de <code>/tmp/lpi-lab/total-contas.txt</code>.',
    dica: '<b>[LPI Linux Essentials 3.2]:</b> Combine <code>wc -l /etc/passwd &gt; /tmp/lpi-lab/total-contas.txt</code>.',
    solucao: [{ comando: 'wc -l /etc/passwd > /tmp/lpi-lab/total-contas.txt' }],
    verificar: (m) =>
      Verificar.arquivo(m, '/tmp/lpi-lab/total-contas.txt') &&
      (Verificar.conteudo(m, '/tmp/lpi-lab/total-contas.txt') ?? '').trim().length > 0,
  },
];

const desafiosLPIC1: Desafio[] = [
  {
    id: 'lpic-1',
    enunciado: 'Atualize os índices locais do repositório e instale todas as atualizações de segurança disponíveis.',
    dica: '<b>[LPIC-1 102.4]:</b> Execute <code>apt update</code> seguido de <code>apt upgrade -y</code>.',
    solucao: [{ comando: 'apt update' }, { comando: 'apt upgrade -y' }],
    verificar: (m) => {
      const g = new GerenciadorDePacotes(m);
      return g.listasAtualizadas() && g.atualizaveis().length === 0;
    },
  },
  {
    id: 'lpic-2',
    enunciado: 'Crie uma conta de serviço para o sistema chamada <code>deploybot</code> com diretório home e shell restrito <code>/usr/sbin/nologin</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> A opção <code>-s</code> define o shell de login: <code>useradd -m -s /usr/sbin/nologin deploybot</code>.',
    solucao: [{ comando: 'useradd -m -s /usr/sbin/nologin deploybot' }],
    verificar: (m) =>
      Verificar.usuario(m, 'deploybot')?.shell === '/usr/sbin/nologin' &&
      Verificar.diretorio(m, '/home/deploybot'),
  },
  {
    id: 'lpic-3',
    enunciado: 'Crie o atalho simbólico <code>/usr/local/bin/srv-web</code> apontando para o binário <code>/usr/sbin/nginx</code>.',
    dica: '<b>[LPIC-1 104.6]:</b> Crie links com <code>ln -s /usr/sbin/nginx /usr/local/bin/srv-web</code>.',
    solucao: [{ comando: 'ln -s /usr/sbin/nginx /usr/local/bin/srv-web' }],
    verificar: (m) => Verificar.link(m, '/usr/local/bin/srv-web'),
  },
  {
    id: 'lpic-4',
    enunciado: 'Conceda privilégios de superusuário a <code>ricardo</code> adicionando-o ao grupo <code>sudo</code> sem retirá-lo de outros grupos.',
    dica: '<b>[LPIC-1 107.1]:</b> A combinação obrigatória é <code>usermod -aG sudo ricardo</code>.',
    solucao: [{ comando: 'usermod -aG sudo ricardo' }],
    verificar: (m) => Verificar.membro(m, 'ricardo', 'sudo'),
  },
  {
    id: 'lpic-5',
    enunciado: 'Remova completamente o usuário de serviço <code>deploybot</code> e apague também sua pasta <code>/home/deploybot</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> A opção <code>-r</code> (remove home) é mandatória: <code>userdel -r deploybot</code>.',
    solucao: [{ comando: 'userdel -r deploybot' }],
    verificar: (m) => Verificar.usuario(m, 'deploybot') === undefined && Verificar.naoExiste(m, '/home/deploybot'),
  },
];

const desafiosEscola: Desafio[] = [
  {
    id: 'sim-1',
    enunciado: 'Crie a estrutura <code>/srv/escola/docs</code>, <code>/srv/escola/scripts</code> e <code>/srv/escola/publico</code>.',
    dica: '<b>[LPIC-1 103.3]:</b> <code>mkdir -p</code> aceita vários caminhos no mesmo comando e cria as pastas pai intermediárias.',
    solucao: [{ comando: 'mkdir -p /srv/escola/docs /srv/escola/scripts /srv/escola/publico' }],
    verificar: (m) => ['docs', 'scripts', 'publico'].every((p: string) => Verificar.diretorio(m, '/srv/escola/' + p)),
  },
  {
    id: 'sim-2',
    enunciado: 'Crie <code>/srv/escola/docs/regras.txt</code> com duas linhas: <code>Prova de Linux</code> e <code>Sem consulta</code>.',
    dica: '<b>[LPIC-1 103.4]:</b> Redirecione a primeira linha com <code>&gt;</code> para criar o arquivo, e anexe a segunda com <code>&gt;&gt;</code>.',
    solucao: [
      { comando: 'echo "Prova de Linux" > /srv/escola/docs/regras.txt' },
      { comando: 'echo "Sem consulta" >> /srv/escola/docs/regras.txt' },
    ],
    verificar: (m) => {
      const linhas: string[] = (Verificar.conteudo(m, '/srv/escola/docs/regras.txt') ?? '').trim().split('\n');
      return linhas.length === 2 && linhas[0].trim() === 'Prova de Linux' && linhas[1].trim() === 'Sem consulta';
    },
  },
  {
    id: 'sim-3',
    enunciado: 'Crie o grupo <code>professores</code> e o grupo <code>alunos</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> <code>groupadd</code>, um comando por grupo.',
    solucao: [{ comando: 'groupadd professores' }, { comando: 'groupadd alunos' }],
    verificar: (m) => Verificar.grupo(m, 'professores') !== undefined && Verificar.grupo(m, 'alunos') !== undefined,
  },
  {
    id: 'sim-4',
    enunciado: 'Crie a usuária <code>sediane</code> (com home e bash), no grupo <code>professores</code>, com senha definida.',
    dica: '<b>[LPIC-1 107.1 / RHCSA EX200]:</b> <code>useradd -m -s /bin/bash -G professores sediane</code> e defina a senha com <code>passwd sediane</code>.',
    solucao: [
      { comando: 'useradd -m -s /bin/bash -G professores sediane' },
      { comando: 'passwd sediane', respostas: ['123', '123'] },
    ],
    verificar: (m) =>
      Verificar.membro(m, 'sediane', 'professores') &&
      Verificar.diretorio(m, '/home/sediane') &&
      (Verificar.usuario(m, 'sediane')?.senha ?? null) !== null,
  },
  {
    id: 'sim-5',
    enunciado: 'Crie os usuários <code>ana</code> e <code>beto</code> (com home e bash), ambos no grupo <code>alunos</code>, com senha.',
    dica: '<b>[LPIC-1 107.1]:</b> Repita o procedimento do item anterior usando <code>-G alunos</code> para ambos e definindo as senhas.',
    solucao: [
      { comando: 'useradd -m -s /bin/bash -G alunos ana' },
      { comando: 'passwd ana', respostas: ['123', '123'] },
      { comando: 'useradd -m -s /bin/bash -G alunos beto' },
      { comando: 'passwd beto', respostas: ['123', '123'] },
    ],
    verificar: (m) =>
      ['ana', 'beto'].every(
        (u: string) =>
          Verificar.membro(m, u, 'alunos') &&
          Verificar.diretorio(m, '/home/' + u) &&
          (Verificar.usuario(m, u)?.senha ?? null) !== null,
      ),
  },
  {
    id: 'sim-6',
    enunciado: 'A pasta <code>/srv/escola/docs</code> deve pertencer à <code>sediane</code> e ao grupo <code>professores</code>, com acesso total para dono e grupo e <b>nenhum</b> para os outros.',
    dica: '<b>[LPIC-1 104.5 / RHCSA EX200]:</b> <code>chown -R sediane:professores /srv/escola/docs</code> e <code>chmod 770 /srv/escola/docs</code>.',
    solucao: [
      { comando: 'chown -R sediane:professores /srv/escola/docs' },
      { comando: 'chmod 770 /srv/escola/docs' },
    ],
    verificar: (m) =>
      Verificar.dono(m, '/srv/escola/docs', 'sediane', 'professores') &&
      Verificar.modo(m, '/srv/escola/docs', 0o770),
  },
  {
    id: 'sim-7',
    enunciado: 'Crie o script <code>/srv/escola/scripts/boasvindas.sh</code> com a linha <code>echo Bem-vindo</code> e deixe-o com permissão <code>755</code>. Rode-o com <code>./</code>.',
    dica: '<b>[LPIC-1 103.3 / 104.5]:</b> <code>echo "echo Bem-vindo" &gt; arquivo</code>, torne executável com <code>chmod 755</code> e chame pelo caminho.',
    solucao: [
      { comando: 'echo "echo Bem-vindo" > /srv/escola/scripts/boasvindas.sh' },
      { comando: 'chmod 755 /srv/escola/scripts/boasvindas.sh' },
      { comando: '/srv/escola/scripts/boasvindas.sh' },
    ],
    verificar: (m) =>
      Verificar.modo(m, '/srv/escola/scripts/boasvindas.sh', 0o755) &&
      Verificar.contem(m, '/srv/escola/scripts/boasvindas.sh', 'echo'),
  },
  {
    id: 'sim-8',
    enunciado: 'Em <code>/srv/escola/publico</code> todos devem poder criar arquivos, mas ninguém pode apagar o arquivo de outra pessoa.',
    dica: '<b>[LPIC-1 104.5 / 104.6]:</b> Aplique o Sticky Bit: <code>chmod 1777 /srv/escola/publico</code>.',
    solucao: [{ comando: 'chmod 1777 /srv/escola/publico' }],
    verificar: (m) => Verificar.no(m, '/srv/escola/publico')?.modo === 0o1777,
  },
  {
    id: 'sim-9',
    enunciado: 'Logada como <code>ana</code> em outro terminal, crie <code>/srv/escola/publico/trabalho-ana.txt</code>. Depois confirme que ela <b>não</b> consegue ler <code>/srv/escola/docs</code>.',
    dica: '<b>[LPIC-1 104.5]:</b> Abra o terminal 2 (＋), faça login como ana, use <code>touch</code> em publico e comprove o "Permissão negada" em docs.',
    solucao: [
      { comando: 'touch /srv/escola/publico/trabalho-ana.txt', terminal: 2, login: { usuario: 'ana', senha: '123' } },
      { comando: 'ls /srv/escola/docs', terminal: 2 },
    ],
    verificar: (m) => Verificar.dono(m, '/srv/escola/publico/trabalho-ana.txt', 'ana'),
  },
  {
    id: 'sim-10',
    enunciado: 'Copie <code>regras.txt</code> para a home da <code>ana</code> e faça com que ela seja a dona da cópia.',
    dica: '<b>[LPIC-1 103.3 / 104.5]:</b> <code>cp /srv/escola/docs/regras.txt /home/ana/</code> e depois ajuste a posse com <code>chown ana:ana /home/ana/regras.txt</code>.',
    solucao: [
      { comando: 'cp /srv/escola/docs/regras.txt /home/ana/' },
      { comando: 'chown ana:ana /home/ana/regras.txt' },
    ],
    verificar: (m) =>
      Verificar.dono(m, '/home/ana/regras.txt', 'ana') &&
      Verificar.contem(m, '/home/ana/regras.txt', 'Prova de Linux'),
  },
  {
    id: 'sim-apt-1',
    enunciado: 'Atualize a lista de pacotes e instale as atualizações pendentes do servidor.',
    dica: '<b>[LPIC-1 102.4]:</b> Execute <code>apt update</code> seguido de <code>apt upgrade -y</code>.',
    solucao: [{ comando: 'apt update' }, { comando: 'apt upgrade -y' }],
    verificar: (m) => {
      const g = new GerenciadorDePacotes(m);
      return g.listasAtualizadas() && g.atualizaveis().length === 0;
    },
  },
  {
    id: 'sim-apt-2',
    enunciado: 'Instale o servidor web <code>nginx</code> e faça a página inicial (<code>/var/www/html/index.html</code>) mostrar <code>Escola Linux</code>. O serviço precisa estar rodando.',
    dica: '<b>[LPIC-1 108.1 / CompTIA Linux+]:</b> <code>apt install -y nginx</code>, grave a página com <code>echo ... &gt; ...</code> e valide com <code>curl localhost</code>.',
    solucao: [
      { comando: 'apt install -y nginx' },
      { comando: 'echo "Escola Linux" > /var/www/html/index.html' },
      { comando: 'curl localhost' },
    ],
    verificar: (m) => new Servicos(m).ativo('nginx') && Verificar.contem(m, '/var/www/html/index.html', 'Escola Linux'),
  },
  {
    id: 'sim-11',
    enunciado: 'O <code>beto</code> trancou o curso: remova o usuário e a pasta pessoal dele.',
    dica: '<b>[LPIC-1 107.1]:</b> Utilize <code>userdel -r beto</code> para expurgar a conta e o diretório /home.',
    solucao: [{ comando: 'userdel -r beto' }],
    verificar: (m) =>
      Verificar.usuario(m, 'ana') !== undefined &&
      Verificar.usuario(m, 'beto') === undefined &&
      Verificar.naoExiste(m, '/home/beto'),
  },
  {
    id: 'sim-12',
    enunciado: 'Por fim, apague a pasta <code>/srv/escola/scripts</code> inteira.',
    dica: '<b>[LPIC-1 103.3]:</b> Remoção recursiva de diretórios com conteúdo: <code>rm -r /srv/escola/scripts</code>.',
    solucao: [{ comando: 'rm -r /srv/escola/scripts' }],
    verificar: (m) =>
      Verificar.naoExiste(m, '/srv/escola/scripts') &&
      Verificar.diretorio(m, '/srv/escola/docs'),
  },
];

const modalidades: ModalidadeSimulado[] = [
  {
    id: 'basico',
    titulo: 'Linux Básico',
    icone: '🟢',
    badge: 'Fundamentos',
    descricao: 'Navegação por caminhos, criação de pastas aninhadas, manipulação, cópia e redirecionamento de arquivos.',
    desafios: desafiosBasico,
  },
  {
    id: 'medio',
    titulo: 'Linux Médio',
    icone: '🟡',
    badge: 'Intermediário',
    descricao: 'Administração de contas de usuários, grupos secundários, posse com chown e permissões com chmod (770, 640).',
    desafios: desafiosMedio,
  },
  {
    id: 'avancado',
    titulo: 'Linux Avançado',
    icone: '🔴',
    badge: 'Avançado',
    descricao: 'Instalação de pacotes com apt, gestão de serviços com systemctl, Sticky Bit 1777 e links simbólicos.',
    desafios: desafiosAvancado,
  },
  {
    id: 'essentials',
    titulo: 'LPI Essentials',
    icone: '🏅',
    badge: '010-160',
    descricao: 'Cenários práticos no formato do exame oficial LPI Linux Essentials: padrão FHS, arquivos ocultos e filtros.',
    desafios: desafiosEssentials,
  },
  {
    id: 'lpic1',
    titulo: 'LPIC-1',
    icone: '🏆',
    badge: '101 e 102',
    descricao: 'Desafios no padrão das provas LPIC-1 e CompTIA Linux+: contas de serviço /sbin/nologin, links e userdel -r.',
    desafios: desafiosLPIC1,
  },
  {
    id: 'escola',
    titulo: 'Servidor Escola',
    icone: '🏫',
    badge: 'Cenário Integrado',
    descricao: 'Laboratório completo de infraestrutura escolar: 14 tarefas encadeadas cobrindo todos os tópicos do exame.',
    desafios: desafiosEscola,
  },
  {
    id: 'quiz',
    titulo: 'Quiz Certificação',
    icone: '📝',
    badge: 'Teórico · 10 Questões',
    descricao: 'Questões de múltipla escolha oficiais de certificações (Linux Essentials e LPIC-1) com gabarito comentado.',
    questoes: questoesCertificacao,
  },
];

/** 09 · Simulado: tarefas encadeadas no estilo da prova prática, misturando todos os tópicos. */
export const simulado: Topico = {
  id: 'simulado',
  numero: 9,
  titulo: 'Simulados de Certificação',
  subtitulo: 'Prática por níveis e simulados oficiais LPI Linux Essentials, LPIC-1 e Quiz',
  icone: '📝',
  cor: '--cor-sim',
  resumo: 'Simulados práticos por níveis (Básico, Médio e Avançado), exames oficiais (LPI Essentials e LPIC-1), cenário integrado de servidor e questionários teóricos com gabarito imediato.',
  conceitos: '',

  preparar(): void {
    // servidor limpo: só root e ricardo
  },

  licoes: [],
  desafios: desafiosEscola,
  modalidades,
};
