// 供生成器与钩子复用的纯工具（无宿主依赖，可独立单测）。

/** 确定性伪随机数（mulberry32）：同一种子永远得到同一个 (0,1) 序列。
 *  生成器在编译期展开，用种子随机可保证判题数据跨机器、跨版本完全一致。 */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [0, n) 的整数序列：批量生成输入组合或场景帧时使用。 */
export const range = (n: number): number[] => Array.from({ length: n }, (_, index) => index);
