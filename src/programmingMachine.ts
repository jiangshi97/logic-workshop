// 兼容转发：固定机器已升级为可多机选择的机器注册表（machines.ts），旧导入路径保持不变。
export {
  isProgrammingLevel, programmingMachine, programmingMachineLibrary, canonicalMachineLibrary,
  validateProgrammingMachine, programmingSessionKey, programmingReferenceCircuit,
  machines, machineByKey, machineForLevel, machineKeyOf, computer44,
} from './machines';
export type { MachineDescriptor } from './machines';
