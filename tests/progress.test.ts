// 进度助手测试：真实目录（1..57 连续）上与旧的"id 当序号"语义完全等价；
// 稀疏目录（关卡包引入的跳号 id）上按位置编号/解锁/前进。
import { describe, expect, it } from 'vitest';
import { levels } from '../src/levels';
import { displayNumber, frontierLevelId, isCleared, isUnlocked, levelPosition, makeProgress, nextLevelId, unlockedCount } from '../src/progress';

describe('progress helpers on the real catalogue', () => {
  it('is equivalent to id-based semantics while ids stay contiguous 1..57', () => {
    expect(levels.map(level => displayNumber(level.id))).toEqual(levels.map(level => level.id));
    for (let done = 0; done <= levels.length; done += 7) {
      for (const level of levels) {
        expect(isUnlocked(level.id, done)).toBe(level.id <= done + 1);
        expect(isCleared(level.id, done)).toBe(level.id <= done);
      }
      expect(frontierLevelId(done)).toBe(Math.min(done + 1, levels.length));
    }
    expect(levelPosition(0)).toBe(-1);
    expect(levelPosition(999)).toBe(-1);
    expect(nextLevelId(56)).toBe(57);
    expect(nextLevelId(57)).toBeUndefined();
    expect(unlockedCount(0)).toBe(1);
  });
});

describe('progress helpers on a sparse pack catalogue', () => {
  const sparse = makeProgress([{ id: 1 }, { id: 2 }, { id: 101 }, { id: 205 }]);

  it('numbers and navigates by position, not id value', () => {
    expect([1, 2, 101, 205].map(id => sparse.displayNumber(id))).toEqual([1, 2, 3, 4]);
    expect(sparse.nextLevelId(2)).toBe(101);
    expect(sparse.nextLevelId(205)).toBeUndefined();
    expect(sparse.frontierLevelId(2)).toBe(101);
    expect(sparse.frontierLevelId(99)).toBe(205); // 全通关后停在最后一关
  });

  it('unlocks and clears by position regardless of gaps', () => {
    expect(sparse.isUnlocked(101, 2)).toBe(true);  // 前沿 = 第 3 关
    expect(sparse.isUnlocked(205, 2)).toBe(false); // 第 4 关尚未解锁
    expect(sparse.isUnlocked(101, 1)).toBe(false);
    expect(sparse.isCleared(101, 3)).toBe(true);
    expect(sparse.isCleared(101, 2)).toBe(false);
    expect(sparse.isUnlocked(57, 3)).toBe(false);  // 不在目录
    expect(sparse.isCleared(57, 4)).toBe(false);
  });
});
