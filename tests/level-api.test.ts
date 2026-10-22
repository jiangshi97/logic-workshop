// logic-level-api 包测试：纯工具确定性与事件目录（经 vite 别名直接从 packages/level-api 导入）。
import { describe, expect, it } from 'vitest';
import { isOnceLevelEvent, LEVEL_HOOK_KEYS, ONCE_LEVEL_EVENTS, range, RECURRING_LEVEL_EVENTS, rng } from 'logic-level-api';

describe('logic-level-api utilities', () => {
  it('rng is deterministic per seed and spread over [0,1)', () => {
    const left = rng(42), right = rng(42);
    const values = range(50).map(() => left());
    expect(values).toEqual(range(50).map(() => right()));
    expect(new Set(values).size).toBeGreaterThan(40);
    expect(values.every(value => value >= 0 && value < 1)).toBe(true);
  });

  it('exposes the full hook event catalogue with the one-shot/recurring split', () => {
    expect(LEVEL_HOOK_KEYS).toEqual([...ONCE_LEVEL_EVENTS, ...RECURRING_LEVEL_EVENTS]);
    expect(LEVEL_HOOK_KEYS).toHaveLength(9);
    expect(ONCE_LEVEL_EVENTS.every(isOnceLevelEvent)).toBe(true);
    expect(RECURRING_LEVEL_EVENTS.every(isOnceLevelEvent)).toBe(false);
  });
});
