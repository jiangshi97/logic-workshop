// 关卡内容快照：固化第 1–20 关全部穷举期望值、全关卡元数据与全部关卡的判题数据摘要
// （组合输入集/期望、时序场景帧、编程用例的条数与 sha1 摘要），保证编辑 JSON 不悄悄改变判题标准。
// 期望值快照来自迁移前的数学闭包；UPDATE_SNAPSHOTS=1 npx vitest run tests/level-content.test.ts 重新生成。
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chapters, levels, testInputs } from '../src/levels';
import { levelData, levelPackTags, levelSources } from '../src/levelData.generated';
import { generatedLevelPacks } from '../src/levelPacks.generated';
import { programmingCases, programmingReferenceSource } from '../src/programmingSpec';
import type { Inputs, Outputs } from '../src/contracts';

const snapshotPath = fileURLToPath(new URL('./snapshots/levels-content.json', import.meta.url));

interface Snapshot {
  truthTables: Record<string, [Inputs, Outputs][]>;
  judging: Record<string, { kind: string; scenarios?: number; steps?: number; cases?: number; samples?: number; digest: string; referenceSourceChars?: number }>;
  meta: { id: number; title: string; chapter: number; mode?: string; allowedCount: number; rewardName?: string }[];
}

const digest = (value: unknown): string => createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16);

function capture(): Snapshot {
  const truthTables: Snapshot['truthTables'] = {};
  for (const level of levels.filter(level => !level.mode && level.id <= 20)) {
    truthTables[String(level.id)] = testInputs(level.id).map(sample => [sample, level.expectedOutputs(sample)]);
  }
  const judging: Snapshot['judging'] = {};
  for (const level of levels) {
    if (level.mode === 'sequential') {
      const sequences = level.sequences!();
      judging[level.id] = { kind: 'sequential', scenarios: sequences.length,
        steps: sequences.reduce((total, sequence) => total + sequence.steps.length, 0), digest: digest(sequences) };
    } else if (level.mode === 'program') {
      judging[level.id] = { kind: 'program', cases: programmingCases(level.id).length,
        digest: digest(programmingCases(level.id)), referenceSourceChars: programmingReferenceSource(level.id).length };
    } else {
      const samples = testInputs(level.id);
      judging[level.id] = { kind: 'combinational', samples: samples.length,
        digest: digest(samples.map(sample => [sample, level.expectedOutputs(sample)])) };
    }
  }
  return {
    truthTables,
    judging,
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

  it('keeps levelData.generated in sync with content/levels and content/packs', () => {
    const contentRoot = fileURLToPath(new URL('../content/', import.meta.url));
    const files = readdirSync(join(contentRoot, 'levels')).filter(name => name.endsWith('.json')).sort();
    const fromDisk = files.map(name => JSON.parse(readFileSync(join(contentRoot, 'levels', name), 'utf8')));
    const packFolders = existsSync(join(contentRoot, 'packs'))
      ? readdirSync(join(contentRoot, 'packs')).filter(name => statSync(join(contentRoot, 'packs', name)).isDirectory()).sort()
      : [];
    const expected: unknown[] = [...fromDisk];
    const sources = files.map(name => `content/levels/${name}`);
    const tags = files.map(() => '');
    for (const folder of packFolders) {
      const packLevels = join(contentRoot, 'packs', folder, 'levels');
      if (!existsSync(packLevels)) continue;
      for (const name of readdirSync(packLevels).filter(name => name.endsWith('.json')).sort()) {
        expected.push(JSON.parse(readFileSync(join(packLevels, name), 'utf8')));
        sources.push(`content/packs/${folder}/levels/${name}`);
        tags.push(folder);
      }
    }
    expect(levelData).toEqual(expected);
    expect(levelSources).toEqual(sources);
    expect(levelPackTags).toEqual(tags);
    expect(generatedLevelPacks.map(entry => entry.folder)).toEqual(packFolders);
  });
});
