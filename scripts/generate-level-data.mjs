#!/usr/bin/env node
// 从 content/levels/*.json 生成 src/levelData.generated.ts（纯 TS 数据数组）。
// JSON 目录是唯一权威；生成文件提交入库，保证 Vite/vitest/Playwright/Node 任何环境都能静态导入
// （import.meta.glob 是 Vite 专有特性，Playwright 的转译器无法处理）。
// 新增或修改关卡后运行：npm run regen:levels。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const levelsDir = join(root, 'content', 'levels');
const files = readdirSync(levelsDir).filter(name => name.endsWith('.json')).sort();
if (!files.length) throw new Error('content/levels 下没有找到任何 JSON 关卡。');

const lines = [
  '// 本文件由 scripts/generate-level-data.mjs 生成，请勿手改。',
  '// 修改 content/levels/*.json 后运行 npm run regen:levels 重新生成。',
  `// 源文件（${files.length} 个）：${files.join('、')}`,
  'export const levelData: unknown[] = [',
];
for (const name of files) {
  const text = readFileSync(join(levelsDir, name), 'utf8');
  const data = JSON.parse(text); // 语法错误在此尽早暴露
  lines.push(`  // ${name}`, `  ${JSON.stringify(data)},`);
}
lines.push('];', '');
writeFileSync(join(root, 'src', 'levelData.generated.ts'), lines.join('\n'));
console.log(`已生成 src/levelData.generated.ts（${files.length} 个关卡）。`);
