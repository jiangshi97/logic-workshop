// 元件工坊端到端：打开工坊 → 搭建反相器（接口/门/输出 + 端口点击连线）→ 交互仿真验证 →
// 保存为组件 → 分组展示与同名新版本 → 草稿持久化与“在工坊中编辑”入口。
import { test, expect, type Page } from '@playwright/test';

const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = []; browserErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});
test.afterEach(async ({ page }) => { expect(browserErrors.get(page)).toEqual([]); });

test('workshop builds a component end to end, versions it and persists the draft', async ({ page }) => {
  await page.getByRole('button', { name: /^组件库/ }).click();
  await page.getByRole('button', { name: '打开元件工坊' }).click();
  await expect(page.getByRole('dialog', { name: '元件工坊' })).toBeVisible();

  await page.getByLabel('总线位宽').selectOption('1');
  await page.getByRole('button', { name: '添加 输入接口', exact: true }).click();
  await page.getByRole('button', { name: '添加 NOT', exact: true }).click();
  await page.getByRole('button', { name: '添加 输出接口', exact: true }).click();
  // 端口按节点顺序出现：INPUT.out、NOT.a、NOT.out、OUTPUT.in——用 testid 抓取随机节点 id。
  const ports = await page.locator('.workshop-board .react-flow__handle')
    .evaluateAll(handles => handles.map(handle => handle.getAttribute('data-testid')!));
  expect(ports).toHaveLength(4);
  await page.getByTestId(ports[0]).click();
  await page.getByTestId(ports[1]).click();
  await page.getByTestId(ports[2]).click();
  await page.getByTestId(ports[3]).click();
  await expect(page.locator('.workshop-board .react-flow__edge')).toHaveCount(2);

  await page.locator('.workshop-board .input-switch').click();
  await expect(page.locator('.workshop-board .lamp-value strong')).toHaveText('0');
  await page.locator('.workshop-board .input-switch').click();
  await expect(page.locator('.workshop-board .lamp-value strong')).toHaveText('1');

  await page.getByRole('button', { name: '保存为组件', exact: true }).click();
  await page.getByLabel('组件名称', { exact: true }).fill('反相器');
  await page.getByRole('button', { name: '保存组件', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('组件已保存');
  await page.getByRole('button', { name: '返回关卡', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加组件 反相器 v1', exact: true })).toBeVisible();

  // 草稿持久化：重载后等存档重验完成，再打开工坊，三个节点与连线仍在。
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.locator('.save-status')).toContainText('已保存', { timeout: 30_000 });
  await page.getByRole('button', { name: /^组件库/ }).click();
  await page.getByRole('button', { name: '打开元件工坊' }).click();
  await expect(page.locator('.workshop-board .react-flow__node')).toHaveCount(3);
  await expect(page.locator('.workshop-board .react-flow__edge')).toHaveCount(2);

  // “在工坊中编辑”载入组件内部图；同名保存产生 v2，家族分组同时展示两个版本。
  await page.getByRole('button', { name: '返回关卡', exact: true }).click();
  await page.getByRole('button', { name: '在工坊中编辑 反相器 v1', exact: true }).click();
  await expect(page.locator('.workshop-header')).toContainText('编辑 反相器 v1');
  await expect(page.locator('.workshop-board .react-flow__node')).toHaveCount(3);
  await page.getByRole('button', { name: '保存为组件', exact: true }).click();
  await page.getByLabel('组件名称', { exact: true }).fill('反相器');
  await page.getByRole('button', { name: '保存组件', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('组件已保存');
  await page.getByRole('button', { name: '返回关卡', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加组件 反相器 v2', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加组件 反相器 v1', exact: true })).toBeVisible();
  await expect(page.locator('.library-family').first()).toContainText('最新');
});

test('merges bit-width variants of one component family behind a width selector', async ({ page }) => {
  const buildInverter = async () => {
    await page.getByRole('button', { name: '添加 输入接口', exact: true }).click();
    await page.getByRole('button', { name: '添加 NOT', exact: true }).click();
    await page.getByRole('button', { name: '添加 输出接口', exact: true }).click();
    // 端口按节点顺序出现：INPUT.out、NOT.a、NOT.out、OUTPUT.in——依次点击完成两条连线。
    const ports = await page.locator('.workshop-board .react-flow__handle')
      .evaluateAll(handles => handles.map(handle => handle.getAttribute('data-testid')!));
    expect(ports).toHaveLength(4);
    for (const port of ports) await page.getByTestId(port).click();
    await expect(page.locator('.workshop-board .react-flow__edge')).toHaveCount(2);
  };
  const saveAs = async (name: string) => {
    await page.getByRole('button', { name: '保存为组件', exact: true }).click();
    await page.getByLabel('组件名称', { exact: true }).fill(name);
    await page.getByRole('button', { name: '保存组件', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('组件已保存');
    await page.getByRole('button', { name: '返回关卡', exact: true }).click();
  };

  await page.getByRole('button', { name: /^组件库/ }).click();
  await page.getByRole('button', { name: '打开元件工坊' }).click();
  await page.getByLabel('总线位宽').selectOption('1');
  await buildInverter();
  await saveAs('反相器');

  await page.getByRole('button', { name: '打开元件工坊' }).click();
  await page.getByRole('button', { name: '清空工坊', exact: true }).click();
  await expect(page.locator('.workshop-board .react-flow__node')).toHaveCount(0);
  await page.getByLabel('总线位宽').selectOption('8');
  await buildInverter();
  await saveAs('八位反相器');

  // 关卡侧组件库：同族元件合并，默认展示最宽变体，小选择框切换位宽。
  const library = page.locator('.saved-components');
  await expect(library.getByRole('combobox', { name: '反相器 位宽' })).toHaveCount(1);
  await expect(library.getByRole('button', { name: '添加组件 八位反相器 v1', exact: true })).toBeVisible();
  await expect(library.getByRole('button', { name: '添加组件 反相器 v1', exact: true })).toHaveCount(0);
  await library.getByRole('combobox', { name: '反相器 位宽' }).selectOption('1');
  await expect(library.getByRole('button', { name: '添加组件 反相器 v1', exact: true })).toBeVisible();
  await expect(library.getByRole('button', { name: '添加组件 八位反相器 v1', exact: true })).toHaveCount(0);

  // 工坊调色板同样按家族合并，位宽选择框常驻。
  await page.getByRole('button', { name: '打开元件工坊' }).click();
  const palette = page.locator('.workshop-palette');
  await expect(palette.getByRole('combobox', { name: '反相器 位宽' })).toHaveCount(1);
  await expect(palette.getByRole('button', { name: '添加组件 八位反相器', exact: true })).toBeVisible();
});
