import { RegistroDeComandos } from './RegistroDeComandos';
import { Interpretador } from './Interpretador';
import { Cd, Ls, Pwd, Tree } from './comandos/Navegacao';
import { Mkdir, Rmdir } from './comandos/Diretorios';
import { Cat, Cp, Echo, Editor, Mv, Stat, Touch } from './comandos/Arquivos';
import { Cut, Grep, Head, Sort, Tail, Wc } from './comandos/Texto';
import { Rm } from './comandos/Exclusao';
import { Chgrp, Chmod, Chown, Umask } from './comandos/Acesso';
import { Adduser, Deluser, Getent, Groups, Id, Passwd, Useradd, Userdel, Usermod, Whoami } from './comandos/Usuarios';
import { Delgroup, Gpasswd, Groupadd, Groupdel, Groupmod } from './comandos/Grupos';
import { Exit, Su, Sudo } from './comandos/Privilegios';
import { Ajuda, Clear, Date_, History, Hostname, Man, Uname, Who } from './comandos/Utilitarios';

/** Monta o registro com todos os comandos e devolve um interpretador novo (um por terminal). */
export class Shell {
  private static registro: RegistroDeComandos | null = null;

  public static criarInterpretador(): Interpretador {
    return new Interpretador(Shell.obterRegistro());
  }

  public static obterRegistro(): RegistroDeComandos {
    if (Shell.registro === null) {
      const registro: RegistroDeComandos = new RegistroDeComandos();
      registro.registrar(
        new Pwd(), new Cd(), new Ls(), new Tree(),
        new Mkdir(), new Rmdir(),
        new Touch(), new Cat(), new Echo(), new Cp(), new Mv(), new Stat(),
        new Editor('nano'), new Editor('vim'), new Editor('vi'),
        new Head(), new Tail(), new Wc(), new Grep(), new Sort(), new Cut(),
        new Rm(),
        new Chmod(), new Chown(), new Chgrp(), new Umask(),
        new Whoami(), new Id(), new Groups(), new Useradd(), new Adduser('adduser'), new Adduser('addgroup'),
        new Userdel(), new Deluser(), new Usermod(), new Passwd(), new Getent(),
        new Groupadd(), new Groupdel(), new Groupmod(), new Gpasswd(), new Delgroup(),
        new Sudo(), new Su(), new Exit('exit'), new Exit('logout'),
        new Clear(), new History(), new Hostname(), new Date_(), new Uname(), new Who(),
        new Ajuda(registro), new Man(registro),
      );
      Shell.registro = registro;
    }
    return Shell.registro;
  }
}
