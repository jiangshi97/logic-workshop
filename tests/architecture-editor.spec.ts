import { test, expect, type Page } from '@playwright/test';
import { levels } from '../src/levels';
import { testSequences } from '../src/levels';
import { architectureLibrary } from '../src/architectureCircuits';
import type { Workspace } from '../src/storage';
import { readFile } from 'node:fs/promises';
import { referenceCircuit } from './fixtures';

test.setTimeout(240_000);
function stateAt(id: number): Workspace {
  const state: Workspace = { version: 6, currentLevel: id, library: architectureLibrary(), proofs: {}, circuits: {}, inputs: {} };
  for (const level of levels) {
    state.circuits[level.id] = referenceCircuit(level.id);
    state.inputs[level.id] = Object.fromEntries(level.inputs.map(p => [p, 0]));
    if (level.id < id) state.proofs[level.id] = structuredClone(state.circuits[level.id]);
  }
  return state;
}
async function load(page: Page, state: Workspace) {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'architecture-save.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await expect(page.getByRole('status')).toContainText('存档已导入', { timeout: 180_000 });
  await expect(page.getByRole('button', { name: '测试电路', exact: true })).toBeEnabled();
}
async function exported(page: Page): Promise<Workspace> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出存档', exact: true }).click();
  const path = await (await download).path();
  if (!path) throw new Error('No save download');
  return JSON.parse(await readFile(path, 'utf8'));
}
async function tick(page: Page, cycle: number) {
  await page.getByRole('button', { name: '单步周期', exact: true }).click();
  await expect(page.getByTestId('clock-cycle')).toHaveText(`周期 ${cycle}`);
  await expect(page.getByRole('button', { name: '单步周期', exact: true })).toBeEnabled();
}
async function bit(page: Page, id: string, value: boolean) {
  const button = page.getByRole('button', { name: `输入 ${id}`, exact: true });
  if (await button.getAttribute('aria-pressed') !== String(value)) await button.click();
}
async function program(page: Page, words: string) {
  await page.getByRole('button', { name: '编辑 ROM 程序', exact: true }).click();
  await page.getByRole('textbox', { name: 'ROM 程序字' }).fill(words);
  await page.getByRole('button', { name: '应用程序', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('clock-cycle')).toHaveText('周期 0');
}
test('a migrated stage-five save unlocks architecture and lets users place 16-bit gates', async ({ page }) => {
  const circuits = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [i + 1, referenceCircuit(i + 1)]));
  const inputs = Object.fromEntries(levels.filter(l => l.id <= 32).map(l => [l.id, Object.fromEntries(l.inputs.map(p => [p, 0]))]));
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'v3-save.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 3, currentLevel: 32, circuits, inputs, proofs: circuits, library: {} })) });
  await expect(page.getByRole('status')).toContainText('存档已导入', { timeout: 90_000 });
  await expect(page.getByTestId('progress-count')).toHaveText('32 / 57');
  await page.getByRole('button', { name: /第 33 关/ }).click();
  await expect(page.getByRole('heading', { name: '八位加减器', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '基础组件', exact: true }).click();
  await page.getByRole('combobox', { name: '总线位宽' }).selectOption('16');
  await page.getByRole('button', { name: '添加 AND', exact: true }).click();
  await expect(page.locator('.gate-node .node-kind')).toContainText(['16 bit']);
  await page.getByRole('tab', { name: '教学组件', exact: true }).click();
  await page.getByRole('button', { name: '查看教学组件 八位进位加法器', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '组件内部电路' })).toBeVisible();
  await expect(page.locator('.component-preview .gate-node')).not.toHaveCount(0);
  await page.getByRole('button', { name: '关闭组件详情', exact: true }).click();
  await page.getByRole('button', { name: '添加教学组件 八位使能寄存器', exact: true }).click();
  const saved = await exported(page);
  expect(saved.version).toBe(6);
  expect(saved.library['architecture-register8@1'].dependencies).toContain('architecture-mux8@1');
  expect(saved.library['architecture-mux8@1']).toBeDefined();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect((await exported(page)).circuits[33].nodes.filter(n => n.type === 'COMPONENT')).toHaveLength(0);
});

test('refreshes reused A and B handles when entering the register-pair lesson', async ({ page }) => {
  const state = stateAt(35);
  state.currentLevel = 34;
  await load(page, state);
  await page.getByRole('button', { name: /第 35 关/ }).click();
  await expect(page.getByRole('heading', { name: '双寄存器组', exact: true })).toBeVisible();
  await expect(page.locator('.react-flow__edge[aria-label="Edge from reference to A"]')).toHaveCount(1);
  await expect(page.locator('.react-flow__edge[aria-label="Edge from reference to B"]')).toHaveCount(1);
});

test('ROM editing validates, commits atomically, undoes fully and retains instruction words through import', async ({ page }) => {
  const state = stateAt(38);
  await load(page, state);
  const original = state.circuits[38];
  await page.getByRole('button', { name: '编辑 ROM 程序', exact: true }).click();
  await page.getByRole('textbox', { name: 'ROM 程序字' }).fill('10000');
  await page.getByRole('button', { name: '应用程序', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('无效');
  await page.getByRole('button', { name: '关闭程序编辑器', exact: true }).click();
  expect((await exported(page)).circuits[38]).toEqual(original);
  await page.getByRole('button', { name: '编辑 ROM 程序', exact: true }).click();
  await page.getByRole('textbox', { name: 'ROM 程序字' }).fill('1003\n1104\n2000\n8000\n9000');
  await page.getByRole('button', { name: '应用程序', exact: true }).click();
  const changed = await exported(page);
  expect(changed.circuits[38].nodes.find(n => n.id === 'program')!.words).toEqual([0x1003, 0x1104, 0x2000, 0x8000, 0x9000]);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  const undone = (await exported(page)).circuits[38];
  expect(undone.nodes).toEqual(original.nodes); expect(undone.wires).toEqual(original.wires);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  expect((await exported(page)).circuits[38].nodes).toEqual(changed.circuits[38].nodes);
  await bit(page, 'E', true); await tick(page, 1);
  await expect(page.getByTestId('output-IR')).toHaveText(String(0x1003));
  await expect(page.getByTestId('output-PC')).toHaveText('1');
  await page.getByRole('spinbutton', { name: '输入 Target', exact: true }).fill('255');
  await bit(page, 'Jump', true); await tick(page, 2);
  await expect(page.getByTestId('output-IR')).toHaveText(String(0x1104));
  await expect(page.getByTestId('output-PC')).toHaveText('255');
  await bit(page, 'Jump', false); await tick(page, 3);
  await expect(page.getByTestId('output-PC')).toHaveText('0');
  const saved = await exported(page);
  expect(saved).not.toHaveProperty('runtime');
  await load(page, saved);
  await expect(page.getByTestId('clock-cycle')).toHaveText('周期 0');
  expect((await exported(page)).circuits[38].nodes).toEqual(saved.circuits[38].nodes);
  await page.getByRole('button', { name: '编辑 ROM 程序', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'ROM 程序字' })).toHaveValue('1003\n1104\n2000\n8000\n9000');
  await page.screenshot({ path: 'work/architecture-program-editor.png' });
});

test('the player CPU executes custom ROM words in three phases, pauses, resets and traps illegal instructions', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await load(page, stateAt(44));
  await expect(page.getByTestId('scenario-program')).toHaveCount(0);
  await program(page, '1003\n1104\n2000\n8000\n9000');
  await bit(page, 'E', true);
  for (let cycle = 1; cycle <= 15; cycle++) {
    await tick(page, cycle);
    if (cycle === 1) { await expect(page.getByTestId('machine-Phase')).toHaveText('1'); await expect(page.getByTestId('machine-IR')).toHaveText(String(0x1003)); await expect(page.getByTestId('machine-A')).toHaveText('0'); }
    if (cycle === 2) await expect(page.getByTestId('machine-Phase')).toHaveText('2');
    if (cycle === 3) { await expect(page.getByTestId('machine-A')).toHaveText('3'); await expect(page.getByTestId('machine-PC')).toHaveText('1'); }
    if (cycle === 6) await expect(page.getByTestId('machine-B')).toHaveText('4');
    if (cycle === 9) { await expect(page.getByTestId('machine-A')).toHaveText('7'); await expect(page.getByTestId('machine-Out')).toHaveText('0'); }
    if (cycle === 12) await expect(page.getByTestId('machine-Out')).toHaveText('7');
  }
  await expect(page.getByTestId('machine-Halt')).toHaveText('1');
  await expect(page.getByTestId('machine-PC')).toHaveText('4');
  await tick(page, 16); await expect(page.getByTestId('machine-PC')).toHaveText('4');
  await bit(page, 'R', true); await expect(page.getByTestId('machine-Halt')).toHaveText('1');
  await tick(page, 17); await expect(page.getByTestId('machine-Halt')).toHaveText('0'); await expect(page.getByTestId('machine-Out')).toHaveText('0');
  await bit(page, 'R', false); await bit(page, 'E', false); await tick(page, 18);
  await expect(page.getByTestId('machine-Phase')).toHaveText('0');
  await bit(page, 'E', true); await page.getByRole('button', { name: '运行时钟', exact: true }).click();
  await expect(page.getByTestId('clock-cycle')).not.toHaveText('周期 18', { timeout: 10_000 });
  await page.getByRole('button', { name: '暂停时钟', exact: true }).click();
  await expect(page.getByRole('button', { name: '单步周期', exact: true })).toBeEnabled();
  const paused = await page.getByTestId('clock-cycle').textContent();
  await page.waitForTimeout(1100); await expect(page.getByTestId('clock-cycle')).toHaveText(paused!);
  await program(page, '1009\n2001\n8000');
  for (let cycle = 1; cycle <= 6; cycle++) await tick(page, cycle);
  await expect(page.getByTestId('machine-Fault')).toHaveText('1'); await expect(page.getByTestId('machine-Halt')).toHaveText('1');
  await expect(page.getByTestId('machine-A')).toHaveText('9'); await expect(page.getByTestId('machine-Out')).toHaveText('0');
  await expect(page.getByTestId('machine-PC')).toHaveText('1'); await expect(page.getByTestId('machine-Phase')).toHaveText('2');
  await tick(page, 7); await expect(page.getByTestId('machine-PC')).toHaveText('1');
  await page.getByRole('button', { name: '波形记录', exact: true }).click();
  await expect(page.getByRole('img', { name: '信号波形，向右为时间' })).toBeVisible();
  await page.screenshot({ path: 'work/architecture-cpu-desktop.png' });
  await page.setViewportSize({ width: 430, height: 900 });
  await page.getByRole('button', { name: '查看任务', exact: true }).click();
  await expect(page.getByTestId('machine-Out')).toHaveText('0');
  await page.getByRole('button', { name: '编辑 ROM 程序', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'work/architecture-cpu-mobile.png' });
  expect(errors).toEqual([]);
});

test('CPU judging stays responsive and replay retains its own program until clear state', async ({ page }) => {
  const state = stateAt(44), graph = state.circuits[44];
  graph.nodes.find(n => n.id === 'program')!.words = [0];
  const output = graph.wires.find(w => w.target === 'Out')!, a = graph.wires.find(w => w.target === 'A')!;
  output.source = a.source; output.sourceHandle = a.sourceHandle;
  const scenario = testSequences(44)[0];
  let cycle = 0;
  const failure = scenario.steps.map((step, index) => ({ ...step, index, cycle: cycle += Number(step.tick) })).find(step => step.expectedOutputs.Out !== step.expectedOutputs.A)!;
  await load(page, state);
  await page.evaluate(() => { const probe = { frames: 0, running: true }; (window as unknown as { archProbe: typeof probe }).archProbe = probe; const frame = () => { if (probe.running) { probe.frames++; requestAnimationFrame(frame); } }; requestAnimationFrame(frame); });
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await expect(page.getByTestId('test-feedback')).toContainText('发现不一致', { timeout: 90_000 });
  await expect(page.getByTestId('scenario-program')).toContainText('正在回放测试程序');
  await expect(page.getByTestId('output-Out')).toHaveText(String(failure.expectedOutputs.A));
  await expect(page.getByTestId('clock-cycle')).toHaveText(`周期 ${failure.cycle}`);
  await page.getByRole('button', { name: '回放反例', exact: true }).click();
  await expect(page.getByRole('button', { name: '单步周期', exact: true })).toBeEnabled();
  await expect(page.getByTestId('output-Out')).toHaveText(String(failure.expectedOutputs.A));
  await tick(page, failure.cycle + 1); await expect(page.getByTestId('scenario-program')).toBeVisible();
  await page.getByRole('button', { name: '清零状态', exact: true }).click();
  await expect(page.getByTestId('scenario-program')).toHaveCount(0);
  await expect(page.getByTestId('clock-cycle')).toHaveText('周期 0');
  await tick(page, 1); await expect(page.getByTestId('machine-IR')).toHaveText('0');
  expect(await page.evaluate(() => { const probe = (window as unknown as { archProbe: { frames: number; running: boolean } }).archProbe; probe.running = false; return probe.frames; })).toBeGreaterThan(2);
});

test('RAM reads addresses immediately, resets on edges and keeps memory out of saved state', async ({ page }) => {
  await load(page, stateAt(41));
  await page.getByRole('spinbutton', { name: '输入 Addr', exact: true }).fill('255');
  await page.getByRole('spinbutton', { name: '输入 D', exact: true }).fill('165');
  await bit(page, 'W', true); await expect(page.getByTestId('output-Q')).toHaveText('0');
  await tick(page, 1); await expect(page.getByTestId('output-Q')).toHaveText('165');
  await bit(page, 'W', false);
  await page.getByRole('spinbutton', { name: '输入 Addr', exact: true }).fill('128');
  await expect(page.getByTestId('output-Q')).toHaveText('0');
  await page.getByRole('spinbutton', { name: '输入 Addr', exact: true }).fill('255');
  await expect(page.getByTestId('output-Q')).toHaveText('165');
  const saved = await exported(page);
  expect(JSON.stringify(saved)).not.toContain('memories');
  await bit(page, 'R', true); await expect(page.getByTestId('output-Q')).toHaveText('165');
  await tick(page, 2); await expect(page.getByTestId('output-Q')).toHaveText('0');
  await load(page, saved); await expect(page.getByTestId('output-Q')).toHaveText('0');
  await expect(page.getByTestId('clock-cycle')).toHaveText('周期 0');
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await expect(page.getByTestId('test-feedback')).toContainText('全部通过', { timeout: 90_000 });
});
