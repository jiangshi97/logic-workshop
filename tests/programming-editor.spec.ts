import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Workspace } from '../src/storage';
import { levels } from '../src/levels';
import { architectureLibrary } from '../src/architectureCircuits';
import { programmingCases, programmingReferenceSource } from '../src/programmingSpec';
import { referenceCircuit } from './fixtures';

test.setTimeout(240_000);
async function migrated(page: Page) {
  const state = JSON.parse(await readFile('docs/computer-architecture-demo.json', 'utf8'));
  state.proofs = structuredClone(state.circuits);
  state.currentLevel = 44;
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'completed-architecture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await expect(page.locator('.toast')).toContainText('存档已导入', { timeout: 180_000 });
  await page.getByRole('button', { name: /第 45 关/ }).click({ timeout: 6000 });
}
async function exported(page: Page): Promise<Workspace> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出存档', exact: true }).click();
  const path = await (await download).path();
  if (!path) throw new Error('No exported save');
  return JSON.parse(await readFile(path, 'utf8'));
}
async function at(page: Page, id: number) {
  const state: Workspace = { version: 6, currentLevel: id, library: architectureLibrary(), circuits: {}, proofs: {}, inputs: {} };
  for (const level of levels) {
    state.circuits[level.id] = referenceCircuit(level.id);
    state.inputs[level.id] = Object.fromEntries(level.inputs.map(name => [name, level.mode === 'program' && name === 'E' ? 1 : 0]));
    if (level.id < id) state.proofs[level.id] = structuredClone(state.circuits[level.id]);
  }
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'program-save.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await expect(page.locator('.toast')).toContainText('存档已导入', { timeout: 180_000 });
  await expect(page.getByRole('button', { name: '测试程序', exact: true })).toBeEnabled();
  return state;
}
async function apply(page: Page, source: string) {
  await page.getByRole('textbox', { name: '汇编源代码' }).fill(source);
  await page.getByRole('button', { name: '应用汇编', exact: true }).click();
  await expect(page.getByTestId('clock-cycle')).toHaveText('周期 0');
  await expect(page.getByRole('button', { name: '测试程序', exact: true })).toBeEnabled();
}
async function instruction(page: Page, cycle: number) {
  await page.getByRole('button', { name: '单步指令', exact: true }).click();
  await expect(page.getByTestId('clock-cycle')).toHaveText(`周期 ${cycle}`);
}

test('a completed architecture save opens the assembly workbench and applies a program atomically', async ({ page }) => {
  await migrated(page);
  await expect(page.getByRole('textbox', { name: '汇编源代码' })).toBeVisible();
  await page.getByRole('textbox', { name: '汇编源代码' }).fill('MOVI A, 42\nOUT\nHLT');
  await page.getByRole('button', { name: '应用汇编', exact: true }).click();
  await expect(page.getByTestId('clock-cycle')).toHaveText('周期 0');
  await page.getByRole('button', { name: '测试程序', exact: true }).click();
  await expect(page.getByTestId('test-feedback')).toContainText('全部通过', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /第 46 关/ })).toBeEnabled();
  await instruction(page, 3); await instruction(page, 6); await instruction(page, 9);
  await expect(page.getByTestId('machine-Halt')).toHaveText('1');
  await apply(page, 'MOVI A, 42\nOUT\nHLT');
  await expect(page.getByTestId('program-output-events')).toHaveText('尚无输出');
  const applied = (await exported(page)).circuits[45];
  expect(applied.nodes.find(node => node.id === 'program')).toMatchObject({ words: [0x102a, 0x8000, 0x9000], programSource: 'MOVI A, 42\nOUT\nHLT' });
  await apply(page, 'MOVI A, 41\nOUT\nHLT');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '汇编源代码' })).toHaveValue('MOVI A, 42\nOUT\nHLT');
  const restored = (await exported(page)).circuits[45];
  expect(restored.nodes).toEqual(applied.nodes); expect(restored.wires).toEqual(applied.wires);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '汇编源代码' })).toHaveValue('MOVI A, 41\nOUT\nHLT');
  const beforeError = (await exported(page)).circuits[45];
  await page.getByRole('textbox', { name: '汇编源代码' }).fill('JMP missing');
  await expect(page.getByRole('alert')).toContainText('missing');
  await expect(page.getByRole('button', { name: '应用汇编', exact: true })).toBeDisabled();
  expect((await exported(page)).circuits[45]).toEqual(beforeError);
});

test('breakpoints stop before fetch, instruction stepping resumes, and continue hits a loop again', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await at(page, 45);
  await apply(page, 'start: MOVI A, 42\nOUT\nJMP start');
  await page.getByRole('button', { name: '断点 地址 0', exact: true }).click();
  await page.getByRole('button', { name: '运行程序', exact: true }).click();
  await expect(page.getByTestId('program-run-status')).toContainText('断点已命中');
  await expect(page.getByTestId('clock-cycle')).toHaveText('周期 0');
  await instruction(page, 3);
  await expect(page.getByTestId('machine-A')).toHaveText('42');
  await expect(page.getByTestId('machine-PC')).toHaveText('1');
  await page.getByRole('button', { name: '运行程序', exact: true }).click();
  await expect(page.getByTestId('program-run-status')).toContainText('断点已命中');
  await expect(page.getByTestId('clock-cycle')).toHaveText('周期 9');
  await expect(page.getByTestId('program-output-events')).toHaveText('42');
  await page.getByRole('button', { name: '运行程序', exact: true }).click();
  await expect(page.getByTestId('clock-cycle')).toHaveText('周期 18');
  await expect(page.getByTestId('program-output-events')).toHaveText('42 → 42');
  await page.getByRole('button', { name: '查看 CPU 电路', exact: true }).click();
  await expect(page.locator('.board')).toBeVisible();
  await expect(page.locator('.board .gate-node')).not.toHaveCount(0);
  await page.getByRole('button', { name: '返回程序编辑', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '汇编源代码' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('case initialization, RAM writes, output history and source survive save while runtime restarts', async ({ page }) => {
  await at(page, 47);
  const last = programmingCases(47).at(-1)!;
  await page.getByRole('combobox', { name: '程序输入用例' }).selectOption(last.id);
  await expect(page.getByTestId('ram-240')).toHaveText('255');
  await expect(page.getByTestId('ram-242')).toHaveText('0');
  await instruction(page, 3); await instruction(page, 6);
  await expect(page.getByTestId('ram-242')).toHaveText('255');
  await instruction(page, 9); await expect(page.getByTestId('program-output-events')).toHaveText('255');
  const saved = await exported(page);
  expect(saved.version).toBe(6); expect(Object.keys(saved.circuits)).toHaveLength(56);
  expect(saved.library['architecture-datapath@1']).toBeDefined();
  expect(saved).not.toHaveProperty('program'); expect(saved).not.toHaveProperty('runtime'); expect(saved).not.toHaveProperty('breakpoints');
  await page.locator('input[type=file]').setInputFiles({ name: 'roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
  await expect(page.locator('.toast')).toContainText('存档已导入');
  await expect(page.getByTestId('clock-cycle')).toHaveText('周期 0');
  await expect(page.getByTestId('program-output-events')).toHaveText('尚无输出');
  await expect(page.getByRole('textbox', { name: '汇编源代码' })).toHaveValue(programmingReferenceSource(47));
  await page.getByRole('combobox', { name: '程序输入用例' }).selectOption(last.id);
  await expect(page.getByTestId('ram-242')).toHaveText('0');
  await page.getByRole('button', { name: '运行程序', exact: true }).click();
  await expect(page.getByTestId('machine-Halt')).toHaveText('1');
  await expect(page.getByTestId('program-output-events')).toHaveText('255');
  await page.getByRole('button', { name: '程序复位 R', exact: true }).click();
  await expect(page.getByTestId('ram-242')).toHaveText('255');
  await page.getByRole('button', { name: '编程单步周期', exact: true }).click();
  await expect(page.getByTestId('ram-240')).toHaveText('0');
  await expect(page.getByTestId('ram-242')).toHaveText('0');
  await expect(page.getByTestId('machine-Halt')).toHaveText('0');
  await page.getByRole('button', { name: '程序复位 R', exact: true }).click();
  await page.getByRole('button', { name: '程序使能 E', exact: true }).click();
  await page.getByRole('button', { name: '单步指令', exact: true }).click();
  await expect(page.getByTestId('machine-Phase')).toHaveText('0');
  await expect(page.getByTestId('machine-PC')).toHaveText('0');
  await page.getByRole('button', { name: '程序使能 E', exact: true }).click();
  await page.getByRole('button', { name: '重启用例', exact: true }).click();
  await expect(page.getByTestId('ram-240')).toHaveText('255');
  await expect(page.getByTestId('ram-242')).toHaveText('0');
});

test('extra output and infinite loops produce repeatable failures and a bounded debugger', async ({ page }) => {
  await at(page, 45);
  await apply(page, 'MOVI A, 42\nOUT\nOUT\nHLT');
  await page.getByRole('button', { name: '测试程序', exact: true }).click();
  await expect(page.getByTestId('test-feedback')).toContainText('额外 OUT');
  await expect(page.getByTestId('clock-cycle')).toHaveText('周期 9');
  await expect(page.getByTestId('program-output-events')).toHaveText('42 → 42');
  await instruction(page, 12);
  await expect(page.getByTestId('machine-Halt')).toHaveText('1');
  await apply(page, 'again: JMP again');
  await page.getByRole('button', { name: '测试程序', exact: true }).click();
  await expect(page.getByTestId('test-feedback')).toContainText('周期预算');
  await expect(page.getByTestId('clock-cycle')).toHaveText('周期 90');
  await page.getByRole('button', { name: '重启用例', exact: true }).click();
  await page.getByRole('button', { name: '运行程序', exact: true }).click();
  await expect(page.getByTestId('program-run-status')).toContainText('超过周期预算');
  await expect(page.getByRole('button', { name: '运行程序', exact: true })).toBeVisible();
  await expect(page.getByTestId('clock-cycle')).toHaveText('周期 90');
});

test('all twelve applications judge actual reference programs and unlock through the final lesson', async ({ page }) => {
  await migrated(page);
  for (let id = 45; id <= 56; id++) {
    await apply(page, programmingReferenceSource(id));
    await page.getByRole('button', { name: '测试程序', exact: true }).click();
    await expect(page.getByTestId('test-feedback')).toContainText('全部通过', { timeout: 60_000 });
    if (id < 56) await page.getByRole('button', { name: '下一关', exact: true }).click();
  }
  await expect(page.getByTestId('progress-count')).toHaveText('56 / 56');
  await expect(page.getByTestId('test-feedback')).toContainText('编程应用阶段完成');
  await page.screenshot({ path: 'work/programming-complete-desktop.png' });
});

test('long programming tasks keep animation and pause responsive, including the mobile workbench', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await at(page, 54);
  await page.getByRole('combobox', { name: '程序输入用例' }).selectOption(programmingCases(54)[3].id);
  await page.evaluate(() => {
    const probe = { frames: 0, active: true }; (window as unknown as { programProbe: typeof probe }).programProbe = probe;
    const draw = () => { if (probe.active) { probe.frames++; requestAnimationFrame(draw); } }; requestAnimationFrame(draw);
  });
  await page.getByRole('button', { name: '运行程序', exact: true }).click();
  await expect(page.getByTestId('clock-cycle')).not.toHaveText('周期 0');
  await page.getByRole('button', { name: '暂停程序', exact: true }).click();
  await expect(page.getByRole('button', { name: '单步指令', exact: true })).toBeEnabled();
  const cycle = await page.getByTestId('clock-cycle').textContent();
  await page.waitForTimeout(350); await expect(page.getByTestId('clock-cycle')).toHaveText(cycle!);
  const frames = await page.evaluate(() => (window as unknown as { programProbe: { frames: number } }).programProbe.frames);
  await page.getByRole('button', { name: '测试程序', exact: true }).click();
  await expect(page.getByTestId('test-feedback')).toContainText('全部通过', { timeout: 60_000 });
  expect(await page.evaluate(() => (window as unknown as { programProbe: { frames: number } }).programProbe.frames)).toBeGreaterThan(frames + 5);
  await page.setViewportSize({ width: 430, height: 900 });
  await expect(page.getByRole('textbox', { name: '汇编源代码' })).toBeVisible();
  await page.getByRole('textbox', { name: '汇编源代码' }).fill('MOVI A, 5\nOUT\nHLT');
  await page.getByRole('button', { name: '应用汇编', exact: true }).click();
  await expect(page.getByTestId('clock-cycle')).toHaveText('周期 0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'work/programming-mobile.png' });
  expect(errors).toEqual([]);
});
