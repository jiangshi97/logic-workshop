import type { Circuit, GateType } from '../src/contracts';
import { getLevel } from '../src/levels';
import { sequentialReferenceCircuit } from './sequential-fixtures';
import { architectureReferenceCircuit } from '../src/architectureCircuits';
import { isProgrammingLevel, programmingReferenceCircuit } from '../src/programmingMachine';

type Pin = { node: string; port: string };

class Builder {
  circuit: Circuit;
  private next = 0;
  constructor(id: number) {
    const level = getLevel(id);
    this.circuit = {
      levelId: id, revision: 0, wires: [],
      nodes: [
        ...level.inputPorts.map((p, index) => ({ id: p.id, label: p.label, bits: p.bits, type: 'INPUT' as const, position: { x: 80, y: 70 + index * 145 } })),
        ...level.outputPorts.map((p, index) => ({ id: p.id, label: p.label, bits: p.bits, type: 'OUTPUT' as const, position: { x: 1030, y: 150 + index * 145 } })),
      ],
    };
  }
  input(node: string): Pin { return { node, port: 'out' }; }
  wire(source: Pin, node: string, port: string) {
    this.circuit.wires.push({ id: `w${this.circuit.wires.length + 1}`, source: source.node, sourceHandle: source.port, target: node, targetHandle: port });
  }
  output(source: Pin, node = 'Y') { this.wire(source, node, 'in'); }
  node(type: GateType, bits = 1, value?: number): string {
    const id = `g${++this.next}`;
    this.circuit.nodes.push({ id, type, label: type, bits, ...(value === undefined ? {} : { value }), position: { x: 260 + ((this.next - 1) % 4) * 175, y: 60 + Math.floor((this.next - 1) / 4) * 140 } });
    return id;
  }
  gate(type: GateType, a: Pin, b?: Pin): Pin {
    const id = this.node(type);
    this.wire(a, id, 'a');
    if (b) this.wire(b, id, 'b');
    return this.input(id);
  }
  constant(value: number, bits = 1): Pin { return this.input(this.node('CONST', bits, value)); }
  split(source: Pin, bits: number): Pin[] {
    const id = this.node('SPLIT', bits);
    this.wire(source, id, 'in');
    return Array.from({ length: bits }, (_, bit) => ({ node: id, port: `out${bit}` }));
  }
  join(bits: Pin[]): Pin {
    const id = this.node('JOIN', bits.length);
    bits.forEach((source, bit) => this.wire(source, id, `in${bit}`));
    return this.input(id);
  }
  mux(a: Pin, b: Pin, s: Pin): Pin {
    const noS = this.gate('NOT', s);
    return this.gate('OR', this.gate('AND', a, noS), this.gate('AND', b, s));
  }
  fullAdder(a: Pin, b: Pin, cin: Pin): { sum: Pin; cout: Pin } {
    const x = this.gate('XOR', a, b);
    return { sum: this.gate('XOR', x, cin), cout: this.gate('OR', this.gate('AND', a, b), this.gate('AND', x, cin)) };
  }
  ripple(a: Pin[], b: Pin[], cin: Pin): { sum: Pin; cout: Pin } {
    const bits: Pin[] = [];
    let carry = cin;
    a.forEach((value, index) => {
      const adder = this.fullAdder(value, b[index], carry);
      bits.push(adder.sum);
      carry = adder.cout;
    });
    return { sum: this.join(bits), cout: carry };
  }
}

/** Test-only solutions composed from the tools available in each lesson. */
export function referenceCircuit(levelId: number): Circuit {
  // 按关卡数据分派而非编号区间：JSON 追加的 57+ 普通关不会误入固定机器/架构参考电路。
  if (isProgrammingLevel(levelId)) return programmingReferenceCircuit(levelId);
  const chapter = getLevel(levelId).chapter;
  if (chapter === 6) return architectureReferenceCircuit(levelId);
  if (chapter === 5 && levelId > 20) return sequentialReferenceCircuit(levelId);
  const b = new Builder(levelId);
  const a = b.input('A'), second = b.input('B'), s = b.input('S');
  switch (levelId) {
    case 1: b.output(a); break;
    case 2: b.output(b.gate('NAND', a, second)); break;
    case 3: b.output(b.gate('NAND', a, a)); break;
    case 4: b.output(b.gate('NOT', b.gate('NAND', a, second))); break;
    case 5: b.output(b.gate('NAND', b.gate('NOT', a), b.gate('NOT', second))); break;
    case 6: b.output(b.gate('AND', b.gate('OR', a, second), b.gate('NAND', a, second))); break;
    case 7: b.output(b.gate('NOT', b.gate('XOR', a, second))); break;
    case 8: {
      const c = b.input('C');
      b.output(b.gate('OR', b.gate('OR', b.gate('AND', a, second), b.gate('AND', a, c)), b.gate('AND', second, c)));
      break;
    }
    case 9: b.output(b.mux(a, second, s)); break;
    case 10: b.output(b.gate('AND', a, b.gate('NOT', s)), 'Y0'); b.output(b.gate('AND', a, s), 'Y1'); break;
    case 11: b.output(b.join(['b0', 'b1', 'b2', 'b3'].map(name => b.input(name)))); break;
    case 12: {
      const aa = b.split(a, 4), bb = b.split(second, 4);
      b.output(b.join(aa.map((value, index) => b.mux(value, bb[index], s))));
      break;
    }
    case 13: {
      const aa = b.split(a, 4);
      b.output(b.gate('NOT', b.gate('OR', b.gate('OR', aa[0], aa[1]), b.gate('OR', aa[2], aa[3]))), 'Z');
      break;
    }
    case 14: {
      const aa = b.split(a, 4), bb = b.split(second, 4);
      const different = aa.map((value, index) => b.gate('XOR', value, bb[index]));
      b.output(b.gate('NOT', b.gate('OR', b.gate('OR', different[0], different[1]), b.gate('OR', different[2], different[3]))), 'EQ');
      break;
    }
    case 15: b.output(b.gate('XOR', a, second), 'Sum'); b.output(b.gate('AND', a, second), 'Carry'); break;
    case 16: {
      const adder = b.fullAdder(a, second, b.input('Cin'));
      b.output(adder.sum, 'Sum'); b.output(adder.cout, 'Cout');
      break;
    }
    case 17:
    case 18: {
      const bits = levelId === 17 ? 2 : 4;
      const adder = b.ripple(b.split(a, bits), b.split(second, bits), b.input('Cin'));
      b.output(adder.sum, 'Sum'); b.output(adder.cout, 'Cout');
      break;
    }
    case 19: {
      const adder = b.ripple(b.split(a, 4), b.split(b.constant(1, 4), 4), b.constant(0));
      b.output(adder.sum); b.output(adder.cout, 'Cout');
      break;
    }
    case 20: {
      const adder = b.ripple(b.split(a, 4), b.split(second, 4).map(value => b.gate('NOT', value)), b.constant(1));
      b.output(adder.sum, 'Diff'); b.output(b.gate('NOT', adder.cout), 'Borrow');
      break;
    }
    case 901: {
      // example 包示例关（四位减法）：A + ~B + 1 的低四位即 (A − B) mod 16。
      const adder = b.ripple(b.split(a, 4), b.split(second, 4).map(value => b.gate('NOT', value)), b.constant(1));
      b.output(adder.sum, 'Diff');
      break;
    }
    default: throw new Error(`No reference circuit for lesson ${levelId}`);
  }
  return b.circuit;
}
