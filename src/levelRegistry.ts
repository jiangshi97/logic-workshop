// 关卡装载：把生成文件里的声明式 spec（基础目录 content/levels + 各关卡包 content/packs/*）
// 编译成 Level 目录。compileCatalogue 是纯函数，测试可直接构造假包验证守卫；
// specLevels 用生成数据调用它（生成的源路径用于把编译错误定位到具体文件）。
import { levelData, levelPackTags, levelSources } from './levelData.generated';
import { compileLevelSpec } from './levelSpec';
import { levelPacks, type LevelPack } from './levelPack';
import type { Level } from './levels';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const BASE_CHAPTERS = 7;

/** 编译完整目录：包关卡 id 平移（+idBase）后与基础关卡合并按 id 排序，并做跨关卡守卫。 */
export function compileCatalogue(data: readonly unknown[], sources: readonly string[], tags: readonly string[], packs: readonly LevelPack[]): Level[] {
  const chapterCount = BASE_CHAPTERS + packs.reduce((total, pack) => total + (pack.chapters?.length ?? 0), 0);
  const compiled = data.map((spec, index) => {
    const tag = tags[index] ?? '';
    const pack = tag ? packs.find(item => item.key === tag) : undefined;
    if (tag && !pack) throw new Error(`${sources[index]}：未注册的关卡包“${tag}”。`);
    const localId = pack && isRecord(spec) && Number.isInteger(spec.id) ? spec.id as number : undefined;
    const shifted: unknown = pack && isRecord(spec) && localId !== undefined ? { ...spec, id: localId + pack.idBase } : spec;
    try {
      const level = compileLevelSpec(shifted, pack
        ? { pack: pack.key, localId, ...(localId === undefined ? {} : { packs }) }
        : undefined);
      return pack ? { ...level, pack: pack.key } : level;
    } catch (error) {
      throw new Error(`${sources[index]}：${(error as Error).message}`);
    }
  });
  // 注意守卫基于未排序的 compiled（与 tags 下标对齐）；排序副本只用于相邻查重与返回。
  const levels = [...compiled].sort((left, right) => left.id - right.id);
  levels.forEach((level, index) => {
    if (index > 0 && level.id === levels[index - 1].id)
      throw new Error(`关卡编号 ${level.id} 重复，请检查 content/levels 与各关卡包的 id/idBase。`);
    if (level.chapter > chapterCount)
      throw new Error(`关卡 ${level.id} 的章节号 ${level.chapter} 超出章节总数 ${chapterCount}（基础 ${BASE_CHAPTERS} + 各关卡包追加）。`);
  });
  // 包关卡必须整体位于基础目录之上，且各包 id 区间互不相交——保证 id 序 == 目录序、包块连续，
  // 教学组件 sourceLevel 等既有"id 比较即位置比较"的语义因此继续成立。
  const baseIds = compiled.filter((_, index) => !tags[index]).map(level => level.id);
  const maxBase = baseIds.length ? Math.max(...baseIds) : 0;
  const ranges = new Map<string, [number, number]>();
  compiled.forEach((level, index) => {
    const tag = tags[index];
    if (!tag) return;
    if (level.id <= maxBase)
      throw new Error(`关卡包 ${tag} 的关卡 ${level.id} 编号必须大于基础目录最大关卡号 ${maxBase}（检查 idBase）。`);
    const range = ranges.get(tag);
    ranges.set(tag, [Math.min(range?.[0] ?? level.id, level.id), Math.max(range?.[1] ?? level.id, level.id)]);
  });
  for (const [left, [aMin, aMax]] of ranges) for (const [right, [bMin, bMax]] of ranges) {
    if (left >= right || aMax < bMin) continue;
    throw new Error(`关卡包 ${left} 与 ${right} 的 id 区间（${aMin}–${aMax} / ${bMin}–${bMax}）相交，请调整 idBase。`);
  }
  return levels;
}

export function specLevels(): Level[] {
  return compileCatalogue(levelData, levelSources, levelPackTags, levelPacks);
}
