import type { Desafio, ModalidadeSimulado, QuestaoQuiz, Topico } from './Topico';
import { Verificar } from './Verificar';
import { GerenciadorDePacotes, Servicos } from '../linux/Pacotes';

/**
 * Sorteia 10 questões de forma equilibrada a partir do banco de 30 questões:
 * - 4 Fáceis
 * - 3 Médias
 * - 3 Difíceis
 * Retornadas em ordem progressiva de dificuldade (Fácil -> Médio -> Difícil).
 */
export function sortearQuestoesExame<T extends { nivel?: 'facil' | 'medio' | 'dificil' }>(
  banco: T[],
  total: number = 10,
): T[] {
  if (banco.length <= total) {
    return [...banco];
  }

  const faceis = banco.filter((q) => q.nivel === 'facil');
  const medias = banco.filter((q) => q.nivel === 'medio');
  const dificeis = banco.filter((q) => q.nivel === 'dificil');

  const embaralhar = <Item>(lista: Item[]): Item[] => {
    const copia = [...lista];
    for (let i = copia.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
  };

  if (faceis.length >= 4 && medias.length >= 3 && dificeis.length >= 3) {
    const selecionadasFacil = embaralhar(faceis).slice(0, 4);
    const selecionadasMedio = embaralhar(medias).slice(0, 3);
    const selecionadasDificil = embaralhar(dificeis).slice(0, 3);
    return [...selecionadasFacil, ...selecionadasMedio, ...selecionadasDificil];
  }

  return embaralhar(banco).slice(0, total);
}

// ============================================================================
// 1. QUIZ CERTIFICAÇÃO (30 Questões Teóricas: 10 Fáceis, 10 Médias, 10 Difíceis)
// ============================================================================
export const questoesCertificacao: QuestaoQuiz[] = [
  // --- FÁCIL (1..10) ---
  {
    id: 'quiz-fac-1',
    nivel: 'facil',
    certificacao: 'LPI Linux Essentials 1.1 / LPIC-1 101.1',
    pergunta: 'Qual componente é o núcleo central do sistema operacional responsável por gerenciar a memória, o escalonamento de processos e a comunicação com o hardware?',
    opcoes: ['Bash Shell', 'Kernel Linux', 'GNU Coreutils', 'Systemd'],
    correta: 1,
    explicacao: 'O Kernel Linux é o núcleo do sistema operacional. O Bash é o interpretador de comandos (shell), o GNU Coreutils fornece utilitários de espaço do usuário e o Systemd gerencia serviços e inicialização.',
  },
  {
    id: 'quiz-fac-2',
    nivel: 'facil',
    certificacao: 'LPIC-1 103.3 / Linux Essentials 2.4',
    pergunta: 'Qual comando deve ser utilizado para remover um diretório não vazio e todo o seu conteúdo recursivamente sem pedir confirmação individual?',
    opcoes: ['rmdir -r pasta', 'rm -rf pasta', 'del /s pasta', 'rmdir --force pasta'],
    correta: 1,
    explicacao: 'O comando <code>rm -rf</code> (recursive + force) remove diretórios e arquivos recursivamente. O comando <code>rmdir</code> aceita remover apenas diretórios que já estejam totalmente vazios.',
  },
  {
    id: 'quiz-fac-3',
    nivel: 'facil',
    certificacao: 'LPIC-1 104.5 / Linux Essentials 5.3',
    pergunta: 'Qual representação numérica octal corresponde exatamente às permissões <code>rwxr-xr--</code>?',
    opcoes: ['754', '751', '644', '775'],
    correta: 0,
    explicacao: 'Cálculo octal (r=4, w=2, x=1): Dono: rwx = 4+2+1 = 7. Grupo: r-x = 4+0+1 = 5. Outros: r-- = 4+0+0 = 4. Portanto: 754.',
  },
  {
    id: 'quiz-fac-4',
    nivel: 'facil',
    certificacao: 'LPI Linux Essentials 4.3 / LPIC-1 104.7',
    pergunta: 'De acordo com o padrão FHS (Filesystem Hierarchy Standard), qual diretório é destinado a armazenar arquivos de configuração específicos do host?',
    opcoes: ['/var', '/usr', '/etc', '/opt'],
    correta: 2,
    explicacao: 'O diretório <code>/etc</code> é reservado exclusivamente para configurações do sistema e serviços. O <code>/var</code> armazena dados variáveis (logs, spools) e o <code>/usr</code> armazena programas e bibliotecas.',
  },
  {
    id: 'quiz-fac-5',
    nivel: 'facil',
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
    id: 'quiz-fac-6',
    nivel: 'facil',
    certificacao: 'LPIC-1 103.3 / Linux Essentials 2.2',
    pergunta: 'Qual comando deve ser utilizado para criar uma estrutura de diretórios aninhada como <code>projeto/src/main</code> em uma única execução, criando os diretórios pai intermediários?',
    opcoes: ['mkdir -p projeto/src/main', 'mkdir -r projeto/src/main', 'mkdir --all projeto/src/main', 'mkdir -f projeto/src/main'],
    correta: 0,
    explicacao: 'A opção <code>-p</code> (parents) do comando <code>mkdir</code> instrui o sistema a criar todas as pastas intermediárias ausentes sem retornar erro.',
  },
  {
    id: 'quiz-fac-7',
    nivel: 'facil',
    certificacao: 'LPI Linux Essentials 4.1',
    pergunta: 'Qual é o diretório pessoal (home) padrão do superusuário (root) na maioria das distribuições Linux?',
    opcoes: ['/home/root', '/root', '/usr/root', '/var/root'],
    correta: 1,
    explicacao: 'O diretório do superusuário é <code>/root</code>, localizado na partição raiz para que o administrador possa fazer manutenção mesmo se a partição <code>/home</code> não estiver montada.',
  },
  {
    id: 'quiz-fac-8',
    nivel: 'facil',
    certificacao: 'Linux Essentials 2.1 / LPIC-1 103.1',
    pergunta: 'Qual comando exibe o caminho absoluto do diretório de trabalho atual no terminal?',
    opcoes: ['whereami', 'dir', 'pwd', 'path'],
    correta: 2,
    explicacao: 'O comando <code>pwd</code> (Print Working Directory) exibe o caminho absoluto completo do diretório onde o terminal está posicionado atualmente.',
  },
  {
    id: 'quiz-fac-9',
    nivel: 'facil',
    certificacao: 'Linux Essentials 1.3 / LPIC-1 103.1',
    pergunta: 'Qual utilitário é utilizado para consultar os manuais e a documentação oficial dos comandos diretamente no terminal?',
    opcoes: ['help', 'man', 'doc', 'info-linux'],
    correta: 1,
    explicacao: 'O utilitário <code>man</code> (Manual Pages) é a documentação canônica dos sistemas Unix e Linux. Exemplo: <code>man ls</code>.',
  },
  {
    id: 'quiz-fac-10',
    nivel: 'facil',
    certificacao: 'Linux Essentials 2.2 / LPIC-1 103.3',
    pergunta: 'Qual caractere no início do nome de um arquivo ou diretório faz com que ele seja considerado oculto pelo comando <code>ls</code>?',
    opcoes: ['_ (sublinhado)', '. (ponto)', '# (cerquilha)', '$ (cifrão)'],
    correta: 1,
    explicacao: 'Arquivos cujo nome se inicia com um ponto (como <code>.bashrc</code>) são tratados como arquivos ocultos e requerem a opção <code>-a</code> no <code>ls</code> para serem listados.',
  },

  // --- MÉDIO (11..20) ---
  {
    id: 'quiz-med-1',
    nivel: 'medio',
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
    id: 'quiz-med-2',
    nivel: 'medio',
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
    id: 'quiz-med-3',
    nivel: 'medio',
    certificacao: 'LPIC-1 102.4',
    pergunta: 'Em sistemas baseados em Debian e Ubuntu, qual comando deve ser usado para desinstalar um pacote removendo também todos os seus arquivos de configuração do sistema?',
    opcoes: ['apt remove pacote', 'apt purge pacote', 'apt clean pacote', 'dpkg -r pacote'],
    correta: 1,
    explicacao: 'O <code>apt remove</code> apaga os binários mas mantém as configurações em <code>/etc</code>. O <code>apt purge</code> (ou <code>dpkg -P</code>) remove o pacote e expurga todos os arquivos de configuração.',
  },
  {
    id: 'quiz-med-4',
    nivel: 'medio',
    certificacao: 'LPIC-1 107.1 / RHCSA EX200',
    pergunta: 'Qual comando adiciona o usuário "joao" ao grupo suplementar "docker" MANTENDO todos os outros grupos secundários dos quais ele já é membro?',
    opcoes: ['usermod -G docker joao', 'usermod -aG docker joao', 'groupadd -u joao docker', 'chown joao:docker'],
    correta: 1,
    explicacao: 'A flag <code>-a</code> (append) acompanhada de <code>-G</code> é obrigatória. Executar <code>usermod -G docker joao</code> sem o <code>-a</code> remove o usuário de todos os demais grupos secundários!',
  },
  {
    id: 'quiz-med-5',
    nivel: 'medio',
    certificacao: 'LPIC-1 107.1',
    pergunta: 'Qual comando deve ser utilizado para excluir uma conta de usuário e automaticamente apagar o seu diretório pessoal (/home/usuario) e sua caixa de correio?',
    opcoes: ['userdel usuario', 'userdel -r usuario', 'rmuser -f usuario', 'deluser --clean usuario'],
    correta: 1,
    explicacao: 'O comando <code>userdel -r</code> (remove) deleta a conta em <code>/etc/passwd</code> e expurga conjuntamente a pasta home do usuário e o spool de e-mails.',
  },
  {
    id: 'quiz-med-6',
    nivel: 'medio',
    certificacao: 'LPIC-1 104.5',
    pergunta: 'Se a máscara de permissões (umask) de um usuário estiver definida como <code>022</code>, qual será a permissão octal padrão de um NOVO ARQUIVO criado por ele?',
    opcoes: ['755', '644', '666', '777'],
    correta: 1,
    explicacao: 'Arquivos comuns partem da base 666 (sem bit de execução). Subtraindo 022 da umask: 666 - 022 = 644 (rw-r--r--). Diretórios partem de 777 e ficariam com 755.',
  },
  {
    id: 'quiz-med-7',
    nivel: 'medio',
    certificacao: 'LPIC-1 103.5',
    pergunta: 'Qual sinal padrão do sistema é enviado pelo comando <code>kill &lt;PID&gt;</code> quando nenhum sinal específico é passado como argumento?',
    opcoes: ['SIGKILL (9)', 'SIGTERM (15)', 'SIGHUP (1)', 'SIGSTOP (19)'],
    correta: 1,
    explicacao: 'O comando <code>kill</code> envia por padrão o sinal <code>SIGTERM (15)</code>, permitindo que o processo faça limpeza de recursos e termine ordenadamente. O <code>SIGKILL (9)</code> só é enviado se for explícito.',
  },
  {
    id: 'quiz-med-8',
    nivel: 'medio',
    certificacao: 'LPIC-1 104.6',
    pergunta: 'Qual das alternativas descreve corretamente a diferença entre um link simbólico (soft link) e um link físico (hard link)?',
    opcoes: [
      'Links simbólicos apontam para o mesmo número de inode; hard links criam um novo inode',
      'Hard links apontam diretamente para o inode original; links simbólicos contêm apenas o caminho textual do arquivo alvo',
      'Hard links podem cruzar partições e sistemas de arquivos diferentes livremente',
      'Se o arquivo original for excluído, o hard link deixa de funcionar imediatamente',
    ],
    correta: 1,
    explicacao: 'Hard links são entradas de diretório adicionais apontando para o mesmo inode (não podem cruzar partições). Soft links contêm o caminho do alvo em um novo inode.',
  },
  {
    id: 'quiz-med-9',
    nivel: 'medio',
    certificacao: 'LPIC-1 109.1 / CompTIA Linux+',
    pergunta: 'Qual comando moderno é o substituto recomendado do netstat para inspecionar portas TCP abertas e conexões de rede em modo numérico?',
    opcoes: ['ss -tuln', 'ip link show', 'ping -a', 'route -n'],
    correta: 0,
    explicacao: 'O utilitário <code>ss</code> (Socket Statistics) é o padrão moderno do pacote iproute2. As flags <code>-tuln</code> listam sockets TCP (t), UDP (u), Listening (l) e numéricos (n).',
  },
  {
    id: 'quiz-med-10',
    nivel: 'medio',
    certificacao: 'LPIC-1 102.4',
    pergunta: 'Em distribuições Debian e Ubuntu, qual arquivo principal contém as URLs e linhas dos repositórios oficiais utilizados pelo APT?',
    opcoes: ['/etc/apt/apt.conf', '/etc/apt/sources.list', '/var/lib/apt/lists', '/etc/dpkg/dpkg.cfg'],
    correta: 1,
    explicacao: 'Os repositórios oficiais são configurados no arquivo <code>/etc/apt/sources.list</code> e no diretório complementar <code>/etc/apt/sources.list.d/</code>.',
  },

  // --- DIFÍCIL (21..30) ---
  {
    id: 'quiz-dif-1',
    nivel: 'dificil',
    certificacao: 'LPIC-1 104.5 / RHCSA EX200',
    pergunta: 'Qual é a finalidade do bit especial SGID (Set Group ID, valor octal 2xxx) quando configurado em um DIRETÓRIO compartilhado?',
    opcoes: [
      'Garante que apenas o dono do diretório possa excluir arquivos existentes',
      'Faz com que todos os novos arquivos criados dentro dele herdem automaticamente o grupo do diretório, e não o grupo primário do usuário',
      'Impede que usuários comuns alterem permissões de arquivos na pasta',
      'Concede privilégios de root para qualquer executável contido no diretório',
    ],
    correta: 1,
    explicacao: 'Quando o SGID é aplicado a um diretório (ex.: <code>chmod 2775 /pasta</code>), qualquer arquivo novo criado herda automaticamente o grupo proprietário da pasta, facilitando o trabalho em equipe.',
  },
  {
    id: 'quiz-dif-2',
    nivel: 'dificil',
    certificacao: 'LPIC-1 101.3 / Linux Essentials 4.2',
    pergunta: 'Qual processo recebe o PID (Process ID) 1 após o Kernel Linux ser carregado na memória e assume o papel de pai de todos os outros processos?',
    opcoes: ['kthreadd', 'bash', 'systemd (ou init)', 'udevd'],
    correta: 2,
    explicacao: 'O <code>systemd</code> (ou init nos sistemas legados) é o primeiro processo criado no espaço do usuário e sempre recebe o <code>PID 1</code>.',
  },
  {
    id: 'quiz-dif-3',
    nivel: 'dificil',
    certificacao: 'LPIC-1 103.4',
    pergunta: 'Qual número de descritor de arquivo (file descriptor) corresponde à saída de erro padrão (stderr) no ambiente Linux?',
    opcoes: ['0', '1', '2', '3'],
    correta: 2,
    explicacao: 'Os 3 descritores padrão são: 0 para stdin (entrada padrão), 1 para stdout (saída padrão) e 2 para stderr (saída de erros). Exemplo: <code>2&gt; /dev/null</code>.',
  },
  {
    id: 'quiz-dif-4',
    nivel: 'dificil',
    certificacao: 'LPIC-1 103.4',
    pergunta: 'Qual utilitário recebe dados da entrada padrão (stdin) e é capaz de enviar a saída para a tela e simultaneamente gravá-la em um ou mais arquivos?',
    opcoes: ['pipe', 'split', 'tee', 'echo'],
    correta: 2,
    explicacao: 'O comando <code>tee</code> (em forma de T) duplica o fluxo: escreve tanto na saída padrão (terminal) quanto em arquivos indicados. Exemplo: <code>ls | tee log.txt</code>.',
  },
  {
    id: 'quiz-dif-5',
    nivel: 'dificil',
    certificacao: 'LPIC-1 107.3 / CompTIA Linux+',
    pergunta: 'Em qual arquivo de configuração são estabelecidos os limites de recursos do sistema por usuário ou grupo, tais como número máximo de processos (nproc) e arquivos abertos (nofile)?',
    opcoes: ['/etc/security/limits.conf', '/etc/sysctl.conf', '/etc/profile', '/etc/login.defs'],
    correta: 0,
    explicacao: 'O arquivo <code>/etc/security/limits.conf</code> (módulo PAM pam_limits) define restrições soft e hard de recursos do sistema por usuário ou grupo.',
  },
  {
    id: 'quiz-dif-6',
    nivel: 'dificil',
    certificacao: 'LPIC-1 104.7',
    pergunta: 'Qual comando deve ser executado para indexar o sistema de arquivos e atualizar a base de dados consultada pelo comando <code>locate</code>?',
    opcoes: ['find -u', 'reindex-db', 'updatedb', 'mklocaledb'],
    correta: 2,
    explicacao: 'O comando <code>updatedb</code> percorre o sistema de arquivos e atualiza a base de dados do <code>locate</code> (geralmente executado via cron ou timer do systemd).',
  },
  {
    id: 'quiz-dif-7',
    nivel: 'dificil',
    certificacao: 'LPIC-1 105.2 / Linux Essentials 2.4',
    pergunta: 'Qual é a principal diferença entre executar um script Bash com <code>./script.sh</code> e com <code>source script.sh</code> (ou <code>. script.sh</code>)?',
    opcoes: [
      './script.sh roda mais rápido que source',
      './script.sh executa em um subshell separado, enquanto source executa no contexto do shell pai atual, retendo alterações de variáveis',
      'source requer permissão de execução (+x), enquanto ./script.sh não requer',
      'source só funciona com scripts compilados em binário C',
    ],
    correta: 1,
    explicacao: 'Ao executar <code>./script.sh</code> um novo subshell é gerado. Com <code>source script.sh</code> (ou <code>. script.sh</code>), as variáveis e funções declaradas permanecem ativas na sessão atual.',
  },
  {
    id: 'quiz-dif-8',
    nivel: 'dificil',
    certificacao: 'LPIC-1 102.1 / Linux Essentials 4.3',
    pergunta: 'Qual pseudo-sistema de arquivos é gerado em memória RAM pelo Kernel e expõe dados em tempo real sobre o hardware e processos em execução?',
    opcoes: ['/dev', '/sys', '/proc', '/run'],
    correta: 2,
    explicacao: 'O diretório <code>/proc</code> é um procfs virtual mantido na RAM pelo kernel contendo informações de processos (ex.: <code>/proc/cpuinfo</code>, <code>/proc/meminfo</code> e pastas numéricas por PID).',
  },
  {
    id: 'quiz-dif-9',
    nivel: 'dificil',
    certificacao: 'LPIC-1 103.4',
    pergunta: 'No Bash moderno, qual sintaxe redireciona TANTO a saída padrão (stdout) quanto o erro padrão (stderr) para o mesmo arquivo <code>saida.log</code>?',
    opcoes: [
      '&> saida.log (ou > saida.log 2>&1)',
      '1+2> saida.log',
      '>>* saida.log',
      '2>&1 > saida.log',
    ],
    correta: 0,
    explicacao: 'A sintaxe <code>&gt; arquivo 2&gt;&amp;1</code> e a forma abreviada do Bash <code>&amp;&gt; arquivo</code> consolidam stdout e stderr no mesmo arquivo de destino.',
  },
  {
    id: 'quiz-dif-10',
    nivel: 'dificil',
    certificacao: 'LPIC-1 101.3 / RHCSA EX200',
    pergunta: 'Após editar manualmente um arquivo de serviço em <code>/etc/systemd/system/meu-servico.service</code>, qual comando DEVE ser executado antes de reiniciar o serviço?',
    opcoes: [
      'systemctl reload-all',
      'systemctl daemon-reload',
      'systemctl restart systemd',
      'systemctl refresh',
    ],
    correta: 1,
    explicacao: 'O comando <code>systemctl daemon-reload</code> instrui o Systemd a reler todos os arquivos de configuração de unidades do disco e reconstruir a árvore de dependências.',
  },
];

// ============================================================================
// 2. LINUX BÁSICO (30 Desafios: 10 Fáceis, 10 Médios, 10 Difíceis)
// ============================================================================
export const desafiosBasico: Desafio[] = [
  // --- FÁCIL (1..10) ---
  {
    id: 'bas-fac-1',
    nivel: 'facil',
    enunciado: 'Crie a estrutura de diretórios aninhada <code>/home/ricardo/workspace/projeto1</code> em um único comando.',
    dica: '<b>[LPIC-1 103.3]:</b> Utilize o comando <code>mkdir</code> com a flag que cria automaticamente todos os diretórios pais intermediários necessários.',
    solucao: [{ comando: 'mkdir -p /home/ricardo/workspace/projeto1' }],
    verificar: (m) => Verificar.diretorio(m, '/home/ricardo/workspace/projeto1'),
  },
  {
    id: 'bas-fac-2',
    nivel: 'facil',
    enunciado: 'Crie o arquivo <code>/home/ricardo/workspace/notas.txt</code> contendo o texto <code>Inicio dos estudos Linux</code>.',
    dica: '<b>[LPIC-1 103.4]:</b> Utilize o utilitário <code>echo</code> com o operador de redirecionamento de saída (<code>&gt;</code>) para gravar texto em um novo arquivo.',
    solucao: [{ comando: 'echo "Inicio dos estudos Linux" > /home/ricardo/workspace/notas.txt' }],
    verificar: (m) => Verificar.contem(m, '/home/ricardo/workspace/notas.txt', 'inicio dos estudos'),
  },
  {
    id: 'bas-fac-3',
    nivel: 'facil',
    enunciado: 'Crie um arquivo vazio chamado <code>/home/ricardo/workspace/vazio.txt</code> utilizando o comando <code>touch</code>.',
    dica: '<b>[Linux Essentials 2.2]:</b> O comando <code>touch</code> cria novos arquivos vazios quando eles ainda não existem.',
    solucao: [{ comando: 'touch /home/ricardo/workspace/vazio.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/workspace/vazio.txt'),
  },
  {
    id: 'bas-fac-4',
    nivel: 'facil',
    enunciado: 'Grave o caminho do diretório atual dentro do arquivo <code>/home/ricardo/meu_caminho.txt</code> usando <code>pwd</code> e redirecionamento.',
    dica: '<b>[Linux Essentials 2.1]:</b> O comando <code>pwd</code> retorna o diretório atual; redirecione sua saída (<code>&gt;</code>) para o arquivo de destino.',
    solucao: [{ comando: 'pwd > /home/ricardo/meu_caminho.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/meu_caminho.txt') && (Verificar.conteudo(m, '/home/ricardo/meu_caminho.txt') ?? '').trim().length > 0,
  },
  {
    id: 'bas-fac-5',
    nivel: 'facil',
    enunciado: 'Copie <code>/home/ricardo/workspace/notas.txt</code> para <code>/home/ricardo/workspace/notas.backup</code>.',
    dica: '<b>[LPIC-1 103.3]:</b> O comando <code>cp</code> copia arquivos; informe primeiro o arquivo de origem e em seguida o caminho de destino.',
    solucao: [
      { comando: 'echo "Inicio dos estudos Linux" > /home/ricardo/workspace/notas.txt' },
      { comando: 'cp /home/ricardo/workspace/notas.txt /home/ricardo/workspace/notas.backup' },
    ],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/workspace/notas.backup'),
  },
  {
    id: 'bas-fac-6',
    nivel: 'facil',
    enunciado: 'Crie o diretório simples <code>/home/ricardo/temporario</code>.',
    dica: '<b>[Linux Essentials 2.2]:</b> Utilize o comando padrão <code>mkdir</code> para criar novos diretórios no sistema de arquivos.',
    solucao: [{ comando: 'mkdir -p /home/ricardo/temporario' }],
    verificar: (m) => Verificar.diretorio(m, '/home/ricardo/temporario'),
  },
  {
    id: 'bas-fac-7',
    nivel: 'facil',
    enunciado: 'Anexe a linha <code>Pratica diaria no terminal</code> ao final de <code>/home/ricardo/workspace/notas.txt</code> sem apagar o conteúdo existente.',
    dica: '<b>[LPIC-1 103.4]:</b> Para anexar dados ao final de um arquivo sem sobrescrever seu conteúdo original, utilize o operador de concatenação duplo (<code>&gt;&gt;</code>).',
    solucao: [{ comando: 'echo "Pratica diaria no terminal" >> /home/ricardo/workspace/notas.txt' }],
    verificar: (m) => Verificar.contem(m, '/home/ricardo/workspace/notas.txt', 'pratica diaria'),
  },
  {
    id: 'bas-fac-8',
    nivel: 'facil',
    enunciado: 'Crie o arquivo <code>/home/ricardo/temporario/temp.log</code>.',
    dica: '<b>[LPIC-1 103.3]:</b> Crie o novo arquivo vazio utilizando o utilitário <code>touch</code> apontando para o caminho especificado.',
    solucao: [
      { comando: 'mkdir -p /home/ricardo/temporario' },
      { comando: 'touch /home/ricardo/temporario/temp.log' },
    ],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/temporario/temp.log'),
  },
  {
    id: 'bas-fac-9',
    nivel: 'facil',
    enunciado: 'Copie o conteúdo de <code>/etc/hostname</code> para <code>/home/ricardo/nome_maquina.txt</code> usando <code>cat</code> ou redirecionamento.',
    dica: '<b>[Linux Essentials 2.4]:</b> É possível ler um arquivo com <code>cat</code> e redirecionar a saída com <code>&gt;</code>, ou copiar diretamente com <code>cp</code>.',
    solucao: [{ comando: 'cat /etc/hostname > /home/ricardo/nome_maquina.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/nome_maquina.txt') && (Verificar.conteudo(m, '/home/ricardo/nome_maquina.txt') ?? '').trim().length > 0,
  },
  {
    id: 'bas-fac-10',
    nivel: 'facil',
    enunciado: 'Crie a pasta aninhada <code>/home/ricardo/backup/diario</code>.',
    dica: '<b>[LPIC-1 103.3]:</b> Utilize <code>mkdir</code> com a opção para criar subpastas e diretórios intermediários de uma só vez.',
    solucao: [{ comando: 'mkdir -p /home/ricardo/backup/diario' }],
    verificar: (m) => Verificar.diretorio(m, '/home/ricardo/backup/diario'),
  },

  // --- MÉDIO (11..20) ---
  {
    id: 'bas-med-1',
    nivel: 'medio',
    enunciado: 'Mova ou renomeie <code>/home/ricardo/workspace/notas.backup</code> para <code>/home/ricardo/workspace/notas.old</code>.',
    dica: '<b>[LPIC-1 103.3]:</b> No Linux, o comando <code>mv</code> é utilizado tanto para mover arquivos entre pastas quanto para renomeá-los.',
    solucao: [
      { comando: 'touch /home/ricardo/workspace/notas.backup' },
      { comando: 'mv /home/ricardo/workspace/notas.backup /home/ricardo/workspace/notas.old' },
    ],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/workspace/notas.old') && Verificar.naoExiste(m, '/home/ricardo/workspace/notas.backup'),
  },
  {
    id: 'bas-med-2',
    nivel: 'medio',
    enunciado: 'Remova com segurança o arquivo <code>/home/ricardo/temporario/temp.log</code>.',
    dica: '<b>[LPIC-1 103.3]:</b> O comando <code>rm</code> é o utilitário padrão para exclusão de arquivos; você pode usar a flag <code>-f</code> para evitar confirmações.',
    solucao: [{ comando: 'rm -f /home/ricardo/temporario/temp.log' }],
    verificar: (m) => Verificar.naoExiste(m, '/home/ricardo/temporario/temp.log'),
  },
  {
    id: 'bas-med-3',
    nivel: 'medio',
    enunciado: 'Copie todo o diretório <code>/home/ricardo/workspace</code> recursivamente para dentro de <code>/home/ricardo/backup/</code>.',
    dica: '<b>[LPIC-1 103.3]:</b> Para copiar uma pasta inteira com todo o seu conteúdo e subdiretórios, use o <code>cp</code> com a flag recursiva (<code>-r</code>).',
    solucao: [
      { comando: 'mkdir -p /home/ricardo/backup /home/ricardo/workspace' },
      { comando: 'cp -r /home/ricardo/workspace /home/ricardo/backup/' },
    ],
    verificar: (m) => Verificar.diretorio(m, '/home/ricardo/backup/workspace'),
  },
  {
    id: 'bas-med-4',
    nivel: 'medio',
    enunciado: 'Remova o diretório vazio <code>/home/ricardo/temporario</code>.',
    dica: '<b>[Linux Essentials 2.4]:</b> Diretórios vazios podem ser removidos com <code>rmdir</code> ou através de <code>rm</code> com opção de remoção de diretório.',
    solucao: [
      { comando: 'rm -f /home/ricardo/temporario/*' },
      { comando: 'rmdir /home/ricardo/temporario' },
    ],
    verificar: (m) => Verificar.naoExiste(m, '/home/ricardo/temporario'),
  },
  {
    id: 'bas-med-5',
    nivel: 'medio',
    enunciado: 'Extraia as 5 primeiras linhas do arquivo <code>/etc/passwd</code> e salve em <code>/home/ricardo/primeiras_contas.txt</code>.',
    dica: '<b>[LPIC-1 103.2]:</b> O utilitário <code>head</code> com a opção <code>-n</code> permite extrair uma quantidade específica de linhas do início de um arquivo.',
    solucao: [{ comando: 'head -n 5 /etc/passwd > /home/ricardo/primeiras_contas.txt' }],
    verificar: (m) => {
      const c = Verificar.conteudo(m, '/home/ricardo/primeiras_contas.txt');
      return c !== null && c.trim().split('\n').length === 5;
    },
  },
  {
    id: 'bas-med-6',
    nivel: 'medio',
    enunciado: 'Extraia as últimas 3 linhas do arquivo <code>/etc/group</code> e salve em <code>/home/ricardo/ultimos_grupos.txt</code>.',
    dica: '<b>[LPIC-1 103.2]:</b> O utilitário <code>tail</code> com a flag <code>-n</code> permite obter as linhas finais de um arquivo de texto.',
    solucao: [{ comando: 'tail -n 3 /etc/group > /home/ricardo/ultimos_grupos.txt' }],
    verificar: (m) => {
      const c = Verificar.conteudo(m, '/home/ricardo/ultimos_grupos.txt');
      return c !== null && c.trim().split('\n').length === 3;
    },
  },
  {
    id: 'bas-med-7',
    nivel: 'medio',
    enunciado: 'Conte quantas linhas existem no arquivo <code>/etc/passwd</code> e grave o número em <code>/home/ricardo/total_usuarios.txt</code>.',
    dica: '<b>[LPIC-1 103.2]:</b> O utilitário <code>wc</code> com a opção <code>-l</code> conta o total de linhas de um arquivo ou fluxo de texto.',
    solucao: [{ comando: 'wc -l /etc/passwd > /home/ricardo/total_usuarios.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/total_usuarios.txt') && (Verificar.conteudo(m, '/home/ricardo/total_usuarios.txt') ?? '').trim().length > 0,
  },
  {
    id: 'bas-med-8',
    nivel: 'medio',
    enunciado: 'Concatene os arquivos <code>/etc/issue</code> e <code>/etc/hostname</code> gerando o arquivo consolidado <code>/home/ricardo/info_sistema.txt</code>.',
    dica: '<b>[Linux Essentials 2.4]:</b> O comando <code>cat</code> pode receber múltiplos arquivos como argumento em sequência e redirecionar a saída unificada com <code>&gt;</code>.',
    solucao: [{ comando: 'cat /etc/issue /etc/hostname > /home/ricardo/info_sistema.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/info_sistema.txt') && (Verificar.conteudo(m, '/home/ricardo/info_sistema.txt') ?? '').length > 0,
  },
  {
    id: 'bas-med-9',
    nivel: 'medio',
    enunciado: 'Crie o arquivo de configuração oculto <code>/home/ricardo/.bash_custom</code>.',
    dica: '<b>[Linux Essentials 2.2]:</b> No Linux, qualquer arquivo ou pasta cujo nome comece com ponto (<code>.</code>) é tratado como oculto.',
    solucao: [{ comando: 'touch /home/ricardo/.bash_custom' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/.bash_custom'),
  },
  {
    id: 'bas-med-10',
    nivel: 'medio',
    enunciado: 'Gere uma listagem com todos os arquivos da sua pasta pessoal (incluindo ocultos) e grave em <code>/home/ricardo/lista_com_ocultos.txt</code>.',
    dica: '<b>[LPIC-1 103.3]:</b> No comando <code>ls</code>, utilize a flag que lista todos os arquivos incluindo as entradas ocultas iniciadas por ponto.',
    solucao: [{ comando: 'ls -a /home/ricardo > /home/ricardo/lista_com_ocultos.txt' }],
    verificar: (m) => Verificar.contem(m, '/home/ricardo/lista_com_ocultos.txt', '.bashrc'),
  },

  // --- DIFÍCIL (21..30) ---
  {
    id: 'bas-dif-1',
    nivel: 'dificil',
    enunciado: 'Filtre todas as linhas que contenham o termo <code>bash</code> em <code>/etc/passwd</code> e grave o resultado em <code>/home/ricardo/usuarios_bash.txt</code>.',
    dica: '<b>[LPIC-1 103.2]:</b> O comando <code>grep</code> busca padrões e textos específicos linha por linha dentro de arquivos.',
    solucao: [{ comando: 'grep "bash" /etc/passwd > /home/ricardo/usuarios_bash.txt' }],
    verificar: (m) => Verificar.contem(m, '/home/ricardo/usuarios_bash.txt', 'bash'),
  },
  {
    id: 'bas-dif-2',
    nivel: 'dificil',
    enunciado: 'Ordene alfabeticamente as linhas do arquivo <code>/etc/shells</code> e salve em <code>/home/ricardo/shells_ordenados.txt</code>.',
    dica: '<b>[LPIC-1 103.2]:</b> O utilitário <code>sort</code> lê as linhas de um arquivo e as organiza em ordem alfabética ou numérica.',
    solucao: [{ comando: 'sort /etc/shells > /home/ricardo/shells_ordenados.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/shells_ordenados.txt') && (Verificar.conteudo(m, '/home/ricardo/shells_ordenados.txt') ?? '').length > 0,
  },
  {
    id: 'bas-dif-3',
    nivel: 'dificil',
    enunciado: 'Extraia apenas os nomes de usuário (o primeiro campo delimitado por <code>:</code>) de <code>/etc/passwd</code> para <code>/home/ricardo/nomes_usuarios.txt</code>.',
    dica: '<b>[LPIC-1 103.2]:</b> O comando <code>cut</code> permite extrair campos específicos de uma linha utilizando um delimitador customizado (flags <code>-d</code> e <code>-f</code>).',
    solucao: [{ comando: 'cut -d: -f1 /etc/passwd > /home/ricardo/nomes_usuarios.txt' }],
    verificar: (m) => Verificar.contem(m, '/home/ricardo/nomes_usuarios.txt', 'root') && !Verificar.contem(m, '/home/ricardo/nomes_usuarios.txt', '/bin/bash'),
  },
  {
    id: 'bas-dif-4',
    nivel: 'dificil',
    enunciado: 'Filtre o arquivo <code>/etc/passwd</code> excluindo a conta <code>root</code> (inversão de busca) e grave em <code>/home/ricardo/sem_root.txt</code>.',
    dica: '<b>[LPIC-1 103.2]:</b> No <code>grep</code>, verifique a flag de inversão de busca que seleciona apenas as linhas que NÃO correspondem ao padrão.',
    solucao: [{ comando: 'grep -v "root" /etc/passwd > /home/ricardo/sem_root.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/sem_root.txt') && !Verificar.contem(m, '/home/ricardo/sem_root.txt', 'root:'),
  },
  {
    id: 'bas-dif-5',
    nivel: 'dificil',
    enunciado: 'Crie a árvore de diretórios profunda <code>/home/ricardo/lab/a/b/c</code> e dentro dela crie o arquivo <code>dado.txt</code> com o texto <code>Nivel Profundo</code>.',
    dica: '<b>[LPIC-1 103.3]:</b> Crie a árvore de pastas com a flag pai de <code>mkdir</code> e em seguida direcione o texto para o arquivo de destino com <code>&gt;</code>.',
    solucao: [
      { comando: 'mkdir -p /home/ricardo/lab/a/b/c' },
      { comando: 'echo "Nivel Profundo" > /home/ricardo/lab/a/b/c/dado.txt' },
    ],
    verificar: (m) => Verificar.contem(m, '/home/ricardo/lab/a/b/c/dado.txt', 'profundo'),
  },
  {
    id: 'bas-dif-6',
    nivel: 'dificil',
    enunciado: 'Descubra a localização do binário do comando <code>bash</code> usando <code>which</code> e grave a resposta em <code>/home/ricardo/caminho_bash.txt</code>.',
    dica: '<b>[LPIC-1 104.7]:</b> O comando <code>which</code> procura no PATH e exibe o caminho absoluto do executável correspondente.',
    solucao: [{ comando: 'which bash > /home/ricardo/caminho_bash.txt' }],
    verificar: (m) => Verificar.contem(m, '/home/ricardo/caminho_bash.txt', 'bash'),
  },
  {
    id: 'bas-dif-7',
    nivel: 'dificil',
    enunciado: 'Descubra a localização do binário do comando <code>ls</code> usando <code>which</code> e grave em <code>/home/ricardo/caminho_ls.txt</code>.',
    dica: '<b>[LPIC-1 104.7]:</b> Localize o binário do comando utilizando <code>which</code> e direcione a saída com o operador de redirecionamento <code>&gt;</code>.',
    solucao: [{ comando: 'which ls > /home/ricardo/caminho_ls.txt' }],
    verificar: (m) => Verificar.contem(m, '/home/ricardo/caminho_ls.txt', 'ls'),
  },
  {
    id: 'bas-dif-8',
    nivel: 'dificil',
    enunciado: 'Conecte a saída de <code>cat /etc/passwd</code> ao comando <code>wc -l</code> através de um pipe (<code>|</code>) e salve em <code>/home/ricardo/contagem_pipe.txt</code>.',
    dica: '<b>[LPIC-1 103.4]:</b> O operador pipe (<code>|</code>) canaliza a saída padrão do primeiro comando para a entrada padrão do comando de contagem.',
    solucao: [{ comando: 'cat /etc/passwd | wc -l > /home/ricardo/contagem_pipe.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/contagem_pipe.txt') && (Verificar.conteudo(m, '/home/ricardo/contagem_pipe.txt') ?? '').trim().length > 0,
  },
  {
    id: 'bas-dif-9',
    nivel: 'dificil',
    enunciado: 'Remova de forma forçada e recursiva toda a pasta <code>/home/ricardo/lab</code> criada anteriormente.',
    dica: '<b>[LPIC-1 103.3]:</b> Para remover pastas e todo o seu conteúdo sem solicitar confirmação, combine as opções recursiva e de força no comando <code>rm</code>.',
    solucao: [{ comando: 'rm -rf /home/ricardo/lab' }],
    verificar: (m) => Verificar.naoExiste(m, '/home/ricardo/lab'),
  },
  {
    id: 'bas-dif-10',
    nivel: 'dificil',
    enunciado: 'Busque no diretório <code>/etc</code> o arquivo de nome exato <code>hosts</code> usando o comando <code>find</code> e grave o caminho em <code>/home/ricardo/busca_hosts.txt</code>.',
    dica: '<b>[LPIC-1 104.7]:</b> O comando <code>find</code> permite pesquisar recursivamente na árvore de diretórios informando o ponto de partida e o critério <code>-name</code>.',
    solucao: [{ comando: 'find /etc -name "hosts" > /home/ricardo/busca_hosts.txt' }],
    verificar: (m) => Verificar.contem(m, '/home/ricardo/busca_hosts.txt', '/etc/hosts'),
  },
];

// ============================================================================
// 3. LINUX MÉDIO (30 Desafios: 10 Fáceis, 10 Médios, 10 Difíceis)
// ============================================================================
export const desafiosMedio: Desafio[] = [
  // --- FÁCIL (1..10) ---
  {
    id: 'med-fac-1',
    nivel: 'facil',
    enunciado: 'Crie o grupo de trabalho chamado <code>suporte</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> O utilitário <code>groupadd</code> é responsável por criar novos grupos de segurança e trabalho no sistema.',
    solucao: [{ comando: 'groupadd suporte' }],
    verificar: (m) => Verificar.grupo(m, 'suporte') !== undefined,
  },
  {
    id: 'med-fac-2',
    nivel: 'facil',
    enunciado: 'Crie o grupo de trabalho chamado <code>devops</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> Utilize o utilitário <code>groupadd</code> informando o nome do grupo a ser adicionado ao sistema.',
    solucao: [{ comando: 'groupadd devops' }],
    verificar: (m) => Verificar.grupo(m, 'devops') !== undefined,
  },
  {
    id: 'med-fac-3',
    nivel: 'facil',
    enunciado: 'Crie o grupo de trabalho chamado <code>financeiro</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> O comando <code>groupadd</code> registra o novo grupo no arquivo de configuração de grupos do sistema.',
    solucao: [{ comando: 'groupadd financeiro' }],
    verificar: (m) => Verificar.grupo(m, 'financeiro') !== undefined,
  },
  {
    id: 'med-fac-4',
    nivel: 'facil',
    enunciado: 'Crie o usuário <code>carlos</code> com diretório home e shell <code>/bin/bash</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> No comando <code>useradd</code>, utilize opções para criar o diretório pessoal (home) e definir o interpretador de comandos (shell).',
    solucao: [{ comando: 'useradd -m -s /bin/bash carlos' }],
    verificar: (m) => Verificar.usuario(m, 'carlos') !== undefined && Verificar.diretorio(m, '/home/carlos'),
  },
  {
    id: 'med-fac-5',
    nivel: 'facil',
    enunciado: 'Defina uma senha para o usuário <code>carlos</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> O utilitário <code>passwd</code> é utilizado para definir ou redefinir a credencial de uma conta de usuário.',
    solucao: [{ comando: 'passwd carlos', respostas: ['123', '123'] }],
    verificar: (m) => (Verificar.usuario(m, 'carlos')?.senha ?? null) !== null,
  },
  {
    id: 'med-fac-6',
    nivel: 'facil',
    enunciado: 'Crie a pasta de compartilhamento <code>/srv/compartilhado</code>.',
    dica: '<b>[LPIC-1 103.3]:</b> Crie o diretório com <code>mkdir</code>, utilizando a opção <code>-p</code> caso pastas intermediárias precisem ser criadas.',
    solucao: [{ comando: 'mkdir -p /srv/compartilhado' }],
    verificar: (m) => Verificar.diretorio(m, '/srv/compartilhado'),
  },
  {
    id: 'med-fac-7',
    nivel: 'facil',
    enunciado: 'Altere o usuário proprietário da pasta <code>/srv/compartilhado</code> para <code>carlos</code>.',
    dica: '<b>[LPIC-1 104.5]:</b> O comando <code>chown</code> é utilizado para alterar o usuário proprietário de arquivos ou diretórios.',
    solucao: [{ comando: 'chown carlos /srv/compartilhado' }],
    verificar: (m) => Verificar.dono(m, '/srv/compartilhado', 'carlos'),
  },
  {
    id: 'med-fac-8',
    nivel: 'facil',
    enunciado: 'Altere o grupo proprietário da pasta <code>/srv/compartilhado</code> para <code>suporte</code>.',
    dica: '<b>[LPIC-1 104.5]:</b> Para alterar exclusivamente o grupo proprietário de um arquivo ou pasta, utilize o comando <code>chgrp</code> ou <code>chown :grupo</code>.',
    solucao: [{ comando: 'chgrp suporte /srv/compartilhado' }],
    verificar: (m) => Verificar.grupoDoNo(m, '/srv/compartilhado', 'suporte'),
  },
  {
    id: 'med-fac-9',
    nivel: 'facil',
    enunciado: 'Ajuste a permissão de <code>/srv/compartilhado</code> para <code>755</code>.',
    dica: '<b>[LPIC-1 104.5]:</b> O utilitário <code>chmod</code> aceita a representação octal de 3 dígitos (dono, grupo e outros) para redefinir permissões de acesso.',
    solucao: [{ comando: 'chmod 755 /srv/compartilhado' }],
    verificar: (m) => Verificar.modo(m, '/srv/compartilhado', 0o755),
  },
  {
    id: 'med-fac-10',
    nivel: 'facil',
    enunciado: 'Restrinja o acesso à home <code>/home/carlos</code> com permissão <code>700</code> (apenas o próprio usuário pode acessar).',
    dica: '<b>[LPIC-1 104.5]:</b> A permissão octal <code>700</code> concede leitura, escrita e execução para o dono e retira qualquer acesso de grupo e outros.',
    solucao: [{ comando: 'chmod 700 /home/carlos' }],
    verificar: (m) => Verificar.modo(m, '/home/carlos', 0o700),
  },

  // --- MÉDIO (11..20) ---
  {
    id: 'med-med-1',
    nivel: 'medio',
    enunciado: 'Crie o usuário <code>lucas</code> (com home e bash) já associado ao grupo secundário <code>suporte</code>.',
    dica: '<b>[LPIC-1 107.1 / RHCSA EX200]:</b> Ao criar o usuário com <code>useradd</code>, utilize a flag de grupos secundários/suplementares em maiúsculo para vincular ao grupo desejado.',
    solucao: [{ comando: 'useradd -m -s /bin/bash -G suporte lucas' }],
    verificar: (m) => Verificar.membro(m, 'lucas', 'suporte') && Verificar.diretorio(m, '/home/lucas'),
  },
  {
    id: 'med-med-2',
    nivel: 'medio',
    enunciado: 'Adicione o usuário existente <code>carlos</code> ao grupo suplementar <code>financeiro</code> mantendo seus outros grupos.',
    dica: '<b>[LPIC-1 107.1]:</b> Para adicionar um usuário a um grupo secundário mantendo os grupos atuais intactos, use <code>usermod</code> com a combinação de append e grupo suplementar.',
    solucao: [{ comando: 'usermod -aG financeiro carlos' }],
    verificar: (m) => Verificar.membro(m, 'carlos', 'financeiro'),
  },
  {
    id: 'med-med-3',
    nivel: 'medio',
    enunciado: 'Crie a pasta <code>/srv/suporte</code> e configure para que pertença a <code>carlos:suporte</code> em um único comando chown.',
    dica: '<b>[LPIC-1 104.5]:</b> O utilitário <code>chown</code> permite definir dono e grupo simultaneamente usando a sintaxe <code>usuario:grupo</code>.',
    solucao: [
      { comando: 'mkdir -p /srv/suporte' },
      { comando: 'chown carlos:suporte /srv/suporte' },
    ],
    verificar: (m) => Verificar.dono(m, '/srv/suporte', 'carlos', 'suporte'),
  },
  {
    id: 'med-med-4',
    nivel: 'medio',
    enunciado: 'Ajuste a permissão de <code>/srv/suporte</code> para <code>770</code> (acesso total para dono e grupo, nenhum para outros).',
    dica: '<b>[LPIC-1 104.5]:</b> Calcule os valores octais r=4, w=2, x=1 para definir acesso total (rwx) para dono e grupo, e zero para outros com <code>chmod</code>.',
    solucao: [{ comando: 'chmod 770 /srv/suporte' }],
    verificar: (m) => Verificar.modo(m, '/srv/suporte', 0o770),
  },
  {
    id: 'med-med-5',
    nivel: 'medio',
    enunciado: 'Crie o arquivo <code>/srv/suporte/atendimento.log</code> pertencente a <code>carlos:suporte</code> com permissão <code>640</code>.',
    dica: '<b>[LPIC-1 104.5]:</b> Crie o arquivo, defina o proprietário e grupo com <code>chown</code> e configure as permissões numéricas com <code>chmod</code>.',
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
  {
    id: 'med-med-6',
    nivel: 'medio',
    enunciado: 'Ajuste a permissão do arquivo <code>/home/carlos/.bashrc</code> para <code>600</code> (leitura e escrita apenas pelo proprietário).',
    dica: '<b>[LPIC-1 104.5]:</b> A permissão <code>600</code> (rw-------) restringe o arquivo para leitura e escrita exclusivas do dono através de <code>chmod</code>.',
    solucao: [
      { comando: 'touch /home/carlos/.bashrc' },
      { comando: 'chmod 600 /home/carlos/.bashrc' },
    ],
    verificar: (m) => Verificar.modo(m, '/home/carlos/.bashrc', 0o600),
  },
  {
    id: 'med-med-7',
    nivel: 'medio',
    enunciado: 'Exclua o grupo <code>devops</code> do sistema utilizando <code>groupdel</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> O utilitário <code>groupdel</code> remove grupos de usuários existentes no sistema.',
    solucao: [{ comando: 'groupdel devops' }],
    verificar: (m) => Verificar.grupo(m, 'devops') === undefined,
  },
  {
    id: 'med-med-8',
    nivel: 'medio',
    enunciado: 'Altere o proprietário e grupo de toda a pasta <code>/srv/suporte</code> e seus subitens de forma recursiva para <code>carlos:suporte</code>.',
    dica: '<b>[LPIC-1 104.5]:</b> Utilize o comando <code>chown</code> com a opção recursiva (<code>-R</code>) para aplicar a nova posse a toda a estrutura interna da pasta.',
    solucao: [{ comando: 'chown -R carlos:suporte /srv/suporte' }],
    verificar: (m) => Verificar.dono(m, '/srv/suporte', 'carlos', 'suporte'),
  },
  {
    id: 'med-med-9',
    nivel: 'medio',
    enunciado: 'Aplique a permissão recursiva <code>750</code> no diretório <code>/srv/suporte</code>.',
    dica: '<b>[LPIC-1 104.5]:</b> No utilitário <code>chmod</code>, utilize a flag recursiva para propagar a nova máscara de permissões a todos os itens da pasta.',
    solucao: [{ comando: 'chmod -R 750 /srv/suporte' }],
    verificar: (m) => Verificar.modo(m, '/srv/suporte', 0o750),
  },
  {
    id: 'med-med-10',
    nivel: 'medio',
    enunciado: 'Crie a conta de usuário <code>backupuser</code> com home, shell <code>/bin/sh</code> e o comentário GECOS "Operador de Backup".',
    dica: '<b>[LPIC-1 107.1]:</b> O comando <code>useradd</code> aceita uma opção específica para definir o campo GECOS / comentário da conta.',
    solucao: [{ comando: 'useradd -m -s /bin/sh -c "Operador de Backup" backupuser' }],
    verificar: (m) => Verificar.usuario(m, 'backupuser') !== undefined,
  },

  // --- DIFÍCIL (21..30) ---
  {
    id: 'med-dif-1',
    nivel: 'dificil',
    enunciado: 'Exclua permanentemente a conta <code>backupuser</code> e remova automaticamente seu diretório home.',
    dica: '<b>[LPIC-1 107.1]:</b> O utilitário <code>userdel</code> remove contas; consulte a opção para apagar simultaneamente a pasta home do usuário.',
    solucao: [{ comando: 'userdel -r backupuser' }],
    verificar: (m) => Verificar.usuario(m, 'backupuser') === undefined && Verificar.naoExiste(m, '/home/backupuser'),
  },
  {
    id: 'med-dif-2',
    nivel: 'dificil',
    enunciado: 'Configure o Sticky Bit (<code>1777</code>) no diretório <code>/srv/compartilhado</code> para que qualquer um possa criar arquivos mas ninguém apague arquivos de outros.',
    dica: '<b>[LPIC-1 104.5]:</b> O Sticky Bit em diretórios é representado pelo valor especial <code>1</code> na primeira posição octal de 4 dígitos do <code>chmod</code>.',
    solucao: [{ comando: 'chmod 1777 /srv/compartilhado' }],
    verificar: (m) => Verificar.no(m, '/srv/compartilhado')?.modo === 0o1777,
  },
  {
    id: 'med-dif-3',
    nivel: 'dificil',
    enunciado: 'Bloqueie o acesso de login interativo do usuário <code>lucas</code> alterando seu shell para <code>/usr/sbin/nologin</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> O comando <code>usermod</code> com a opção de shell permite alterar o interpretador padrão de login de uma conta existente.',
    solucao: [{ comando: 'usermod -s /usr/sbin/nologin lucas' }],
    verificar: (m) => Verificar.usuario(m, 'lucas')?.shell === '/usr/sbin/nologin',
  },
  {
    id: 'med-dif-4',
    nivel: 'dificil',
    enunciado: 'Conceda privilégios de superusuário ao usuário <code>carlos</code> adicionando-o ao grupo <code>sudo</code> sem perder seus grupos atuais.',
    dica: '<b>[LPIC-1 107.1]:</b> No <code>usermod</code>, lembre-se de usar a flag de append junto à de grupo suplementar para não substituir a lista de grupos do usuário.',
    solucao: [{ comando: 'usermod -aG sudo carlos' }],
    verificar: (m) => Verificar.membro(m, 'carlos', 'sudo'),
  },
  {
    id: 'med-dif-5',
    nivel: 'dificil',
    enunciado: 'Crie o diretório <code>/srv/projetos</code> pertencente a <code>root:suporte</code> e configure a permissão especial SGID (<code>2770</code>).',
    dica: '<b>[LPIC-1 104.5 / RHCSA EX200]:</b> A permissão especial SGID em diretórios força a herança de grupo e é definida pelo valor <code>2</code> no primeiro dígito octal do <code>chmod</code>.',
    solucao: [
      { comando: 'mkdir -p /srv/projetos' },
      { comando: 'chown root:suporte /srv/projetos' },
      { comando: 'chmod 2770 /srv/projetos' },
    ],
    verificar: (m) =>
      Verificar.no(m, '/srv/projetos')?.modo === 0o2770 &&
      Verificar.grupoDoNo(m, '/srv/projetos', 'suporte'),
  },
  {
    id: 'med-dif-6',
    nivel: 'dificil',
    enunciado: 'Obtenha os grupos e identificadores do usuário <code>carlos</code> com o comando <code>id</code> e salve em <code>/home/ricardo/grupos_carlos.txt</code>.',
    dica: '<b>[Linux Essentials 5.1]:</b> O utilitário <code>id</code> exibe o UID, GID e grupos suplementares de um usuário; redirecione a saída para o arquivo solicitado.',
    solucao: [{ comando: 'id carlos > /home/ricardo/grupos_carlos.txt' }],
    verificar: (m) => Verificar.contem(m, '/home/ricardo/grupos_carlos.txt', 'carlos'),
  },
  {
    id: 'med-dif-7',
    nivel: 'dificil',
    enunciado: 'Restaure a posse e permissão estrita do arquivo de senhas <code>/etc/shadow</code> para o dono <code>root:root</code> e permissão <code>640</code>.',
    dica: '<b>[LPIC-1 104.5]:</b> Ajuste a posse com <code>chown</code> e aplique a máscara octal requerida com o comando <code>chmod</code>.',
    solucao: [
      { comando: 'chown root:root /etc/shadow' },
      { comando: 'chmod 640 /etc/shadow' },
    ],
    verificar: (m) =>
      Verificar.dono(m, '/etc/shadow', 'root', 'root') &&
      Verificar.modo(m, '/etc/shadow', 0o640),
  },
  {
    id: 'med-dif-8',
    nivel: 'dificil',
    enunciado: 'Crie o usuário <code>marina</code> com UID fixo <code>1500</code>, grupo primário <code>suporte</code> e diretório home.',
    dica: '<b>[LPIC-1 107.1]:</b> O utilitário <code>useradd</code> permite especificar o UID numérico e o grupo primário através de opções de linha de comando.',
    solucao: [{ comando: 'useradd -m -u 1500 -g suporte marina' }],
    verificar: (m) => Verificar.usuario(m, 'marina')?.uid === 1500,
  },
  {
    id: 'med-dif-9',
    nivel: 'dificil',
    enunciado: 'Ajuste a permissão do diretório de regras de privilégios <code>/etc/sudoers.d</code> para <code>750</code>.',
    dica: '<b>[LPIC-1 104.5]:</b> O comando <code>chmod</code> aceita a máscara octal de três dígitos para configurar os privilégios do diretório.',
    solucao: [{ comando: 'chmod 750 /etc/sudoers.d' }],
    verificar: (m) => Verificar.modo(m, '/etc/sudoers.d', 0o750),
  },
  {
    id: 'med-dif-10',
    nivel: 'dificil',
    enunciado: 'Filtre as contas de sistema do arquivo <code>/etc/passwd</code> que possuam UID iniciando com 100 e grave em <code>/home/ricardo/contas_sistema.txt</code>.',
    dica: '<b>[LPIC-1 103.2]:</b> Combine <code>grep</code> com uma expressão regular que busque o padrão no arquivo de senhas e direcione a saída com <code>&gt;</code>.',
    solucao: [{ comando: 'grep -E ":100" /etc/passwd > /home/ricardo/contas_sistema.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/contas_sistema.txt'),
  },
];

// ============================================================================
// 4. LINUX AVANÇADO (30 Desafios: 10 Fáceis, 10 Médios, 10 Difíceis)
// ============================================================================
export const desafiosAvancado: Desafio[] = [
  // --- FÁCIL (1..10) ---
  {
    id: 'av-fac-1',
    nivel: 'facil',
    enunciado: 'Atualize os índices locais dos repositórios de pacotes com <code>apt update</code>.',
    dica: '<b>[LPIC-1 102.4]:</b> O subcomando <code>update</code> do <code>apt</code> sincroniza o catálogo local com os repositórios configurados.',
    solucao: [{ comando: 'apt update' }],
    verificar: (m) => new GerenciadorDePacotes(m).listasAtualizadas(),
  },
  {
    id: 'av-fac-2',
    nivel: 'facil',
    enunciado: 'Instale o pacote utilitário de visualização em árvore <code>tree</code>.',
    dica: '<b>[LPIC-1 102.4]:</b> Utilize o subcomando de instalação do gerenciador <code>apt</code>, informando a flag <code>-y</code> para confirmar automaticamente.',
    solucao: [{ comando: 'apt install -y tree' }],
    verificar: (m) => new GerenciadorDePacotes(m).instalado('tree'),
  },
  {
    id: 'av-fac-3',
    nivel: 'facil',
    enunciado: 'Instale o pacote utilitário de transferências web <code>curl</code>.',
    dica: '<b>[LPIC-1 102.4]:</b> Instale o pacote utilitário web utilizando a ação de instalação do gerenciador de pacotes <code>apt</code>.',
    solucao: [{ comando: 'apt install -y curl' }],
    verificar: (m) => new GerenciadorDePacotes(m).instalado('curl'),
  },
  {
    id: 'av-fac-4',
    nivel: 'facil',
    enunciado: 'Grave o hostname atual da máquina no arquivo <code>/home/ricardo/hostname.txt</code>.',
    dica: '<b>[LPIC-1 109.1]:</b> O comando <code>hostname</code> exibe o nome de rede da máquina; redirecione sua saída padrão com <code>&gt;</code>.',
    solucao: [{ comando: 'hostname > /home/ricardo/hostname.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/hostname.txt') && (Verificar.conteudo(m, '/home/ricardo/hostname.txt') ?? '').trim().length > 0,
  },
  {
    id: 'av-fac-5',
    nivel: 'facil',
    enunciado: 'Grave o tempo de atividade da máquina com <code>uptime</code> em <code>/home/ricardo/uptime.txt</code>.',
    dica: '<b>[LPIC-1 103.5]:</b> O utilitário <code>uptime</code> informa há quanto tempo o sistema está em execução e a média de carga operacional.',
    solucao: [{ comando: 'uptime > /home/ricardo/uptime.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/uptime.txt') && (Verificar.conteudo(m, '/home/ricardo/uptime.txt') ?? '').trim().length > 0,
  },
  {
    id: 'av-fac-6',
    nivel: 'facil',
    enunciado: 'Descubra a versão do kernel Linux com <code>uname -r</code> e grave em <code>/home/ricardo/kernel_versao.txt</code>.',
    dica: '<b>[LPIC-1 101.1]:</b> O comando <code>uname</code> com a flag de release (<code>-r</code>) exibe a versão exata do kernel em execução.',
    solucao: [{ comando: 'uname -r > /home/ricardo/kernel_versao.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/kernel_versao.txt') && (Verificar.conteudo(m, '/home/ricardo/kernel_versao.txt') ?? '').trim().length > 0,
  },
  {
    id: 'av-fac-7',
    nivel: 'facil',
    enunciado: 'Verifique a ocupação do sistema de arquivos com <code>df -h</code> e grave em <code>/home/ricardo/disco_uso.txt</code>.',
    dica: '<b>[LPIC-1 104.1]:</b> O comando <code>df</code> exibe o uso de espaço nas partições; a opção <code>-h</code> exibe valores legíveis em formato humano (MB/GB).',
    solucao: [{ comando: 'df -h > /home/ricardo/disco_uso.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/disco_uso.txt') && (Verificar.conteudo(m, '/home/ricardo/disco_uso.txt') ?? '').trim().length > 0,
  },
  {
    id: 'av-fac-8',
    nivel: 'facil',
    enunciado: 'Verifique o consumo de memória RAM com <code>free -m</code> e salve em <code>/home/ricardo/memoria_uso.txt</code>.',
    dica: '<b>[LPIC-1 103.5]:</b> O utilitário <code>free</code> relata o uso de memória RAM e swap; a flag <code>-m</code> formata as quantidades em megabytes.',
    solucao: [{ comando: 'free -m > /home/ricardo/memoria_uso.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/memoria_uso.txt') && (Verificar.conteudo(m, '/home/ricardo/memoria_uso.txt') ?? '').trim().length > 0,
  },
  {
    id: 'av-fac-9',
    nivel: 'facil',
    enunciado: 'Crie o link simbólico <code>/home/ricardo/banner_link</code> apontando para o arquivo <code>/etc/issue</code>.',
    dica: '<b>[LPIC-1 104.6]:</b> O comando <code>ln</code> com a opção <code>-s</code> cria atalhos do tipo link simbólico apontando para o arquivo original.',
    solucao: [{ comando: 'ln -s /etc/issue /home/ricardo/banner_link' }],
    verificar: (m) => Verificar.link(m, '/home/ricardo/banner_link'),
  },
  {
    id: 'av-fac-10',
    nivel: 'facil',
    enunciado: 'Inspecione o status do serviço SSH com <code>systemctl status ssh</code> e salve em <code>/home/ricardo/ssh_status.txt</code>.',
    dica: '<b>[LPIC-1 101.3]:</b> O comando <code>systemctl status</code> inspeciona o estado de execução de uma unidade de serviço do systemd.',
    solucao: [{ comando: 'systemctl status ssh > /home/ricardo/ssh_status.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/ssh_status.txt') && (Verificar.conteudo(m, '/home/ricardo/ssh_status.txt') ?? '').trim().length > 0,
  },

  // --- MÉDIO (11..20) ---
  {
    id: 'av-med-1',
    nivel: 'medio',
    enunciado: 'Instale o servidor web <code>nginx</code> através do gerenciador de pacotes.',
    dica: '<b>[LPIC-1 102.4 / 108.1]:</b> Utilize a ação de instalação do gerenciador <code>apt</code> informando o pacote do servidor web solicitado.',
    solucao: [{ comando: 'apt install -y nginx' }],
    verificar: (m) => new Servicos(m).ativo('nginx'),
  },
  {
    id: 'av-med-2',
    nivel: 'medio',
    enunciado: 'Configure a página web padrão em <code>/var/www/html/index.html</code> para exibir o texto <code>Servidor Avancado Pronto</code>.',
    dica: '<b>[LPIC-1 103.4]:</b> Utilize o comando <code>echo</code> com o operador de redirecionamento de saída (<code>&gt;</code>) para gravar na página web.',
    solucao: [{ comando: 'echo "Servidor Avancado Pronto" > /var/www/html/index.html' }],
    verificar: (m) => Verificar.contem(m, '/var/www/html/index.html', 'Servidor Avancado Pronto'),
  },
  {
    id: 'av-med-3',
    nivel: 'medio',
    enunciado: 'Reinicie o serviço web <code>nginx</code> usando o systemctl.',
    dica: '<b>[LPIC-1 101.3]:</b> O utilitário <code>systemctl</code> possui uma ação específica para reiniciar daemons de serviços em execução.',
    solucao: [{ comando: 'systemctl restart nginx' }],
    verificar: (m) => new Servicos(m).ativo('nginx'),
  },
  {
    id: 'av-med-4',
    nivel: 'medio',
    enunciado: 'Habilite o serviço <code>nginx</code> para inicialização automática no boot com <code>systemctl enable</code>.',
    dica: '<b>[LPIC-1 101.3]:</b> Para ativar a inicialização de um serviço durante o boot do sistema operacional, use a ação de habilitação do <code>systemctl</code>.',
    solucao: [{ comando: 'systemctl enable nginx' }],
    verificar: (m) => new Servicos(m).ativo('nginx'),
  },
  {
    id: 'av-med-5',
    nivel: 'medio',
    enunciado: 'Crie o atalho simbólico <code>/home/ricardo/meusite</code> apontando para a pasta raiz web <code>/var/www/html</code>.',
    dica: '<b>[LPIC-1 104.6]:</b> No comando <code>ln -s</code>, informe primeiro o diretório de destino original e em seguida o caminho do link simbólico.',
    solucao: [{ comando: 'ln -s /var/www/html /home/ricardo/meusite' }],
    verificar: (m) => Verificar.link(m, '/home/ricardo/meusite'),
  },
  {
    id: 'av-med-6',
    nivel: 'medio',
    enunciado: 'Instale o monitor interativo de processos <code>htop</code> com o APT.',
    dica: '<b>[LPIC-1 102.4]:</b> Utilize a ação de instalação do gerenciador de pacotes <code>apt</code> para adicionar o monitor de processos interativo.',
    solucao: [{ comando: 'apt install -y htop' }],
    verificar: (m) => new GerenciadorDePacotes(m).instalado('htop'),
  },
  {
    id: 'av-med-7',
    nivel: 'medio',
    enunciado: 'Colete a tabela completa de processos em execução com <code>ps aux</code> e salve em <code>/home/ricardo/processos_ativos.txt</code>.',
    dica: '<b>[LPIC-1 103.5]:</b> O utilitário <code>ps</code> com as opções <code>aux</code> lista todos os processos de todos os usuários do sistema com detalhes.',
    solucao: [{ comando: 'ps aux > /home/ricardo/processos_ativos.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/processos_ativos.txt') && (Verificar.conteudo(m, '/home/ricardo/processos_ativos.txt') ?? '').trim().length > 0,
  },
  {
    id: 'av-med-8',
    nivel: 'medio',
    enunciado: 'Crie o diretório compartilhado <code>/srv/upload</code> com Sticky Bit (<code>1777</code>).',
    dica: '<b>[LPIC-1 104.5]:</b> Crie a pasta e aplique a permissão especial de Sticky Bit através do valor octal de 4 dígitos iniciado em <code>1</code>.',
    solucao: [
      { comando: 'mkdir -p /srv/upload' },
      { comando: 'chmod 1777 /srv/upload' },
    ],
    verificar: (m) => Verificar.no(m, '/srv/upload')?.modo === 0o1777,
  },
  {
    id: 'av-med-9',
    nivel: 'medio',
    enunciado: 'Crie um alias persistente <code>ll</code> para o comando <code>ls -la</code> anexando-o ao arquivo <code>/home/ricardo/.bashrc</code>.',
    dica: '<b>[LPIC-1 105.1]:</b> Utilize <code>echo</code> com o operador de concatenação <code>&gt;&gt;</code> para adicionar a declaração de alias ao final do arquivo de perfil bash.',
    solucao: [{ comando: "echo 'alias ll=\"ls -la\"' >> /home/ricardo/.bashrc" }],
    verificar: (m) => Verificar.contem(m, '/home/ricardo/.bashrc', 'alias ll='),
  },
  {
    id: 'av-med-10',
    nivel: 'medio',
    enunciado: 'Atualize todos os pacotes instalados com atualizações disponíveis usando <code>apt upgrade -y</code>.',
    dica: '<b>[LPIC-1 102.4]:</b> O subcomando <code>upgrade</code> do <code>apt</code> baixa e aplica as versões mais recentes dos pacotes instalados no sistema.',
    solucao: [{ comando: 'apt upgrade -y' }],
    verificar: (m) => new GerenciadorDePacotes(m).atualizaveis().length === 0,
  },

  // --- DIFÍCIL (21..30) ---
  {
    id: 'av-dif-1',
    nivel: 'dificil',
    enunciado: 'Instale o servidor web <code>apache2</code> e certifique-se de que o serviço está ativo.',
    dica: '<b>[LPIC-1 102.4 / 108.1]:</b> Instale o pacote com <code>apt</code> e em seguida inicie a unidade correspondente utilizando <code>systemctl start</code>.',
    solucao: [
      { comando: 'apt install -y apache2' },
      { comando: 'systemctl start apache2' },
    ],
    verificar: (m) => new Servicos(m).ativo('apache2'),
  },
  {
    id: 'av-dif-2',
    nivel: 'dificil',
    enunciado: 'Crie o script de sistema <code>/usr/local/bin/status-rede.sh</code> com permissão <code>755</code> contendo o comando <code>ip route</code>.',
    dica: '<b>[LPIC-1 103.3 / 104.5]:</b> Crie o arquivo de script com o comando desejado e torne-o executável com o utilitário <code>chmod</code>.',
    solucao: [
      { comando: 'echo "ip route" > /usr/local/bin/status-rede.sh' },
      { comando: 'chmod 755 /usr/local/bin/status-rede.sh' },
    ],
    verificar: (m) =>
      Verificar.modo(m, '/usr/local/bin/status-rede.sh', 0o755) &&
      Verificar.contem(m, '/usr/local/bin/status-rede.sh', 'ip route'),
  },
  {
    id: 'av-dif-3',
    nivel: 'dificil',
    enunciado: 'Gere um arquivo tar compactado <code>/home/ricardo/backup_etc.tar.gz</code> contendo o diretório <code>/etc/</code>.',
    dica: '<b>[LPIC-1 103.5]:</b> No comando <code>tar</code>, combine as flags de criação de arquivo, compressão com gzip e especificação do nome de saída.',
    solucao: [{ comando: 'tar -czf /home/ricardo/backup_etc.tar.gz /etc/' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/backup_etc.tar.gz'),
  },
  {
    id: 'av-dif-4',
    nivel: 'dificil',
    enunciado: 'Pare o serviço <code>apache2</code> com <code>systemctl stop</code> para liberar a porta web.',
    dica: '<b>[LPIC-1 101.3]:</b> O comando <code>systemctl</code> possui uma ação de parada de serviço para interromper daemons em execução.',
    solucao: [{ comando: 'systemctl stop apache2' }],
    verificar: (m) => !new Servicos(m).ativo('apache2'),
  },
  {
    id: 'av-dif-5',
    nivel: 'dificil',
    enunciado: 'Desinstale o pacote <code>tree</code> utilizando <code>apt remove -y tree</code>.',
    dica: '<b>[LPIC-1 102.4]:</b> O subcomando <code>remove</code> do <code>apt</code> desinstala os binários do pacote especificado no sistema.',
    solucao: [{ comando: 'apt remove -y tree' }],
    verificar: (m) => !new GerenciadorDePacotes(m).instalado('tree'),
  },
  {
    id: 'av-dif-6',
    nivel: 'dificil',
    enunciado: 'Expurgue completamente o pacote <code>apache2</code> e suas configurações usando <code>apt purge -y apache2</code>.',
    dica: '<b>[LPIC-1 102.4]:</b> A ação <code>purge</code> do <code>apt</code> remove tanto os pacotes quanto todos os seus arquivos de configuração remanescentes.',
    solucao: [{ comando: 'apt purge -y apache2' }],
    verificar: (m) => !new GerenciadorDePacotes(m).instalado('apache2'),
  },
  {
    id: 'av-dif-7',
    nivel: 'dificil',
    enunciado: 'Crie o atalho simbólico de binário <code>/usr/local/bin/srv-web</code> apontando para <code>/usr/sbin/nginx</code>.',
    dica: '<b>[LPIC-1 104.6]:</b> Utilize <code>ln -s</code> especificando primeiro o caminho absoluto do executável original e em seguida o caminho do atalho.',
    solucao: [{ comando: 'ln -s /usr/sbin/nginx /usr/local/bin/srv-web' }],
    verificar: (m) => Verificar.link(m, '/usr/local/bin/srv-web'),
  },
  {
    id: 'av-dif-8',
    nivel: 'dificil',
    enunciado: 'Colete as últimas 20 mensagens do journal de sistema com <code>journalctl -n 20</code> e salve em <code>/home/ricardo/ultimos_logs.txt</code>.',
    dica: '<b>[LPIC-1 108.2]:</b> O utilitário <code>journalctl</code> aceita a flag <code>-n</code> para limitar a quantidade de registros mais recentes exibidos.',
    solucao: [{ comando: 'journalctl -n 20 > /home/ricardo/ultimos_logs.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/ultimos_logs.txt') && (Verificar.conteudo(m, '/home/ricardo/ultimos_logs.txt') ?? '').trim().length > 0,
  },
  {
    id: 'av-dif-9',
    nivel: 'dificil',
    enunciado: 'Adicione o diretório <code>/opt/bin</code> à variável PATH no arquivo de ambiente <code>/home/ricardo/.bash_custom</code>.',
    dica: '<b>[LPIC-1 105.1]:</b> Adicione o novo caminho à variável exportada de ambiente usando append (<code>&gt;&gt;</code>), protegendo expansões indevidas.',
    solucao: [{ comando: "echo 'export PATH=$PATH:/opt/bin' >> /home/ricardo/.bash_custom" }],
    verificar: (m) => Verificar.contem(m, '/home/ricardo/.bash_custom', '/opt/bin'),
  },
  {
    id: 'av-dif-10',
    nivel: 'dificil',
    enunciado: 'Crie o diretório de aplicação <code>/opt/app</code> com permissão <code>755</code>.',
    dica: '<b>[FHS / LPIC-1 104.7]:</b> Crie o diretório em <code>/opt</code> e configure as permissões numéricas solicitadas utilizando <code>chmod</code>.',
    solucao: [
      { comando: 'mkdir -p /opt/app' },
      { comando: 'chmod 755 /opt/app' },
    ],
    verificar: (m) => Verificar.diretorio(m, '/opt/app') && Verificar.modo(m, '/opt/app', 0o755),
  },
];

// ============================================================================
// 5. LPI LINUX ESSENTIALS (30 Desafios: 10 Fáceis, 10 Médios, 10 Difíceis)
// ============================================================================
export const desafiosEssentials: Desafio[] = [
  // --- FÁCIL (1..10) ---
  {
    id: 'ess-fac-1',
    nivel: 'facil',
    enunciado: 'Crie o arquivo de ambiente oculto <code>/home/ricardo/.bash_custom</code> contendo a linha <code>export PROVA="Linux Essentials"</code>.',
    dica: '<b>[LPI Linux Essentials 2.4]:</b> Arquivos que começam com ponto (<code>.</code>) são ocultos; grave a instrução de exportação com o operador de redirecionamento <code>&gt;</code>.',
    solucao: [{ comando: 'echo "export PROVA=Linux_Essentials" > /home/ricardo/.bash_custom' }],
    verificar: (m) =>
      Verificar.arquivo(m, '/home/ricardo/.bash_custom') &&
      Verificar.contem(m, '/home/ricardo/.bash_custom', 'PROVA='),
  },
  {
    id: 'ess-fac-2',
    nivel: 'facil',
    enunciado: 'Respeitando o padrão FHS para dados variáveis, crie o arquivo de log <code>/var/log/app-monitor.log</code>.',
    dica: '<b>[LPI Linux Essentials 4.3 / FHS]:</b> Segundo a hierarquia do FHS, arquivos de log e dados dinâmicos do sistema pertencem à árvore <code>/var/log</code>.',
    solucao: [{ comando: 'touch /var/log/app-monitor.log' }],
    verificar: (m) => Verificar.arquivo(m, '/var/log/app-monitor.log'),
  },
  {
    id: 'ess-fac-3',
    nivel: 'facil',
    enunciado: 'Crie o diretório de laboratório <code>/tmp/lpi-lab</code> com permissão <code>755</code>.',
    dica: '<b>[LPI Linux Essentials 5.3]:</b> Crie o diretório com <code>mkdir</code> e configure as permissões de acesso correspondentes com <code>chmod</code>.',
    solucao: [
      { comando: 'mkdir -p /tmp/lpi-lab' },
      { comando: 'chmod 755 /tmp/lpi-lab' },
    ],
    verificar: (m) => Verificar.diretorio(m, '/tmp/lpi-lab') && Verificar.modo(m, '/tmp/lpi-lab', 0o755),
  },
  {
    id: 'ess-fac-4',
    nivel: 'facil',
    enunciado: 'Grave o nome do usuário atual no arquivo <code>/tmp/lpi-lab/usuario_atual.txt</code> com o comando <code>whoami</code>.',
    dica: '<b>[LPI Linux Essentials 5.1]:</b> O utilitário <code>whoami</code> retorna o identificador textual do usuário autenticado no terminal.',
    solucao: [{ comando: 'whoami > /tmp/lpi-lab/usuario_atual.txt' }],
    verificar: (m) => Verificar.contem(m, '/tmp/lpi-lab/usuario_atual.txt', 'root') || Verificar.contem(m, '/tmp/lpi-lab/usuario_atual.txt', 'ricardo'),
  },
  {
    id: 'ess-fac-5',
    nivel: 'facil',
    enunciado: 'Crie o arquivo <code>/tmp/lpi-lab/filosofia.txt</code> com o texto <code>Linux Open Source</code>.',
    dica: '<b>[LPI Linux Essentials 1.1]:</b> Utilize o utilitário <code>echo</code> com redirecionamento de saída (<code>&gt;</code>) para gravar a mensagem no arquivo.',
    solucao: [{ comando: 'echo "Linux Open Source" > /tmp/lpi-lab/filosofia.txt' }],
    verificar: (m) => Verificar.contem(m, '/tmp/lpi-lab/filosofia.txt', 'Linux Open Source'),
  },
  {
    id: 'ess-fac-6',
    nivel: 'facil',
    enunciado: 'Crie o arquivo oculto <code>/home/ricardo/.documento_oculto</code>.',
    dica: '<b>[LPI Linux Essentials 2.2]:</b> Para criar um novo arquivo oculto, utilize o comando <code>touch</code> iniciando o nome do arquivo com um ponto.',
    solucao: [{ comando: 'touch /home/ricardo/.documento_oculto' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/.documento_oculto'),
  },
  {
    id: 'ess-fac-7',
    nivel: 'facil',
    enunciado: 'Grave a data e hora do sistema em <code>/tmp/lpi-lab/data_exame.txt</code> usando <code>date</code>.',
    dica: '<b>[LPI Linux Essentials 2.1]:</b> O utilitário <code>date</code> relata o relógio e calendário do sistema; redirecione sua saída com <code>&gt;</code>.',
    solucao: [{ comando: 'date > /tmp/lpi-lab/data_exame.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/tmp/lpi-lab/data_exame.txt') && (Verificar.conteudo(m, '/tmp/lpi-lab/data_exame.txt') ?? '').trim().length > 0,
  },
  {
    id: 'ess-fac-8',
    nivel: 'facil',
    enunciado: 'Crie a pasta pessoal <code>/home/ricardo/documentos/lpi</code>.',
    dica: '<b>[LPI Linux Essentials 2.2]:</b> Utilize <code>mkdir</code> com a opção para criar subpastas e diretórios intermediários de forma automática.',
    solucao: [{ comando: 'mkdir -p /home/ricardo/documentos/lpi' }],
    verificar: (m) => Verificar.diretorio(m, '/home/ricardo/documentos/lpi'),
  },
  {
    id: 'ess-fac-9',
    nivel: 'facil',
    enunciado: 'Copie <code>/tmp/lpi-lab/filosofia.txt</code> para a pasta <code>/home/ricardo/documentos/lpi/</code>.',
    dica: '<b>[LPI Linux Essentials 2.4]:</b> O comando <code>cp</code> recebe como parâmetros o arquivo de origem e em seguida o diretório de destino.',
    solucao: [
      { comando: 'mkdir -p /tmp/lpi-lab /home/ricardo/documentos/lpi' },
      { comando: 'echo "Linux Open Source" > /tmp/lpi-lab/filosofia.txt' },
      { comando: 'cp /tmp/lpi-lab/filosofia.txt /home/ricardo/documentos/lpi/' },
    ],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/documentos/lpi/filosofia.txt'),
  },
  {
    id: 'ess-fac-10',
    nivel: 'facil',
    enunciado: 'Gere a listagem de arquivos da home com <code>ls -a /home/ricardo</code> e salve em <code>/tmp/lpi-lab/arquivos_com_ocultos.txt</code>.',
    dica: '<b>[LPI Linux Essentials 2.2]:</b> No comando <code>ls</code>, a opção que inclui arquivos ocultos na listagem é a flag <code>-a</code>.',
    solucao: [{ comando: 'ls -a /home/ricardo > /tmp/lpi-lab/arquivos_com_ocultos.txt' }],
    verificar: (m) => Verificar.contem(m, '/tmp/lpi-lab/arquivos_com_ocultos.txt', '.bashrc'),
  },

  // --- MÉDIO (11..20) ---
  {
    id: 'ess-med-1',
    nivel: 'medio',
    enunciado: 'Grave a contagem de linhas do arquivo <code>/etc/passwd</code> dentro de <code>/tmp/lpi-lab/total-contas.txt</code>.',
    dica: '<b>[LPI Linux Essentials 3.2]:</b> Utilize o utilitário <code>wc</code> com a opção de contagem de linhas (<code>-l</code>) e redirecione o resultado.',
    solucao: [{ comando: 'wc -l /etc/passwd > /tmp/lpi-lab/total-contas.txt' }],
    verificar: (m) =>
      Verificar.arquivo(m, '/tmp/lpi-lab/total-contas.txt') &&
      (Verificar.conteudo(m, '/tmp/lpi-lab/total-contas.txt') ?? '').trim().length > 0,
  },
  {
    id: 'ess-med-2',
    nivel: 'medio',
    enunciado: 'Salve as 5 primeiras linhas de <code>/etc/group</code> em <code>/tmp/lpi-lab/primeiros_grupos.txt</code>.',
    dica: '<b>[LPI Linux Essentials 3.2]:</b> O utilitário <code>head</code> com a opção numérica <code>-n</code> extrai linhas a partir do início de arquivos de texto.',
    solucao: [{ comando: 'head -n 5 /etc/group > /tmp/lpi-lab/primeiros_grupos.txt' }],
    verificar: (m) => {
      const c = Verificar.conteudo(m, '/tmp/lpi-lab/primeiros_grupos.txt');
      return c !== null && c.trim().split('\n').length === 5;
    },
  },
  {
    id: 'ess-med-3',
    nivel: 'medio',
    enunciado: 'Salve as últimas 5 linhas de <code>/etc/passwd</code> em <code>/tmp/lpi-lab/ultimos_usuarios.txt</code>.',
    dica: '<b>[LPI Linux Essentials 3.2]:</b> O utilitário <code>tail</code> com a opção <code>-n</code> permite obter linhas a partir do final do arquivo.',
    solucao: [{ comando: 'tail -n 5 /etc/passwd > /tmp/lpi-lab/ultimos_usuarios.txt' }],
    verificar: (m) => {
      const c = Verificar.conteudo(m, '/tmp/lpi-lab/ultimos_usuarios.txt');
      return c !== null && c.trim().split('\n').length === 5;
    },
  },
  {
    id: 'ess-med-4',
    nivel: 'medio',
    enunciado: 'Crie um arquivo tar simples <code>/tmp/lpi-lab/documentos.tar</code> arquivando o diretório <code>/home/ricardo/documentos</code>.',
    dica: '<b>[LPI Linux Essentials 3.4]:</b> O comando <code>tar</code> permite agrupar múltiplos arquivos; utilize opções de criação (<code>-c</code>) e especificação de arquivo (<code>-f</code>).',
    solucao: [
      { comando: 'mkdir -p /home/ricardo/documentos /tmp/lpi-lab' },
      { comando: 'tar -cf /tmp/lpi-lab/documentos.tar /home/ricardo/documentos' },
    ],
    verificar: (m) => Verificar.arquivo(m, '/tmp/lpi-lab/documentos.tar'),
  },
  {
    id: 'ess-med-5',
    nivel: 'medio',
    enunciado: 'Crie o arquivo <code>/tmp/lpi-lab/privado.txt</code> com o texto <code>Segredo 123</code> e configure permissão estrita <code>600</code>.',
    dica: '<b>[LPI Linux Essentials 5.3]:</b> Crie o conteúdo do arquivo com redirecionamento e restrinja as permissões octais para leitura e escrita exclusivas do dono com <code>chmod</code>.',
    solucao: [
      { comando: 'mkdir -p /tmp/lpi-lab' },
      { comando: 'echo "Segredo 123" > /tmp/lpi-lab/privado.txt' },
      { comando: 'chmod 600 /tmp/lpi-lab/privado.txt' },
    ],
    verificar: (m) =>
      Verificar.modo(m, '/tmp/lpi-lab/privado.txt', 0o600) &&
      Verificar.contem(m, '/tmp/lpi-lab/privado.txt', 'Segredo 123'),
  },
  {
    id: 'ess-med-6',
    nivel: 'medio',
    enunciado: 'Anexe a linha <code>LPI Essentials 010-160</code> ao arquivo <code>/tmp/lpi-lab/filosofia.txt</code>.',
    dica: '<b>[LPI Linux Essentials 2.4]:</b> Para adicionar novas linhas ao final de um arquivo sem substituir o que já existe, utilize o operador de anexação <code>&gt;&gt;</code>.',
    solucao: [{ comando: 'echo "LPI Essentials 010-160" >> /tmp/lpi-lab/filosofia.txt' }],
    verificar: (m) => Verificar.contem(m, '/tmp/lpi-lab/filosofia.txt', '010-160'),
  },
  {
    id: 'ess-med-7',
    nivel: 'medio',
    enunciado: 'Descubra a localização do utilitário <code>ls</code> com <code>which</code> e grave em <code>/tmp/lpi-lab/caminho_ls.txt</code>.',
    dica: '<b>[LPI Linux Essentials 2.1]:</b> O comando <code>which</code> localiza e retorna o caminho absoluto de executáveis localizados nos diretórios do PATH.',
    solucao: [{ comando: 'which ls > /tmp/lpi-lab/caminho_ls.txt' }],
    verificar: (m) => Verificar.contem(m, '/tmp/lpi-lab/caminho_ls.txt', 'ls'),
  },
  {
    id: 'ess-med-8',
    nivel: 'medio',
    enunciado: 'Renomeie o arquivo <code>/tmp/lpi-lab/privado.txt</code> para <code>/tmp/lpi-lab/confidencial.txt</code>.',
    dica: '<b>[LPI Linux Essentials 2.4]:</b> O comando <code>mv</code> é o utilitário padrão para renomear ou mover arquivos no sistema de arquivos Linux.',
    solucao: [
      { comando: 'touch /tmp/lpi-lab/privado.txt' },
      { comando: 'mv /tmp/lpi-lab/privado.txt /tmp/lpi-lab/confidencial.txt' },
    ],
    verificar: (m) =>
      Verificar.arquivo(m, '/tmp/lpi-lab/confidencial.txt') &&
      Verificar.naoExiste(m, '/tmp/lpi-lab/privado.txt'),
  },
  {
    id: 'ess-med-9',
    nivel: 'medio',
    enunciado: 'Busque a palavra <code>linux</code> (ignorando maiúsculas e minúsculas) em <code>/tmp/lpi-lab/filosofia.txt</code> e salve em <code>/tmp/lpi-lab/linhas_linux.txt</code>.',
    dica: '<b>[LPI Linux Essentials 3.2]:</b> No utilitário <code>grep</code>, utilize a opção que desconsidera a diferença entre maiúsculas e minúsculas (case-insensitive).',
    solucao: [
      { comando: 'echo "Linux Open Source" > /tmp/lpi-lab/filosofia.txt' },
      { comando: 'grep -i "linux" /tmp/lpi-lab/filosofia.txt > /tmp/lpi-lab/linhas_linux.txt' },
    ],
    verificar: (m) => Verificar.contem(m, '/tmp/lpi-lab/linhas_linux.txt', 'linux'),
  },
  {
    id: 'ess-med-10',
    nivel: 'medio',
    enunciado: 'Extraia os shells de login (campo 7) de <code>/etc/passwd</code> e grave em <code>/tmp/lpi-lab/shells_sistema.txt</code>.',
    dica: '<b>[LPI Linux Essentials 3.2]:</b> O comando <code>cut</code> permite recortar colunas; especifique o caractere delimitador (<code>-d</code>) e o número do campo desejado (<code>-f</code>).',
    solucao: [{ comando: 'cut -d: -f7 /etc/passwd > /tmp/lpi-lab/shells_sistema.txt' }],
    verificar: (m) => Verificar.contem(m, '/tmp/lpi-lab/shells_sistema.txt', '/bin/bash') || Verificar.contem(m, '/tmp/lpi-lab/shells_sistema.txt', 'sh'),
  },

  // --- DIFÍCIL (21..30) ---
  {
    id: 'ess-dif-1',
    nivel: 'dificil',
    enunciado: 'Ordene alfabeticamente o arquivo <code>/etc/passwd</code> e salve o resultado em <code>/tmp/lpi-lab/passwd_ordenado.txt</code>.',
    dica: '<b>[LPI Linux Essentials 3.2]:</b> O utilitário <code>sort</code> organiza os registros de um arquivo em ordem alfabética crescente.',
    solucao: [{ comando: 'sort /etc/passwd > /tmp/lpi-lab/passwd_ordenado.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/tmp/lpi-lab/passwd_ordenado.txt') && (Verificar.conteudo(m, '/tmp/lpi-lab/passwd_ordenado.txt') ?? '').trim().length > 0,
  },
  {
    id: 'ess-dif-2',
    nivel: 'dificil',
    enunciado: 'Configure o Sticky Bit (permissão <code>1777</code>) no diretório <code>/tmp/lpi-lab</code>.',
    dica: '<b>[LPI Linux Essentials 5.4]:</b> No comando <code>chmod</code>, o modo octal de 4 dígitos iniciado pelo valor especial <code>1</code> define o Sticky Bit em diretórios.',
    solucao: [{ comando: 'chmod 1777 /tmp/lpi-lab' }],
    verificar: (m) => Verificar.no(m, '/tmp/lpi-lab')?.modo === 0o1777,
  },
  {
    id: 'ess-dif-3',
    nivel: 'dificil',
    enunciado: 'Crie o atalho simbólico <code>/home/ricardo/link_filosofia</code> apontando para <code>/tmp/lpi-lab/filosofia.txt</code>.',
    dica: '<b>[LPI Linux Essentials 2.4]:</b> Para criar links do tipo simbólico, invoque o utilitário <code>ln</code> com a opção <code>-s</code>, indicando o alvo e o nome do link.',
    solucao: [{ comando: 'ln -s /tmp/lpi-lab/filosofia.txt /home/ricardo/link_filosofia' }],
    verificar: (m) => Verificar.link(m, '/home/ricardo/link_filosofia'),
  },
  {
    id: 'ess-dif-4',
    nivel: 'dificil',
    enunciado: 'Gere uma cópia compactada gzip de <code>/tmp/lpi-lab/filosofia.txt</code> em <code>/tmp/lpi-lab/filosofia.txt.gz</code>.',
    dica: '<b>[LPI Linux Essentials 3.4]:</b> O utilitário <code>gzip</code> compacta arquivos individuais; utilize opções como <code>-k</code> caso deseje preservar o arquivo original.',
    solucao: [
      { comando: 'echo "Linux Open Source" > /tmp/lpi-lab/filosofia.txt' },
      { comando: 'gzip -k /tmp/lpi-lab/filosofia.txt || gzip /tmp/lpi-lab/filosofia.txt' },
    ],
    verificar: (m) => Verificar.arquivo(m, '/tmp/lpi-lab/filosofia.txt.gz'),
  },
  {
    id: 'ess-dif-5',
    nivel: 'dificil',
    enunciado: 'Conte quantas contas no sistema NÃO possuem a palavra <code>root</code> usando pipe entre <code>grep -v</code> e <code>wc -l</code> e salve em <code>/tmp/lpi-lab/usuarios_nao_root.txt</code>.',
    dica: '<b>[LPI Linux Essentials 3.2]:</b> Combine <code>grep -v</code> (para inverter a seleção) com o utilitário <code>wc -l</code> através de um pipe (<code>|</code>).',
    solucao: [{ comando: 'grep -v "root" /etc/passwd | wc -l > /tmp/lpi-lab/usuarios_nao_root.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/tmp/lpi-lab/usuarios_nao_root.txt') && (Verificar.conteudo(m, '/tmp/lpi-lab/usuarios_nao_root.txt') ?? '').trim().length > 0,
  },
  {
    id: 'ess-dif-6',
    nivel: 'dificil',
    enunciado: 'Localize todos os arquivos terminados em <code>.log</code> dentro de <code>/var/log</code> com o comando <code>find</code> e salve a lista em <code>/tmp/lpi-lab/lista_logs.txt</code>.',
    dica: '<b>[LPI Linux Essentials 2.4]:</b> O utilitário <code>find</code> permite buscar arquivos por padrão de nome utilizando o predicado <code>-name</code>.',
    solucao: [{ comando: 'find /var/log -name "*.log" > /tmp/lpi-lab/lista_logs.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/tmp/lpi-lab/lista_logs.txt') && (Verificar.conteudo(m, '/tmp/lpi-lab/lista_logs.txt') ?? '').length > 0,
  },
  {
    id: 'ess-dif-7',
    nivel: 'dificil',
    enunciado: 'Exporte todas as variáveis de ambiente atuais com <code>env</code> para o arquivo <code>/tmp/lpi-lab/variaveis_ambiente.txt</code>.',
    dica: '<b>[LPI Linux Essentials 2.1]:</b> O comando <code>env</code> exibe a lista completa de variáveis de ambiente do shell em execução.',
    solucao: [{ comando: 'env > /tmp/lpi-lab/variaveis_ambiente.txt' }],
    verificar: (m) => Verificar.contem(m, '/tmp/lpi-lab/variaveis_ambiente.txt', 'PATH='),
  },
  {
    id: 'ess-dif-8',
    nivel: 'dificil',
    enunciado: 'Crie o script executável <code>/tmp/lpi-lab/script.sh</code> com permissão <code>755</code> contendo a linha <code>echo Ola $USER</code>.',
    dica: '<b>[LPI Linux Essentials 2.4 / 5.3]:</b> Crie o arquivo com o comando desejado e atribua a permissão de execução usando <code>chmod</code>.',
    solucao: [
      { comando: 'echo "echo Ola $USER" > /tmp/lpi-lab/script.sh' },
      { comando: 'chmod 755 /tmp/lpi-lab/script.sh' },
    ],
    verificar: (m) =>
      Verificar.modo(m, '/tmp/lpi-lab/script.sh', 0o755) &&
      Verificar.contem(m, '/tmp/lpi-lab/script.sh', 'echo Ola'),
  },
  {
    id: 'ess-dif-9',
    nivel: 'dificil',
    enunciado: 'Crie o grupo <code>lpistudents</code> e crie a conta de usuário <code>aluno1</code> associada a este grupo secundário.',
    dica: '<b>[LPI Linux Essentials 5.1]:</b> Crie o grupo com <code>groupadd</code> e em seguida use <code>useradd</code> com as opções para home e grupo suplementar.',
    solucao: [
      { comando: 'groupadd lpistudents' },
      { comando: 'useradd -m -s /bin/bash -G lpistudents aluno1' },
    ],
    verificar: (m) => Verificar.membro(m, 'aluno1', 'lpistudents'),
  },
  {
    id: 'ess-dif-10',
    nivel: 'dificil',
    enunciado: 'Altere o proprietário e grupo do script <code>/tmp/lpi-lab/script.sh</code> para <code>aluno1:lpistudents</code>.',
    dica: '<b>[LPI Linux Essentials 5.3]:</b> O utilitário <code>chown</code> altera proprietário e grupo na mesma instrução usando a notação <code>usuario:grupo</code>.',
    solucao: [{ comando: 'chown aluno1:lpistudents /tmp/lpi-lab/script.sh' }],
    verificar: (m) => Verificar.dono(m, '/tmp/lpi-lab/script.sh', 'aluno1', 'lpistudents'),
  },
];

// ============================================================================
// 6. LPIC-1 (30 Desafios: 10 Fáceis, 10 Médios, 10 Difíceis)
// ============================================================================
export const desafiosLPIC1: Desafio[] = [
  // --- FÁCIL (1..10) ---
  {
    id: 'lpic-fac-1',
    nivel: 'facil',
    enunciado: 'Atualize as listas de repositórios locais com o comando oficial <code>apt update</code>.',
    dica: '<b>[LPIC-1 102.4]:</b> O comando <code>apt update</code> sincroniza o catálogo local de pacotes a partir dos repositórios configurados.',
    solucao: [{ comando: 'apt update' }],
    verificar: (m) => new GerenciadorDePacotes(m).listasAtualizadas(),
  },
  {
    id: 'lpic-fac-2',
    nivel: 'facil',
    enunciado: 'Instale o pacote <code>tree</code> através do APT.',
    dica: '<b>[LPIC-1 102.4]:</b> Use a ação de instalação do gerenciador de pacotes <code>apt</code> com a flag <code>-y</code> para instalar o utilitário.',
    solucao: [{ comando: 'apt install -y tree' }],
    verificar: (m) => new GerenciadorDePacotes(m).instalado('tree'),
  },
  {
    id: 'lpic-fac-3',
    nivel: 'facil',
    enunciado: 'Inspecione a arquitetura e detalhes completos do sistema operacional com <code>uname -a</code> e grave em <code>/home/ricardo/info_kernel.txt</code>.',
    dica: '<b>[LPIC-1 101.1]:</b> O comando <code>uname</code> com a flag <code>-a</code> (all) imprime todas as informações de arquitetura, versão do kernel e sistema operacional.',
    solucao: [{ comando: 'uname -a > /home/ricardo/info_kernel.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/info_kernel.txt') && (Verificar.conteudo(m, '/home/ricardo/info_kernel.txt') ?? '').trim().length > 0,
  },
  {
    id: 'lpic-fac-4',
    nivel: 'facil',
    enunciado: 'Crie o grupo de segurança de sistema chamado <code>auditores</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> O comando <code>groupadd</code> registra novos grupos de segurança no sistema operacional.',
    solucao: [{ comando: 'groupadd auditores' }],
    verificar: (m) => Verificar.grupo(m, 'auditores') !== undefined,
  },
  {
    id: 'lpic-fac-5',
    nivel: 'facil',
    enunciado: 'Crie a conta de usuário <code>auditor1</code> com diretório home e shell <code>/bin/bash</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> No utilitário <code>useradd</code>, utilize opções para criar o diretório pessoal (home) e definir o interpretador de comandos (shell).',
    solucao: [{ comando: 'useradd -m -s /bin/bash auditor1' }],
    verificar: (m) => Verificar.usuario(m, 'auditor1') !== undefined,
  },
  {
    id: 'lpic-fac-6',
    nivel: 'facil',
    enunciado: 'Defina a senha de autenticação para o usuário <code>auditor1</code> com o comando <code>passwd</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> O comando <code>passwd</code> é a ferramenta oficial para cadastrar e atualizar credenciais de usuários.',
    solucao: [{ comando: 'passwd auditor1', respostas: ['123', '123'] }],
    verificar: (m) => (Verificar.usuario(m, 'auditor1')?.senha ?? null) !== null,
  },
  {
    id: 'lpic-fac-7',
    nivel: 'facil',
    enunciado: 'Crie o atalho simbólico <code>/home/ricardo/fstab_link</code> apontando para a tabela de sistemas de arquivos <code>/etc/fstab</code>.',
    dica: '<b>[LPIC-1 104.6]:</b> O utilitário <code>ln</code> requer a opção <code>-s</code> para estabelecer vínculos do tipo link simbólico.',
    solucao: [{ comando: 'ln -s /etc/fstab /home/ricardo/fstab_link' }],
    verificar: (m) => Verificar.link(m, '/home/ricardo/fstab_link'),
  },
  {
    id: 'lpic-fac-8',
    nivel: 'facil',
    enunciado: 'Restrinja as permissões do arquivo crítico <code>/etc/shadow</code> para <code>600</code>.',
    dica: '<b>[LPIC-1 104.5]:</b> O utilitário <code>chmod</code> aceita valores octais; para apenas leitura e escrita do proprietário, utilize a notação numérica correspondente.',
    solucao: [{ comando: 'chmod 600 /etc/shadow' }],
    verificar: (m) => Verificar.modo(m, '/etc/shadow', 0o600),
  },
  {
    id: 'lpic-fac-9',
    nivel: 'facil',
    enunciado: 'Verifique se o daemon SSH está ativo usando <code>systemctl is-active ssh</code> e salve a resposta em <code>/home/ricardo/ssh_ativo.txt</code>.',
    dica: '<b>[LPIC-1 101.3]:</b> O comando <code>systemctl</code> possui o subcomando <code>is-active</code> para testar programmaticamente se uma unidade está em execução.',
    solucao: [{ comando: 'systemctl is-active ssh > /home/ricardo/ssh_ativo.txt' }],
    verificar: (m) => Verificar.contem(m, '/home/ricardo/ssh_ativo.txt', 'active'),
  },
  {
    id: 'lpic-fac-10',
    nivel: 'facil',
    enunciado: 'Adicione o alias <code>grep</code> colorido ao arquivo <code>/home/ricardo/.bashrc</code>.',
    dica: '<b>[LPIC-1 105.1]:</b> Utilize o operador de concatenação duplo (<code>&gt;&gt;</code>) para anexar a definição de alias ao arquivo de inicialização do shell.',
    solucao: [{ comando: "echo 'alias grep=\"grep --color=auto\"' >> /home/ricardo/.bashrc" }],
    verificar: (m) => Verificar.contem(m, '/home/ricardo/.bashrc', 'alias grep='),
  },

  // --- MÉDIO (11..20) ---
  {
    id: 'lpic-med-1',
    nivel: 'medio',
    enunciado: 'Atualize os índices locais e instale todas as atualizações de segurança disponíveis com o APT.',
    dica: '<b>[LPIC-1 102.4]:</b> Combine a atualização da lista de repositórios com a atualização dos pacotes instalados através dos subcomandos do <code>apt</code>.',
    solucao: [
      { comando: 'apt update' },
      { comando: 'apt upgrade -y' },
    ],
    verificar: (m) => {
      const g = new GerenciadorDePacotes(m);
      return g.listasAtualizadas() && g.atualizaveis().length === 0;
    },
  },
  {
    id: 'lpic-med-2',
    nivel: 'medio',
    enunciado: 'Crie uma conta de serviço para o sistema chamada <code>deploybot</code> com diretório home e shell restrito <code>/usr/sbin/nologin</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> No comando <code>useradd</code>, utilize a flag de shell para apontar para um interpretador restrito que impeça sessões interativas.',
    solucao: [{ comando: 'useradd -m -s /usr/sbin/nologin deploybot' }],
    verificar: (m) =>
      Verificar.usuario(m, 'deploybot')?.shell === '/usr/sbin/nologin' &&
      Verificar.diretorio(m, '/home/deploybot'),
  },
  {
    id: 'lpic-med-3',
    nivel: 'medio',
    enunciado: 'Crie o atalho simbólico <code>/usr/local/bin/srv-web</code> apontando para o binário <code>/usr/sbin/nginx</code>.',
    dica: '<b>[LPIC-1 104.6]:</b> Crie o atalho simbólico com <code>ln -s</code>, indicando primeiro a localização do binário original e depois o caminho do link.',
    solucao: [{ comando: 'ln -s /usr/sbin/nginx /usr/local/bin/srv-web' }],
    verificar: (m) => Verificar.link(m, '/usr/local/bin/srv-web'),
  },
  {
    id: 'lpic-med-4',
    nivel: 'medio',
    enunciado: 'Conceda privilégios de superusuário a <code>ricardo</code> adicionando-o ao grupo <code>sudo</code> sem retirá-lo de outros grupos.',
    dica: '<b>[LPIC-1 107.1]:</b> No <code>usermod</code>, use sempre a combinação da flag de append com a de grupos secundários para não sobrescrever os grupos pré-existentes.',
    solucao: [{ comando: 'usermod -aG sudo ricardo' }],
    verificar: (m) => Verificar.membro(m, 'ricardo', 'sudo'),
  },
  {
    id: 'lpic-med-5',
    nivel: 'medio',
    enunciado: 'Crie o diretório de aplicação <code>/opt/app</code>, atribua a posse para <code>deploybot:auditores</code> e aplique permissão <code>770</code>.',
    dica: '<b>[LPIC-1 104.5]:</b> Crie a pasta, aplique a posse com <code>chown</code> no formato <code>usuario:grupo</code> e ajuste os privilégios octais com <code>chmod</code>.',
    solucao: [
      { comando: 'mkdir -p /opt/app' },
      { comando: 'chown deploybot:auditores /opt/app' },
      { comando: 'chmod 770 /opt/app' },
    ],
    verificar: (m) =>
      Verificar.dono(m, '/opt/app', 'deploybot', 'auditores') &&
      Verificar.modo(m, '/opt/app', 0o770),
  },
  {
    id: 'lpic-med-6',
    nivel: 'medio',
    enunciado: 'Adicione o usuário <code>auditor1</code> ao grupo secundário <code>auditores</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> Utilize o comando <code>usermod</code> com a combinação de opções necessária para adicionar o usuário a um grupo suplementar.',
    solucao: [{ comando: 'usermod -aG auditores auditor1' }],
    verificar: (m) => Verificar.membro(m, 'auditor1', 'auditores'),
  },
  {
    id: 'lpic-med-7',
    nivel: 'medio',
    enunciado: 'Gere um arquivo tar compactado <code>/home/ricardo/pam_backup.tar.gz</code> contendo <code>/etc/pam.d</code>.',
    dica: '<b>[LPIC-1 103.5]:</b> O comando <code>tar</code> suporta criação de arquivo (<code>-c</code>), compactação gzip (<code>-z</code>) e especificação de nome (<code>-f</code>).',
    solucao: [{ comando: 'tar -czf /home/ricardo/pam_backup.tar.gz /etc/pam.d' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/pam_backup.tar.gz'),
  },
  {
    id: 'lpic-med-8',
    nivel: 'medio',
    enunciado: 'Extraia os campos 1 (nome) e 3 (UID) de <code>/etc/passwd</code> delimitados por dois pontos e salve em <code>/home/ricardo/uid_usuarios.txt</code>.',
    dica: '<b>[LPIC-1 103.2]:</b> O utilitário <code>cut</code> permite recortar múltiplos campos separados por delimitador informando as posições separadas por vírgula na flag de campos.',
    solucao: [{ comando: 'cut -d: -f1,3 /etc/passwd > /home/ricardo/uid_usuarios.txt' }],
    verificar: (m) => Verificar.contem(m, '/home/ricardo/uid_usuarios.txt', 'root:0'),
  },
  {
    id: 'lpic-med-9',
    nivel: 'medio',
    enunciado: 'Crie a pasta de descarte <code>/srv/dropzone</code> e aplique o Sticky Bit (<code>1777</code>).',
    dica: '<b>[LPIC-1 104.5]:</b> Crie o diretório e configure o Sticky Bit através da representação octal iniciada pelo dígito <code>1</code> no <code>chmod</code>.',
    solucao: [
      { comando: 'mkdir -p /srv/dropzone' },
      { comando: 'chmod 1777 /srv/dropzone' },
    ],
    verificar: (m) => Verificar.no(m, '/srv/dropzone')?.modo === 0o1777,
  },
  {
    id: 'lpic-med-10',
    nivel: 'medio',
    enunciado: 'Grave as 10 primeiras mensagens do buffer do kernel com <code>dmesg</code> em <code>/home/ricardo/boot_messages.txt</code>.',
    dica: '<b>[LPIC-1 101.2]:</b> Conecte o leitor do buffer do kernel <code>dmesg</code> ao utilitário <code>head</code> através de um pipe para limitar o total de linhas exibidas.',
    solucao: [{ comando: 'dmesg | head -n 10 > /home/ricardo/boot_messages.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/boot_messages.txt') && (Verificar.conteudo(m, '/home/ricardo/boot_messages.txt') ?? '').trim().length > 0,
  },

  // --- DIFÍCIL (21..30) ---
  {
    id: 'lpic-dif-1',
    nivel: 'dificil',
    enunciado: 'Remova completamente o usuário de serviço <code>deploybot</code> e apague também sua pasta <code>/home/deploybot</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> O utilitário <code>userdel</code> possui uma flag específica para expurgar a conta juntamente com seu diretório home e arquivos.',
    solucao: [{ comando: 'userdel -r deploybot' }],
    verificar: (m) => Verificar.usuario(m, 'deploybot') === undefined && Verificar.naoExiste(m, '/home/deploybot'),
  },
  {
    id: 'lpic-dif-2',
    nivel: 'dificil',
    enunciado: 'Instale o servidor web <code>nginx</code> e habilite-o para iniciar automaticamente no boot com o systemctl.',
    dica: '<b>[LPIC-1 102.4 / 108.1]:</b> Instale o pacote com <code>apt</code> e utilize a ação de habilitação automática de boot do <code>systemctl</code>.',
    solucao: [
      { comando: 'apt install -y nginx' },
      { comando: 'systemctl enable nginx' },
    ],
    verificar: (m) => new Servicos(m).ativo('nginx'),
  },
  {
    id: 'lpic-dif-3',
    nivel: 'dificil',
    enunciado: 'Crie o diretório de dados restritos <code>/srv/seguro</code>, atribua a posse a <code>root:auditores</code> e aplique a permissão especial SGID (<code>2770</code>).',
    dica: '<b>[LPIC-1 104.5]:</b> Crie o diretório, defina dono e grupo com <code>chown</code> e configure a permissão especial SGID iniciada por <code>2</code> no <code>chmod</code>.',
    solucao: [
      { comando: 'mkdir -p /srv/seguro' },
      { comando: 'chown root:auditores /srv/seguro' },
      { comando: 'chmod 2770 /srv/seguro' },
    ],
    verificar: (m) =>
      Verificar.no(m, '/srv/seguro')?.modo === 0o2770 &&
      Verificar.grupoDoNo(m, '/srv/seguro', 'auditores'),
  },
  {
    id: 'lpic-dif-4',
    nivel: 'dificil',
    enunciado: 'Desinstale o pacote <code>nginx</code> expurgando todos os seus arquivos de configuração com <code>apt purge</code>.',
    dica: '<b>[LPIC-1 102.4]:</b> No gerenciador <code>apt</code>, utilize o subcomando que remove pacotes e expurga completamente seus arquivos de configuração residuais.',
    solucao: [{ comando: 'apt purge -y nginx' }],
    verificar: (m) => !new GerenciadorDePacotes(m).instalado('nginx'),
  },
  {
    id: 'lpic-dif-5',
    nivel: 'dificil',
    enunciado: 'Encontre todos os arquivos de configuração <code>*.conf</code> em <code>/etc</code> e grave os caminhos em <code>/home/ricardo/arquivos_conf.txt</code>.',
    dica: '<b>[LPIC-1 104.7]:</b> Utilize o utilitário <code>find</code> especificando o diretório de busca e o predicado de busca por máscara de nome.',
    solucao: [{ comando: 'find /etc -name "*.conf" > /home/ricardo/arquivos_conf.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/home/ricardo/arquivos_conf.txt') && (Verificar.conteudo(m, '/home/ricardo/arquivos_conf.txt') ?? '').trim().length > 0,
  },
  {
    id: 'lpic-dif-6',
    nivel: 'dificil',
    enunciado: 'Filtre todas as linhas de <code>/etc/group</code> que começam com letras minúsculas usando expressão regular e salve em <code>/home/ricardo/grupos_validos.txt</code>.',
    dica: '<b>[LPIC-1 103.7]:</b> O comando <code>grep</code> com a opção de expressões regulares estendidas permite casar padrões ancorados no início de cada linha.',
    solucao: [{ comando: 'grep -E "^[a-z]+" /etc/group > /home/ricardo/grupos_validos.txt' }],
    verificar: (m) => Verificar.contem(m, '/home/ricardo/grupos_validos.txt', 'root:') || Verificar.contem(m, '/home/ricardo/grupos_validos.txt', 'sudo:'),
  },
  {
    id: 'lpic-dif-7',
    nivel: 'dificil',
    enunciado: 'Habilite o encaminhamento de pacotes IPv4 gravando a linha <code>net.ipv4.ip_forward = 1</code> em <code>/etc/sysctl.d/99-custom.conf</code>.',
    dica: '<b>[LPIC-1 102.1]:</b> Parâmetros do kernel podem ser persistidos criando arquivos em <code>/etc/sysctl.d/</code> com operadores de redirecionamento de saída.',
    solucao: [
      { comando: 'mkdir -p /etc/sysctl.d' },
      { comando: 'echo "net.ipv4.ip_forward = 1" > /etc/sysctl.d/99-custom.conf' },
    ],
    verificar: (m) => Verificar.contem(m, '/etc/sysctl.d/99-custom.conf', 'net.ipv4.ip_forward'),
  },
  {
    id: 'lpic-dif-8',
    nivel: 'dificil',
    enunciado: 'Substitua todas as ocorrências de <code>bash</code> por <code>sh</code> no arquivo <code>/etc/passwd</code> usando <code>sed</code> e salve em <code>/home/ricardo/passwd_sh.txt</code>.',
    dica: '<b>[LPIC-1 103.2]:</b> O editor de fluxo <code>sed</code> utiliza a sintaxe de substituição global <code>s/padrao/substituto/g</code> para transformar textos em lote.',
    solucao: [{ comando: "sed s/bash/sh/g /etc/passwd > /home/ricardo/passwd_sh.txt" }],
    verificar: (m) =>
      Verificar.arquivo(m, '/home/ricardo/passwd_sh.txt') &&
      !Verificar.contem(m, '/home/ricardo/passwd_sh.txt', '/bin/bash') &&
      Verificar.contem(m, '/home/ricardo/passwd_sh.txt', '/bin/sh'),
  },
  {
    id: 'lpic-dif-9',
    nivel: 'dificil',
    enunciado: 'Filtre os processos ativos relacionados ao <code>ssh</code> através de pipe entre <code>ps aux</code> e <code>grep</code> e salve em <code>/home/ricardo/processos_ssh.txt</code>.',
    dica: '<b>[LPIC-1 103.5]:</b> Liste os processos do sistema com <code>ps aux</code> e filtre as linhas desejadas conectando a saída ao <code>grep</code> via pipe.',
    solucao: [{ comando: 'ps aux | grep ssh > /home/ricardo/processos_ssh.txt' }],
    verificar: (m) => Verificar.contem(m, '/home/ricardo/processos_ssh.txt', 'ssh'),
  },
  {
    id: 'lpic-dif-10',
    nivel: 'dificil',
    enunciado: 'Extraia os campos 1 e 6 de <code>/etc/passwd</code> para mapear usuários e seus respectivos diretórios home em <code>/home/ricardo/mapeamento_homes.txt</code>.',
    dica: '<b>[LPIC-1 103.2]:</b> O comando <code>cut</code> com as opções de delimitador (<code>:</code>) e lista de campos (<code>1,6</code>) extrai simultaneamente o usuário e sua home.',
    solucao: [{ comando: 'cut -d: -f1,6 /etc/passwd > /home/ricardo/mapeamento_homes.txt' }],
    verificar: (m) => Verificar.contem(m, '/home/ricardo/mapeamento_homes.txt', 'root:/root'),
  },
];

// ============================================================================
// 7. SERVIDOR ESCOLA (30 Desafios: 10 Fáceis, 10 Médios, 10 Difíceis)
// ============================================================================
export const desafiosEscola: Desafio[] = [
  // --- FÁCIL (1..10) ---
  {
    id: 'esc-fac-1',
    nivel: 'facil',
    enunciado: 'Crie a estrutura básica <code>/srv/escola/docs</code>, <code>/srv/escola/scripts</code> e <code>/srv/escola/publico</code>.',
    dica: '<b>[LPIC-1 103.3]:</b> O comando <code>mkdir</code> com a flag <code>-p</code> aceita múltiplos caminhos em uma única linha para criar várias estruturas de pastas.',
    solucao: [{ comando: 'mkdir -p /srv/escola/docs /srv/escola/scripts /srv/escola/publico' }],
    verificar: (m) => ['docs', 'scripts', 'publico'].every((p: string) => Verificar.diretorio(m, '/srv/escola/' + p)),
  },
  {
    id: 'esc-fac-2',
    nivel: 'facil',
    enunciado: 'Crie o arquivo institucional <code>/srv/escola/docs/titulo.txt</code> com o texto <code>Portal da Escola</code>.',
    dica: '<b>[LPIC-1 103.4]:</b> Utilize o comando <code>echo</code> com o operador de redirecionamento simples (<code>&gt;</code>) para gravar texto em um novo arquivo.',
    solucao: [
      { comando: 'mkdir -p /srv/escola/docs' },
      { comando: 'echo "Portal da Escola" > /srv/escola/docs/titulo.txt' },
    ],
    verificar: (m) => Verificar.contem(m, '/srv/escola/docs/titulo.txt', 'Portal da Escola'),
  },
  {
    id: 'esc-fac-3',
    nivel: 'facil',
    enunciado: 'Crie o grupo de trabalho chamado <code>professores</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> O utilitário <code>groupadd</code> é o comando padrão para cadastrar novos grupos de trabalho no sistema operacional.',
    solucao: [{ comando: 'groupadd professores' }],
    verificar: (m) => Verificar.grupo(m, 'professores') !== undefined,
  },
  {
    id: 'esc-fac-4',
    nivel: 'facil',
    enunciado: 'Crie o grupo de estudantes chamado <code>alunos</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> Utilize o utilitário <code>groupadd</code> para registrar o novo grupo de estudantes no sistema.',
    solucao: [{ comando: 'groupadd alunos' }],
    verificar: (m) => Verificar.grupo(m, 'alunos') !== undefined,
  },
  {
    id: 'esc-fac-5',
    nivel: 'facil',
    enunciado: 'Crie a conta da professora coordenadora <code>sediane</code> (com home e shell bash).',
    dica: '<b>[LPIC-1 107.1]:</b> No comando <code>useradd</code>, utilize opções para criar automaticamente o diretório home e definir o shell de login.',
    solucao: [{ comando: 'useradd -m -s /bin/bash sediane' }],
    verificar: (m) => Verificar.usuario(m, 'sediane') !== undefined && Verificar.diretorio(m, '/home/sediane'),
  },
  {
    id: 'esc-fac-6',
    nivel: 'facil',
    enunciado: 'Defina a senha da usuária <code>sediane</code> com <code>passwd</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> O utilitário <code>passwd</code> permite que administradores definam ou alterem senhas de usuários cadastrados.',
    solucao: [{ comando: 'passwd sediane', respostas: ['123', '123'] }],
    verificar: (m) => (Verificar.usuario(m, 'sediane')?.senha ?? null) !== null,
  },
  {
    id: 'esc-fac-7',
    nivel: 'facil',
    enunciado: 'Crie a conta de estudante <code>ana</code> (com home e shell bash).',
    dica: '<b>[LPIC-1 107.1]:</b> Crie a conta com <code>useradd</code>, lembrando de incluir as flags para geração da pasta pessoal e definição do interpretador bash.',
    solucao: [{ comando: 'useradd -m -s /bin/bash ana' }],
    verificar: (m) => Verificar.usuario(m, 'ana') !== undefined && Verificar.diretorio(m, '/home/ana'),
  },
  {
    id: 'esc-fac-8',
    nivel: 'facil',
    enunciado: 'Defina a senha da usuária <code>ana</code> com <code>passwd</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> Utilize o comando <code>passwd</code> indicando o nome de usuário cuja credencial deve ser configurada.',
    solucao: [{ comando: 'passwd ana', respostas: ['123', '123'] }],
    verificar: (m) => (Verificar.usuario(m, 'ana')?.senha ?? null) !== null,
  },
  {
    id: 'esc-fac-9',
    nivel: 'facil',
    enunciado: 'Crie o arquivo de recados <code>/srv/escola/publico/mural.txt</code>.',
    dica: '<b>[LPIC-1 103.3]:</b> Utilize o utilitário <code>touch</code> para criar arquivos vazios no caminho indicado caso eles ainda não existam.',
    solucao: [
      { comando: 'mkdir -p /srv/escola/publico' },
      { comando: 'touch /srv/escola/publico/mural.txt' },
    ],
    verificar: (m) => Verificar.arquivo(m, '/srv/escola/publico/mural.txt'),
  },
  {
    id: 'esc-fac-10',
    nivel: 'facil',
    enunciado: 'Ajuste a permissão da pasta <code>/srv/escola/docs</code> para <code>755</code>.',
    dica: '<b>[LPIC-1 104.5]:</b> O utilitário <code>chmod</code> aceita a representação octal de 3 dígitos (dono, grupo e outros) para redefinir permissões de acesso.',
    solucao: [{ comando: 'chmod 755 /srv/escola/docs' }],
    verificar: (m) => Verificar.modo(m, '/srv/escola/docs', 0o755),
  },

  // --- MÉDIO (11..20) ---
  {
    id: 'esc-med-1',
    nivel: 'medio',
    enunciado: 'Adicione a coordenadora <code>sediane</code> ao grupo <code>professores</code> com <code>usermod -aG</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> No utilitário <code>usermod</code>, combine a flag de append com a de grupo suplementar para vincular a usuária sem afetar seus grupos atuais.',
    solucao: [{ comando: 'usermod -aG professores sediane' }],
    verificar: (m) => Verificar.membro(m, 'sediane', 'professores'),
  },
  {
    id: 'esc-med-2',
    nivel: 'medio',
    enunciado: 'Adicione a aluna <code>ana</code> ao grupo <code>alunos</code> com <code>usermod -aG</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> Utilize <code>usermod</code> com a combinação de opções de adição a grupo secundário mantendo os demais grupos da usuária.',
    solucao: [{ comando: 'usermod -aG alunos ana' }],
    verificar: (m) => Verificar.membro(m, 'ana', 'alunos'),
  },
  {
    id: 'esc-med-3',
    nivel: 'medio',
    enunciado: 'Crie o arquivo <code>/srv/escola/docs/regras.txt</code> com as linhas <code>Prova de Linux</code> e <code>Sem consulta</code>.',
    dica: '<b>[LPIC-1 103.4]:</b> Grave a primeira linha com o operador de criação (<code>&gt;</code>) e a linha subsequente com o operador de anexação (<code>&gt;&gt;</code>).',
    solucao: [
      { comando: 'echo "Prova de Linux" > /srv/escola/docs/regras.txt' },
      { comando: 'echo "Sem consulta" >> /srv/escola/docs/regras.txt' },
    ],
    verificar: (m) => {
      const c = Verificar.conteudo(m, '/srv/escola/docs/regras.txt') ?? '';
      return c.includes('Prova de Linux') && c.includes('Sem consulta');
    },
  },
  {
    id: 'esc-med-4',
    nivel: 'medio',
    enunciado: 'A pasta <code>/srv/escola/docs</code> deve pertencer a <code>sediane:professores</code> com permissão restrita <code>770</code>.',
    dica: '<b>[LPIC-1 104.5]:</b> Altere proprietário e grupo com <code>chown</code> no formato <code>usuario:grupo</code> e aplique a máscara octal requerida com <code>chmod</code>.',
    solucao: [
      { comando: 'chown -R sediane:professores /srv/escola/docs' },
      { comando: 'chmod 770 /srv/escola/docs' },
    ],
    verificar: (m) =>
      Verificar.dono(m, '/srv/escola/docs', 'sediane', 'professores') &&
      Verificar.modo(m, '/srv/escola/docs', 0o770),
  },
  {
    id: 'esc-med-5',
    nivel: 'medio',
    enunciado: 'Configure o Sticky Bit (<code>1777</code>) no mural público <code>/srv/escola/publico</code>.',
    dica: '<b>[LPIC-1 104.5]:</b> O Sticky Bit impede que usuários apaguem arquivos de outros em pastas públicas; utilize o modo octal iniciado por <code>1</code> no <code>chmod</code>.',
    solucao: [{ comando: 'chmod 1777 /srv/escola/publico' }],
    verificar: (m) => Verificar.no(m, '/srv/escola/publico')?.modo === 0o1777,
  },
  {
    id: 'esc-med-6',
    nivel: 'medio',
    enunciado: 'Copie <code>regras.txt</code> para a home da <code>ana</code> (<code>/home/ana/regras.txt</code>) e torne-a dona do arquivo.',
    dica: '<b>[LPIC-1 103.3 / 104.5]:</b> Copie o arquivo com <code>cp</code> e em seguida altere o proprietário e grupo do arquivo de destino utilizando <code>chown</code>.',
    solucao: [
      { comando: 'cp /srv/escola/docs/regras.txt /home/ana/' },
      { comando: 'chown ana:alunos /home/ana/regras.txt' },
    ],
    verificar: (m) =>
      Verificar.dono(m, '/home/ana/regras.txt', 'ana') &&
      Verificar.contem(m, '/home/ana/regras.txt', 'Prova de Linux'),
  },
  {
    id: 'esc-med-7',
    nivel: 'medio',
    enunciado: 'Crie o script de boas-vindas <code>/srv/escola/scripts/boasvindas.sh</code> com a linha <code>echo Bem-vindo</code> e permissão <code>755</code>.',
    dica: '<b>[LPIC-1 103.3 / 104.5]:</b> Crie o script com a instrução informada e conceda permissão de execução utilizando o utilitário <code>chmod</code>.',
    solucao: [
      { comando: 'echo "echo Bem-vindo" > /srv/escola/scripts/boasvindas.sh' },
      { comando: 'chmod 755 /srv/escola/scripts/boasvindas.sh' },
    ],
    verificar: (m) =>
      Verificar.modo(m, '/srv/escola/scripts/boasvindas.sh', 0o755) &&
      Verificar.contem(m, '/srv/escola/scripts/boasvindas.sh', 'echo'),
  },
  {
    id: 'esc-med-8',
    nivel: 'medio',
    enunciado: 'Crie o aluno <code>beto</code> associado ao grupo <code>alunos</code> com senha definida.',
    dica: '<b>[LPIC-1 107.1]:</b> Crie a conta vinculando-a ao grupo suplementar com <code>useradd</code> e em seguida configure sua senha com <code>passwd</code>.',
    solucao: [
      { comando: 'useradd -m -s /bin/bash -G alunos beto' },
      { comando: 'passwd beto', respostas: ['123', '123'] },
    ],
    verificar: (m) =>
      Verificar.membro(m, 'beto', 'alunos') &&
      Verificar.diretorio(m, '/home/beto'),
  },
  {
    id: 'esc-med-9',
    nivel: 'medio',
    enunciado: 'O aluno <code>beto</code> trancou a matrícula: remova a conta e a pasta pessoal dele.',
    dica: '<b>[LPIC-1 107.1]:</b> No comando <code>userdel</code>, consulte a opção que elimina a pasta pessoal (home) juntamente com a exclusão da conta.',
    solucao: [{ comando: 'userdel -r beto' }],
    verificar: (m) =>
      Verificar.usuario(m, 'beto') === undefined &&
      Verificar.naoExiste(m, '/home/beto'),
  },
  {
    id: 'esc-med-10',
    nivel: 'medio',
    enunciado: 'Remova recursivamente a pasta de scripts legados <code>/srv/escola/scripts</code>.',
    dica: '<b>[LPIC-1 103.3]:</b> Para remover um diretório e todo o seu conteúdo interno de forma completa, utilize o comando <code>rm</code> com a opção recursiva.',
    solucao: [{ comando: 'rm -r /srv/escola/scripts' }],
    verificar: (m) => Verificar.naoExiste(m, '/srv/escola/scripts'),
  },

  // --- DIFÍCIL (21..30) ---
  {
    id: 'esc-dif-1',
    nivel: 'dificil',
    enunciado: 'Atualize os índices locais com <code>apt update</code> e instale as atualizações pendentes do servidor escolar.',
    dica: '<b>[LPIC-1 102.4]:</b> Sincronize a lista de pacotes com <code>apt update</code> e aplique as correções pendentes utilizando a ação de upgrade do <code>apt</code>.',
    solucao: [
      { comando: 'apt update' },
      { comando: 'apt upgrade -y' },
    ],
    verificar: (m) => {
      const g = new GerenciadorDePacotes(m);
      return g.listasAtualizadas() && g.atualizaveis().length === 0;
    },
  },
  {
    id: 'esc-dif-2',
    nivel: 'dificil',
    enunciado: 'Instale o servidor web <code>nginx</code> e faça a página inicial padrão exibir <code>Escola Linux</code>.',
    dica: '<b>[LPIC-1 108.1]:</b> Instale o pacote com o gerenciador <code>apt</code> e direcione o texto para a página raiz padrão do servidor web usando <code>&gt;</code>.',
    solucao: [
      { comando: 'apt install -y nginx' },
      { comando: 'echo "Escola Linux" > /var/www/html/index.html' },
    ],
    verificar: (m) =>
      new Servicos(m).ativo('nginx') &&
      Verificar.contem(m, '/var/www/html/index.html', 'Escola Linux'),
  },
  {
    id: 'esc-dif-3',
    nivel: 'dificil',
    enunciado: 'Crie o atalho simbólico <code>/srv/escola/portal-web</code> apontando para a pasta raiz <code>/var/www/html</code>.',
    dica: '<b>[LPIC-1 104.6]:</b> Utilize <code>ln -s</code> indicando o diretório web original e o caminho desejado para o link simbólico.',
    solucao: [{ comando: 'ln -s /var/www/html /srv/escola/portal-web' }],
    verificar: (m) => Verificar.link(m, '/srv/escola/portal-web'),
  },
  {
    id: 'esc-dif-4',
    nivel: 'dificil',
    enunciado: 'Crie a pasta confidencial <code>/srv/escola/notas</code> pertencente a <code>sediane:professores</code> com SGID (<code>2770</code>).',
    dica: '<b>[LPIC-1 104.5]:</b> Crie o diretório, defina a posse com <code>chown</code> e configure o bit especial SGID (iniciado por <code>2</code> no modo octal de 4 dígitos) com <code>chmod</code>.',
    solucao: [
      { comando: 'mkdir -p /srv/escola/notas' },
      { comando: 'chown sediane:professores /srv/escola/notas' },
      { comando: 'chmod 2770 /srv/escola/notas' },
    ],
    verificar: (m) =>
      Verificar.no(m, '/srv/escola/notas')?.modo === 0o2770 &&
      Verificar.grupoDoNo(m, '/srv/escola/notas', 'professores'),
  },
  {
    id: 'esc-dif-5',
    nivel: 'dificil',
    enunciado: 'Crie o gabarito oficial em <code>/srv/escola/docs/gabarito.txt</code> com permissão estrita <code>600</code> pertencente a <code>sediane:professores</code>.',
    dica: '<b>[LPIC-1 104.5]:</b> Crie o arquivo vazio com <code>touch</code>, atribua dono e grupo com <code>chown</code> e restrinja os acessos através de <code>chmod</code>.',
    solucao: [
      { comando: 'touch /srv/escola/docs/gabarito.txt' },
      { comando: 'chown sediane:professores /srv/escola/docs/gabarito.txt' },
      { comando: 'chmod 600 /srv/escola/docs/gabarito.txt' },
    ],
    verificar: (m) =>
      Verificar.arquivo(m, '/srv/escola/docs/gabarito.txt') &&
      Verificar.modo(m, '/srv/escola/docs/gabarito.txt', 0o600),
  },
  {
    id: 'esc-dif-6',
    nivel: 'dificil',
    enunciado: 'Gere um arquivo tar compactado <code>/srv/escola/backup_docs.tar.gz</code> contendo toda a pasta <code>/srv/escola/docs</code>.',
    dica: '<b>[LPIC-1 103.5]:</b> No comando <code>tar</code>, utilize opções para criar o arquivo, aplicar compressão gzip e definir o arquivo de destino.',
    solucao: [{ comando: 'tar -czf /srv/escola/backup_docs.tar.gz /srv/escola/docs' }],
    verificar: (m) => Verificar.arquivo(m, '/srv/escola/backup_docs.tar.gz'),
  },
  {
    id: 'esc-dif-7',
    nivel: 'dificil',
    enunciado: 'Crie o grupo administrativo <code>coordenacao</code> e associe <code>sediane</code> a ele.',
    dica: '<b>[LPIC-1 107.1]:</b> Crie o novo grupo com <code>groupadd</code> e associe a usuária existente utilizando <code>usermod</code> com as opções adequadas de grupo secundário.',
    solucao: [
      { comando: 'groupadd coordenacao' },
      { comando: 'usermod -aG coordenacao sediane' },
    ],
    verificar: (m) => Verificar.membro(m, 'sediane', 'coordenacao'),
  },
  {
    id: 'esc-dif-8',
    nivel: 'dificil',
    enunciado: 'Crie o usuário robô de sincronização do portal chamado <code>portalbot</code> com diretório home e shell restrito <code>/usr/sbin/nologin</code>.',
    dica: '<b>[LPIC-1 107.1]:</b> Crie a conta com <code>useradd</code> definindo como shell um interpretador que impeça sessões interativas de login.',
    solucao: [{ comando: 'useradd -m -s /usr/sbin/nologin portalbot' }],
    verificar: (m) =>
      Verificar.usuario(m, 'portalbot')?.shell === '/usr/sbin/nologin' &&
      Verificar.diretorio(m, '/home/portalbot'),
  },
  {
    id: 'esc-dif-9',
    nivel: 'dificil',
    enunciado: 'Extraia os membros cadastrados no grupo <code>alunos</code> a partir de <code>/etc/group</code> e salve em <code>/srv/escola/membros_alunos.txt</code>.',
    dica: '<b>[LPIC-1 103.2]:</b> Utilize o utilitário <code>grep</code> para filtrar a linha correspondente ao grupo no arquivo de grupos e direcione a saída com <code>&gt;</code>.',
    solucao: [{ comando: 'grep "alunos" /etc/group > /srv/escola/membros_alunos.txt' }],
    verificar: (m) => Verificar.contem(m, '/srv/escola/membros_alunos.txt', 'alunos:'),
  },
  {
    id: 'esc-dif-10',
    nivel: 'dificil',
    enunciado: 'Grave o status do servidor web <code>nginx</code> no arquivo de auditoria <code>/srv/escola/status_servidor.txt</code>.',
    dica: '<b>[LPIC-1 101.3]:</b> Obtenha o status operacional do daemon de serviço através do <code>systemctl</code> e grave a saída no arquivo de destino.',
    solucao: [{ comando: 'systemctl status nginx > /srv/escola/status_servidor.txt' }],
    verificar: (m) => Verificar.arquivo(m, '/srv/escola/status_servidor.txt') && (Verificar.conteudo(m, '/srv/escola/status_servidor.txt') ?? '').trim().length > 0,
  },
];

// ============================================================================
// MODALIDADES DISPONÍVEIS (Cada modalidade com 30 questões divididas em 3 níveis)
// ============================================================================
export const modalidades: ModalidadeSimulado[] = [
  {
    id: 'basico',
    titulo: 'Linux Básico',
    icone: '🟢',
    badge: 'Fundamentos',
    descricao: 'Navegação por caminhos, criação de pastas aninhadas, manipulação, cópia e redirecionamento de arquivos.',
    objetivo: 'Avaliar sua agilidade e precisão em navegação de diretórios no terminal, caminhos relativos e absolutos, criação de pastas aninhadas com -p, manipulação de arquivos e redirecionamento de fluxos (> e >>). O exame sorteia 10 questões (4 fáceis, 3 médias e 3 difíceis) de um banco com 30 tarefas práticas.',
    preparar: (m) => {
      m.criarDiretorio('/home/ricardo/workspace', 1000, 1000, 0o755);
      m.criarArquivo('/home/ricardo/workspace/notas.txt', 'Inicio dos estudos Linux\n', 1000, 1000, 0o644);
      m.criarDiretorio('/home/ricardo/documentos', 1000, 1000, 0o755);
      m.criarArquivo('/home/ricardo/documentos/artigo.txt', 'Documento de leitura inicial\n', 1000, 1000, 0o644);
    },
    desafios: desafiosBasico,
  },
  {
    id: 'medio',
    titulo: 'Linux Médio',
    icone: '🟡',
    badge: 'Intermediário',
    descricao: 'Administração de contas de usuários, grupos secundários, posse com chown e permissões com chmod (770, 640).',
    objetivo: 'Validar suas competências em criação e administração de contas de usuários (useradd, passwd), grupos de segurança (groupadd), atribuição de donos (chown) e permissões de acesso (chmod 770 e 640). O exame sorteia 10 questões balanceadas por nível a partir de 30 desafios práticos.',
    preparar: (m) => {
      m.criarDiretorio('/srv/compartilhado', 0, 0, 0o755);
      m.criarDiretorio('/srv/suporte', 0, 0, 0o755);
    },
    desafios: desafiosMedio,
  },
  {
    id: 'avancado',
    titulo: 'Linux Avançado',
    icone: '🔴',
    badge: 'Avançado',
    descricao: 'Instalação de pacotes com apt, gestão de serviços com systemctl, Sticky Bit 1777 e links simbólicos.',
    objetivo: 'Testar habilidades avançadas de administração Linux: instalação e controle de serviços web (apt, systemctl), configuração de diretórios públicos com Sticky Bit (1777), links simbólicos e automação de scripts. Prova sorteada com 10 tarefas do banco de 30 questões.',
    preparar: () => {
      // Ambiente limpo
    },
    desafios: desafiosAvancado,
  },
  {
    id: 'essentials',
    titulo: 'LPI Essentials',
    icone: '🏅',
    badge: '010-160',
    descricao: 'Cenários práticos no formato do exame oficial LPI Linux Essentials: padrão FHS, arquivos ocultos e filtros.',
    objetivo: 'Simular os objetivos práticos cobrados no exame oficial LPI Linux Essentials (010-160): padrão de hierarquia do sistema de arquivos (FHS), arquivos de configuração ocultos (.bash_custom), redirecionamentos e filtros de texto. Sorteio de 10 tarefas de um banco oficial com 30 desafios.',
    preparar: (m) => {
      m.criarDiretorio('/tmp/lpi-lab', 0, 0, 0o755);
      m.criarDiretorio('/home/ricardo/documentos', 1000, 1000, 0o755);
    },
    desafios: desafiosEssentials,
  },
  {
    id: 'lpic1',
    titulo: 'LPIC-1',
    icone: '🏆',
    badge: '101 e 102',
    descricao: 'Desafios no padrão das provas LPIC-1 e CompTIA Linux+: contas de serviço /sbin/nologin, links e userdel -r.',
    objetivo: 'Simulação prática no nível profissional dos exames LPIC-1 (101-500 e 102-500) e CompTIA Linux+: gestão de pacotes do sistema, contas de serviços sem login (/usr/sbin/nologin), links para binários e remoção segura de usuários. Prova composta por 10 tarefas sorteadas de um total de 30.',
    preparar: () => {
      // Estado inicial padrão
    },
    desafios: desafiosLPIC1,
  },
  {
    id: 'escola',
    titulo: 'Servidor Escola',
    icone: '🏫',
    badge: 'Cenário Integrado',
    descricao: 'Laboratório completo de infraestrutura escolar: servidor de arquivos, contas de professores e alunos, permissões restritas e web.',
    objetivo: 'Cenário integrado corporativo estilo exames práticos RHCSA (EX200) e LFCS. Você configurará contas de professores e alunos, permissões restritas em diretórios de notas, servidor web institucional e rotinas de backup. Sorteia 10 desafios do banco de 30 tarefas.',
    preparar: (m) => {
      m.criarDiretorio('/srv/escola', 0, 0, 0o755);
      m.criarDiretorio('/srv/escola/docs', 0, 0, 0o755);
      m.criarDiretorio('/srv/escola/scripts', 0, 0, 0o755);
      m.criarDiretorio('/srv/escola/publico', 0, 0, 0o1777);
    },
    desafios: desafiosEscola,
  },
  {
    id: 'quiz',
    titulo: 'Quiz Certificação',
    icone: '📝',
    badge: 'Teórico · 10 de 30',
    descricao: 'Questões de múltipla escolha oficiais de certificações (Linux Essentials e LPIC-1) com gabarito comentado.',
    objetivo: 'Avaliar seus conhecimentos teóricos através de 10 questões clássicas sorteadas (4 fáceis, 3 médias e 3 difíceis) a partir de um banco de 30 questões oficiais das certificações Linux Essentials e LPIC-1, com gabarito imediato e justificativa técnica detalhada.',
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
