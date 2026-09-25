import { Comando, Opcoes } from '../Comando';
import type { Contexto } from '../Contexto';
import { Diretorio } from '../../linux/No';
import { SistemaDeArquivos } from '../../linux/SistemaDeArquivos';
import { Disco, Particao } from '../../linux/Discos';
import { registrar } from '../../linux/Registro';

export class Mount extends Comando {
  public readonly nome: string = 'mount';
  public readonly resumo: string = 'monta um sistema de arquivos numa pasta: mount /dev/sdb1 /mnt | mount -a (/etc/fstab)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, 'a', { all: 'a' });

    // Sem argumentos: lista tudo o que está montado no sistema (formato padrão do Linux)
    if (args.length === 0) {
      contexto.linha('sysfs on /sys type sysfs (rw,nosuid,nodev,noexec,relatime)');
      contexto.linha('proc on /proc type proc (rw,nosuid,nodev,noexec,relatime)');
      contexto.linha('udev on /dev type devtmpfs (rw,nosuid,noexec,relatime,size=1943504k,nr_inodes=485876,mode=755)');
      contexto.linha('devpts on /dev/pts type devpts (rw,nosuid,noexec,relatime,gid=5,mode=620,ptmxmode=000)');
      contexto.linha('tmpfs on /run type tmpfs (rw,nosuid,nodev,noexec,relatime,size=401564k,mode=755)');
      contexto.linha('/dev/sda2 on / type ext4 (rw,relatime,errors=remount-ro)');
      contexto.linha('/dev/sda1 on /boot/efi type vfat (rw,relatime,fmask=0077,dmask=0077,codepage=437,iocharset=iso8859-1,shortname=mixed,errors=remount-ro)');
      for (const m of contexto.maquina.discos.listarMontagens()) {
        contexto.linha(`${m.dispositivo} on ${m.ponto} type ${m.particao.fs ?? 'ext4'} (rw,relatime)`);
      }
      return 0;
    }

    if (!contexto.ehRoot()) {
      contexto.falhar('mount: apenas o root pode executar isso');
      return 1;
    }

    if (opcoes.tem('a')) {
      const erros = contexto.maquina.discos.montarFstab();
      for (const erro of erros) {
        contexto.falhar(erro);
      }
      return erros.length > 0 ? 1 : 0;
    }

    const operandos = opcoes.operandos;
    if (operandos.length < 2) {
      contexto.falhar('mount: uso: mount <dispositivo> <ponto-de-montagem>');
      return 1;
    }

    const dispositivoTexto = operandos[0];
    const pontoTexto = operandos[1];

    const particao = contexto.maquina.discos.particao(dispositivoTexto);
    if (!particao) {
      contexto.falhar(`mount: dispositivo especial ${dispositivoTexto} não existe`);
      return 1;
    }

    if (particao.fs === null) {
      contexto.falhar(`mount: ${pontoTexto}: tipo errado de sistema de arquivos, opção inválida, superbloco inválido em ${dispositivoTexto}, faltando página de código ou programa auxiliar, ou outro erro.`);
      return 32;
    }

    const pontoAbsoluto = SistemaDeArquivos.absoluto(pontoTexto, contexto.quadro.cwd);
    const pontoNo = contexto.fs.obter(pontoAbsoluto);
    if (!(pontoNo instanceof Diretorio)) {
      contexto.falhar(`mount: ponto de montagem ${pontoTexto} não existe ou não é um diretório`);
      return 1;
    }

    if (contexto.maquina.discos.montagemEm(pontoAbsoluto)) {
      contexto.falhar(`mount: ${pontoTexto} já está montado`);
      return 1;
    }

    contexto.maquina.discos.montar(particao, pontoAbsoluto);
    registrar(contexto.maquina, 'kern.log', 'kernel', `EXT4-fs (${particao.nome}): mounted filesystem ${particao.uuid ?? ''} with ordered data mode. Quota mode: none.`);
    return 0;
  }
}

export class Umount extends Comando {
  public readonly nome: string = 'umount';
  public readonly resumo: string = 'desmonta um sistema de arquivos: umount /mnt | umount /dev/sdb1';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    if (args.length === 0) {
      contexto.falhar('umount: uso: umount <dispositivo|ponto-de-montagem>');
      return 1;
    }

    if (!contexto.ehRoot()) {
      contexto.falhar('umount: apenas o root pode executar isso');
      return 1;
    }

    const alvo = args[0];
    const pontoAbsoluto = SistemaDeArquivos.absoluto(alvo, contexto.quadro.cwd);

    let montagem = contexto.maquina.discos.montagemEm(pontoAbsoluto);
    if (!montagem) {
      const particao = contexto.maquina.discos.particao(alvo);
      if (particao) {
        montagem = contexto.maquina.discos.montagemDe(particao);
      }
    }

    if (!montagem) {
      contexto.falhar(`umount: ${alvo}: não montado.`);
      return 1;
    }

    // Se o diretório atual do usuário estiver dentro do ponto de montagem
    if (contexto.quadro.cwd === montagem.ponto || contexto.quadro.cwd.startsWith(montagem.ponto + '/')) {
      contexto.falhar(`umount: ${montagem.ponto}: o alvo está ocupado.`);
      return 1;
    }

    contexto.maquina.discos.desmontar(montagem);
    return 0;
  }
}

export class Fdisk extends Comando {
  public readonly nome: string = 'fdisk';
  public readonly resumo: string = 'manipula a tabela de partições de um disco (fdisk -l | fdisk /dev/sdb)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes = Opcoes.ler(args, 'l', { list: 'l' });

    if (opcoes.tem('l')) {
      // fdisk -l [dispositivo]
      const alvo = opcoes.operandos[0];
      const discosParaListar = alvo
        ? [contexto.maquina.discos.disco(alvo)].filter((d): d is Disco => d !== undefined)
        : contexto.maquina.discos.listar();

      if (alvo && discosParaListar.length === 0) {
        if (alvo.includes('sda')) {
          this.listarSda(contexto);
          return 0;
        }
        contexto.falhar(`fdisk: impossível abrir ${alvo}: Arquivo ou diretório inexistente`);
        return 1;
      }

      if (!alvo) {
        this.listarSda(contexto);
      }

      for (const disco of discosParaListar) {
        this.listarDisco(disco, contexto);
      }
      return 0;
    }

    if (!contexto.ehRoot()) {
      contexto.falhar('fdisk: impossível abrir: Permissão negada');
      return 1;
    }

    const disp = opcoes.operandos[0];
    if (!disp) {
      contexto.falhar('fdisk: nenhum dispositivo especificado. Uso: fdisk /dev/sdb');
      return 1;
    }

    const disco = contexto.maquina.discos.disco(disp);
    if (!disco) {
      contexto.falhar(`fdisk: impossível abrir ${disp}: Arquivo ou diretório inexistente`);
      return 1;
    }

    // Modo interativo do fdisk
    contexto.linha(`Welcome to fdisk (util-linux 2.39.3).`);
    contexto.linha(`Changes will remain in memory only, until you decide to write them.`);
    contexto.linha(`Be careful before using the write command.\n`);

    const particoesTrabalho: Particao[] = disco.particoes.map((p) => {
      const nova = new Particao(p.nome, p.tamanhoGb);
      nova.fs = p.fs;
      nova.uuid = p.uuid;
      nova.raiz = p.raiz;
      nova.formatadaEm = p.formatadaEm;
      return nova;
    });

    while (true) {
      const cmd = (await contexto.interacao.perguntar('Command (m for help): ', false)).trim().toLowerCase();

      if (cmd === 'q') {
        contexto.linha('');
        return 0;
      }

      if (cmd === 'm') {
        contexto.linha('\nHelp:');
        contexto.linha('  Generic');
        contexto.linha('   d   delete a partition');
        contexto.linha('   l   list known partition types');
        contexto.linha('   n   add a new partition');
        contexto.linha('   p   print the partition table');
        contexto.linha('   q   quit without saving changes');
        contexto.linha('   w   write table to disk and exit\n');
        continue;
      }

      if (cmd === 'p') {
        this.imprimirTabelaTrabalho(disco, particoesTrabalho, contexto);
        continue;
      }

      if (cmd === 'd') {
        if (particoesTrabalho.length === 0) {
          contexto.linha('No partition is defined yet!');
          continue;
        }
        let numParticao = 1;
        if (particoesTrabalho.length > 1) {
          const resp = await contexto.interacao.perguntar(`Partition number (1-${particoesTrabalho.length}): `, false);
          numParticao = Number(resp.trim()) || 1;
        }
        const idx = particoesTrabalho.findIndex((p) => p.nome === `${disco.nome}${numParticao}`);
        if (idx >= 0) {
          particoesTrabalho.splice(idx, 1);
          contexto.linha(`Partition ${numParticao} has been deleted.`);
        } else {
          contexto.linha(`Partition ${numParticao} does not exist.`);
        }
        continue;
      }

      if (cmd === 'n') {
        if (particoesTrabalho.length >= 4) {
          contexto.linha('All primary partitions are in use. You must delete one first.');
          continue;
        }
        const numParticao = particoesTrabalho.length + 1;
        await contexto.interacao.perguntar('Partition type\n   p   primary (0 primary, 0 extended, 4 free)\nSelect (default p): ', false);
        await contexto.interacao.perguntar(`Partition number (${numParticao}-4, default ${numParticao}): `, false);
        await contexto.interacao.perguntar('First sector (2048-10485759, default 2048): ', false);
        const tamStr = await contexto.interacao.perguntar(`Last sector, +/-sectors or +/-size{K,M,G,T,P} (2048-10485759, default 10485759): `, false);

        let tamanhoGb = Math.max(1, Math.floor(disco.tamanhoGb / (particoesTrabalho.length + 1)));
        const match = tamStr.trim().match(/^\+?(\d+)\s*G?$/i);
        if (match) {
          tamanhoGb = Number(match[1]);
        }

        const novaPart = new Particao(`${disco.nome}${numParticao}`, Math.min(tamanhoGb, disco.tamanhoGb));
        particoesTrabalho.push(novaPart);
        contexto.linha(`Created a new partition ${numParticao} of type 'Linux' and of size ${novaPart.tamanhoGb} GiB.`);
        continue;
      }

      if (cmd === 'w') {
        disco.particoes = particoesTrabalho;
        for (const p of disco.particoes) {
          contexto.maquina.discos.garantirDispositivo(p.nome);
        }
        contexto.linha('The partition table has been altered.');
        contexto.linha('Calling ioctl() to re-read partition table.');
        contexto.linha('Syncing disks.');
        return 0;
      }

      contexto.linha(`${cmd}: unknown command, see 'm' for help`);
    }
  }

  private listarSda(contexto: Contexto): void {
    contexto.linha('Disk /dev/sda: 25 GiB, 26843545600 bytes, 52428800 sectors');
    contexto.linha('Disk model: VBOX HARDDISK   ');
    contexto.linha('Units: sectors of 1 * 512 = 512 bytes');
    contexto.linha('Sector size (logical/physical): 512 bytes / 512 bytes');
    contexto.linha('I/O size (minimum/optimal): 512 bytes / 512 bytes');
    contexto.linha('Disklabel type: gpt');
    contexto.linha('Disk identifier: 5A1C1B2E-0F4D-4A8E-9B6C-2D7E3F8A9B0C\n');
    contexto.linha('Device       Start      End  Sectors Size Type');
    contexto.linha('/dev/sda1     2048  2099199  2097152   1G EFI System');
    contexto.linha('/dev/sda2  2099200 52426751 50327552  24G Linux filesystem\n');
  }

  private listarDisco(disco: Disco, contexto: Contexto): void {
    const setores = disco.tamanhoGb * 2097152;
    const bytes = disco.tamanhoGb * 1073741824;
    contexto.linha(`Disk /dev/${disco.nome}: ${disco.tamanhoGb} GiB, ${bytes} bytes, ${setores} sectors`);
    contexto.linha(`Disk model: VBOX HARDDISK   `);
    contexto.linha('Units: sectors of 1 * 512 = 512 bytes');
    contexto.linha('Sector size (logical/physical): 512 bytes / 512 bytes');
    contexto.linha('I/O size (minimum/optimal): 512 bytes / 512 bytes');
    contexto.linha('Disklabel type: dos');
    contexto.linha(`Disk identifier: 0x${disco.nome === 'sdb' ? '9a8b7c6d' : '1e2f3a4b'}\n`);
    if (disco.particoes.length > 0) {
      contexto.linha('Device     Boot Start      End  Sectors Size Id Type');
      let inicio = 2048;
      for (const p of disco.particoes) {
        const sec = p.tamanhoGb * 2097152;
        const fim = inicio + sec - 1;
        contexto.linha(`/dev/${p.nome.padEnd(8)}   ${String(inicio).padStart(6)} ${String(fim).padStart(8)} ${String(sec).padStart(8)}  ${p.tamanhoGb}G 83 Linux`);
        inicio = fim + 1;
      }
      contexto.linha('');
    }
  }

  private imprimirTabelaTrabalho(disco: Disco, particoes: Particao[], contexto: Contexto): void {
    const setores = disco.tamanhoGb * 2097152;
    const bytes = disco.tamanhoGb * 1073741824;
    contexto.linha(`Disk /dev/${disco.nome}: ${disco.tamanhoGb} GiB, ${bytes} bytes, ${setores} sectors`);
    contexto.linha('Units: sectors of 1 * 512 = 512 bytes');
    contexto.linha('Sector size (logical/physical): 512 bytes / 512 bytes');
    contexto.linha('I/O size (minimum/optimal): 512 bytes / 512 bytes');
    contexto.linha('Disklabel type: dos');
    contexto.linha('Disk identifier: 0x9a8b7c6d\n');
    if (particoes.length > 0) {
      contexto.linha('Device     Boot Start      End  Sectors Size Id Type');
      let inicio = 2048;
      for (const p of particoes) {
        const sec = p.tamanhoGb * 2097152;
        const fim = inicio + sec - 1;
        contexto.linha(`/dev/${p.nome.padEnd(8)}   ${String(inicio).padStart(6)} ${String(fim).padStart(8)} ${String(sec).padStart(8)}  ${p.tamanhoGb}G 83 Linux`);
        inicio = fim + 1;
      }
      contexto.linha('');
    }
  }
}

export class Mkfs extends Comando {
  public readonly nome: string;
  public readonly resumo: string = 'cria um sistema de arquivos ext4 numa partição: mkfs.ext4 /dev/sdb1';

  constructor(nome: string = 'mkfs.ext4') {
    super();
    this.nome = nome;
  }

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    if (!contexto.ehRoot()) {
      contexto.falhar('mkfs: permissão negada. Apenas root pode formatar dispositivos.');
      return 1;
    }

    let disp: string | undefined;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-t' && i + 1 < args.length) {
        i++;
      } else if (args[i].startsWith('-t=')) {
        continue;
      } else if (!args[i].startsWith('-')) {
        disp = args[i];
      }
    }

    if (!disp) {
      contexto.falhar('Uso: mkfs [-t tipo] [-F] <dispositivo>');
      return 1;
    }

    const particao = contexto.maquina.discos.particao(disp);
    if (!particao) {
      contexto.falhar(`mke2fs: Arquivo ou diretório inexistente ao tentar abrir ${disp}`);
      return 1;
    }

    if (contexto.maquina.discos.montagemDe(particao)) {
      contexto.falhar(`/dev/${particao.nome} está montado; não criarei um sistema de arquivos aqui!`);
      return 1;
    }

    contexto.linha(`mke2fs 1.47.0 (5-Feb-2023)`);
    contexto.linha(`Creating filesystem with ${particao.tamanhoGb * 262144} 4k blocks and ${particao.tamanhoGb * 65536} inodes`);
    particao.formatar();
    contexto.linha(`Filesystem UUID: ${particao.uuid}`);
    contexto.linha(`Superblock backups stored on blocks:`);
    contexto.linha(`\t32768, 98304, 163840, 229376, 294912, 819200, 884736\n`);
    contexto.linha(`Allocating group tables: done                            `);
    contexto.linha(`Writing inode tables: done                            `);
    contexto.linha(`Creating journal (${particao.tamanhoGb * 4096} blocks): done`);
    contexto.linha(`Writing superblocks and filesystem accounting information: done\n`);
    return 0;
  }
}

export class Blkid extends Comando {
  public readonly nome: string = 'blkid';
  public readonly resumo: string = 'localiza e imprime atributos de dispositivos de bloco (UUIDs, tipos de fs)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const alvo = args[0];
    const sda1 = '/dev/sda1: UUID="E234-9B01" BLOCK_SIZE="512" TYPE="vfat" PARTUUID="7a1b2c3d-01"';
    const sda2 = '/dev/sda2: UUID="5a1c1b2e-0f4d-4a8e-9b6c-2d7e3f8a9b0c" BLOCK_SIZE="4096" TYPE="ext4" PARTUUID="7a1b2c3d-02"';

    if (alvo === '/dev/sda1') { contexto.linha(sda1); return 0; }
    if (alvo === '/dev/sda2') { contexto.linha(sda2); return 0; }

    if (alvo) {
      const part = contexto.maquina.discos.particao(alvo);
      if (part && part.fs) {
        contexto.linha(`/dev/${part.nome}: UUID="${part.uuid}" BLOCK_SIZE="4096" TYPE="${part.fs}"`);
        return 0;
      }
      return 2;
    }

    contexto.linha(sda1);
    contexto.linha(sda2);
    for (const disco of contexto.maquina.discos.listar()) {
      for (const p of disco.particoes) {
        if (p.fs) {
          contexto.linha(`/dev/${p.nome}: UUID="${p.uuid}" BLOCK_SIZE="4096" TYPE="${p.fs}"`);
        }
      }
    }
    return 0;
  }
}
