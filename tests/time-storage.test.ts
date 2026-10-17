import { afterEach, expect, it, vi } from 'vitest';
import { createWorkspace, parseWorkspace, saveWorkspace, STORAGE_KEY } from '../src/storage';
import { connect, createCircuit } from '../src/model';
import type { ComponentDefinition } from '../src/contracts';
import { encapsulateSelection } from '../src/components';
import { referenceCircuit } from './fixtures';
import { sequentialReferenceCircuit } from './sequential-fixtures';

afterEach(() => vi.unstubAllGlobals());

it('migrates v2 drafts, inputs, proofs and component versions while adding thirty-six fresh drafts', () => {
  const workspace = createWorkspace();
  workspace.circuits[1] = connect(workspace.circuits[1], 'A', 'out', 'Y', 'in');
  workspace.proofs[1] = structuredClone(workspace.circuits[1]);
  workspace.inputs[12] = { A: 15, B: 9 };
  const leaf: ComponentDefinition = { id: 'leaf', version: 1, name: 'identity', sourceLevel: 1,
    inputs: [{ id: 'A', label: 'A', bits: 1 }], outputs: [{ id: 'Y', label: 'Y', bits: 1 }], dependencies: [],
    graph: { nodes: structuredClone(workspace.circuits[1].nodes), wires: structuredClone(workspace.circuits[1].wires) } };
  const outer: ComponentDefinition = { ...structuredClone(leaf), id: 'outer', dependencies: ['leaf@1'],
    graph: { nodes: [leaf.graph.nodes[0], { id: 'child', type: 'COMPONENT', label: 'child', componentKey: 'leaf@1', position: { x: 100, y: 0 } }, leaf.graph.nodes[1]],
      wires: [{ id: 'in', source: 'A', sourceHandle: 'out', target: 'child', targetHandle: 'A' },
        { id: 'out', source: 'child', sourceHandle: 'Y', target: 'Y', targetHandle: 'in' }] } };
  const legacy = { ...workspace, version: 2, currentLevel: 2, library: { 'leaf@1': leaf, 'leaf@2': { ...leaf, version: 2 }, 'outer@1': outer },
    circuits: Object.fromEntries(Object.entries(workspace.circuits).filter(([id]) => Number(id) <= 20)),
    inputs: Object.fromEntries(Object.entries(workspace.inputs).filter(([id]) => Number(id) <= 20)) };
  const restored = parseWorkspace(JSON.stringify(legacy));
  expect(restored.version).toBe(6);
  expect(restored.currentLevel).toBe(2);
  expect(restored.circuits[1]).toEqual(workspace.circuits[1]);
  expect(restored.proofs[1]).toEqual(workspace.proofs[1]);
  expect(restored.inputs[12]).toEqual({ A: 15, B: 9, S: 0 });
  expect(restored.library).toMatchObject(legacy.library);
  expect(restored.library['outer@1'].dependencies).toEqual(['leaf@1']);
  expect(Object.keys(restored.circuits)).toHaveLength(56);
  expect(restored.circuits[24].wires).toEqual([]);
});

it('keeps the legacy save key and excludes transient state from serialization and import', () => {
  const workspace = { ...createWorkspace(), state: { registers: { memory: 255 }, cycle: 80 },
    trace: [{ cycle: 80 }], unknown: 'discard me' };
  let saved = '';
  let savedKey = '';
  vi.stubGlobal('localStorage', { setItem: (key: string, text: string) => { savedKey = key; saved = text; } });
  saveWorkspace(workspace);
  expect(savedKey).toBe('logic-workshop.v1');
  expect(STORAGE_KEY).toBe(savedKey);
  expect(JSON.parse(saved)).not.toHaveProperty('state');
  expect(JSON.parse(saved)).not.toHaveProperty('trace');
  expect(JSON.parse(saved)).not.toHaveProperty('unknown');
  const restored = parseWorkspace(JSON.stringify(workspace));
  expect(restored).not.toHaveProperty('state');
  expect(restored).not.toHaveProperty('trace');
});

it('rejects out-of-range legacy level entries rather than treating v2 as v3', () => {
  const workspace = createWorkspace();
  const legacy = { ...workspace, version: 2,
    circuits: Object.fromEntries(Object.entries(workspace.circuits).filter(([id]) => Number(id) <= 20)),
    inputs: Object.fromEntries(Object.entries(workspace.inputs).filter(([id]) => Number(id) <= 20)),
    proofs: { 21: createCircuit(1) } };
  expect(() => parseWorkspace(JSON.stringify(legacy))).toThrow(/关卡/);
});

it('round-trips eight-bit DFF definitions and discards runtime fields from graph records', () => {
  const workspace = createWorkspace(), circuit = sequentialReferenceCircuit(24);
  const packaged = encapsulateSelection(circuit,
    circuit.nodes.filter(node => node.type !== 'INPUT' && node.type !== 'OUTPUT').map(node => node.id), '八位寄存器');
  workspace.library = { ...workspace.library, ...packaged.library };
  workspace.circuits[24] = packaged.circuit;
  workspace.inputs[24] = { D: 255, E: 1, R: 0 };
  const raw = JSON.parse(JSON.stringify(workspace));
  raw.circuits[24].state = { cycle: 90, registers: { stale: 127 } };
  const definition = Object.values(packaged.library)[0];
  const key = Object.keys(packaged.library)[0];
  raw.library[key].graph.nodes.find((node: { type: string }) => node.type === 'DFF').runtimeValue = 255;
  const restored = parseWorkspace(JSON.stringify(raw));
  expect(restored.inputs[24]).toEqual({ D: 255, E: 1, R: 0 });
  expect(restored.library[key]).toEqual(definition);
  expect(restored.library[key].outputs[0].bits).toBe(8);
  expect(restored.library[key].graph.nodes.find(node => node.type === 'DFF')?.bits).toBe(8);
  expect(restored.circuits[24]).toEqual(workspace.circuits[24]);
  raw.inputs[24].D = 256;
  expect(() => parseWorkspace(JSON.stringify(raw))).toThrow(/位宽/);
});

it('verifies all thirty-two proofs and clamps progress at the first failed temporal proof', () => {
  const workspace = createWorkspace();
  workspace.currentLevel = 32;
  workspace.proofs = Object.fromEntries(Array.from({ length: 32 }, (_, index) => {
    const id = index + 1;
    return [id, id <= 20 ? referenceCircuit(id) : sequentialReferenceCircuit(id)];
  }));
  const restored = parseWorkspace(JSON.stringify(workspace));
  expect(restored.currentLevel).toBe(32);
  expect(Object.keys(restored.proofs)).toHaveLength(32);
  expect(restored.proofs[32]).toEqual(workspace.proofs[32]);
  workspace.proofs[21] = createCircuit(21);
  const corrupted = parseWorkspace(JSON.stringify(workspace));
  expect(corrupted.currentLevel).toBe(21);
  expect(Object.keys(corrupted.proofs)).toHaveLength(20);
  expect(corrupted.proofs[22]).toBeUndefined();
}, 30_000);
