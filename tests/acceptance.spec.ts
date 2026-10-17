import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Workspace } from '../src/storage';
import { getLevel, levels } from '../src/levels';
import { encapsulateSelection } from '../src/components';
import { createCircuit } from '../src/model';
import { referenceCircuit } from './fixtures';
import { architectureLibrary } from '../src/architectureCircuits';

test.setTimeout(90_000);
const browserErrors = new WeakMap<Page, string[]>();

function completedWorkspace(current: number): Workspace {
  const state: Workspace = { version: 6, currentLevel: current, library: architectureLibrary(), proofs: {},
    circuits: Object.fromEntries(levels.map(level => [level.id, createCircuit(level.id)])),
    inputs: Object.fromEntries(levels.map(level => [level.id, Object.fromEntries(level.inputs.map(name => [name, 0]))])) };
  for (const level of levels) {
    state.circuits[level.id] = referenceCircuit(level.id);
    state.proofs[level.id] = structuredClone(state.circuits[level.id]);
  }
  return state;
}

async function importWorkspace(page: Page, state: Workspace) {
  await page.locator('input[type=file]').setInputFiles({ name: 'acceptance-save.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(state)) });
  await expect(page.getByRole('status')).toContainText('存档已导入', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: '测试电路', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: getLevel(state.currentLevel).title, exact: true })).toBeVisible();
}

async function exportWorkspace(page: Page): Promise<Workspace> {
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出存档', exact: true }).click();
  const file = await (await downloaded).path();
  if (!file) throw new Error('Export download is unavailable');
  return JSON.parse(await readFile(file, 'utf8')) as Workspace;
}

const graph = (state: Workspace, id: number) => ({ nodes: state.circuits[id].nodes, wires: state.circuits[id].wires });

test.beforeEach(async ({ page }) => {
  const errors: string[] = []; browserErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});
test.afterEach(async ({ page }) => { expect(browserErrors.get(page)).toEqual([]); });

test('all twenty proofs import and a 512-case worker run keeps inputs and animation responsive', async ({ page }) => {
  const state = completedWorkspace(18);
  const circuit = state.circuits[18];
  let previous = 'Cin';
  for (let index = 0; index < 100; index++) {
    const id = `stress-${index}`;
    circuit.nodes.push({ id, type: 'NOT', label: 'NOT', bits: 1, position: { x: 1700 + index * 150, y: 500 } });
    circuit.wires.push({ id: `stress-wire-${index}`, source: previous, sourceHandle: 'out', target: id, targetHandle: 'a' });
    previous = id;
  }
  await importWorkspace(page, state);
  await expect(page.getByTestId('progress-count')).toContainText(`${levels.length} / ${levels.length}`);
  await expect.poll(() => page.locator('.react-flow__viewport').evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a)).toBeLessThan(0.25);
  await page.evaluate(() => {
    const probe = { activeFrames: 0, running: true };
    (window as unknown as { acceptanceProbe: typeof probe }).acceptanceProbe = probe;
    const frame = () => {
      if (!probe.running) return;
      if (document.querySelector('[aria-label="取消后台任务"]')?.textContent?.includes('测试中')) probe.activeFrames++;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消后台任务', exact: true })).toContainText('测试中');
  await page.getByRole('button', { name: '下一组输入', exact: true }).click();
  await expect(page.getByRole('button', { name: '输入 Cin', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('test-feedback')).toContainText('512 / 512 全部通过', { timeout: 60_000 });
  const frames = await page.evaluate(() => {
    const probe = (window as unknown as { acceptanceProbe: { activeFrames: number; running: boolean } }).acceptanceProbe;
    probe.running = false;
    return probe.activeFrames;
  });
  expect(frames).toBeGreaterThan(2);
  expect(await page.locator('.test-table-wrap tbody tr').count()).toBeLessThanOrEqual(8);
  await page.screenshot({ path: 'work/twenty-lessons-desktop.png' });
});

test('nested component dependencies survive public export and import with equivalent outputs', async ({ page }) => {
  const state = completedWorkspace(15);
  const first = encapsulateSelection(state.circuits[15], state.circuits[15].nodes.filter(n => n.type !== 'INPUT' && n.type !== 'OUTPUT').map(n => n.id), '半加器内部', state.library);
  const second = encapsulateSelection(first.circuit, first.circuit.nodes.filter(n => n.type === 'COMPONENT').map(n => n.id), '嵌套半加器', first.library);
  state.circuits[15] = second.circuit;
  state.library = second.library;
  await importWorkspace(page, state);
  await page.getByRole('button', { name: '输入 A', exact: true }).click();
  await page.getByRole('button', { name: '输入 B', exact: true }).click();
  await expect(page.getByTestId('output-Sum')).toHaveText('0');
  await expect(page.getByTestId('output-Carry')).toHaveText('1');
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await expect(page.getByTestId('test-feedback')).toContainText('全部通过');
  const exported = await exportWorkspace(page);
  await page.getByRole('button', { name: /^组件库/ }).click();
  await page.locator('.library-item').last().getByRole('button', { name: '查看内部电路', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '组件内部电路' }).locator('.react-flow__node')).toHaveCount(5);
  await page.screenshot({ path: 'work/nested-component.png' });
  await page.getByRole('button', { name: '关闭组件详情', exact: true }).click();
  expect(exported.library).toEqual(state.library);
  expect(graph(exported, 15)).toEqual(graph(state, 15));
  await page.getByRole('button', { name: '重置当前电路', exact: true }).click();
  await page.getByRole('button', { name: '确认重置', exact: true }).click();
  await importWorkspace(page, exported);
  await expect(page.getByTestId('output-Sum')).toHaveText('0');
  await expect(page.getByTestId('output-Carry')).toHaveText('1');
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await expect(page.getByTestId('test-feedback')).toContainText('全部通过');
  const broken = structuredClone(exported);
  delete broken.library[first.key];
  await page.locator('input[type=file]').setInputFiles({ name: 'missing-dependency.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(broken)) });
  await expect(page.getByRole('status')).toContainText('导入失败');
  expect(graph(await exportWorkspace(page), 15)).toEqual(graph(exported, 15));
});

test('selection encapsulation and expansion restore the entire circuit through undo and redo', async ({ page }) => {
  const state = completedWorkspace(15);
  await importWorkspace(page, state);
  const before = await exportWorkspace(page);
  const gates = page.locator('[data-gate-id] .node-heading');
  await gates.nth(0).click();
  await gates.nth(1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: '封装所选组件', exact: true }).click();
  await page.getByLabel('组件名称', { exact: true }).fill('验收半加器');
  await page.getByRole('dialog').getByRole('button', { name: '保存组件', exact: true }).click();
  await expect(page.locator('[data-gate-id]')).toHaveCount(1);
  const packaged = await exportWorkspace(page);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(graph(await exportWorkspace(page), 15)).toEqual(graph(before, 15));
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(graph(await exportWorkspace(page), 15)).toEqual(graph(packaged, 15));
  await page.locator('[data-gate-id] .node-heading').click();
  await page.getByRole('button', { name: '属性', exact: true }).click();
  await page.getByRole('button', { name: '展开组件', exact: true }).click();
  await expect(page.locator('[data-gate-id]')).toHaveCount(2);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(graph(await exportWorkspace(page), 15)).toEqual(graph(packaged, 15));
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await expect(page.getByTestId('test-feedback')).toContainText('全部通过');
});

test('a passed multi-output lesson becomes a versioned component usable in later lessons', async ({ page }) => {
  await importWorkspace(page, completedWorkspace(15));
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await expect(page.getByTestId('test-feedback')).toContainText('全部通过');
  await page.getByRole('button', { name: '保存为组件', exact: true }).click();
  await page.getByLabel('组件名称', { exact: true }).fill('我的半加器');
  await page.getByRole('dialog').getByRole('button', { name: '保存组件', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加组件 我的半加器 v1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关卡', exact: true }).click();
  await page.getByRole('button', { name: `第 16 关 ${getLevel(16).title}`, exact: true }).click();
  await page.getByRole('button', { name: /^组件库/ }).click();
  await page.getByRole('button', { name: '添加组件 我的半加器 v1', exact: true }).click();
  const saved = await exportWorkspace(page);
  const instance = saved.circuits[16].nodes.find(n => n.type === 'COMPONENT');
  expect(instance).toBeDefined();
  expect(saved.library[instance!.componentKey!].outputs.map(p => p.id)).toEqual(['Sum', 'Carry']);
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await expect(page.getByTestId('test-feedback')).toContainText('全部通过');
});

test('bus typing and constant properties survive asynchronous signals, duplication, undo and redo', async ({ page }) => {
  const state = completedWorkspace(19);
  state.circuits[19] = createCircuit(19);
  state.circuits[19].nodes.push({ id: 'constant', type: 'CONST', label: 'CONST', bits: 4, value: 7, position: { x: 350, y: 210 } });
  state.circuits[19].wires.push({ id: 'constant-wire', source: 'constant', sourceHandle: 'out', target: 'Y', targetHandle: 'in' });
  await importWorkspace(page, state);
  const bus = page.getByRole('spinbutton', { name: '输入 A', exact: true });
  await bus.fill(''); await bus.pressSequentially('15');
  await expect(bus).toHaveValue('15');
  await expect.poll(async () => (await exportWorkspace(page)).inputs[19].A).toBe(15);
  await page.locator('[data-gate-id="constant"] .node-heading').click();
  await page.getByRole('button', { name: '属性', exact: true }).click();
  const before = await exportWorkspace(page);
  await page.getByRole('spinbutton', { name: '常量值', exact: true }).fill('12');
  await expect(page.getByTestId('output-Y')).toHaveText('12');
  await page.getByRole('button', { name: '复制所选组件', exact: true }).click();
  const duplicated = await exportWorkspace(page);
  expect(duplicated.circuits[19].nodes.filter(n => n.type === 'CONST').map(n => [n.bits, n.value])).toEqual([[4, 12], [4, 12]]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(graph(await exportWorkspace(page), 19)).toEqual(graph(before, 19));
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(graph(await exportWorkspace(page), 19)).toEqual(graph(duplicated, 19));
  await page.getByRole('combobox', { name: '总线位宽', exact: true }).selectOption('1');
  await page.getByRole('button', { name: '添加 CONST', exact: true }).click();
  const oneBit = (await exportWorkspace(page)).circuits[19].nodes.filter(n => n.type === 'CONST').at(-1)!;
  expect(oneBit.bits).toBe(1);
  await page.getByTestId(`port-${oneBit.id}-out`).click(); await page.getByTestId('port-Cout-in').click();
  await expect(page.getByTestId('output-Cout')).toHaveText('0');
});

test('moving a selection restores every node position and wire on undo', async ({ page }) => {
  await importWorkspace(page, completedWorkspace(15));
  const gates = page.locator('[data-gate-id] .node-heading');
  await gates.nth(0).click(); await gates.nth(1).click({ modifiers: ['Shift'] });
  const before = await exportWorkspace(page);
  const start = await gates.nth(0).boundingBox();
  if (!start) throw new Error('Gate unavailable');
  await page.mouse.move(start.x + 10, start.y + 10); await page.mouse.down();
  await page.mouse.move(start.x + 60, start.y + 50, { steps: 8 }); await page.mouse.up();
  const moved = await exportWorkspace(page);
  const changed = before.circuits[15].nodes.filter(n => !['INPUT', 'OUTPUT'].includes(n.type)).every(n => JSON.stringify(n.position) !== JSON.stringify(moved.circuits[15].nodes.find(other => other.id === n.id)!.position));
  expect(changed).toBe(true);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(graph(await exportWorkspace(page), 15)).toEqual(graph(before, 15));
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect(graph(await exportWorkspace(page), 15)).toEqual(graph(moved, 15));
});

test('multi-output counterexamples replay the failing inputs and identify only mismatched outputs', async ({ page }) => {
  const state = completedWorkspace(15);
  const sum = state.circuits[15].wires.find(w => w.target === 'Sum')!;
  const carry = state.circuits[15].wires.find(w => w.target === 'Carry')!;
  carry.source = sum.source;
  carry.sourceHandle = sum.sourceHandle;
  await importWorkspace(page, state);
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  const feedback = page.getByTestId('test-feedback');
  await expect(feedback).toContainText('Carry 期望 0');
  await expect(feedback).toContainText('实际 1');
  await expect(page.getByTestId('output-Sum')).toHaveText('1');
  await expect(page.getByTestId('output-Carry')).toHaveText('1');
  await expect(page.locator('.failed-node')).toHaveCount(1);
  await page.getByRole('button', { name: '输入 A', exact: true }).click({ timeout: 5_000 });
  await expect(page.getByTestId('output-Carry')).toHaveText('0');
  await expect(page.locator('.failed-node')).toHaveCount(0);
  await page.getByRole('button', { name: '回放反例', exact: true }).click();
  await expect(page.getByRole('button', { name: '输入 A', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: '输入 B', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('output-Carry')).toHaveText('1');
  await expect(page.locator('.failed-node')).toHaveCount(1);
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await expect(feedback).toContainText('Carry 期望 0');
  await expect(feedback).toContainText('A = 0，B = 1');
});
