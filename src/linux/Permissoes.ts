/**
 * Conversões entre as três formas de enxergar uma permissão:
 * número (0o755), texto do ls (rwxr-xr-x) e expressão simbólica do chmod (u+x,g-w).
 */
export class Permissoes {
  public static readonly STICKY: number = 0o1000;
  public static readonly SGID: number = 0o2000;
  public static readonly SUID: number = 0o4000;

  /** 0o755 + diretório → "drwxr-xr-x" (com o "t" do sticky bit quando houver). Aceita a letra de tipo do ls (d, l, c, b, -). */
  public static paraTexto(modo: number, tipo: boolean | string): string {
    const letras: string[] = ['r', 'w', 'x'];
    let texto: string = typeof tipo === 'string' ? tipo : tipo ? 'd' : '-';
    for (let bit: number = 8; bit >= 0; bit--) {
      texto += (modo & (1 << bit)) !== 0 ? letras[(8 - bit) % 3] : '-';
    }
    const trocar = (posicao: number, minuscula: string, maiuscula: string): void => {
      texto = texto.substring(0, posicao) + (texto.charAt(posicao) === 'x' ? minuscula : maiuscula) + texto.substring(posicao + 1);
    };
    if ((modo & Permissoes.SUID) !== 0) trocar(3, 's', 'S');
    if ((modo & Permissoes.SGID) !== 0) trocar(6, 's', 'S');
    if ((modo & Permissoes.STICKY) !== 0) trocar(9, 't', 'T');
    return texto;
  }

  /** 0o644 → "644"; com bits especiais → "1777". */
  public static paraOctal(modo: number, quatroDigitos: boolean = false): string {
    const texto: string = (modo & 0o7777).toString(8);
    return texto.padStart(quatroDigitos ? 4 : 3, '0');
  }

  /** "755", "0644" ou "1777" → número; null se não for octal válido. */
  public static lerOctal(texto: string): number | null {
    if (!/^[0-7]{1,4}$/.test(texto)) {
      return null;
    }
    return parseInt(texto, 8);
  }

  /** Aplica "u+x,g-w,o=r" sobre o modo atual. Retorna null se a expressão for inválida. */
  public static aplicarSimbolico(modoAtual: number, expressao: string, ehDiretorio: boolean): number | null {
    let modo: number = modoAtual;
    for (const clausula of expressao.split(',')) {
      const partes: RegExpMatchArray | null = clausula.match(/^([ugoa]*)([+\-=])([rwxXst]*)$/);
      if (partes === null) {
        return null;
      }
      const quem: string = partes[1] === '' || partes[1].includes('a') ? 'ugo' : partes[1];
      const operador: string = partes[2];
      let bits: number = 0;
      for (const letra of partes[3]) {
        if (letra === 'r') bits |= 4;
        if (letra === 'w') bits |= 2;
        if (letra === 'x') bits |= 1;
        if (letra === 'X' && (ehDiretorio || (modoAtual & 0o111) !== 0)) bits |= 1;
      }
      for (const alvo of quem) {
        const deslocamento: number = alvo === 'u' ? 6 : alvo === 'g' ? 3 : 0;
        const mascara: number = 7 << deslocamento;
        const valor: number = bits << deslocamento;
        if (operador === '+') modo |= valor;
        if (operador === '-') modo &= ~valor;
        if (operador === '=') modo = (modo & ~mascara) | valor;
      }
      if (partes[3].includes('t')) {
        modo = operador === '-' ? modo & ~Permissoes.STICKY : modo | Permissoes.STICKY;
      }
      if (partes[3].includes('s')) {
        // u+s = SUID (roda como o dono), g+s = SGID (roda como o grupo / pasta passa o grupo adiante)
        let especiais: number = 0;
        if (quem.includes('u')) especiais |= Permissoes.SUID;
        if (quem.includes('g')) especiais |= Permissoes.SGID;
        modo = operador === '-' ? modo & ~especiais : modo | especiais;
      }
    }
    return modo;
  }

  /** "u=rwx,g=rx,o=rx" — formato do umask -S. */
  public static paraSimbolicoCompleto(modo: number): string {
    const partes: string[] = [];
    const nomes: string[] = ['u', 'g', 'o'];
    for (let i: number = 0; i < 3; i++) {
      const tripla: number = (modo >> (6 - i * 3)) & 7;
      partes.push(nomes[i] + '=' + ((tripla & 4) ? 'r' : '') + ((tripla & 2) ? 'w' : '') + ((tripla & 1) ? 'x' : ''));
    }
    return partes.join(',');
  }
}
