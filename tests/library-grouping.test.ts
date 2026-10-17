// 组件库家族分组：位宽标记解析、端口位宽推导、相似元件按家族合并、
// 除位宽外无区别（同基础名 + 同接口）的元件在家族内以位宽变体切换。
import { expect, test } from 'vitest';
import { activeVariant, componentWidth, groupComponentFamilies, stripWidthMarker, type LibraryEntry } from '../src/libraryGrouping';
import { architectureLibrary } from '../src/architectureCircuits';
import { packageCircuit } from '../src/components';
import { addGate, connect, createWorkshopCircuit } from '../src/model';
import type { ComponentLibrary } from '../src/contracts';

const teachingEntries: LibraryEntry[] = Object.entries(architectureLibrary()).map(([key, definition]) => ({ key, definition }));

test('strips leading width markers from component names', () => {
  expect(stripWidthMarker('十六位选择器')).toBe('选择器');
  expect(stripWidthMarker('一位使能寄存器')).toBe('使能寄存器');
  expect(stripWidthMarker('4位加法器')).toBe('加法器');
  expect(stripWidthMarker('8-bit adder')).toBe('adder');
  expect(stripWidthMarker('8bit adder')).toBe('adder');
  expect(stripWidthMarker('反相器')).toBe('反相器');
  expect(stripWidthMarker('八位')).toBe('八位');
  expect(stripWidthMarker('十分频器')).toBe('十分频器');
});

test('derives component width from the widest port', () => {
  const mux8 = teachingEntries.find(entry => entry.definition.name === '八位选择器')!.definition;
  expect(componentWidth(mux8)).toBe(8);
  const register8 = teachingEntries.find(entry => entry.definition.name === '八位使能寄存器')!.definition;
  expect(componentWidth(register8)).toBe(8);
});

test('groups width variants of one teaching family behind sorted widths', () => {
  const families = groupComponentFamilies(teachingEntries);
  const mux = families.find(family => family.baseName === '选择器')!;
  expect(mux.widths.map(variant => variant.width)).toEqual([1, 2, 8, 16]);
  expect(mux.widths.map(variant => variant.versions[0].definition.name))
    .toEqual(['一位选择器', '两位选择器', '八位选择器', '十六位选择器']);
  const register = families.find(family => family.baseName === '使能寄存器')!;
  expect(register.widths.map(variant => variant.width)).toEqual([1, 2, 8, 16]);
  // 单一元件（无可合并的位宽变体）仍构成只有一个位宽的家族。
  expect(families.find(family => family.baseName === '进位加法器')!.widths).toHaveLength(1);
  // 未选择时默认最宽变体。
  expect(activeVariant(mux).width).toBe(16);
  expect(activeVariant(mux, 8).versions[0].definition.name).toBe('八位选择器');
});

/** 用工坊路径搭一个 n 位反相器入库；enable 时多留一个未接线的输入接口改变端口签名。 */
function saveInverter(name: string, bits: number, library: ComponentLibrary, enable = false): ComponentLibrary {
  const suffix = name + bits;
  let circuit = createWorkshopCircuit();
  circuit = addGate(circuit, 'INPUT', { x: 0, y: 0 }, `in-${suffix}`, library, bits, true);
  if (enable) circuit = addGate(circuit, 'INPUT', { x: 0, y: 140 }, `E-${suffix}`, library, 1, true);
  circuit = addGate(circuit, 'NOT', { x: 130, y: 0 }, `not-${suffix}`, library, bits, true);
  circuit = addGate(circuit, 'OUTPUT', { x: 260, y: 0 }, `out-${suffix}`, library, bits, true);
  circuit = connect(circuit, `in-${suffix}`, 'out', `not-${suffix}`, 'a', library, true);
  circuit = connect(circuit, `not-${suffix}`, 'out', `out-${suffix}`, 'in', library, true);
  return packageCircuit(circuit, name, library, true).library;
}

const familyList = (library: ComponentLibrary) =>
  groupComponentFamilies(Object.entries(library).map(([key, definition]) => ({ key, definition })));

test('merges player components that differ only in bit width', () => {
  let library: ComponentLibrary = {};
  library = saveInverter('反相器', 1, library);
  library = saveInverter('反相器', 1, library); // 同名再次保存 → v2
  library = saveInverter('八位反相器', 8, library);
  const families = familyList(library);
  expect(families.map(family => family.baseName)).toEqual(['反相器']);
  const family = families[0];
  expect(family.widths.map(variant => variant.width)).toEqual([1, 8]);
  // 1 位桶里 v2 在前；8 位桶是独立版本；默认展示最宽。
  expect(family.widths[0].versions.map(entry => entry.definition.version)).toEqual([2, 1]);
  expect(family.widths[1].versions).toHaveLength(1);
  expect(activeVariant(family).width).toBe(8);
});

test('keeps same-base components with different interfaces in separate families', () => {
  let library: ComponentLibrary = {};
  library = saveInverter('锁存', 1, library);
  library = saveInverter('八位锁存', 8, library, true); // 多一个 E 输入 → 接口形状不同
  const families = familyList(library);
  expect(families).toHaveLength(2);
  expect(families.every(family => family.baseName === '锁存')).toBe(true);
  expect(families.map(family => family.widths).every(widths => widths.length === 1)).toBe(true);
  expect(families.some(family => family.widths[0].versions[0].definition.inputs.length === 2)).toBe(true);
  expect(families.some(family => family.widths[0].versions[0].definition.inputs.length === 1)).toBe(true);
});
