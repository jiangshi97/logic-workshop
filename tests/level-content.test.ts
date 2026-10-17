// 关卡内容快照：固化第 1–20 关全部穷举期望值与全关卡元数据，保证 JSON 迁移/后续编辑不悄悄改变判题标准。
// 期望值快照来自迁移前的数学闭包；UPDATE_SNAPSHOTS=1 npx vitest run tests/level-content.test.ts 重新生成。
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chapters, levels, testInputs } from '../src/levels';
import { levelData } from '../src/levelData.generated';
import type { Inputs, Outputs } from '../src/contracts';

const snapshotPath = fileURLToPath(new URL('./snapshots/levels-content.json', import.meta.url));

interface Snapshot {
  truthTables: Record<string, [Inputs, Outputs][]>;
  meta: { id: number; title: string; chapter: number; mode?: string; allowedCount: number; rewardName?: string }[];
}

function capture(): Snapshot {
  const truthTables: Snapshot['truthTables'] = {};
  for (const level of levels.filter(level => !level.mode && level.id <= 20)) {
    truthTables[String(level.id)] = testInputs(level.id).map(sample => [sample, level.expectedOutputs(sample)]);
  }
  return {
    truthTables,
    meta: levels.map(level => ({
      id: level.id, title: level.title, chapter: level.chapter,
      ...(level.mode ? { mode: level.mode } : {}),
      allowedCount: level.allowed.length,
      ...(level.rewardName ? { rewardName: level.rewardName } : {}),
    })),
  };
}

describe('level content snapshot', () => {
  it('matches the committed snapshot exactly', () => {
    if (process.env.UPDATE_SNAPSHOTS === '1' || !existsSync(snapshotPath)) {
      mkdirSync(dirname(snapshotPath), { recursive: true });
      writeFileSync(snapshotPath, `${JSON.stringify(capture(), null, 1)}\n`);
      return;
    }
    expect(capture()).toEqual(JSON.parse(readFileSync(snapshotPath, 'utf8')));
  });

  it('keeps ids strictly increasing and chapters defined', () => {
    const ids = levels.map(level => level.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    for (const level of levels) {
      expect(chapters[level.chapter - 1]).toBeTruthy();
      expect(level.hints).toHaveLength(3);
      expect(new Set(level.allowed).size).toBe(level.allowed.length);
      expect(level.inputPorts.length + level.outputPorts.length).toBeGreaterThan(0);
    }
  });

  it('keeps levelData.generated in sync with content/levels', () => {
    const dir = fileURLToPath(new URL('../content/levels/', import.meta.url));
    const files = readdirSync(dir).filter(name => name.endsWith('.json')).sort();
    const fromDisk = files.map(name => JSON.parse(readFileSync(`${dir}/${name}`, 'utf8')));
    expect(levelData).toEqual(fromDisk);
  });
});
