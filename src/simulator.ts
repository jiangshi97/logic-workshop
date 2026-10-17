// 交互仿真与判题入口。交互路径把扁平网表编译为 DigitalJS HeadlessCircuit（存储元件外置为状态源/采样器）；
// 判题则按关卡模式分发到掩码内核（combinationalEvaluator/sequentialEvaluator）或编程运行器。
import { HeadlessCircuit } from 'digitaljs';
import { Vector3vl } from '3vl';
import { getLevel, testInputs, testSequences } from './levels';
import { getPorts, validateCircuit, validateWorkshopCircuit } from './model';
import { flattenGraph } from './netlist';
import { compileCombinational } from './combinationalEvaluator';
import { compileSequential } from './sequentialEvaluator';
import { isProgrammingLevel } from './programmingMachine';
import { judgeProgramming } from './programmingRunner';
import type { Endpoint } from './netlist';
import type { Circuit, CircuitNode, ComponentLibrary, Inputs, RuntimeState, Signal, Simulation, SimulationFrame, SimulationStep, TestResult, TestRow } from './contracts';
export type { Signal, Simulation, TestResult, TestRow } from './contracts';
export { hasSequential } from './netlist';

/** 外置 DFF：q 是状态源（Input 器件），d/rst 是采样器（Output 器件）。 */
interface Register { key:string; bits:number; q:Endpoint; d:Endpoint; rst:Endpoint; }
/** 外置 ROM/RAM：ROM 的 words 固定，RAM 的 256 字保存在 RuntimeState.memories。 */
interface Memory { key:string; bits:number; q:Endpoint; addr:Endpoint; words?:number[]; d?:Endpoint; we?:Endpoint; rst?:Endpoint; }

/** Registers and memories become state sources plus collectors; DigitalJS evaluates the gates. */
function compile(circuit:Circuit,library:ComponentLibrary) {
  const flat=flattenGraph(circuit,library),devices:Record<string,Record<string,unknown>>={},connectors:{from:Endpoint;to:Endpoint}[]=[],registers:Register[]=[],memories:Memory[]=[];
  const nodeMap=new Map(flat.nodes.map(n=>[n.id,n.node]));
  function actual(endpoint:Endpoint):Endpoint[] {
    // DigitalJS 器件端口名与我们的端口 id 不同：门用 in1/in2/out，NOT 的单输入同时接 in1/in2。
    const node=nodeMap.get(endpoint.id)!;
    if (['DFF','ROM','RAM'].includes(node.type)) return [{id:`${endpoint.id}:${endpoint.port}`,port:endpoint.port==='q'?'out':'in'}];
    if (node.type==='NOT'&&endpoint.port==='a') return [{id:endpoint.id,port:'in1'},{id:endpoint.id,port:'in2'}];
    return [{id:endpoint.id,port:endpoint.port==='a'?'in1':endpoint.port==='b'?'in2':endpoint.port}];
  }
  for (const {id,node,root} of flat.nodes) {
    const bits=node.bits??1;
    if (node.type==='ROM'||node.type==='RAM') {
      const q={id:`${id}:q`,port:'out'},addr={id:`${id}:addr`,port:'in'};
      devices[q.id]={type:'Input',bits,label:q.id};devices[addr.id]={type:'Output',bits:8,label:addr.id};
      const memory:Memory={key:id,bits,q,addr,...(node.type==='ROM'?{words:node.words??[]}:{})};
      if(node.type==='RAM')for(const [port,width] of [['d',8],['we',1],['rst',1]] as const){
        const endpoint={id:`${id}:${port}`,port:'in'};devices[endpoint.id]={type:'Output',bits:width,label:endpoint.id};memory[port]=endpoint;
      }
      memories.push(memory);continue;
    }
    if (node.type==='DFF') {
      const q={id:`${id}:q`,port:'out'},d={id:`${id}:d`,port:'in'},rst={id:`${id}:rst`,port:'in'};
      devices[q.id]={type:'Input',bits,label:q.id};
      devices[d.id]={type:'Output',bits,label:d.id};
      devices[rst.id]={type:'Output',bits:1,label:rst.id};
      registers.push({key:id,bits,q,d,rst});
      continue;
    }
    const type=node.type==='INPUT'?root?'Input':'Repeater':node.type==='OUTPUT'?root?'Output':'Repeater':
      ({NAND:'Nand',NOT:'Nand',AND:'And',OR:'Or',XOR:'Xor',XNOR:'Xnor',CONST:'Constant',SPLIT:'BusUngroup',JOIN:'BusGroup'} as const)[node.type as Exclude<CircuitNode['type'],'INPUT'|'OUTPUT'|'COMPONENT'|'DFF'|'ROM'|'RAM'>];
    devices[id]={type,bits,label:id,net:node.label,
      ...(node.type==='CONST'?{constant:(node.value??0).toString(2).padStart(bits,'0')}:{}),
      ...(['SPLIT','JOIN'].includes(node.type)?{groups:Array(bits).fill(1)}:{})};
  }
  for (const wire of flat.wires) for (const to of actual(wire.to)) connectors.push({from:actual(wire.from)[0],to});
  const references=new Map<string,{device?:string;inputs:Record<string,Endpoint[]>;outputs:Record<string,Endpoint>}>();
  for (const [id,ref] of flat.references) references.set(id,{device:ref.device,
    inputs:Object.fromEntries(Object.entries(ref.inputs).map(([p,e])=>[p,actual(e)])),
    outputs:Object.fromEntries(Object.entries(ref.outputs).map(([p,e])=>[p,actual(e)[0]]))});
  const engine=new HeadlessCircuit({devices,connectors,subcircuits:{}});
  return {engine,references,registers,memories};
}
type Session=ReturnType<typeof compile>;

/** 把 Vector3vl 转为 Signal：全 0/1 → 数值，全 X → 'X'，其余 → 原二进制串。 */
function signal(vector?:Vector3vl):Signal {
  const bin=vector?.toBin().toUpperCase();
  if (!bin) return 'X';
  return /^[01]+$/.test(bin)?Number.parseInt(bin,2):/^X+$/.test(bin)?'X':bin;
}
function binary(value:Signal,bits:number):string {
  if (typeof value==='number') {
    if (!Number.isInteger(value)||value<0||value>=2**bits) throw new Error('寄存器状态超出位宽范围。');
    return value.toString(2).padStart(bits,'0');
  }
  if (value==='X') return 'X'.repeat(bits);
  if (value.length!==bits||!/^[01X]+$/.test(value)) throw new Error('寄存器状态无效。');
  return value;
}
/** 由已有状态构造（或校验）初始 RuntimeState：RAM 默认 256 个 0，寄存器默认 0。 */
function initial(session:Session,state?:RuntimeState):RuntimeState {
  if (state&&(!Number.isSafeInteger(state.cycle)||state.cycle<0||!state.registers||typeof state.registers!=='object')) throw new Error('时钟状态无效。');
  const memories=Object.fromEntries(session.memories.filter(m=>m.words===undefined).map(m=>{
    const data=state?.memories?.[m.key]??Array(256).fill(0);
    if(!Array.isArray(data)||data.length!==256)throw new Error('存储器状态无效。');
    for(const value of data)binary(value,8);
    return [m.key,[...data]];
  }));
  return {cycle:state?.cycle??0,...(Object.keys(memories).length?{memories}:{}),registers:Object.fromEntries(session.registers.map(r=>{
    const value=state&&Object.hasOwn(state.registers,r.key)?state.registers[r.key]:0;
    binary(value,r.bits);return [r.key,value];
  }))};
}
function settle(engine:HeadlessCircuit) {
  let events=0;
  while (engine.hasPendingEvents) {
    // The synchronous DigitalJS engine commits before returning its resolved promise.
    void engine.updateGatesNext();
    if (++events>100000) throw new Error('信号未能稳定，请检查电路。');
  }
}
function read(engine:HeadlessCircuit,endpoint:Endpoint):Signal {
  const kind=endpoint.port==='out'||endpoint.port.startsWith('out')?'outputSignals':'inputSignals';
  return signal(engine.findDeviceByLabel(endpoint.id).get(kind)[endpoint.port]);
}
function merge(values:Signal[],bits:number):Signal {
  let result=binary(values[0],bits);
  for(const value of values.slice(1)) {
    const other=binary(value,bits);result=Array.from(result,(bit,i)=>bit===other[i]?bit:'X').join('');
  }
  return signal(Vector3vl.fromBin(result.toLowerCase()));
}
/** 枚举与含 X 地址匹配的全部 256 个候选地址，用于存储器保守读取。 */
function addresses(value:Signal):number[] {
  if(typeof value==='number')return [value];
  const pattern=binary(value,8);
  return Array.from({length:256},(_,i)=>i).filter(i=>Array.from(i.toString(2).padStart(8,'0')).every((bit,j)=>pattern[j]==='X'||pattern[j]===bit));
}
function memoryRead(session:Session,m:Memory,state:RuntimeState):Signal {
  const words=m.words??state.memories![m.key];
  return merge(addresses(read(session.engine,m.addr)).map(addr=>words[addr]??0),m.bits);
}
function settleMemories(session:Session,state:RuntimeState) {
  // A memory output may feed another memory's address through any number of gates.
  // Re-evaluate addressed reads until both the engine and every memory output agree.
  for(let round=0;round<=session.memories.length+1;round++) {
    settle(session.engine);
    const updates=session.memories.map(m=>({m,value:memoryRead(session,m,state)})).filter(({m,value})=>read(session.engine,m.q)!==value);
    if(!updates.length)return;
    for(const {m,value} of updates)session.engine.setInput(m.q.id,Vector3vl.fromBin(binary(value,m.bits).toLowerCase()));
  }
  throw new Error('存储器寻址信号未能稳定。');
}
/** 施加输入与当前状态，并让存储器输出稳定（存储器输出经门级反馈再作地址时需迭代）。 */
function apply(session:Session,circuit:Circuit,inputs:Inputs,state:RuntimeState) {
  for (const node of circuit.nodes.filter(n=>n.type==='INPUT')) {
    const bits=node.bits??1,v=inputs[node.id]??0;
    if (!Number.isInteger(v)||v<0||v>=2**bits) throw new Error(`输入 ${node.id} 超出位宽范围。`);
    session.engine.setInput(session.references.get(node.id)!.device!,Vector3vl.fromBin(v.toString(2).padStart(bits,'0')));
  }
  for (const r of session.registers) session.engine.setInput(r.q.id,Vector3vl.fromBin(binary(state.registers[r.key],r.bits).toLowerCase()));
  settleMemories(session,state);
}
function outputValue(session:Session,node:CircuitNode):Signal {
  return signal(session.engine.getOutput(session.references.get(node.id)!.device!));
}
/** 推进一个周期：先以旧状态求值并采样全部 d/rst/we，再同时提交新状态并重新求值；tick=false 只求值不推进。 */
function advance(session:Session,circuit:Circuit,inputs:Inputs,state:RuntimeState,tick:boolean):RuntimeState {
  apply(session,circuit,inputs,state);
  if (!tick) return state;
  const registers=Object.fromEntries(session.registers.map(r=>{
    const rst=read(session.engine,r.rst),d=read(session.engine,r.d);
    // Unknown reset merges the reset and data alternatives bit by bit.
    const next=rst===1?0:rst===0?d:signal(Vector3vl.fromBin(binary(d,r.bits).replace(/1/g,'X').toLowerCase()));
    return [r.key,next];
  }));
  const memories=Object.fromEntries(session.memories.filter(m=>m.words===undefined).map(m=>{
    const old=state.memories![m.key],rst=read(session.engine,m.rst!),we=read(session.engine,m.we!);
    if(rst===1)return [m.key,Array(256).fill(0)];
    let data=[...old];
    if(we!==0) {
      // 地址或写使能含 X 时，把「写旧值」与「写新值」两种可能按位合并，得到保守结果。
      const candidates=addresses(read(session.engine,m.addr)),d=read(session.engine,m.d!);
      for(const addr of candidates)data[addr]=we===1&&candidates.length===1?d:merge([old[addr],d],8);
    }
    if(rst!==0)data=data.map(value=>merge([value,0],8));
    return [m.key,data];
  }));
  const next={registers,cycle:state.cycle+1,...(Object.keys(memories).length?{memories}:{})};
  apply(session,circuit,inputs,next);
  return next;
}
/** 采集展示用快照：每个节点的值、每个端口的值与每条导线的信号。 */
function snapshot(session:Session,circuit:Circuit,library:ComponentLibrary,state:RuntimeState):Simulation {
  const values:Record<string,Signal>={},portValues:Record<string,Signal>={};
  for (const node of circuit.nodes) {
    const refs=session.references.get(node.id)!;
    for (const [id,endpoints] of Object.entries(refs.inputs)) portValues[`${node.id}:${id}`]=read(session.engine,endpoints[0]);
    for (const [id,endpoint] of Object.entries(refs.outputs)) portValues[`${node.id}:${id}`]=read(session.engine,endpoint);
    values[node.id]=node.type==='OUTPUT'?outputValue(session,node):portValues[`${node.id}:${getPorts(node,library).outputs[0]?.id}`]??'X';
  }
  return {values,portValues,wires:Object.fromEntries(circuit.wires.map(w=>[w.id,portValues[`${w.source}:${w.sourceHandle}`]])),
    state:{cycle:state.cycle,registers:{...state.registers},...(state.memories?{memories:Object.fromEntries(Object.entries(state.memories).map(([key,words])=>[key,[...words]]))}:{})}};
}
function checkedSession(circuit:Circuit,library:ComponentLibrary):Session {
  // 工坊草稿（levelId=0）不绑定关卡端口，走自由接口校验。
  const error=(circuit.levelId===0?validateWorkshopCircuit(circuit,library):validateCircuit(circuit,library))[0];if(error)throw new Error(error);
  return compile(circuit,library);
}
/** 时序关测试程序覆盖：第 38/44 关判题时用场景自带的 ROM 替换电路中的 program 节点。 */
function withProgram(circuit:Circuit,program?:number[]):Circuit {
  if(program===undefined||![38,44].includes(circuit.levelId))return circuit;
  return {...circuit,nodes:circuit.nodes.map(n=>n.id==='program'?{...n,words:[...program]}:n)};
}

/** 单步交互仿真：可携带旧状态、是否推进时钟、判题用测试程序。 */
export function simulate(circuit:Circuit,inputs:Inputs,library:ComponentLibrary={},options:{state?:RuntimeState;tick?:boolean;program?:number[]}={}):Simulation {
  circuit=withProgram(circuit,options.program);
  const session=checkedSession(circuit,library);
  try {
    const state=advance(session,circuit,inputs,initial(session,options.state),options.tick??false);
    return {...snapshot(session,circuit,library,state),...(options.program!==undefined?{activeProgram:[...options.program]}:{})};
  } finally {session.engine.shutdown();}
}

/** Keep DigitalJS compiled while a Worker performs many batches on the same graph. */
export function createSimulationSession(circuit:Circuit,library:ComponentLibrary) {
  const session=checkedSession(circuit,library);
  return {
    snapshot(inputs:Inputs,state:RuntimeState):Simulation {
      const current=initial(session,state);apply(session,circuit,inputs,current);
      return snapshot(session,circuit,library,current);
    },
    shutdown:()=>session.engine.shutdown(),
  };
}

/** 回放一串步骤并保留最近 64 帧观察，用于反例重现到失败那一刻。 */
export function replaySequence(circuit:Circuit,library:ComponentLibrary,steps:SimulationStep[],program?:number[]):Simulation {
  circuit=withProgram(circuit,program);
  const session=checkedSession(circuit,library),trace:SimulationFrame[]=[];
  try {
    let state=initial(session),inputs:Inputs={};
    if (!steps.length) apply(session,circuit,inputs,state);
    for (const step of steps) {
      inputs=step.inputs;state=advance(session,circuit,inputs,state,step.tick);
      trace.push({cycle:state.cycle,inputs:{...inputs},tick:step.tick,
        outputs:Object.fromEntries(circuit.nodes.filter(n=>n.type==='OUTPUT').map(n=>[n.id,outputValue(session,n)]))});
      if (trace.length>64) trace.shift();
    }
    return {...snapshot(session,circuit,library,state),trace,...(program!==undefined?{activeProgram:[...program]}:{})};
  } finally {session.engine.shutdown();}
}

/** 判题入口：编程关 → judgeProgramming；组合关 → 掩码内核穷举/公开用例；时序关 → 每场景重置的时序内核。 */
export function judge(circuit:Circuit,library:ComponentLibrary={}):TestResult {
  if(isProgrammingLevel(circuit.levelId))return judgeProgramming(circuit,library);
  try {
    const level=getLevel(circuit.levelId),rows:TestRow[]=[];
    const error=validateCircuit(circuit,library)[0];if(error)throw new Error(error);
    const fast=level.mode==='sequential'?undefined:compileCombinational(circuit,library);
    const clocked=fast?undefined:compileSequential(circuit,library);
    function row(inputs:Inputs,expectedOutputs:Record<string,number>,actualOutputs:Record<string,Signal>,details:Partial<TestRow>={}) {
      const mismatches=level.outputPorts.filter(p=>actualOutputs[p.id]!==expectedOutputs[p.id]).map(p=>p.id),first=level.outputPorts[0].id;
      rows.push({inputs,expected:expectedOutputs[first],actual:actualOutputs[first],expectedOutputs,actualOutputs,mismatches,passed:!mismatches.length,...details});
    }
    if (level.mode==='sequential') {
      for (const scenario of testSequences(level.id)) {
        let current=clocked!;
        if(scenario.program!==undefined){
          const programmed=withProgram(circuit,scenario.program),programError=validateCircuit(programmed,library)[0];
          if(programError)throw new Error(programError);
          current=compileSequential(programmed,library);
        }else current.reset();
        scenario.steps.forEach((step,stepIndex)=>{
          const actual=current.step(step.inputs,step.tick);
          row(step.inputs,step.expectedOutputs,actual,{scenarioId:scenario.id,scenarioLabel:scenario.label,stepIndex,cycle:current.cycle,tick:step.tick});
        });
      }
    } else for (const inputs of testInputs(level.id)) {
      if(fast)row(inputs,level.expectedOutputs(inputs),fast(inputs));
      else{clocked!.reset();row(inputs,level.expectedOutputs(inputs),clocked!.step(inputs,false));}
    }
    return {revision:circuit.revision,passed:rows.length>0&&rows.every(r=>r.passed),rows,failure:rows.find(r=>!r.passed)};
  } catch(e) {return {revision:circuit.revision,passed:false,rows:[],error:(e as Error).message};}
}
