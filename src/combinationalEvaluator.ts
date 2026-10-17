// 判题内核：把扁平网表编译成拓扑排序的指令序列，在 known/value 两个掩码数组上执行。
// 所有门运算都写成掩码代数，天然支持三值信号（0/1/X）；交互仿真仍走 DigitalJS，两者由等价测试保证一致。
import type { CircuitGraph, ComponentLibrary, Inputs, Signal } from './contracts';
import { flattenGraph } from './netlist';
import { getPorts } from './model';

type Operation = 'INPUT'|'CONST'|'BUFFER'|'NOT'|'AND'|'NAND'|'OR'|'XOR'|'XNOR'|'SPLIT'|'JOIN'|'DFF'|'ROM'|'RAM';
/** 一条内核指令：从位槽 a/b 读操作数，结果写入位槽 output。 */
interface Instruction {
  op:Operation; bits:number; mask:number; output:number; a:number; b:number;
  bus?:number[]; inputId?:string; constant?:number;
  storageKey?:string; words?:BitSignal[];
}
/** 位掩码形式的信号：known 为 1 的位有效，对应 value 中的 0/1；known 为 0 的位未知。 */
export interface BitSignal { known:number; value:number; }
export interface StorageDevice {
  key:string; kind:'DFF'|'RAM'; bits:number; q:number; d:number; rst:number; addr:number; we:number;
}
export interface GateKernel {
  storage:StorageDevice[];
  evaluate(inputs:Inputs,registers?:Record<string,BitSignal>,memories?:Record<string,BitSignal[]>):void;
  read(slot:number,bits:number):BitSignal;
  outputs():Record<string,Signal>;
}
export function signalMask(signal:Signal,bits:number):BitSignal {
  const mask=2**bits-1;
  if(typeof signal==='number'){
    if(!Number.isInteger(signal)||signal<0||signal>mask)throw new Error('寄存器状态超出位宽范围。');
    return {known:mask,value:signal};
  }
  if(signal==='X')return {known:0,value:0};
  if(typeof signal!=='string'||signal.length!==bits||!/^[01X]+$/.test(signal))throw new Error('寄存器状态无效。');
  let known=0,value=0;
  for(const bit of signal){known=known<<1|(bit==='X'?0:1);value=value<<1|(bit==='1'?1:0);}
  return {known,value};
}
export function maskSignal({known,value}:BitSignal,bits:number):Signal {
  if(known===2**bits-1)return value;
  if(known===0)return 'X';
  let bin='';for(let i=bits-1;i>=0;i--)bin+=known&1<<i?value&1<<i?'1':'0':'X';return bin;
}
/** 掩码合并：只有两个输入都已知且相同的位才保持已知（用于多候选地址/复位未知的保守合并）。 */
export function mergeMasks(a:BitSignal,b:BitSignal):BitSignal {
  const known=a.known&b.known&~(a.value^b.value);return {known,value:a.value&known};
}
function addressedRead(words:BitSignal[],known:number,value:number):BitSignal {
  if(known===255)return words[value];
  let result:BitSignal|undefined;
  for(let address=0;address<256;address++)if((address&known)===value)result=result?mergeMasks(result,words[address]):words[address];
  return result!;
}

/** Real gate dependencies; only synchronous write ports are cut from the ordering. */
export function compileGateKernel(graph:CircuitGraph,library:ComponentLibrary={}):GateKernel {
  const flat=flattenGraph(graph,library);
  // Slot zero represents an undriven, entirely unknown signal.
  const slots=new Map<string,number>();let slotCount=1;
  const nodeIndexes=new Map(flat.nodes.map(({id},index)=>[id,index]));
  for(const {id,node} of flat.nodes){
    const outputs=getPorts(node,library).outputs;
    for(const port of outputs)slots.set(`${id}:${port.id}`,slotCount++);
    if(node.type==='OUTPUT')slots.set(`${id}:out`,slotCount++);
  }
  const sources=new Map<string,number>(),outgoing=flat.nodes.map(()=>[] as number[]),indegree=new Int32Array(flat.nodes.length);
  // 写端口（DFF 全部输入、RAM 的 d/we/rst）不参与拓扑边，因此经过存储元件的反馈不影响排序。
  for(const {from,to} of flat.wires){
    sources.set(`${to.id}:${to.port}`,slots.get(`${from.id}:${from.port}`)!);
    const a=nodeIndexes.get(from.id)!,b=nodeIndexes.get(to.id)!,target=flat.nodes[b].node.type;
    if(target==='DFF'||target==='RAM'&&to.port!=='addr')continue;
    outgoing[a].push(b);indegree[b]++;
  }
  const ready=flat.nodes.map((_,i)=>i).filter(i=>indegree[i]===0),instructions:Instruction[]=[];
  for(let cursor=0;cursor<ready.length;cursor++){
    const index=ready[cursor],{id,node,root}=flat.nodes[index],bits=node.bits??1,mask=2**bits-1;
    const source=(port:string)=>sources.get(`${id}:${port}`)??0,output=(port='out')=>slots.get(`${id}:${port}`)!;
    const op:Operation=node.type==='OUTPUT'||node.type==='INPUT'&&!root?'BUFFER':node.type as Operation;
    instructions.push({op,bits,mask,output:output(node.type==='SPLIT'?'out0':['DFF','RAM','ROM'].includes(node.type)?'q':'out'),
      a:source(['RAM','ROM'].includes(node.type)?'addr':['INPUT','OUTPUT','SPLIT'].includes(node.type)?'in':'a'),b:source('b'),
      ...(op==='INPUT'?{inputId:node.id}:{}),...(op==='CONST'?{constant:node.value??0}:{}),
      ...(op==='JOIN'?{bus:Array.from({length:bits},(_,i)=>source(`in${i}`))}:{}),
      ...(op==='SPLIT'?{bus:Array.from({length:bits},(_,i)=>output(`out${i}`))}:{})});
    if(op==='DFF'||op==='RAM')instructions.at(-1)!.storageKey=id;
    if(op==='ROM')instructions.at(-1)!.words=Array.from({length:256},(_,i)=>({known:mask,value:node.words?.[i]??0}));
    for(const target of outgoing[index])if(--indegree[target]===0)ready.push(target);
  }
  if(instructions.length!==flat.nodes.length)throw new Error('组合电路不能形成反馈回路。');
  const outputs=graph.nodes.filter(n=>n.type==='OUTPUT').map(node=>({id:node.id,bits:node.bits??1,
    slot:slots.get(`${flat.references.get(node.id)!.device!}:out`)!}));
  const known=new Uint32Array(slotCount),values=new Uint32Array(slotCount);
  const storage:StorageDevice[]=flat.nodes.filter(({node})=>node.type==='DFF'||node.type==='RAM').map(({id,node})=>{
    const source=(port:string)=>sources.get(`${id}:${port}`)??0;
    return {key:id,kind:node.type as 'DFF'|'RAM',bits:node.bits??1,q:slots.get(`${id}:q`)!,d:source('d'),rst:source('rst'),addr:source('addr'),we:source('we')};
  });
  function evaluate(inputs:Inputs,registers:Record<string,BitSignal>={},memories:Record<string,BitSignal[]>={}) {
    for(const instruction of instructions){
      const {op,mask,output,a,b}=instruction;
      const av=values[a],ak=known[a],bv=values[b],bk=known[b];let k=0,v=0;
      switch(op){
        case 'DFF': k=registers[instruction.storageKey!].known;v=registers[instruction.storageKey!].value;break;
        case 'ROM':case 'RAM':{
          const result=addressedRead(op==='ROM'?instruction.words!:memories[instruction.storageKey!],ak,av);k=result.known;v=result.value;break;
        }
        case 'INPUT':{
          v=inputs[instruction.inputId!]??0;
          if(!Number.isInteger(v)||v<0||v>mask)throw new Error(`输入 ${instruction.inputId} 超出位宽范围。`);
          k=mask;break;
        }
        case 'CONST': k=mask;v=instruction.constant!;break;
        case 'BUFFER': k=ak&mask;v=av&k;break;
        case 'NOT': k=ak&mask;v=~av&k;break;
        case 'AND':case 'NAND':{
          // AND 三值运算：双方均为 1 的位得 1，任一方已知为 0 的位得 0，其余未知。
          const ones=av&ak&bv&bk,zeros=(~av&ak)|(~bv&bk);k=(ones|zeros)&mask;v=op==='AND'?ones:~ones&k;break;
        }
        case 'OR':{
          const ones=(av&ak)|(bv&bk),zeros=~av&ak&~bv&bk;k=(ones|zeros)&mask;v=ones;break;
        }
        case 'XOR':case 'XNOR':k=ak&bk&mask;v=(op==='XOR'?av^bv:~(av^bv))&k;break;
        case 'JOIN':
          for(let i=0;i<instruction.bus!.length;i++){const slot=instruction.bus![i];k|=(known[slot]&1)<<i;v|=(values[slot]&1)<<i;}break;
        case 'SPLIT':
          for(let i=0;i<instruction.bus!.length;i++){const slot=instruction.bus![i];known[slot]=(ak>>>i)&1;values[slot]=(av>>>i)&1;}
          continue;
      }
      known[output]=k;values[output]=v;
    }
  }
  function outputSignals(){
    const result:Record<string,Signal>={};
    for(const {id,bits,slot} of outputs)result[id]=maskSignal({known:known[slot],value:values[slot]},bits);
    return result;
  }
  return {storage,evaluate,read:(slot,bits)=>{const k=known[slot]&(2**bits-1);return {known:k,value:values[slot]&k};},outputs:outputSignals};
}

/** Fast combinational grading; interactive simulation remains on DigitalJS. */
export function compileCombinational(graph:CircuitGraph,library:ComponentLibrary={}):((inputs:Inputs)=>Record<string,Signal>)|undefined {
  if(flattenGraph(graph,library).nodes.some(({node})=>['DFF','RAM','ROM'].includes(node.type)))return undefined;
  const kernel=compileGateKernel(graph,library);
  return inputs=>{kernel.evaluate(inputs);return kernel.outputs();};
}
