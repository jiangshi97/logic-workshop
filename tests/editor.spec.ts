import { test, expect, type Page } from '@playwright/test';
import { levels } from '../src/levels';
const browserErrors = new WeakMap<Page, string[]>();

async function wire(page: Page, source: string, target: string, port = 'in') {
  await page.getByTestId(`port-${source}-out`).click();
  await page.getByTestId(`port-${target}-${port}`).click();
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = []; browserErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});
test.afterEach(async ({ page }) => { expect(browserErrors.get(page)).toEqual([]); });

test('connects first lesson, gives counterexample, unlocks next lesson and persists', async ({ page }) => {
  await expect(page.getByRole('heading', { name: '点亮信号灯', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await expect(page.getByTestId('test-feedback')).toContainText('实际 X');
  await wire(page, 'A', 'Y');
  await page.getByRole('button', { name: '输入 A', exact: true }).click();
  await expect(page.getByTestId('output-Y')).toHaveText('1');
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await expect(page.getByTestId('test-feedback')).toContainText('全部通过');
  await page.getByRole('button', { name: '下一关', exact: true }).click();
  await expect(page.getByRole('heading', { name: '认识 NAND', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '认识 NAND', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '第 1 关 点亮信号灯' }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});

test('builds every gate lesson through actual editor connections', async ({ page }) => {
  await wire(page, 'A', 'Y');
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await page.getByRole('button', { name: '下一关', exact: true }).click();
  for (const level of [2, 3, 4]) {
    await page.getByRole('button', { name: '添加 NAND', exact: true }).click();
    const gate = await page.locator('[data-gate-id]').last().getAttribute('data-gate-id');
    if (!gate) throw new Error('Missing placed gate');
    await wire(page, 'A', gate, 'a');
    await wire(page, level === 3 ? 'A' : 'B', gate, 'b');
    if (level === 4) {
      await page.getByRole('button', { name: '添加 NOT', exact: true }).click();
      const inverter = await page.locator('[data-gate-id]').last().getAttribute('data-gate-id');
      if (!inverter) throw new Error('Missing inverter');
      await wire(page, gate, inverter, 'a');
      await wire(page, inverter, 'Y');
    } else {
      await wire(page, gate, 'Y');
    }
    await page.getByRole('button', { name: '测试电路', exact: true }).click();
    await expect(page.getByTestId('test-feedback')).toContainText('全部通过');
    if (level === 4) await page.screenshot({ path: 'work/first-four-preview.png', fullPage: true });
    if (level !== 4) await page.getByRole('button', { name: '下一关', exact: true }).click();
  }
  await expect(page.getByTestId('progress-count')).toContainText(`4 / ${levels.length}`);
});

test('undoes and restores connections, resets only current draft', async ({ page }) => {
  await wire(page, 'A', 'Y');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.getByRole('button', { name: '重置当前电路', exact: true }).click();
  await page.getByRole('button', { name: '确认重置', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
});

test('mobile workspace and task view fit without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '查看任务', exact: true }).click();
  await expect(page.getByRole('heading', { name: '点亮信号灯', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'work/mobile-task.png', fullPage: true });
  await page.getByRole('button', { name: '关闭任务', exact: true }).click();
  await page.screenshot({ path: 'work/mobile-workspace.png', fullPage: true });
});

test('drag connection, edge selection and deletion restore through undo', async ({ page }) => {
  const source = await page.getByTestId('port-A-out').boundingBox();
  const target = await page.getByTestId('port-Y-in').boundingBox();
  if (!source || !target) throw new Error('Ports unavailable');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  // SVG screen transforms become available after the first layout of a new edge.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  const midpoint = await page.locator('.react-flow__edge-path').evaluate(element => {
    const path = element as SVGPathElement;
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(midpoint.x, midpoint.y);
  await page.getByRole('button', { name: '删除所选', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});

test('export and import restore drafts; malformed import leaves current circuit intact', async ({ page }) => {
  await wire(page, 'A', 'Y');
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出存档', exact: true }).click();
  await (await downloadPromise).saveAs('work/save.json');
  await page.getByRole('button', { name: '重置当前电路', exact: true }).click();
  await page.getByRole('button', { name: '确认重置', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await page.locator('input[type=file]').setInputFiles('work/save.json');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.locator('input[type=file]').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await expect(page.getByRole('status')).toContainText('导入失败');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});

test('node dragging is reversible, forbidden second driver gives feedback', async ({ page }) => {
  await wire(page, 'A', 'Y');
  await page.getByTestId('port-A-out').click();
  await page.getByTestId('port-Y-in').click();
  await expect(page.getByRole('status')).toContainText('已经有连接');
  const node = page.locator('.react-flow__node').filter({ has: page.getByRole('button', { name: '输入 A', exact: true }) });
  const start = await node.boundingBox();
  if (!start) throw new Error('Missing input node');
  await page.mouse.move(start.x + 45, start.y + 15);
  await page.mouse.down();
  await page.mouse.move(start.x + 95, start.y + 55, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  const restored = await node.boundingBox();
  expect(Math.abs(restored!.x - start.x)).toBeLessThan(2);
});

test('wrong NAND result shows a reproducible counterexample and editing invalidates it', async ({ page }) => {
  await wire(page, 'A', 'Y');
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await page.getByRole('button', { name: '下一关', exact: true }).click();
  await wire(page, 'A', 'Y');
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await expect(page.getByTestId('test-feedback')).toContainText('期望 1');
  await expect(page.getByTestId('test-feedback')).toContainText('实际 0');
  await expect(page.getByTestId('output-Y')).toHaveText('0');
  await expect(page.locator('.failed-node')).toHaveCount(1);
  await page.getByRole('button', { name: '重置当前电路', exact: true }).click();
  await page.getByRole('button', { name: '确认重置', exact: true }).click();
  await expect(page.getByTestId('test-feedback')).toContainText('电路已修改');
  await page.screenshot({ path: 'work/desktop-1440.png', fullPage: true });
});

test('saving failure stays visible while export remains available', async ({ page }) => {
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); }; });
  await wire(page, 'A', 'Y');
  await expect(page.locator('.save-status')).toContainText('保存失败');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出存档', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('logic-workshop-save.json');
});

test('desktop sizes render without browser errors or overflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [width, height] of [[1280, 720], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.reload();
    await expect(page.getByTestId('port-Y-in')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const footer = await page.locator('.test-panel-footer').boundingBox();
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(height);
    await page.screenshot({ path: `work/desktop-${width}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});

test('connections and reusable components work without secure-origin randomUUID', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }));
  await page.reload();
  await wire(page, 'A', 'Y');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await page.getByRole('button', { name: '下一关', exact: true }).click();
  await page.getByRole('button', { name: '添加 NAND', exact: true }).click();
  const gate = (await page.locator('[data-gate-id]').last().getAttribute('data-gate-id'))!;
  await wire(page, 'A', gate, 'a'); await wire(page, 'B', gate, 'b'); await wire(page, gate, 'Y');
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await page.getByRole('button', { name: '保存为组件', exact: true }).click();
  await page.getByLabel('组件名称', { exact: true }).fill('LAN NAND');
  await page.getByRole('button', { name: '保存组件', exact: true }).click();
  await page.getByRole('button', { name: '下一关', exact: true }).click();
  await page.getByRole('button', { name: '添加组件 LAN NAND v1', exact: true }).click();
  const instance = (await page.locator('[data-gate-id]').last().getAttribute('data-gate-id'))!;
  await wire(page, 'A', instance, 'A'); await wire(page, 'A', instance, 'B');
  await page.getByTestId(`port-${instance}-Y`).click(); await page.getByTestId('port-Y-in').click();
  await page.getByRole('button', { name: '测试电路', exact: true }).click();
  await expect(page.getByTestId('test-feedback')).toContainText('全部通过');
});
