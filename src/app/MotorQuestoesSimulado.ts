import type { Desafio, Passo, QuestaoQuiz } from '../conteudo/Topico';
import type { Maquina } from '../linux/Maquina';
import { Usuario, Grupo } from '../linux/Contas';
import { Verificar } from '../conteudo/Verificar';

/**
 * Motor inteligente responsável por:
 * 1. Garantir pré-requisitos de arquivos, pastas e contas para as questões sorteadas.
 * 2. Detectar se o aluno já criou previamente ou por acidente o alvo de uma questão pendente.
 * 3. Mudar dinamicamente a questão (novo diretório, arquivo ou usuário) para evitar que duas
 *    questões sejam concluídas com uma única resposta acidental.
 */
export class MotorQuestoesSimulado {
  /**
   * Prepara o ambiente garantindo que todos os pré-requisitos das 10 questões sorteadas
   * existam na máquina Linux antes do início da prova.
   */
  public static prepararPrerequisitos(
    questoes: Array<Desafio | QuestaoQuiz>,
    maquina: Maquina,
  ): void {
    // 1. Executa o hook preparar individual de cada questão, se houver
    for (const q of questoes) {
      if ('preparar' in q && typeof q.preparar === 'function') {
        try {
          q.preparar(maquina);
        } catch (e) {
          console.warn('Erro ao executar preparar da questão', q.id, e);
        }
      }
    }

    // 2. Tabela de pré-requisitos garantidos por ID de desafio
    const ids = new Set(questoes.map((q) => q.id));

    // Diretório PAM para testes de compactação
    if (ids.has('lpic-med-7')) {
      maquina.criarDiretorio('/etc/pam.d', 0, 0, 0o755);
      maquina.criarArquivo('/etc/pam.d/common-auth', '# PAM auth config\nauth required pam_unix.so nullok\n', 0, 0, 0o644);
      maquina.criarArquivo('/etc/pam.d/common-account', '# PAM account config\naccount required pam_unix.so\n', 0, 0, 0o644);
      maquina.criarArquivo('/etc/pam.d/sshd', '# SSHD PAM config\n@include common-auth\n@include common-account\n', 0, 0, 0o644);
    }

    // Básico: arquivos e pastas para operações subsequentes
    if (ids.has('bas-fac-5') || ids.has('bas-fac-7')) {
      maquina.criarDiretorio('/home/ricardo/workspace', 1000, 1000, 0o755);
      if (!maquina.fs.obter('/home/ricardo/workspace/notas.txt')) {
        maquina.criarArquivo('/home/ricardo/workspace/notas.txt', 'Inicio dos estudos Linux\n', 1000, 1000, 0o644);
      }
    }

    if (ids.has('bas-med-1')) {
      maquina.criarDiretorio('/home/ricardo/workspace', 1000, 1000, 0o755);
      if (!maquina.fs.obter('/home/ricardo/workspace/notas.backup')) {
        maquina.criarArquivo('/home/ricardo/workspace/notas.backup', 'Inicio dos estudos Linux\n', 1000, 1000, 0o644);
      }
    }

    if (ids.has('bas-med-2')) {
      maquina.criarDiretorio('/home/ricardo/temporario', 1000, 1000, 0o755);
      if (!maquina.fs.obter('/home/ricardo/temporario/temp.log')) {
        maquina.criarArquivo('/home/ricardo/temporario/temp.log', 'Log temporario de testes\n', 1000, 1000, 0o644);
      }
    }

    if (ids.has('bas-med-4')) {
      maquina.criarDiretorio('/home/ricardo/temporario', 1000, 1000, 0o755);
    }

    if (ids.has('bas-dif-9')) {
      maquina.criarDiretorio('/home/ricardo/lab/a/b/c', 1000, 1000, 0o755);
      maquina.criarArquivo('/home/ricardo/lab/a/b/c/dado.txt', 'Nivel Profundo\n', 1000, 1000, 0o644);
    }

    // Médio: usuários e grupos para operações de permissão
    if (
      ids.has('med-fac-8') ||
      ids.has('med-med-1') ||
      ids.has('med-med-3') ||
      ids.has('med-med-5') ||
      ids.has('med-med-8') ||
      ids.has('med-dif-5') ||
      ids.has('med-dif-8')
    ) {
      if (!maquina.contas.grupo('suporte')) {
        maquina.contas.adicionarGrupo(new Grupo('suporte', 1010, []));
      }
    }

    if (ids.has('med-med-2')) {
      if (!maquina.contas.grupo('financeiro')) {
        maquina.contas.adicionarGrupo(new Grupo('financeiro', 1011, []));
      }
    }

    if (
      ids.has('med-fac-7') ||
      ids.has('med-fac-10') ||
      ids.has('med-med-2') ||
      ids.has('med-med-3') ||
      ids.has('med-med-5') ||
      ids.has('med-med-6') ||
      ids.has('med-med-8') ||
      ids.has('med-dif-4') ||
      ids.has('med-dif-6')
    ) {
      if (!maquina.contas.usuario('carlos')) {
        const u = new Usuario('carlos', 1001, 1001, '/home/carlos', '/bin/bash', '123', 'Carlos');
        maquina.contas.adicionarUsuario(u);
        maquina.contas.adicionarGrupo(new Grupo('carlos', 1001, ['carlos']));
        maquina.criarHome(u);
      }
      maquina.criarDiretorio('/home/carlos', 1001, 1001, 0o755);
      if (!maquina.fs.obter('/home/carlos/.bashrc')) {
        maquina.criarArquivo('/home/carlos/.bashrc', '# ~/.bashrc de carlos\n', 1001, 1001, 0o644);
      }
    }

    if (ids.has('med-med-7')) {
      if (!maquina.contas.grupo('devops')) {
        maquina.contas.adicionarGrupo(new Grupo('devops', 1012, []));
      }
    }

    if (ids.has('med-dif-1')) {
      if (!maquina.contas.usuario('backupuser')) {
        const u = new Usuario('backupuser', 1002, 1002, '/home/backupuser', '/bin/sh', '123', 'Operador de Backup');
        maquina.contas.adicionarUsuario(u);
        maquina.contas.adicionarGrupo(new Grupo('backupuser', 1002, ['backupuser']));
        maquina.criarHome(u);
      }
    }

    if (ids.has('med-dif-3')) {
      if (!maquina.contas.usuario('lucas')) {
        const u = new Usuario('lucas', 1003, 1003, '/home/lucas', '/bin/bash', '123', 'Lucas');
        maquina.contas.adicionarUsuario(u);
        maquina.contas.adicionarGrupo(new Grupo('lucas', 1003, ['lucas']));
        maquina.criarHome(u);
      }
    }

    if (ids.has('med-dif-9')) {
      maquina.criarDiretorio('/etc/sudoers.d', 0, 0, 0o755);
    }

    // Avançado: serviços e arquivos web
    if (ids.has('av-med-2') || ids.has('av-med-5') || ids.has('esc-dif-3')) {
      maquina.criarDiretorio('/var/www/html', 0, 0, 0o755);
    }

    if (ids.has('av-dif-4') || ids.has('av-dif-6')) {
      try {
        maquina.pacotes.instalar('apache2');
      } catch {
        // ignora se já instalado
      }
    }

    if (ids.has('av-dif-5')) {
      try {
        maquina.pacotes.instalar('tree');
      } catch {
        // ignora se já instalado
      }
    }

    if (ids.has('av-dif-7') || ids.has('lpic-med-3') || ids.has('lpic-dif-4') || ids.has('esc-dif-10')) {
      try {
        maquina.pacotes.instalar('nginx');
      } catch {
        // ignora se já instalado
      }
    }

    // Essentials: arquivos no laboratório /tmp/lpi-lab
    if (
      ids.has('ess-fac-9') ||
      ids.has('ess-med-6') ||
      ids.has('ess-med-9') ||
      ids.has('ess-dif-3') ||
      ids.has('ess-dif-4')
    ) {
      maquina.criarDiretorio('/tmp/lpi-lab', 0, 0, 0o755);
      if (!maquina.fs.obter('/tmp/lpi-lab/filosofia.txt')) {
        maquina.criarArquivo('/tmp/lpi-lab/filosofia.txt', 'Linux Open Source\n', 1000, 1000, 0o644);
      }
    }

    if (ids.has('ess-med-8')) {
      maquina.criarDiretorio('/tmp/lpi-lab', 0, 0, 0o755);
      if (!maquina.fs.obter('/tmp/lpi-lab/privado.txt')) {
        maquina.criarArquivo('/tmp/lpi-lab/privado.txt', 'Segredo 123\n', 1000, 1000, 0o600);
      }
    }

    if (ids.has('ess-dif-10')) {
      maquina.criarDiretorio('/tmp/lpi-lab', 0, 0, 0o755);
      if (!maquina.fs.obter('/tmp/lpi-lab/script.sh')) {
        maquina.criarArquivo('/tmp/lpi-lab/script.sh', 'echo Ola $USER\n', 0, 0, 0o755);
      }
      if (!maquina.contas.grupo('lpistudents')) {
        maquina.contas.adicionarGrupo(new Grupo('lpistudents', 1020, []));
      }
      if (!maquina.contas.usuario('aluno1')) {
        const u = new Usuario('aluno1', 1004, 1020, '/home/aluno1', '/bin/bash', '123', 'Aluno 1');
        maquina.contas.adicionarUsuario(u);
        maquina.criarHome(u);
      }
    }

    // LPIC-1
    if (ids.has('lpic-med-5') || ids.has('lpic-dif-1')) {
      if (!maquina.contas.usuario('deploybot')) {
        const u = new Usuario('deploybot', 1005, 1005, '/home/deploybot', '/usr/sbin/nologin', null, 'Deploy Bot');
        maquina.contas.adicionarUsuario(u);
        maquina.contas.adicionarGrupo(new Grupo('deploybot', 1005, ['deploybot']));
        maquina.criarHome(u);
      }
    }

    if (ids.has('lpic-med-5') || ids.has('lpic-med-6') || ids.has('lpic-dif-3')) {
      if (!maquina.contas.grupo('auditores')) {
        maquina.contas.adicionarGrupo(new Grupo('auditores', 1030, []));
      }
    }

    if (ids.has('lpic-med-6')) {
      if (!maquina.contas.usuario('auditor1')) {
        const u = new Usuario('auditor1', 1006, 1006, '/home/auditor1', '/bin/bash', '123', 'Auditor');
        maquina.contas.adicionarUsuario(u);
        maquina.contas.adicionarGrupo(new Grupo('auditor1', 1006, ['auditor1']));
        maquina.criarHome(u);
      }
    }

    if (ids.has('lpic-dif-5')) {
      maquina.criarDiretorio('/etc', 0, 0, 0o755);
      maquina.criarArquivo('/etc/system.conf', '# system conf\n', 0, 0, 0o644);
      maquina.criarArquivo('/etc/network.conf', '# net conf\n', 0, 0, 0o644);
    }

    if (ids.has('lpic-dif-7')) {
      maquina.criarDiretorio('/etc/sysctl.d', 0, 0, 0o755);
    }

    // Escola
    if (
      ids.has('esc-med-1') ||
      ids.has('esc-med-4') ||
      ids.has('esc-dif-4') ||
      ids.has('esc-dif-5') ||
      ids.has('esc-dif-7')
    ) {
      if (!maquina.contas.grupo('professores')) {
        maquina.contas.adicionarGrupo(new Grupo('professores', 1040, []));
      }
      if (!maquina.contas.usuario('sediane')) {
        const u = new Usuario('sediane', 1007, 1040, '/home/sediane', '/bin/bash', '123', 'Professora Sediane');
        maquina.contas.adicionarUsuario(u);
        maquina.criarHome(u);
      }
    }

    if (ids.has('esc-med-2') || ids.has('esc-med-8') || ids.has('esc-dif-9')) {
      if (!maquina.contas.grupo('alunos')) {
        maquina.contas.adicionarGrupo(new Grupo('alunos', 1041, []));
      }
    }

    if (ids.has('esc-med-6')) {
      maquina.criarDiretorio('/srv/escola/docs', 0, 0, 0o755);
      if (!maquina.fs.obter('/srv/escola/docs/regras.txt')) {
        maquina.criarArquivo('/srv/escola/docs/regras.txt', 'Prova de Linux\nSem consulta\n', 0, 0, 0o644);
      }
      if (!maquina.contas.grupo('alunos')) {
        maquina.contas.adicionarGrupo(new Grupo('alunos', 1041, []));
      }
      if (!maquina.contas.usuario('ana')) {
        const u = new Usuario('ana', 1008, 1041, '/home/ana', '/bin/bash', '123', 'Ana Estudante');
        maquina.contas.adicionarUsuario(u);
        maquina.criarHome(u);
      }
    }

    if (ids.has('esc-med-9')) {
      if (!maquina.contas.usuario('beto')) {
        const u = new Usuario('beto', 1009, 1041, '/home/beto', '/bin/bash', '123', 'Beto Aluno');
        maquina.contas.adicionarUsuario(u);
        maquina.criarHome(u);
      }
    }

    if (ids.has('esc-med-10')) {
      maquina.criarDiretorio('/srv/escola/scripts', 0, 0, 0o755);
      maquina.criarArquivo('/srv/escola/scripts/legado.sh', '#!/bin/bash\necho legado\n', 0, 0, 0o755);
    }
  }

  /**
   * Inspeciona a questão no momento de sua ativação.
   * Se a questão pede para criar algo (pasta, arquivo, usuário) e esse algo JÁ EXISTE no ambiente
   * (porque o aluno criou acidentalmente na questão anterior ou executou comandos múltiplos),
   * o motor adapta dinamicamente a questão para um novo alvo (ex: projeto1 -> projeto2),
   * atualizando o enunciado, o verificador e a solução recomendada.
   */
  public static adaptarQuestaoSeJaAtendida(
    desafio: Desafio,
    maquina: Maquina,
  ): Desafio {
    // Se a questão tem sua própria rotina customizada de adaptação, usa-a
    if (typeof desafio.adaptar === 'function') {
      return desafio.adaptar(maquina);
    }

    // Se a questão já não está "acertada", não há colisão prévia: mantém original
    let jaPassou = false;
    try {
      jaPassou = desafio.verificar(maquina);
    } catch {
      jaPassou = false;
    }

    if (!jaPassou) {
      return desafio;
    }

    // CASO 1: Questão de exclusão (rm / rmdir / userdel) que passou porque o alvo não existe
    // Se era para remover mas o alvo nem existe, recria o alvo para permitir a prática
    if (desafio.enunciado.toLowerCase().includes('remov') || desafio.enunciado.toLowerCase().includes('exclua')) {
      MotorQuestoesSimulado.recriarAlvoDeExclusao(desafio, maquina);
      return desafio;
    }

    // CASO 2: Questão de criação cujo alvo já foi criado previamente pelo aluno
    // Extrai o caminho ou nome que já existe e gera uma versão adaptada
    const matchCaminho = desafio.enunciado.match(/<code>(\/[^<]+)<\/code>/);
    if (matchCaminho) {
      const caminhoOriginal = matchCaminho[1];
      if (maquina.fs.obter(caminhoOriginal) !== null) {
        return MotorQuestoesSimulado.mutarDesafioPorCaminho(desafio, caminhoOriginal, maquina);
      }
    }

    // CASO 3: Criação de usuário que já existe
    const matchUsuario = desafio.enunciado.match(/usuário(?: chamada)? <code>([a-zA-Z0-9_-]+)<\/code>/i);
    if (matchUsuario) {
      const nomeUsuario = matchUsuario[1];
      if (maquina.contas.usuario(nomeUsuario)) {
        return MotorQuestoesSimulado.mutarDesafioPorUsuario(desafio, nomeUsuario, maquina);
      }
    }

    // CASO 4: Criação de grupo que já existe
    const matchGrupo = desafio.enunciado.match(/grupo(?: de trabalho| de estudantes)?(?: chamado)? <code>([a-zA-Z0-9_-]+)<\/code>/i);
    if (matchGrupo) {
      const nomeGrupo = matchGrupo[1];
      if (maquina.contas.grupo(nomeGrupo)) {
        return MotorQuestoesSimulado.mutarDesafioPorGrupo(desafio, nomeGrupo, maquina);
      }
    }

    return desafio;
  }

  private static mutarDesafioPorCaminho(
    desafio: Desafio,
    caminhoOriginal: string,
    maquina: Maquina,
  ): Desafio {
    // Gera um novo caminho que NÃO exista na máquina
    let novoCaminho = '';
    let contador = 2;

    const ehArquivo = caminhoOriginal.includes('.');
    if (ehArquivo) {
      const partes = caminhoOriginal.split('.');
      const ext = partes.pop()!;
      const base = partes.join('.');
      do {
        novoCaminho = `${base}${contador}.${ext}`;
        contador++;
      } while (maquina.fs.obter(novoCaminho) !== null && contador < 50);
    } else {
      do {
        novoCaminho = `${caminhoOriginal}_${contador}`;
        contador++;
      } while (maquina.fs.obter(novoCaminho) !== null && contador < 50);
    }

    // Substitui nos enunciados e comandos
    const novoEnunciado = desafio.enunciado.split(caminhoOriginal).join(novoCaminho);
    const novaDica = (desafio.dica || '').split(caminhoOriginal).join(novoCaminho);
    const novaSolucao: Passo[] = desafio.solucao.map((p) => ({
      ...p,
      comando: p.comando.split(caminhoOriginal).join(novoCaminho),
    }));

    return {
      ...desafio,
      enunciado: novoEnunciado,
      dica: novaDica,
      solucao: novaSolucao,
      verificar: (m: Maquina) => {
        if (ehArquivo) {
          return Verificar.arquivo(m, novoCaminho);
        }
        return Verificar.diretorio(m, novoCaminho);
      },
    };
  }

  private static mutarDesafioPorUsuario(
    desafio: Desafio,
    nomeOriginal: string,
    maquina: Maquina,
  ): Desafio {
    let novoNome = '';
    let contador = 2;
    do {
      novoNome = `${nomeOriginal}${contador}`;
      contador++;
    } while (maquina.contas.usuario(novoNome) !== undefined && contador < 50);

    const novoEnunciado = desafio.enunciado.split(nomeOriginal).join(novoNome);
    const novaDica = (desafio.dica || '').split(nomeOriginal).join(novoNome);
    const novaSolucao: Passo[] = desafio.solucao.map((p) => ({
      ...p,
      comando: p.comando.split(nomeOriginal).join(novoNome),
    }));

    return {
      ...desafio,
      enunciado: novoEnunciado,
      dica: novaDica,
      solucao: novaSolucao,
      verificar: (m: Maquina) => Verificar.usuario(m, novoNome) !== undefined,
    };
  }

  private static mutarDesafioPorGrupo(
    desafio: Desafio,
    nomeOriginal: string,
    maquina: Maquina,
  ): Desafio {
    let novoNome = '';
    let contador = 2;
    do {
      novoNome = `${nomeOriginal}${contador}`;
      contador++;
    } while (maquina.contas.grupo(novoNome) !== undefined && contador < 50);

    const novoEnunciado = desafio.enunciado.split(nomeOriginal).join(novoNome);
    const novaDica = (desafio.dica || '').split(nomeOriginal).join(novoNome);
    const novaSolucao: Passo[] = desafio.solucao.map((p) => ({
      ...p,
      comando: p.comando.split(nomeOriginal).join(novoNome),
    }));

    return {
      ...desafio,
      enunciado: novoEnunciado,
      dica: novaDica,
      solucao: novaSolucao,
      verificar: (m: Maquina) => Verificar.grupo(m, novoNome) !== undefined,
    };
  }

  private static recriarAlvoDeExclusao(desafio: Desafio, maquina: Maquina): void {
    if (desafio.id === 'bas-med-2') {
      maquina.criarDiretorio('/home/ricardo/temporario', 1000, 1000, 0o755);
      maquina.criarArquivo('/home/ricardo/temporario/temp.log', 'temp log\n', 1000, 1000, 0o644);
    } else if (desafio.id === 'bas-med-4') {
      maquina.criarDiretorio('/home/ricardo/temporario', 1000, 1000, 0o755);
    } else if (desafio.id === 'bas-dif-9') {
      maquina.criarDiretorio('/home/ricardo/lab/a/b/c', 1000, 1000, 0o755);
      maquina.criarArquivo('/home/ricardo/lab/a/b/c/dado.txt', 'dado\n', 1000, 1000, 0o644);
    } else if (desafio.id === 'med-dif-1') {
      const u = new Usuario('backupuser', 1002, 1002, '/home/backupuser', '/bin/sh', '123', 'Backup User');
      maquina.contas.adicionarUsuario(u);
      maquina.criarHome(u);
    } else if (desafio.id === 'esc-med-9') {
      const u = new Usuario('beto', 1009, 1041, '/home/beto', '/bin/bash', '123', 'Beto');
      maquina.contas.adicionarUsuario(u);
      maquina.criarHome(u);
    } else if (desafio.id === 'esc-med-10') {
      maquina.criarDiretorio('/srv/escola/scripts', 0, 0, 0o755);
      maquina.criarArquivo('/srv/escola/scripts/antigo.sh', '#!/bin/bash\n', 0, 0, 0o755);
    }
  }
}
