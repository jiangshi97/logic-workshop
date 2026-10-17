// 关卡期望值表达式迷你语言：纯整数运算的安全求值器，供 LevelSpec 组合关期望值直书数学定义。
// 文法（优先级从低到高，与 C 一致）：三目 ?: ；位或 | ；位异或 ^ ；位与 & ；相等 = != ；
// 关系 < <= > >= ；移位 << >> ；加减 + - ；乘除 * div mod ；一元 - ~ ；以及数字、端口标识符与括号。
// 语义约定：全部是整数运算；div 为向下取整除法，mod 为与除数同号的数学取模（(A - B) mod 16 可直接使用）；
// 相等与比较返回 1/0；调用方负责把结果按输出端口位宽再取 mod 2^bits。
// 语言不含属性访问与函数调用，除零在求值时抛错，因此没有注入面；div/mod 是保留字，不能作端口名。

export type ExprInputs = Record<string, number>;
export type ExprFunction = (inputs: ExprInputs) => number;
type Node = (inputs: ExprInputs) => number;

interface Token { type: 'number' | 'ident' | 'op'; text: string; at: number; }

const TWO_CHAR_OPS = ['<<', '>>', '<=', '>=', '!='];
const RESERVED = new Set(['div', 'mod']);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < source.length) {
    const rest = source.slice(at);
    if (/\s/.test(rest[0])) { at += 1; continue; }
    const two = TWO_CHAR_OPS.find(op => rest.startsWith(op));
    if (two) { tokens.push({ type: 'op', text: two, at }); at += 2; continue; }
    const one = rest[0];
    if ('+-*/&|^~()<>?:='.includes(one)) { tokens.push({ type: 'op', text: one, at }); at += 1; continue; }
    const ident = IDENT.exec(rest)?.[0];
    if (ident) {
      tokens.push({ type: RESERVED.has(ident) ? 'op' : 'ident', text: ident, at });
      at += ident.length;
      continue;
    }
    const number = /^0[xX][0-9a-fA-F]+|^\d+/.exec(rest)?.[0];
    if (number) { tokens.push({ type: 'number', text: number, at }); at += number.length; continue; }
    throw new Error(`表达式含有无法识别的字符“${one}”（位置 ${at}）。`);
  }
  return tokens;
}

function floorDiv(a: number, b: number): number {
  if (b === 0) throw new Error('表达式除零。');
  return Math.floor(a / b);
}

function mathMod(a: number, b: number): number {
  if (b === 0) throw new Error('表达式对零取模。');
  return ((a % b) + b) % b;
}

/** 递归下降解析器：每个产生式直接编译为求值闭包，解析期即发现全部语法与未声明标识符错误。 */
class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
    private readonly allowed: Set<string> | undefined,
  ) {}

  private peek(): Token | undefined { return this.tokens[this.pos]; }

  private take(): Token {
    const token = this.tokens[this.pos];
    if (!token) throw new Error(`表达式在“${this.source}”末尾意外结束。`);
    this.pos += 1;
    return token;
  }

  private matchOp(...ops: string[]): string | undefined {
    const token = this.peek();
    if (token?.type === 'op' && ops.includes(token.text)) { this.pos += 1; return token.text; }
    return undefined;
  }

  private expectOp(op: string): void {
    if (!this.matchOp(op)) {
      const token = this.peek();
      throw new Error(`表达式期待“${op}”，实际是“${token ? token.text : '结尾'}”（位置 ${token ? token.at : this.source.length}）。`);
    }
  }

  private binary(next: () => Node, table: Record<string, (a: number, b: number) => number>): Node {
    let left = next();
    for (;;) {
      const token = this.peek();
      const combine = token?.type === 'op' ? table[token.text] : undefined;
      if (!combine) return left;
      this.pos += 1;
      const right = next();
      const l = left;
      left = i => combine(l(i), right(i));
    }
  }

  parse(): Node {
    const node = this.ternary();
    const token = this.peek();
    if (token) throw new Error(`表达式在“${token.text}”处存在多余内容（位置 ${token.at}）。`);
    return node;
  }

  private ternary(): Node {
    const condition = this.bitOr();
    if (!this.matchOp('?')) return condition;
    const whenTrue = this.ternary();
    this.expectOp(':');
    const whenFalse = this.ternary();
    return i => condition(i) ? whenTrue(i) : whenFalse(i);
  }

  private bitOr(): Node {
    return this.binary(() => this.bitXor(), { '|': (a, b) => a | b });
  }

  private bitXor(): Node {
    return this.binary(() => this.bitAnd(), { '^': (a, b) => a ^ b });
  }

  private bitAnd(): Node {
    return this.binary(() => this.equality(), { '&': (a, b) => a & b });
  }

  private equality(): Node {
    return this.binary(() => this.relational(), {
      '=': (a, b) => a === b ? 1 : 0,
      '!=': (a, b) => a !== b ? 1 : 0,
    });
  }

  private relational(): Node {
    return this.binary(() => this.shift(), {
      '<': (a, b) => a < b ? 1 : 0,
      '<=': (a, b) => a <= b ? 1 : 0,
      '>': (a, b) => a > b ? 1 : 0,
      '>=': (a, b) => a >= b ? 1 : 0,
    });
  }

  private shift(): Node {
    return this.binary(() => this.additive(), {
      '<<': (a, b) => a << b,
      '>>': (a, b) => a >> b,
    });
  }

  private additive(): Node {
    return this.binary(() => this.term(), {
      '+': (a, b) => a + b,
      '-': (a, b) => a - b,
    });
  }

  private term(): Node {
    return this.binary(() => this.unary(), {
      '*': (a, b) => a * b,
      div: floorDiv,
      mod: mathMod,
    });
  }

  private unary(): Node {
    if (this.matchOp('-')) { const operand = this.unary(); return i => -operand(i); }
    if (this.matchOp('~')) { const operand = this.unary(); return i => ~operand(i); }
    return this.primary();
  }

  private primary(): Node {
    const token = this.take();
    if (token.type === 'number') {
      const value = token.text.toLowerCase().startsWith('0x') ? parseInt(token.text, 16) : parseInt(token.text, 10);
      return () => value;
    }
    if (token.type === 'ident') {
      const name = token.text;
      if (this.allowed && !this.allowed.has(name))
        throw new Error(`表达式引用了未声明的端口“${name}”（位置 ${token.at}）。`);
      return i => {
        const value = i[name];
        if (value === undefined) throw new Error(`求值时缺少输入端口“${name}”的值。`);
        return value;
      };
    }
    if (token.text === '(') {
      const node = this.ternary();
      this.expectOp(')');
      return node;
    }
    throw new Error(`表达式在“${token.text}”处期待数字、端口名或括号（位置 ${token.at}）。`);
  }
}

/** 把表达式源码编译为求值闭包；allowedIdentifiers 提供时，引用未列出的标识符会在编译期报错。 */
export function compileExpression(source: string, allowedIdentifiers?: Iterable<string>): ExprFunction {
  if (typeof source !== 'string' || !source.trim()) throw new Error('表达式不能为空。');
  const allowed = allowedIdentifiers ? new Set(allowedIdentifiers) : undefined;
  return new Parser(tokenize(source), source, allowed).parse();
}
