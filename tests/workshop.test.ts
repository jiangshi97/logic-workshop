// 元件工坊：哨兵电路校验（自由 INPUT/OUTPUT、全门型）、编辑操作与存档 v6 往返/迁移。
import { describe, expect, it } from 'vitest';
import { addGate, canConnect, connect, createWorkshopCircuit, removeSelection, validateWorkshopCircuit } from '../src/model';
import { createWorkspace, parseWorkspace, serializeWorkspace } from '../src/storage';
import { packageCircuit } from '../src/components';
import type { ComponentLibrary } from '../src/contracts';

describe('workshop circuit validation', () => {
  it('accepts freely added inputs, outputs and every gate type', () => {
    let circuit = createWorkshopCircuit();
    circuit = addGate(circuit, 'INPUT', { x: 0, y: 0 }, 'in-a', {}, 4, true);
    circuit = addGate(circuit, 'OUTPUT', { x: 200, y: 0 }, 'out-y', {}, 4, true);
    circuit = addGate(circuit, 'DFF', { x: 100, y: 120 }, 'g-dff', {}, 4, true);
    circuit = connect(circuit, 'in-a', 'out', 'g-dff', 'd', {}, true);
    circuit = connect(circuit, 'g-dff', 'q', 'out-y', 'in', {}, true);
    expect(validateWorkshopCircuit(circuit)).toEqual([]);
    expect(circuit.nodes).toHaveLength(3);
  });

  it('still enforces graph rules: multi-drive, missing node, combinational cycle', () => {
    const circuit = addGate(createWorkshopCircuit(), 'INPUT', { x: 0, y: 0 }, 'in-a', {}, 1, true);
    const driven = addGate(circuit, 'NOT', { x: 100, y: 0 }, 'g-not', {}, 1, true);
    const twice = { ...driven, wires: [
      { id: 'w1', source: 'in-a', sourceHandle: 'out', target: 'g-not', targetHandle: 'a' },
      { id: 'w2', source: 'in-a', sourceHandle: 'out', target: 'g-not', targetHandle: 'a' },
    ] };
    expect(validateWorkshopCircuit(twice).join()).toContain('已经有连接');

    const feedback = { ...driven, revision: driven.revision + 1, wires: [...driven.wires, { id: 'w3', source: 'g-not', sourceHandle: 'out', target: 'g-not', targetHandle: 'a' }] };
    expect(validateWorkshopCircuit(feedback).join()).toContain('反馈回路');

    expect(canConnect(circuit, 'in-a', 'out', 'missing', 'a', {}, true)).toBe(false);
  });

  it('removes everything including interface nodes in workshop mode', () => {
    let circuit = createWorkshopCircuit();
    circuit = addGate(circuit, 'INPUT', { x: 0, y: 0 }, 'in-a', {}, 1, true);
    circuit = addGate(circuit, 'OUTPUT', { x: 200, y: 0 }, 'out-y', {}, 1, true);
    circuit = connect(circuit, 'in-a', 'out', 'out-y', 'in', {}, true);
    const cleared = removeSelection(circuit, ['in-a', 'out-y'], [], true);
    expect(cleared.nodes).toHaveLength(0);
    expect(cleared.wires).toHaveLength(0);
  });
});

describe('workshop storage (v6)', () => {
  it('round-trips a workshop draft through serialize/parse', () => {
    const workspace = createWorkspace();
    let draft = createWorkshopCircuit();
    draft = addGate(draft, 'INPUT', { x: 0, y: 0 }, 'in-a', {}, 1, true);
    draft = addGate(draft, 'NOT', { x: 120, y: 0 }, 'g-not', {}, 1, true);
    draft = addGate(draft, 'OUTPUT', { x: 240, y: 0 }, 'out-y', {}, 1, true);
    draft = connect(connect(draft, 'in-a', 'out', 'g-not', 'a', {}, true), 'g-not', 'out', 'out-y', 'in', {}, true);
    workspace.workshop = draft;
    const restored = parseWorkspace(serializeWorkspace(workspace), { verifyProofs: false });
    expect(restored.version).toBe(7);
    expect(restored.workshop?.levelId).toBe(0);
    expect(restored.workshop?.nodes.map(node => node.id)).toEqual(['in-a', 'g-not', 'out-y']);
    expect(validateWorkshopCircuit(restored.workshop!)).toEqual([]);
  });

  it('migrates v5 saves without a workshop field and rejects bogus workshop payloads', () => {
    const v5 = JSON.parse(serializeWorkspace(createWorkspace()));
    expect(v5.version).toBe(7);
    const legacy = JSON.stringify({ ...v5, version: 5 });
    const restored = parseWorkspace(legacy, { verifyProofs: false });
    expect(restored.workshop).toBeUndefined();

    const tampered = JSON.stringify({ ...v5, workshop: { levelId: 3, revision: 0, nodes: [], wires: [] } });
    expect(() => parseWorkspace(tampered, { verifyProofs: false })).toThrow(/工坊草稿/);
  });

  it('saves a workshop-built component under a name and bumps version on same-name saves', () => {
    const library: ComponentLibrary = {};
    let draft = createWorkshopCircuit();
    draft = addGate(draft, 'INPUT', { x: 0, y: 0 }, 'in-a', {}, 1, true);
    draft = addGate(draft, 'OUTPUT', { x: 200, y: 0 }, 'out-y', {}, 1, true);
    draft = connect(draft, 'in-a', 'out', 'out-y', 'in', {}, true);
    const first = packageCircuit(draft, '缓冲器', library, true);
    expect(first.definition.version).toBe(1);
    expect(first.definition.sourceLevel).toBeUndefined();
    expect(first.library[first.key].inputs.map(port => port.id)).toEqual(['in-a']);
    expect(validateWorkshopCircuit(draft, first.library)).toEqual([]);

    const revised = connect(addGate(draft, 'NOT', { x: 100, y: 100 }, 'g-not', {}, 1, true), 'in-a', 'out', 'g-not', 'a', {}, true);
    const second = packageCircuit(revised, '缓冲器', first.library, true);
    expect(second.definition.version).toBe(2);
    expect(second.definition.id).toBe(first.definition.id);
    expect(second.library[first.key]).toBeDefined();
    expect(second.library[second.key].dependencies).toEqual([]);
  });
});
