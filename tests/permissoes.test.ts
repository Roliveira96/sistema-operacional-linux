import { describe, it, expect } from 'vitest';
import { permissoes } from '../src/conteudo/permissoes';
import { Maquina } from '../src/linux/Maquina';
import type { Usuario } from '../src/linux/Contas';
import type { Sessao } from '../src/linux/Sessao';
import { Shell } from '../src/shell/Shell';
import type { Interpretador } from '../src/shell/Interpretador';
import { SaidaEmTexto } from '../src/shell/Saida';
import { InteracaoTeste } from './simulado_oficial.test';

describe('Tópico de Permissões (#/permissoes)', () => {
  it('contém a estrutura em 4 pilares do vídeo e o link oficial do YouTube', () => {
    // 1. Link do vídeo no YouTube
    expect(permissoes.conceitos).toContain('https://www.youtube.com/watch?v=sq6pd18X63Q');
    expect(permissoes.conceitos).toContain('video-recomendado');

    // 2. Pilar 1: Entidades do Sistema
    expect(permissoes.conceitos).toContain('1. Entidades do Sistema');
    expect(permissoes.conceitos).toContain('/etc/passwd');
    expect(permissoes.conceitos).toContain('/etc/group');
    expect(permissoes.conceitos).toContain('Humanos');
    expect(permissoes.conceitos).toContain('Usuários do Sistema');

    // 3. Pilar 2: Leitura do ls -l
    expect(permissoes.conceitos).toContain('2. Leitura do Comando <code>ls -l</code>');
    expect(permissoes.conceitos).toContain('an-tipo');
    expect(permissoes.conceitos).toContain('an-dono');
    expect(permissoes.conceitos).toContain('an-grupo');
    expect(permissoes.conceitos).toContain('an-outros');

    // 4. Pilar 3: O Significado de RWX
    expect(permissoes.conceitos).toContain('3. O Significado de RWX');
    expect(permissoes.conceitos).toContain('Read (Leitura)');
    expect(permissoes.conceitos).toContain('Write (Escrita)');
    expect(permissoes.conceitos).toContain('Execute (Execução)');

    // 5. Pilar 4: Gerenciamento via chmod
    expect(permissoes.conceitos).toContain('4. Gerenciamento via <code>chmod</code>');
    expect(permissoes.conceitos).toContain('775');
    expect(permissoes.conceitos).toContain('4 = R, 2 = W, 1 = X');
    expect(permissoes.conceitos).toContain('Método Literal');

    // 6. Guia Oficial de Superadministradores (sudo)
    expect(permissoes.conceitos).toContain('Como Conceder Privilégios de Superadministrador (sudo)');
    expect(permissoes.conceitos).toContain('su -');
    expect(permissoes.conceitos).toContain('usermod -aG sudo nome_do_usuario');
    expect(permissoes.conceitos).toContain('usermod -aG wheel nome_do_usuario');
    expect(permissoes.conceitos).toContain('groups nome_do_usuario');
    expect(permissoes.conceitos).toContain('sudo whoami');
  });

  it('contém lição interativa de concessão de sudo com validação no terminal', () => {
    const licaoSudo = permissoes.licoes.find((l) => l.comando.includes('usermod -aG sudo'));
    expect(licaoSudo).toBeDefined();
    expect(licaoSudo?.titulo).toContain('superadministrador');
    expect(licaoSudo?.exemplos.some((e) => e.comando === 'usermod -aG sudo joao')).toBe(true);
    expect(licaoSudo?.exemplos.some((e) => e.comando === 'sudo whoami')).toBe(true);
  });

  it('contém a seção de curiosidades históricas e técnicas do superusuário', () => {
    expect(permissoes.conceitos).toContain('Curiosidades Históricas e do Dia a Dia do Superusuário');
    expect(permissoes.conceitos).toContain('wheel');
    expect(permissoes.conceitos).toContain('big wheel');
    expect(permissoes.conceitos).toContain('SuperUser DO');
    expect(permissoes.conceitos).toContain('Homem-Aranha');
    expect(permissoes.conceitos).toContain('Defaults insults');
    expect(permissoes.conceitos).toContain('visudo');
    expect(permissoes.conceitos).toContain('shoulder surfing');
  });

  it('demonstração cobre verificação de contas, grupos e permissões', () => {
    expect(permissoes.demonstracao).toBeDefined();
    const comandos = permissoes.demonstracao!.map((d) => d.comando);
    expect(comandos.some((c) => c.includes('/etc/passwd'))).toBe(true);
    expect(comandos.some((c) => c.includes('/etc/group'))).toBe(true);
    expect(comandos.some((c) => c.includes('ls -l'))).toBe(true);
    expect(comandos.some((c) => c.includes('stat'))).toBe(true);
  });

  it('todos os desafios práticos passam com suas soluções oficiais em sequência', async () => {
    const maquina = Maquina.criar();
    permissoes.preparar(maquina);

    const interpretador: Interpretador = Shell.criarInterpretador();
    const root = maquina.contas.usuario('root') as Usuario;
    const sessoesPorTerminal = new Map<number, Sessao>();
    sessoesPorTerminal.set(1, maquina.abrirSessao(root));

    for (const desafio of permissoes.desafios) {
      for (const passo of desafio.solucao) {
        const numTerm = passo.terminal ?? 1;
        let sessao = sessoesPorTerminal.get(numTerm);
        if (!sessao) {
          const usr = passo.login ? (maquina.contas.usuario(passo.login.usuario) as Usuario) : root;
          sessao = maquina.abrirSessao(usr);
          sessoesPorTerminal.set(numTerm, sessao);
        }

        const saida = new SaidaEmTexto();
        const interacao = new InteracaoTeste(passo.respostas ?? []);
        await interpretador.executarLinha(passo.comando, maquina, sessao, saida, interacao);
      }

      const passou = desafio.verificar(maquina);
      expect(passou, `Desafio [${desafio.id}] falhou: ${desafio.enunciado}`).toBe(true);
    }
  });
});
