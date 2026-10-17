// 组件库家族分组：把「相似元件」合并为一组，组内再按位宽合并为可切换的变体。
// 家族键 = 去掉位宽前缀的基础名 + 输入/输出端口数——同名同接口形状、仅位宽不同的元件
// （如 一位/两位/八位/十六位选择器）合为一家，用小选择框切换位宽，展示该位宽下各版本。
// 端口数而非端口 id 作签名：工坊封装的组件端口 id 是随机节点 id，只有数量稳定可比。
// 位宽不解析名称，而是由端口推导（全部端口位宽的最大值），命名不含位宽标记的自定义元件同样生效。
import type { ComponentDefinition } from './contracts';

export interface LibraryEntry { key: string; definition: ComponentDefinition; }
export interface WidthVariant { width: number; versions: LibraryEntry[]; }
export interface ComponentFamily { id: string; baseName: string; widths: WidthVariant[]; }

/** 去掉名称开头的位宽标记（「八位…」「4位…」「8-bit …」）；整名就是标记或无标记时原样返回。 */
export function stripWidthMarker(name: string): string {
  const trimmed = name.trim();
  const stripped = trimmed
    .replace(/^(?:[一二两三四五六七八九十]+|\d+)\s*位/, '')
    .replace(/^\d+\s*-?\s*bit\b/i, '')
    .trim();
  return stripped || trimmed;
}

/** 从端口推导元件位宽：取全部输入/输出端口位宽的最大值（总线主体端口的宽度）。 */
export function componentWidth(definition: ComponentDefinition): number {
  return Math.max(1, ...definition.inputs.map(port => port.bits), ...definition.outputs.map(port => port.bits));
}

/** 家族当前选中的位宽变体；未选择时默认最宽（通常是最近学到 / 最完整的版本）。 */
export function activeVariant(family: ComponentFamily, choice?: number): WidthVariant {
  return family.widths.find(variant => variant.width === choice) ?? family.widths.at(-1)!;
}

/** 按家族聚合库条目：家族内位宽升序、各位宽下版本号降序，家族按基础名排序。 */
export function groupComponentFamilies(entries: LibraryEntry[]): ComponentFamily[] {
  const families = new Map<string, { baseName: string; buckets: Map<number, LibraryEntry[]> }>();
  for (const entry of entries) {
    const baseName = stripWidthMarker(entry.definition.name);
    const signature = `${entry.definition.inputs.length}|${entry.definition.outputs.length}`;
    const family = families.get(`${baseName}\u0000${signature}`) ?? { baseName, buckets: new Map() };
    const width = componentWidth(entry.definition);
    family.buckets.set(width, [...(family.buckets.get(width) ?? []), entry]);
    families.set(`${baseName}\u0000${signature}`, family);
  }
  return [...families.entries()].map(([id, family]) => ({
    id,
    baseName: family.baseName,
    widths: [...family.buckets.entries()]
      .map(([width, versions]) => ({ width, versions: [...versions].sort((left, right) => right.definition.version - left.definition.version) }))
      .sort((left, right) => left.width - right.width),
  })).sort((left, right) => left.baseName.localeCompare(right.baseName, 'zh-CN'));
}
