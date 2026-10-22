import { expect, test } from '@playwright/test';
import { addComponent, connect, createCircuit } from '../src/model';
import { packageCircuit } from '../src/components';
import { levels } from '../src/levels';
import { architectureLibrary } from '../src/architectureCircuits';
import type { Workspace } from '../src/storage';

test('renames custom components and cascade-deletes dependents while retaining red remnants', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const state: Workspace = { version: 7, currentLevel: 1, proofs: {}, library: architectureLibrary(),
    circuits: Object.fromEntries(levels.map(level => [level.id, createCircuit(level.id)])),
    inputs: Object.fromEntries(levels.map(level => [level.id, Object.fromEntries(level.inputs.map(name => [name, 0]))])) };
  const leaf = packageCircuit(connect(createCircuit(1), 'A', 'out', 'Y', 'in'), 'Leaf', state.library);
  let wrapperGraph = addComponent(createCircuit(1), leaf.key, { x: 300, y: 150 }, leaf.library, 'leaf-instance');
  wrapperGraph = connect(wrapperGraph, 'A', 'out', 'leaf-instance', 'A', leaf.library);
  wrapperGraph = connect(wrapperGraph, 'leaf-instance', 'Y', 'Y', 'in', leaf.library);
  const wrapper = packageCircuit(wrapperGraph, 'Wrapper', leaf.library);
  state.library = wrapper.library;
  state.circuits[1] = addComponent(createCircuit(1), wrapper.key, { x: 300, y: 150 }, wrapper.library, 'wrapper-instance');

  await page.locator('input[type=file]').setInputFiles({ name: 'components.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await expect(page.getByRole('status')).toContainText('存档已导入', { timeout: 60_000 });
  await page.getByRole('button', { name: /^组件库/ }).click();

  await page.getByRole('button', { name: '重命名 Leaf v1', exact: true }).click();
  await page.getByLabel('新的组件名称', { exact: true }).fill('Renamed leaf');
  await page.getByRole('button', { name: '确认重命名', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加组件 Renamed leaf v1', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '删除 Renamed leaf v1', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Renamed leaf');
  await expect(dialog).toContainText('Wrapper');
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加组件 Renamed leaf v1', exact: true })).toHaveCount(0);
  await expect(page.locator('.deleted-node')).toContainText('已删除');
  await expect(page.getByRole('button', { name: '测试电路', exact: true })).toBeDisabled();

  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('.deleted-node')).toContainText('已删除', { timeout: 60_000 });

  await page.locator('.deleted-node .node-heading').click();
  await page.getByRole('button', { name: '属性', exact: true }).click();
  await expect(page.getByText('该组件已从组件库删除，请替换或移除此残留实例。')).toBeVisible();
  await page.getByRole('button', { name: '删除组件', exact: true }).click();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出存档', exact: true }).click();
  const path = await (await download).path();
  expect(path).not.toBeNull();
  const exported = JSON.parse(await (await import('node:fs/promises')).readFile(path!, 'utf8'));
  expect(exported.library[leaf.key]).toBeUndefined();
  expect(exported.library[wrapper.key]).toBeUndefined();
});

test('replaces a selected component from the toolbar while preserving its instance and wires', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const state: Workspace = { version: 7, currentLevel: 1, proofs: {}, library: architectureLibrary(),
    circuits: Object.fromEntries(levels.map(level => [level.id, createCircuit(level.id)])),
    inputs: Object.fromEntries(levels.map(level => [level.id, Object.fromEntries(level.inputs.map(name => [name, 0]))])) };
  const source = packageCircuit(connect(createCircuit(1), 'A', 'out', 'Y', 'in'), 'Source', state.library);
  const alternative = packageCircuit(connect(createCircuit(1), 'A', 'out', 'Y', 'in'), 'Alternative', source.library);
  let graph = addComponent(createCircuit(1), source.key, { x: 300, y: 150 }, alternative.library, 'stable-instance');
  graph = connect(graph, 'A', 'out', 'stable-instance', 'A', alternative.library);
  graph = connect(graph, 'stable-instance', 'Y', 'Y', 'in', alternative.library);
  state.library = alternative.library;
  state.circuits[1] = graph;

  await page.locator('input[type=file]').setInputFiles({ name: 'replacement.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await expect(page.getByRole('status')).toContainText('存档已导入', { timeout: 60_000 });
  await page.locator('[data-gate-id="stable-instance"] .node-heading').click();
  await page.getByRole('button', { name: '替换组件', exact: true }).click();
  await page.locator('.replacement-list button').filter({ hasText: 'Alternative' }).click();
  await page.getByRole('button', { name: '确认替换', exact: true }).click();
  await expect(page.locator('[data-gate-id="stable-instance"] .node-heading')).toContainText('Alternative');
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);

  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('[data-gate-id="stable-instance"] .node-heading')).toContainText('Source');
  await page.getByRole('button', { name: '属性', exact: true }).click();
  await expect(page.locator('.properties-section').getByRole('button', { name: '替换组件', exact: true })).toBeVisible();
});

test('keeps independent sidebar scroll positions when switching between levels and components', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const state: Workspace = { version: 7, currentLevel: 1, proofs: {}, library: architectureLibrary(),
    circuits: Object.fromEntries(levels.map(level => [level.id, createCircuit(level.id)])),
    inputs: Object.fromEntries(levels.map(level => [level.id, Object.fromEntries(level.inputs.map(name => [name, 0]))])) };
  const source = connect(createCircuit(1), 'A', 'out', 'Y', 'in');
  for (let index = 0; index < 12; index++) state.library = packageCircuit(source, `Component ${index + 1}`, state.library).library;
  await page.locator('input[type=file]').setInputFiles({ name: 'sidebar-scroll.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state)) });
  await expect(page.getByRole('status')).toContainText('存档已导入', { timeout: 60_000 });

  const levelsList = page.locator('.lesson-list');
  await levelsList.evaluate(element => { element.scrollTop = 700; element.dispatchEvent(new Event('scroll')); });
  const levelPosition = await levelsList.evaluate(element => element.scrollTop);
  expect(levelPosition).toBeGreaterThan(500);

  await page.getByRole('button', { name: /^组件库/ }).click();
  const componentList = page.locator('.saved-components');
  await componentList.evaluate(element => { element.scrollTop = 420; element.dispatchEvent(new Event('scroll')); });
  const componentPosition = await componentList.evaluate(element => element.scrollTop);
  expect(componentPosition).toBeGreaterThan(250);

  await page.getByRole('button', { name: '关卡', exact: true }).click();
  await expect.poll(() => page.locator('.lesson-list').evaluate(element => element.scrollTop)).toBe(levelPosition);
  await page.getByRole('button', { name: /^组件库/ }).click();
  await expect.poll(() => page.locator('.saved-components').evaluate(element => element.scrollTop)).toBe(componentPosition);
});
