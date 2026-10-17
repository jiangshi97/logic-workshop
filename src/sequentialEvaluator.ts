// 时序判题内核：在 GateKernel 外维护寄存器/RAM/周期计数，step() 与交互引擎同构——
// 求值旧状态 → 采样全部存储元件 → 同时提交新状态 → 再求值。不含任何指令语义。
import type { CircuitGraph, ComponentLibrary, Inputs, RuntimeState, Signal } from './contracts';
import { compileGateKernel, maskSignal, mergeMasks, signalMask } from './combinationalEvaluator';
import type { BitSignal } from './combinationalEvaluator';

export interface SequentialEvaluator {
  readonly cycle:number;
  step(inputs:Inputs,tick:boolean):Record<string,Signal>;
  state():RuntimeState;
  reset(state?:RuntimeState):void;
}
/** Synchronous grading of the actual gate graph. No instruction semantics live here. */
export function compileSequential(graph:CircuitGraph,library:ComponentLibrary={}):SequentialEvaluator {
  const kernel=compileGateKernel(graph,library),registerDevices=kernel.storage.filter(s=>s.kind==='DFF'),memoryDevices=kernel.storage.filter(s=>s.kind==='RAM');
  let registers:Record<string,BitSignal>={},memories:Record<string,BitSignal[]>={},cycle=0;
  function reset(state?:RuntimeState){
    if(state&&(!Number.isSafeInteger(state.cycle)||state.cycle<0||!state.registers||typeof state.registers!=='object'))throw new Error('时钟状态无效。');
    cycle=state?.cycle??0;
    registers=Object.fromEntries(registerDevices.map(r=>[r.key,signalMask(state?.registers[r.key]??0,r.bits)]));
    memories=Object.fromEntries(memoryDevices.map(m=>{
      const words=state?.memories?.[m.key]??Array(256).fill(0);
      if(!Array.isArray(words)||words.length!==256)throw new Error('存储器状态无效。');
      return [m.key,Array.from(words,w=>signalMask(w,8))];
    }));
  }
  reset();
  return {
    get cycle(){return cycle;},
    reset,
    state:()=>({cycle,registers:Object.fromEntries(registerDevices.map(r=>[r.key,maskSignal(registers[r.key],r.bits)])),
      ...(memoryDevices.length?{memories:Object.fromEntries(memoryDevices.map(m=>[m.key,memories[m.key].map(word=>maskSignal(word,8))]))}:{})}),
    step(inputs,tick){
      kernel.evaluate(inputs,registers,memories);
      if(tick){
        const nextRegisters=Object.fromEntries(registerDevices.map(r=>{
          const rst=kernel.read(r.rst,1),data=kernel.read(r.d,r.bits),zero={known:2**r.bits-1,value:0};
          return [r.key,rst.known?rst.value?zero:data:mergeMasks(data,zero)];
        }));
        const nextMemories=Object.fromEntries(memoryDevices.map(m=>{
          const rst=kernel.read(m.rst,1),we=kernel.read(m.we,1),zero={known:255,value:0};
          if(rst.known&&rst.value)return [m.key,Array(256).fill(zero)];
          const old=memories[m.key],next=[...old];
          if(!we.known||we.value){
            // 地址/写使能含 X 时按位合并「写旧值」与「写新值」，与交互引擎的保守语义一致。
            const addr=kernel.read(m.addr,8),data=kernel.read(m.d,8),certain=we.known&&addr.known===255;
            for(let address=0;address<256;address++)if((address&addr.known)===addr.value)next[address]=certain?data:mergeMasks(old[address],data);
          }
          if(!rst.known)for(let address=0;address<256;address++)next[address]=mergeMasks(next[address],zero);
          return [m.key,next];
        }));
        // All collectors have sampled the pre-edge graph before any state source changes.
        registers=nextRegisters;memories=nextMemories;cycle++;
        kernel.evaluate(inputs,registers,memories);
      }
      return kernel.outputs();
    },
  };
}
