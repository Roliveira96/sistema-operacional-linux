/**
 * $(( ... )) do bash: inteiros com + - * / % ** e comparações (< > <= >= == !=), parênteses e variáveis.
 */
export class Aritmetica {
  private tokens: string[] = [];
  private i: number = 0;
  private readonly variavel: (nome: string) => string | undefined;

  constructor(variavel: (nome: string) => string | undefined) {
    this.variavel = variavel;
  }

  public calcular(expressao: string): number {
    this.tokens = expressao.match(/\d+|[A-Za-z_][A-Za-z0-9_]*|\*\*|<=|>=|==|!=|&&|\|\||[-+*/%()<>!]/g) ?? [];
    this.i = 0;
    if (this.tokens.length === 0) return 0;
    const valor: number = this.ou();
    if (this.i < this.tokens.length) throw new Error('erro de sintaxe na expressão (o token de erro é "' + this.tokens[this.i] + '")');
    return valor;
  }

  private ou(): number {
    let valor: number = this.e();
    while (this.tokens[this.i] === '||') { this.i++; const d: number = this.e(); valor = valor !== 0 || d !== 0 ? 1 : 0; }
    return valor;
  }

  private e(): number {
    let valor: number = this.comparacao();
    while (this.tokens[this.i] === '&&') { this.i++; const d: number = this.comparacao(); valor = valor !== 0 && d !== 0 ? 1 : 0; }
    return valor;
  }

  private comparacao(): number {
    let valor: number = this.soma();
    for (;;) {
      const op: string | undefined = this.tokens[this.i];
      if (op === undefined || !['<', '>', '<=', '>=', '==', '!='].includes(op)) return valor;
      this.i++;
      const d: number = this.soma();
      const r: boolean = op === '<' ? valor < d : op === '>' ? valor > d : op === '<=' ? valor <= d : op === '>=' ? valor >= d : op === '==' ? valor === d : valor !== d;
      valor = r ? 1 : 0;
    }
  }

  private soma(): number {
    let valor: number = this.produto();
    while (this.tokens[this.i] === '+' || this.tokens[this.i] === '-') {
      const op: string = this.tokens[this.i++];
      const d: number = this.produto();
      valor = op === '+' ? valor + d : valor - d;
    }
    return valor;
  }

  private produto(): number {
    let valor: number = this.potencia();
    while (['*', '/', '%'].includes(this.tokens[this.i])) {
      const op: string = this.tokens[this.i++];
      const d: number = this.potencia();
      if ((op === '/' || op === '%') && d === 0) throw new Error('divisão por 0 (o token de erro é "' + d + '")');
      valor = op === '*' ? valor * d : op === '/' ? Math.trunc(valor / d) : valor % d;
    }
    return valor;
  }

  private potencia(): number {
    const base: number = this.unario();
    if (this.tokens[this.i] === '**') { this.i++; return base ** this.potencia(); }
    return base;
  }

  private unario(): number {
    const t: string | undefined = this.tokens[this.i];
    if (t === '-') { this.i++; return -this.unario(); }
    if (t === '+') { this.i++; return this.unario(); }
    if (t === '!') { this.i++; return this.unario() === 0 ? 1 : 0; }
    if (t === '(') {
      this.i++;
      const valor: number = this.ou();
      if (this.tokens[this.i] !== ')') throw new Error('faltou fechar o parêntese');
      this.i++;
      return valor;
    }
    this.i++;
    if (t === undefined) throw new Error('operando esperado');
    if (/^\d+$/.test(t)) return Number(t);
    if (/^[A-Za-z_]/.test(t)) {
      const texto: string = this.variavel(t) ?? '0';
      return /^-?\d+$/.test(texto.trim()) ? Number(texto.trim()) : 0;
    }
    throw new Error('erro de sintaxe: operando esperado (o token de erro é "' + t + '")');
  }
}
