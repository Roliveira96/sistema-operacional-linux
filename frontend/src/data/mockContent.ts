export interface MaterialModule {
  id: string;
  slug: string;
  title: string;
  description: string;
  level: "Iniciante" | "Intermediário" | "Avançado";
  icon: "terminal" | "folder" | "shield" | "workflow" | "cpu" | "users";
  lessonCount: number;
  commandHighlights: string[];
}

export interface SimulationMode {
  id: string;
  slug: string;
  title: string;
  description: string;
  difficulty: "Iniciante" | "Intermediário" | "Avançado";
  durationMinutes: number;
  questionCount: number;
  topicsCovered: string[];
}

export interface PlatformPillar {
  id: string;
  title: string;
  description: string;
  icon: "browser" | "shield-check" | "academic";
}

export interface PlatformMetric {
  id: string;
  value: string;
  label: string;
  description: string;
}

export const mockMaterialModules: MaterialModule[] = [
  {
    id: "mod-01",
    slug: "navegacao-e-sistema-de-arquivos",
    title: "Navegação e Sistema de Arquivos",
    description:
      "Aprenda a explorar a hierarquia POSIX, entender diretórios especiais (. e ..), caminhos absolutos e relativos.",
    level: "Iniciante",
    icon: "folder",
    lessonCount: 8,
    commandHighlights: ["pwd", "cd", "ls", "tree", "mkdir"],
  },
  {
    id: "mod-02",
    slug: "manipulacao-e-leitura-de-arquivos",
    title: "Manipulação e Leitura de Arquivos",
    description:
      "Criação, cópia, movimentação e inspeção de arquivos texto, cabeçalhos, rodapés e paginação no terminal.",
    level: "Iniciante",
    icon: "terminal",
    lessonCount: 10,
    commandHighlights: ["touch", "cat", "head", "tail", "cp", "mv", "rm"],
  },
  {
    id: "mod-03",
    slug: "permissoes-e-seguranca-posix",
    title: "Permissões e Segurança POSIX",
    description:
      "Compreenda o modelo de permissões Unix (rwx), representações octal e simbólica, e a máscara padrão de criação (umask).",
    level: "Intermediário",
    icon: "shield",
    lessonCount: 7,
    commandHighlights: ["chmod", "chown", "chgrp", "umask"],
  },
  {
    id: "mod-04",
    slug: "redirecionamentos-e-filtros",
    title: "Redirecionamento de Fluxos e Pipes",
    description:
      "Domine os descritores de arquivo padrão (stdin, stdout, stderr), encadeamento com pipes e filtragem de conteúdo.",
    level: "Intermediário",
    icon: "workflow",
    lessonCount: 9,
    commandHighlights: ["|", ">", ">>", "<", "grep", "wc", "sort"],
  },
  {
    id: "mod-05",
    slug: "gerenciamento-de-processos",
    title: "Gerenciamento de Processos",
    description:
      "Visualização da tabela de processos, primeiro plano e segundo plano, envio de sinais de término e prioridades.",
    level: "Intermediário",
    icon: "cpu",
    lessonCount: 6,
    commandHighlights: ["ps", "top", "kill", "jobs", "bg", "fg"],
  },
  {
    id: "mod-06",
    slug: "administracao-de-usuarios-e-grupos",
    title: "Administração de Usuários e Grupos",
    description:
      "Criação e gestão de contas de usuários, grupos, arquivos /etc/passwd e /etc/group e permissões administrativas.",
    level: "Avançado",
    icon: "users",
    lessonCount: 5,
    commandHighlights: ["useradd", "usermod", "userdel", "groupadd", "id"],
  },
];

export const mockSimulationModes: SimulationMode[] = [
  {
    id: "sim-01",
    slug: "fundamentos-operacionais",
    title: "Simulado 1: Fundamentos Operacionais",
    description:
      "Avaliação prática rápida focada em navegação na árvore de diretórios, inspeção e organização de arquivos.",
    difficulty: "Iniciante",
    durationMinutes: 45,
    questionCount: 8,
    topicsCovered: ["Navegação", "Leitura de Arquivos", "Cópia e Movimentação"],
  },
  {
    id: "sim-02",
    slug: "permissoes-e-redirecionamentos",
    title: "Simulado 2: Permissões e Fluxos de E/S",
    description:
      "Desafios de média complexidade envolvendo permissões numéricas, alteração de donos e encadeamento com pipes.",
    difficulty: "Intermediário",
    durationMinutes: 60,
    questionCount: 12,
    topicsCovered: ["Permissões POSIX", "Filtros grep/sort", "Pipes e Redirecionamento"],
  },
  {
    id: "sim-03",
    slug: "processos-e-administracao",
    title: "Simulado 3: Processos e Usuários",
    description:
      "Cenários que simulam administração básica de sistema: identificação de processos órfãos e ajuste de permissões.",
    difficulty: "Intermediário",
    durationMinutes: 50,
    questionCount: 10,
    topicsCovered: ["Tabela de Processos", "Sinais kill/term", "Usuários e Grupos"],
  },
  {
    id: "sim-04",
    slug: "exame-completo-sistemas-operacionais",
    title: "Simulado Completo: Exame Prático SO UTFPR",
    description:
      "Prova prática abrangente simulando as avaliações síncronas aplicadas em laboratório na UTFPR Guarapuava.",
    difficulty: "Avançado",
    durationMinutes: 90,
    questionCount: 16,
    topicsCovered: ["Hierarquia POSIX", "Permissões", "Pipes", "Processos", "Auditoria"],
  },
];

export const mockPlatformPillars: PlatformPillar[] = [
  {
    id: "pillar-01",
    title: "Simulação POSIX Ágil",
    description:
      "Terminal integrado direto no navegador sem necessidade de instalar máquinas virtuais pesadas ou configurar dual-boot.",
    icon: "browser",
  },
  {
    id: "pillar-02",
    title: "Correção Determinística",
    description:
      "Validação no servidor inspecionando o estado real do sistema de arquivos e comandos digitados com critério uniforme.",
    icon: "shield-check",
  },
  {
    id: "pillar-03",
    title: "Contexto Pedagógico UTFPR",
    description:
      "Alinhado à ementa de Sistemas Operacionais do TSI UTFPR Guarapuava, com cadernos de lições e simulados práticos.",
    icon: "academic",
  },
];

export const mockPlatformMetrics: PlatformMetric[] = [
  {
    id: "metric-01",
    value: "6+",
    label: "Módulos Didáticos",
    description: "Cobrindo tópicos essenciais de linha de comando",
  },
  {
    id: "metric-02",
    value: "50+",
    label: "Lições e Desafios",
    description: "Exercícios com validação automática de comandos",
  },
  {
    id: "metric-03",
    value: "4",
    label: "Simulados Preparatórios",
    description: "Exames práticos cronometrados por nível",
  },
  {
    id: "metric-04",
    value: "100%",
    label: "Correção no Servidor",
    description: "Inspeção de snapshots VFS sem interferência client-side",
  },
];
