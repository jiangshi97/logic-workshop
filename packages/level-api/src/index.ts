// logic-level-api：关卡包作者面对的全部公共 API（事件、钩子上下文、包描述符与工具）。
// 宿主应用经别名 logic-level-api 引用本包；content/packs/*/index.ts 也从这里导入。
export * from './events';
export * from './hooks';
export * from './pack';
export * from './utils';
export type { GeneratorContext, ScenarioGenerator, CaseGenerator } from '../../../src/levelGenerators';
export type { MachineDescriptor } from '../../../src/machines';
export type { Level } from '../../../src/levels';
