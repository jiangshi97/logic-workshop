// 编程关卡的固定机器：programmingMachine 生成清空 ROM 的第 44 关整机电路，
// programmingMachineLibrary 计算其依赖闭包，validateProgrammingMachine 防止玩家篡改硬件绕过任务。
import { architectureLibrary, architectureReferenceCircuit } from './architectureCircuits';
import { assemble } from './assembler';
import { programmingReferenceSource } from './programmingSpec';
import { levels } from './levels';
import type { Circuit, CircuitGraph, ComponentLibrary } from './contracts';

// 编程关卡带从聚合目录中 mode='program' 的关卡派生（当前 45–56）：JSON 追加的普通关不会落入编程判题路径。
const programmingBand = levels.reduce(({ min, max }, level) =>
  level.mode === 'program'
    ? { min: Math.min(min, level.id), max: Math.max(max, level.id) }
    : { min, max }, { min: Infinity, max: -Infinity });
export const isProgrammingLevel=(id:number)=>Number.isInteger(id)&&id>=programmingBand.min&&id<=programmingBand.max;

/** 编程关卡初始电路 = 第 44 关参考整机，ROM 清空待玩家编写。 */
export function programmingMachine(levelId:number):Circuit {
  if(!isProgrammingLevel(levelId))throw new Error('编程关卡不存在。');
  const circuit=architectureReferenceCircuit(44);
  return {...circuit,levelId,nodes:circuit.nodes.map(n=>n.id==='program'?{...n,words:[]}:n)};
}

/** Every canonical component reachable from the fixed root CPU, in deterministic order. */
export function programmingMachineLibrary():ComponentLibrary {
  const bank=architectureLibrary(),needed=new Set<string>();
  const visit=(graph:CircuitGraph)=>{for(const n of graph.nodes)if(n.type==='COMPONENT'&&!needed.has(n.componentKey!)){
    needed.add(n.componentKey!);visit(bank[n.componentKey!].graph);
  }};
  visit(architectureReferenceCircuit(44));
  return Object.fromEntries([...needed].sort().map(key=>[key,bank[key]]));
}

function stable(value:unknown):unknown {
  // stable 递归删除 undefined 键并按字典序排序对象键，使 JSON 比对不受字段顺序影响。
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)]));
  return value;
}
function graph(graph:CircuitGraph,root=false) {
  // 规范化图：忽略位置、节点/导线按 id 排序；root=true 时再忽略 program 节点的 ROM 字与汇编源。
  return {nodes:graph.nodes.map(({position:_position,...n})=>{
    if(root&&n.id==='program'){const {words:_words,programSource:_source,...fixed}=n;return fixed;}
    return n;
  }).sort((a,b)=>a.id.localeCompare(b.id)),wires:[...graph.wires].sort((a,b)=>a.id.localeCompare(b.id))};
}
const equal=(a:unknown,b:unknown)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
/** 校验编程关卡：整机电路（不含 ROM 内容）与全部固定依赖组件必须与规范版本逐字节等价。 */
export function validateProgrammingMachine(circuit:Circuit,library:ComponentLibrary):string[] {
  if(!isProgrammingLevel(circuit.levelId))return [];
  if(!equal(graph(circuit,true),graph(programmingMachine(circuit.levelId),true)))return ['编程关卡的固定机器电路被修改。'];
  for(const [key,canonical] of Object.entries(programmingMachineLibrary())){
    const actual=library[key];
    if(!actual)return [`固定机器组件依赖缺失：${key}。`];
    if(!equal({...actual,graph:graph(actual.graph)},{...canonical,graph:graph(canonical.graph)}))return [`固定机器组件被修改：${key}。`];
  }
  return [];
}

/** Runtime session identity ignores layout but includes the ROM and all dependency contents. */
export function programmingSessionKey(circuit:Circuit,library:ComponentLibrary,caller?:string):string {
  return JSON.stringify(stable({caller,levelId:circuit.levelId,graph:graph(circuit),library:Object.fromEntries(Object.entries(library).map(([key,def])=>[key,{...def,graph:graph(def.graph)}]))}));
}
export function programmingReferenceCircuit(levelId:number):Circuit {
  const circuit=programmingMachine(levelId),programSource=programmingReferenceSource(levelId),words=assemble(programSource).words;
  return {...circuit,nodes:circuit.nodes.map(n=>n.id==='program'?{...n,words,programSource}:n)};
}
