import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Workspace } from '../src/storage';
import { addComponent, connect as connectCircuit, createCircuit } from '../src/model';
import { getLevel, levels, testSequences } from '../src/levels';
import { encapsulateSelection, packageCircuit } from '../src/components';
import { referenceCircuit } from './fixtures';
import { architectureLibrary } from '../src/architectureCircuits';

test.setTimeout(120_000);
const errors = new WeakMap<Page, string[]>();
function stateAt(id: number): Workspace {
  const state: Workspace = { version: 6, currentLevel: id, library: architectureLibrary(), proofs: {},
    circuits: Object.fromEntries(levels.map(level => [level.id, createCircuit(level.id)])),
    inputs: Object.fromEntries(levels.map(level => [level.id, Object.fromEntries(level.inputs.map(name => [name, 0]))])) };
  for (let level = 1; level <= 32; level++) {
    state.circuits[level] = referenceCircuit(level);
    if (level < id) state.proofs[level] = structuredClone(state.circuits[level]);
  }
  return state;
}
async function importState(page: Page, state: Workspace) {
  await page.locator('input[type=file]').setInputFiles({ name: 'time-save.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await expect(page.getByRole('status')).toContainText('存档已导入', { timeout: 90_000 });
  await expect(page.getByRole('heading', { name: getLevel(state.currentLevel).title, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '单步周期', exact: true })).toBeEnabled();
}
async function exportState(page: Page): Promise<Workspace> {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出存档', exact: true }).click();
  const path = await (await event).path();
  if (!path) throw new Error('Download unavailable');
  return JSON.parse(await readFile(path, 'utf8'));
}
async function connect(page: Page, source: string, sourcePort: string, target: string, targetPort: string) {
  await page.getByTestId(`port-${source}-${sourcePort}`).click();
  await page.getByTestId(`port-${target}-${targetPort}`).click();
}
async function tick(page: Page, cycle: number) {
  await page.getByRole('button', { name: '单步周期', exact: true }).click();
  await expect(page.getByTestId('clock-cycle')).toContainText(`周期 ${cycle}`);
  await expect(page.getByRole('button', { name: '单步周期', exact: true })).toBeEnabled();
}
async function bit(page: Page, name: string, value: boolean) {
  const button = page.getByRole('button', { name: `输入 ${name}`, exact: true });
  if (await button.getAttribute('aria-pressed') !== String(value)) await button.click();
}
async function bus(page: Page, name: string, value: number) {
  await page.getByRole('spinbutton', { name: `输入 ${name}`, exact: true }).fill(String(value));
}

test.beforeEach(async ({ page }) => {
  const list: string[] = []; errors.set(page, list); page.on('pageerror', error => list.push(error.message));
  await page.goto('/'); await page.evaluate(() => localStorage.clear()); await page.reload();
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));

test('builds a DFF in the editor; inputs hold, ticks capture, movement preserves state, import starts cleared', async ({ page }) => {
  const state = stateAt(21); state.circuits[21] = createCircuit(21);
  await importState(page, state);
  await page.getByRole('button', { name: '添加 CONST', exact: true }).click();
  const zero = (await page.locator('[data-gate-id]').last().getAttribute('data-gate-id'))!;
  await page.getByRole('button', { name: '添加 DFF', exact: true }).click();
  const register = (await page.locator('[data-gate-id]').last().getAttribute('data-gate-id'))!;
  await connect(page, 'D', 'out', register, 'd'); await connect(page, zero, 'out', register, 'rst');
  await connect(page, register, 'q', 'Q', 'in');
  await expect(page.getByTestId('output-Q')).toHaveText('0');
  await bit(page, 'D', true); await expect(page.getByTestId('output-Q')).toHaveText('0');
  await tick(page, 1); await expect(page.getByTestId('output-Q')).toHaveText('1');
  await bit(page, 'D', false); await expect(page.getByTestId('output-Q')).toHaveText('1');
  const node = page.locator(`[data-gate-id="${register}"] .node-heading`), box = await node.boundingBox();
  if (!box) throw new Error('Register missing');
  await page.mouse.move(box.x + 15, box.y + 10); await page.mouse.down();
  await page.mouse.move(box.x + 65, box.y + 35, { steps: 8 }); await page.mouse.up();
  await expect(page.getByTestId('clock-cycle')).toContainText('周期 1'); await expect(page.getByTestId('output-Q')).toHaveText('1');
  await tick(page, 2); await expect(page.getByTestId('output-Q')).toHaveText('0');
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await expect(page.getByTestId('test-feedback')).toContainText('全部通过');
  await bit(page, 'D', true); await tick(page, 3); await expect(page.getByTestId('output-Q')).toHaveText('1');
  const exported = await exportState(page); await importState(page, exported);
  await expect(page.getByTestId('clock-cycle')).toContainText('周期 0'); await expect(page.getByTestId('output-Q')).toHaveText('0');
  expect(exported.version).toBe(6);
  await page.screenshot({ path: 'work/time-register-desktop.png' });
});

test('eight-bit values, enable and synchronous reset work through the public UI', async ({ page }) => {
  await importState(page, stateAt(24));
  const data = page.getByRole('spinbutton', { name: '输入 D', exact: true });
  await data.fill(''); await data.pressSequentially('255'); await expect(data).toHaveValue('255');
  await bit(page, 'E', true); await tick(page, 1); await expect(page.getByTestId('output-Q')).toHaveText('255');
  await bit(page, 'E', false); await bus(page, 'D', 17); await tick(page, 2); await expect(page.getByTestId('output-Q')).toHaveText('255');
  await bit(page, 'R', true); await expect(page.getByTestId('output-Q')).toHaveText('255');
  await tick(page, 3); await expect(page.getByTestId('output-Q')).toHaveText('0');
  await page.getByRole('button', { name: '波形记录', exact: true }).click();
  await expect(page.getByTestId('timing-waveform')).toBeVisible();
  await expect(page.getByRole('img', { name: '信号波形，向右为时间' })).toContainText('255');
  await page.screenshot({ path: 'work/time-waveform-desktop.png' });
});

test('continuous clock advances a counter, pause stops it, and reset keeps the circuit', async ({ page }) => {
  await importState(page, stateAt(26)); await bit(page, 'E', true);
  const nodes = await page.locator('[data-gate-id]').count();
  await page.getByRole('button', { name: '运行时钟', exact: true }).click();
  await expect.poll(async () => Number((await page.getByTestId('clock-cycle').innerText()).replace(/\D/g, ''))).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: '暂停时钟', exact: true }).click();
  await expect(page.getByRole('button', { name: '单步周期', exact: true })).toBeEnabled();
  const paused = await page.getByTestId('clock-cycle').innerText();
  await page.waitForTimeout(1050); expect(await page.getByTestId('clock-cycle').innerText()).toBe(paused);
  await page.getByRole('button', { name: '清零状态', exact: true }).click();
  await expect(page.getByTestId('clock-cycle')).toContainText('周期 0'); await expect(page.getByTestId('output-Q')).toHaveText('0');
  await expect(page.locator('[data-gate-id]')).toHaveCount(nodes);
  await tick(page, 1); await expect(page.getByTestId('output-Q')).toHaveText('1');
});

test('memory reads change without an edge; simultaneous write and output capture use the old value', async ({ page }) => {
  await importState(page, stateAt(32));
  await bus(page, 'D', 7); await bit(page, 'W', true); await bit(page, 'Read', true);
  await tick(page, 1); await expect(page.getByTestId('output-Memory')).toHaveText('7'); await expect(page.getByTestId('output-Out')).toHaveText('0');
  await bus(page, 'D', 11); await tick(page, 2); await expect(page.getByTestId('output-Memory')).toHaveText('11'); await expect(page.getByTestId('output-Out')).toHaveText('7');
  await bus(page, 'Addr', 1); await expect(page.getByTestId('output-Memory')).toHaveText('0'); await expect(page.getByTestId('output-Out')).toHaveText('7');
  await bit(page, 'W', false); await tick(page, 3); await expect(page.getByTestId('output-Out')).toHaveText('0');
  await bus(page, 'Addr', 0); await bit(page, 'R', true); await expect(page.getByTestId('output-Memory')).toHaveText('11');
  await tick(page, 4); await expect(page.getByTestId('output-Memory')).toHaveText('0');
  await page.evaluate(() => {
    const probe = { frames: 0, running: true }; (window as unknown as { timeProbe: typeof probe }).timeProbe = probe;
    const frame = () => { if (!probe.running) return; if (document.querySelector('[aria-label="取消后台任务"]')?.textContent?.includes('测试中')) probe.frames++; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  });
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await bus(page, 'D', 15);
  await expect(page.getByTestId('test-feedback')).toContainText('2304 / 2304 全部通过', { timeout: 90_000 });
  expect(await page.evaluate(() => { const probe = (window as unknown as { timeProbe: { frames: number; running: boolean } }).timeProbe; probe.running = false; return probe.frames; })).toBeGreaterThan(2);
  expect(await page.locator('.test-table-wrap tbody tr').count()).toBeLessThanOrEqual(8);
  await page.screenshot({ path: 'work/time-memory-desktop.png' });
});

test('temporal counterexample replay reconstructs the failed prefix and state', async ({ page }) => {
  const state = stateAt(29), circuit = state.circuits[29];
  const first = circuit.nodes.find(node => node.type === 'DFF')!;
  const output = circuit.wires.find(wire => wire.target === 'Q')!; output.source = first.id; output.sourceHandle = 'q';
  const failure = testSequences(29).flatMap(sequence => {
    let firstStage = 0, cycle = 0;
    return sequence.steps.map((step, stepIndex) => {
      if (step.tick) { cycle++; if (step.inputs.R) firstStage = 0; else if (step.inputs.E) firstStage = step.inputs.D; }
      return { ...step, scenarioLabel: sequence.label, stepIndex, cycle, actual: firstStage };
    });
  }).find(step => step.actual !== step.expectedOutputs.Q)!;
  expect(failure).toBeDefined();
  await importState(page, state); await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await expect(page.getByTestId('test-feedback')).toContainText(failure.scenarioLabel!);
  await expect(page.getByTestId('clock-cycle')).toContainText(`周期 ${failure.cycle}`);
  await expect(page.getByTestId('output-Q')).toHaveText(String(failure.actual));
  await page.getByRole('button', { name: '清零状态', exact: true }).click(); await bus(page, 'D', 14);
  await expect(page.locator('.failed-node')).toHaveCount(0);
  await page.getByRole('button', { name: '回放反例', exact: true }).click();
  await expect(page.getByTestId('clock-cycle')).toContainText(`周期 ${failure.cycle}`);
  await expect(page.getByTestId('output-Q')).toHaveText(String(failure.actual));
  await expect(page.getByRole('spinbutton', { name: '输入 D', exact: true })).toHaveValue(String(failure.inputs.D));
  await expect(page.locator('.failed-node')).toHaveCount(1);
  await page.getByRole('button', { name: '波形记录', exact: true }).click();
  expect(Number(await page.getByTestId('timing-waveform').getAttribute('data-frames'))).toBeGreaterThan(1);
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await expect(page.getByTestId('test-feedback')).toContainText(failure.scenarioLabel!);
  await expect(page.getByTestId('output-Q')).toHaveText(String(failure.actual));
});

test('nested stateful components keep their dependencies on export/import and work on mobile', async ({ page }) => {
  const state = stateAt(23);
  const first = encapsulateSelection(state.circuits[23], state.circuits[23].nodes.filter(node => !['INPUT', 'OUTPUT'].includes(node.type)).map(node => node.id), '使能存储', state.library);
  const second = encapsulateSelection(first.circuit, first.circuit.nodes.filter(node => node.type === 'COMPONENT').map(node => node.id), '嵌套存储', first.library);
  state.circuits[23] = second.circuit; state.library = { ...state.library, ...second.library };
  await importState(page, state); await bit(page, 'D', true); await bit(page, 'E', true); await tick(page, 1);
  await expect(page.getByTestId('output-Q')).toHaveText('1');
  await page.getByRole('button', { name: '测试电路', exact: true }).click(); await expect(page.getByTestId('test-feedback')).toContainText('全部通过');
  const exported = await exportState(page); expect(exported.library).toEqual(state.library);
  await importState(page, exported); await expect(page.getByTestId('output-Q')).toHaveText('0'); await tick(page, 1); await expect(page.getByTestId('output-Q')).toHaveText('1');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '波形记录', exact: true }).click(); await expect(page.getByTestId('timing-waveform')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'work/time-mobile.png', fullPage: true });
});

test('a registered component with external self-feedback expands and undo restores every connection', async ({ page }) => {
  const state = stateAt(21), packaged = packageCircuit(referenceCircuit(21), '保存自身', {});
  state.library = { ...state.library, ...packaged.library };
  let circuit = addComponent(createCircuit(21), packaged.key, { x: 330, y: 190 }, state.library, 'unit');
  circuit = connectCircuit(circuit, 'unit', 'Q', 'unit', 'D', state.library);
  state.circuits[21] = connectCircuit(circuit, 'unit', 'Q', 'Q', 'in', state.library);
  await importState(page, state);
  await page.locator('[data-gate-id="unit"] .node-heading').click();
  await page.getByRole('button', { name: '属性', exact: true }).click();
  await page.getByRole('button', { name: '展开组件', exact: true }).click();
  await expect(page.locator('[data-gate-id="unit"]')).toHaveCount(0);
  const expanded = (await exportState(page)).circuits[21];
  const register = expanded.nodes.find(node => node.type === 'DFF')!;
  expect(expanded.wires.some(wire => wire.source === register.id && wire.target === register.id && wire.sourceHandle === 'q' && wire.targetHandle === 'd')).toBe(true);
  expect(expanded.wires.every(wire => expanded.nodes.some(node => node.id === wire.source) && expanded.nodes.some(node => node.id === wire.target))).toBe(true);
  await tick(page, 1); await expect(page.getByTestId('output-Q')).toHaveText('0');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  const restored = (await exportState(page)).circuits[21];
  expect({ nodes: restored.nodes, wires: restored.wires }).toEqual({ nodes: state.circuits[21].nodes, wires: state.circuits[21].wires });
  await page.getByRole('button', { name: '重做', exact: true }).click(); await tick(page, 1);
  await expect(page.getByTestId('output-Q')).toHaveText('0');
});
