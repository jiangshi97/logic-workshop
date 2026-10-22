import { levels } from '../src/levels';
import { afterEach, expect, it, vi } from 'vitest';
import { createWorkspace, loadWorkspace, parseWorkspace, serializeWorkspace } from '../src/storage';
import { connect, createCircuit } from '../src/model';

afterEach(() => vi.unstubAllGlobals());

it('defers saved-file parsing to the worker instead of blocking startup', () => {
  vi.stubGlobal('localStorage', { getItem: () => '{broken' });
  const loaded = loadWorkspace();
  expect(loaded.savedText).toBe('{broken');
  expect(loaded.workspace.currentLevel).toBe(1);
  expect(loaded.error).toBeUndefined();
});

it('exposes empty saved files for asynchronous error reporting', () => {
  vi.stubGlobal('localStorage', { getItem: () => '' });
  expect(loadWorkspace().savedText).toBe('');
});

it('reports local storage access failures without throwing', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Storage unavailable'); } });
  expect(loadWorkspace().error).toContain('存档读取失败');
});

it('creates every catalog draft and the canonical component library', () => {
  const state = createWorkspace();
  expect(state.version).toBe(7);
  expect(Object.keys(state.circuits)).toHaveLength(levels.length);
  expect(Object.keys(state.library).length).toBeGreaterThan(0);
});

it('migrates the four-lesson format without losing progress', () => {
  const state = createWorkspace();
  const proof = connect(createCircuit(1), 'A', 'out', 'Y', 'in');
  const legacy = { version: 1, currentLevel: 2,
    circuits: Object.fromEntries([1, 2, 3, 4].map(id => [id, state.circuits[id]])),
    proofs: { 1: proof }, inputs: { 1: { A: 1 } } };
  for (const circuit of [...Object.values(legacy.circuits), ...Object.values(legacy.proofs)]) {
    for (const node of circuit.nodes) delete node.bits;
  }
  const restored = parseWorkspace(JSON.stringify(legacy));
  expect(restored.version).toBe(7);
  expect(restored.currentLevel).toBe(2);
  expect(restored.proofs[1].wires).toHaveLength(1);
  expect(restored.inputs[1]).toEqual({ A: 1 });
  expect(Object.keys(restored.circuits)).toHaveLength(levels.length);
});

it('can structurally parse candidate proofs for asynchronous verification', () => {
  const state = createWorkspace();
  state.proofs[1] = createCircuit(1);
  state.currentLevel = 20;
  const parsed = parseWorkspace(JSON.stringify(state), { verifyProofs: false });
  expect(parsed.currentLevel).toBe(20);
  expect(parsed.proofs[1]).toBeDefined();
});

it('round-trips the current lesson and independent drafts', () => {
  const state = createWorkspace();
  state.circuits[1] = connect(state.circuits[1], 'A', 'out', 'Y', 'in');
  state.proofs[1] = structuredClone(state.circuits[1]);
  state.currentLevel = 2;
  const restored = parseWorkspace(JSON.stringify(state));
  expect(restored.currentLevel).toBe(2);
  expect(restored.circuits[1].wires).toHaveLength(1);
  expect(restored.circuits[2].wires).toHaveLength(0);
});

it('does not trust a forged pass record', () => {
  const state = createWorkspace();
  state.currentLevel = 4;
  state.proofs[1] = createCircuit(1);
  expect(parseWorkspace(JSON.stringify(state)).currentLevel).toBe(1);
});

it('rejects broken files before changing existing drafts', () => {
  expect(() => parseWorkspace('{')).toThrow();
  const state = createWorkspace();
  state.circuits[1].nodes.pop();
  expect(() => parseWorkspace(JSON.stringify(state))).toThrow(/端口/);
});

it('keeps a valid pass proof independent of subsequent edits', () => {
  const state = createWorkspace();
  state.proofs[1] = connect(createCircuit(1), 'A', 'out', 'Y', 'in');
  state.currentLevel = 2;
  expect(parseWorkspace(JSON.stringify(state)).currentLevel).toBe(2);
});

it('drops level keys beyond the catalogue instead of invalidating a v6 save', () => {
  const state = createWorkspace();
  const proof = connect(createCircuit(1), 'A', 'out', 'Y', 'in');
  const poisoned = { version: 7, currentLevel: 100,
    circuits: { ...state.circuits, 100: state.circuits[1] },
    proofs: { 1: proof, 100: proof }, inputs: { 1: { A: 1 }, 100: { A: 1 } }, library: state.library };
  const restored = parseWorkspace(JSON.stringify(poisoned), { verifyProofs: false });
  expect(restored.circuits[57]).toBeDefined();
  expect(restored.proofs[1]).toBeDefined();
  expect(restored.proofs[100]).toBeUndefined();
  expect(restored.inputs[100]).toBeUndefined();
  expect(restored.currentLevel).toBe(levels.length);
});

it('ignores malformed level keys instead of invalidating a v7 save', () => {
  const state = createWorkspace();
  const restored = parseWorkspace(JSON.stringify({ ...state, proofs: { bogus: state.circuits[1] } }), { verifyProofs: false });
  expect(restored.proofs[1]).toBeUndefined();
  expect(restored.currentLevel).toBe(1);
});

it('synthesizes missing drafts instead of rejecting sparse v7 saves', () => {
  const state = createWorkspace();
  const proof = connect(createCircuit(1), 'A', 'out', 'Y', 'in');
  const sparse = { version: 7, currentLevel: 2, circuits: { 1: state.circuits[1] }, proofs: { 1: proof }, inputs: {}, library: {} };
  const restored = parseWorkspace(JSON.stringify(sparse));
  expect(restored.circuits[45].nodes.some(node => node.type === 'ROM')).toBe(true);
  expect(restored.circuits[57]).toEqual(state.circuits[57]);
  expect(restored.currentLevel).toBe(2);
});

it('serializes sparsely: untouched drafts and canonical components never reach the file', () => {
  const state = createWorkspace();
  state.circuits[1] = connect(state.circuits[1], 'A', 'out', 'Y', 'in');
  state.proofs[1] = structuredClone(state.circuits[1]);
  state.currentLevel = 2;
  const text = JSON.parse(serializeWorkspace(state));
  expect(text.version).toBe(7);
  expect(Object.keys(text.circuits)).toEqual(['1']);
  expect(Object.keys(text.proofs)).toEqual(['1']);
  expect(Object.keys(text.library).every(key => key.startsWith('component-'))).toBe(true);
  expect(parseWorkspace(serializeWorkspace(state))).toEqual(state);
});

it('keeps legacy canonical keys the code no longer produces while rebuilding known ones', () => {
  const state = createWorkspace();
  const raw = JSON.parse(JSON.stringify(state));
  const renamed = JSON.parse(JSON.stringify(state.library['architecture-mux1@1']));
  renamed.id = 'architecture-mux1-renamed'; renamed.version = 2;
  raw.library['architecture-mux1-renamed@2'] = renamed;
  raw.library['architecture-mux1@1'].name = '被篡改的名字';
  const restored = parseWorkspace(JSON.stringify(raw), { verifyProofs: false });
  expect(restored.library['architecture-mux1-renamed@2']).toEqual(renamed);
  expect(restored.library['architecture-mux1@1'].name).toBe(state.library['architecture-mux1@1'].name);
  expect(Object.keys(JSON.parse(serializeWorkspace(restored)).library)).toEqual(['architecture-mux1-renamed@2']);
});

it('refuses saves written by a newer application with a dedicated message', () => {
  const state = createWorkspace();
  expect(() => parseWorkspace(JSON.stringify({ ...state, version: 8 }))).toThrow('更新版本');
});
