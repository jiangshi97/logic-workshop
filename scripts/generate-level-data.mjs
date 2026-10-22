#!/usr/bin/env node
// 从 content/levels/*.json 与 content/packs/*/levels/*.json 生成 src/levelData.generated.ts
// （关卡数据 + 源文件路径 levelSources + 包标记 levelPackTags），并从 content/packs/*/index.ts
// 生成 src/levelPacks.generated.ts（关卡包清单）。两个生成文件都提交入库，
// 保证 Vite/vitest/Playwright/Node 任何环境都能静态导入（import.meta.glob 是 Vite 专有特性，
// Playwright 的转译器无法处理）。新增或修改关卡后运行：npm run regen:levels。
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const levelsDir = join(root, 'content', 'levels');
const packsDir = join(root, 'content', 'packs');
const files = readdirSync(levelsDir).filter(name => name.endsWith('.json')).sort();
if (!files.length) throw new Error('content/levels 下没有找到任何 JSON 关卡。');

// 基础目录在前、各包按文件夹序、包内按文件名序——与编译后的目录顺序一致（包关卡 id 再加 idBase 平移）。
const entries = files.map(name => ({
  source: `content/levels/${name}`, pack: '',
  data: JSON.parse(readFileSync(join(levelsDir, name), 'utf8')), // 语法错误在此尽早暴露
}));
const packFolders = existsSync(packsDir)
  ? readdirSync(packsDir).filter(name => statSync(join(packsDir, name)).isDirectory()).sort()
  : [];
for (const folder of packFolders) {
  if (!existsSync(join(packsDir, folder, 'index.ts'))) throw new Error(`关卡包 content/packs/${folder} 缺少 index.ts。`);
  const packLevels = join(packsDir, folder, 'levels');
  if (!existsSync(packLevels)) continue;
  for (const name of readdirSync(packLevels).filter(name => name.endsWith('.json')).sort())
    entries.push({ source: `content/packs/${folder}/levels/${name}`, pack: folder, data: JSON.parse(readFileSync(join(packLevels, name), 'utf8')) });
}

const dataLines = [
  '// 本文件由 scripts/generate-level-data.mjs 生成，请勿手改。',
  '// 修改 content/levels/*.json 或 content/packs/*/levels/*.json 后运行 npm run regen:levels 重新生成。',
  `// 源文件（${entries.length} 个）：${entries.map(entry => entry.source).join('、')}`,
  'export const levelData: unknown[] = [',
];
for (const entry of entries) dataLines.push(`  // ${entry.source}`, `  ${JSON.stringify(entry.data)},`);
dataLines.push(
  '];',
  '// 与 levelData 逐项对齐：源文件路径（编译报错定位）与所属关卡包（空串 = 基础目录）。',
  'export const levelSources: string[] = [',
  ...entries.map(entry => `  ${JSON.stringify(entry.source)},`),
  '];',
  'export const levelPackTags: string[] = [',
  ...entries.map(entry => `  ${JSON.stringify(entry.pack)},`),
  '];',
  '',
);
writeFileSync(join(root, 'src', 'levelData.generated.ts'), dataLines.join('\n'));

const alias = folder => `__pack_${folder.replace(/-/g, '_')}`;
const packLines = [
  '// 本文件由 scripts/generate-level-data.mjs 生成，请勿手改。',
  '// 新关卡包放入 content/packs/<包名>/（index.ts + levels/*.json）后运行 npm run regen:levels。',
  ...packFolders.map(folder => `import { pack as ${alias(folder)} } from '../content/packs/${folder}/index';`),
  'export const generatedLevelPacks = [',
  ...packFolders.map(folder => `  { folder: ${JSON.stringify(folder)}, pack: ${alias(folder)} },`),
  '];',
  '',
];
writeFileSync(join(root, 'src', 'levelPacks.generated.ts'), packLines.join('\n'));
console.log(`已生成 levelData.generated.ts（${entries.length} 个关卡）与 levelPacks.generated.ts（${packFolders.length} 个关卡包）。`);
