// 编程关卡运行器：包装一个 compileSequential 内核执行玩家的 ROM。
// 指令效果全部来自门级图；这里只做用例管理、周期/指令单步、批量运行、断点、OUT 事件观察与判题。
import { compileSequential } from './sequentialEvaluator';
import { validateCircuit } from './model';
import { programmingCases } from './programmingSpec';
import { isProgrammingLevel } from './programmingMachine';
import type { ProgramCase } from './programmingSpec';
import type { Circuit, ComponentLibrary, Inputs, Signal, Simulation, SimulationFrame, TestResult, TestRow } from './contracts';

/**
 * @param caseId 初始选中的用例；captureTrace 为 true 时保留最近 64 帧观察（交互用，判题不需要）。
 */
export function createProgrammingRunner(circuit:Circuit,library:ComponentLibrary,caseId?:string,captureTrace=false) {
  if(!isProgrammingLevel(circuit.levelId))throw new Error('当前不是编程关卡。');
  const error=validateCircuit(circuit,library)[0];if(error)throw new Error(error);
  const kernel=compileSequential(circuit,library),cases=programmingCases(circuit.levelId);
  let selected:ProgramCase,outputs:Signal[]=[],instructions=0,stopReason:NonNullable<Simulation['program']>['stopReason'];
  let trace:SimulationFrame[]=[];
  const inputs=(i:Inputs):Inputs=>({E:1,R:0,...i});
  function restart(id=caseId??cases[0].id){
    // 重启用例：把用例 memory 写入 RAM 状态（键 'memory' 为整机器件 RAM 的实例路径）。
    const found=cases.find(c=>c.id===id);if(!found)throw new Error('编程测试用例不存在。');
    selected=found;
    const memory=Array<Signal>(256).fill(0);for(const [address,value] of Object.entries(found.memory))memory[Number(address)]=value;
    kernel.reset({cycle:0,registers:{},memories:{memory}});outputs=[];instructions=0;stopReason=undefined;trace=[];
  }
  restart();
  const observe=(i:Inputs={})=>kernel.step(inputs(i),false);
  function stopped(actual:Record<string,Signal>){
    if(actual.Fault===1)stopReason='fault';
    else if(actual.Halt===1)stopReason='halt';
    else if(kernel.cycle>=selected.maxCycles)stopReason='budget';
  }
  function step(i:Inputs={}){
    const normalized=inputs(i),pre=observe(normalized);
    if(kernel.cycle>=selected.maxCycles&&normalized.R!==1){stopReason='budget';return pre;}
    const executed=pre.Phase===2&&normalized.E===1&&normalized.R===0&&pre.Halt===0&&pre.Fault===0;
    // This observer recognizes OUT only; all instruction effects come from the gate graph.
    const outputEvent=executed&&pre.IR===0x8000;
    const actual=kernel.step(normalized,true);
    if(captureTrace)trace=[...trace.slice(-63),{cycle:kernel.cycle,inputs:{...normalized},outputs:{...actual},tick:true}];
    if(executed)instructions++;
    if(outputEvent)outputs.push(actual.Out);
    stopReason=undefined;stopped(actual);return actual;
  }
  function program():NonNullable<Simulation['program']>{return {caseId:selected.id,outputs:[...outputs],instructions,memory:[...(kernel.state().memories?.memory??Array(256).fill(0))],...(stopReason?{stopReason}:{})};}
  function run(i:Inputs={},options:{maxCycles:number;breakpoints:number[]}){
    // 快速运行：每批 1–90 周期；断点在取指（Phase=0）前命中，继续时跳过当前地址一次。
    if(!Number.isSafeInteger(options.maxCycles)||options.maxCycles<1||options.maxCycles>90)throw new Error('每批运行必须为 1–90 周期。');
    if(options.breakpoints.some(p=>!Number.isInteger(p)||p<0||p>255))throw new Error('断点地址必须为 0–255。');
    const normalized=inputs(i),skipCurrent=stopReason==='breakpoint';stopReason=undefined;
    let actual=observe(normalized);if(normalized.R===0)stopped(actual);
    if(stopReason)return actual;
    if(normalized.E===0&&normalized.R===0){stopReason='paused';return actual;}
    for(let cycle=0;cycle<options.maxCycles;cycle++){
      if(normalized.R===0&&actual.Phase===0&&typeof actual.PC==='number'&&options.breakpoints.includes(actual.PC)&&!(cycle===0&&skipCurrent)){
        stopReason='breakpoint';break;
      }
      actual=step(normalized);if(stopReason)break;
    }
    return actual;
  }
  function instruction(i:Inputs={}){
    const normalized=inputs(i);stopReason=undefined;let actual=observe(normalized);stopped(actual);
    if(stopReason&&normalized.R===0)return actual;
    const before=instructions;
    for(let cycle=0;cycle<3;cycle++){actual=step(normalized);if(instructions>before||stopReason||normalized.E===0)break;}
    return actual;
  }
  function replay(id:string,cycle:number){
    restart(id);if(!Number.isSafeInteger(cycle)||cycle<0||cycle>selected.maxCycles)throw new Error('反例周期无效。');
    for(let n=0;n<cycle;n++)step({E:1,R:0});
    return observe();
  }
  return {observe,step,run,instruction,restart,replay,program,state:()=>kernel.state(),currentCase:()=>selected,cycle:()=>kernel.cycle,outputEvents:()=>outputs,frames:()=>[...trace]};
}

/** 编程判题：逐用例检查 OUT 事件序列、FAULT/Halt 停止状态、周期预算与必要 RAM 结果。 */
export function judgeProgramming(circuit:Circuit,library:ComponentLibrary):TestResult {
  try {
    const runner=createProgrammingRunner(circuit,library),rows:TestRow[]=[];
    for(const testCase of programmingCases(circuit.levelId)){
      runner.restart(testCase.id);let reason='',actual=runner.observe();let outputIndex=0;
      while(runner.cycle()<testCase.maxCycles){
        actual=runner.step();const produced=runner.outputEvents();
        if(produced.length>outputIndex){
          if(outputIndex>=testCase.expectedOutput.length){reason=`额外 OUT：第 ${outputIndex+1} 次输出 ${produced[outputIndex]}。`;break;}
          if(produced[outputIndex]!==testCase.expectedOutput[outputIndex]){reason=`第 ${outputIndex+1} 次 OUT 应为 ${testCase.expectedOutput[outputIndex]}，实际为 ${produced[outputIndex]}。`;break;}
          outputIndex++;
        }
        if(actual.Fault===1){reason='FAULT：执行了非法指令。';break;}
        if(actual.Halt===1){
          if(outputIndex<testCase.expectedOutput.length)reason=`缺少 OUT：应有 ${testCase.expectedOutput.length} 次，实际 ${outputIndex} 次。`;
          else for(const [address,value] of Object.entries(testCase.expectedMemory??{}))if(runner.program().memory[Number(address)]!==value){reason=`RAM[${address}] 应为 ${value}，实际为 ${runner.program().memory[Number(address)]}。`;break;}
          break;
        }
      }
      if(!reason&&actual.Halt!==1)reason=`达到 ${testCase.maxCycles} 周期预算，程序未停止。`;
      const passed=!reason,expectedOutputs={Out:testCase.expectedOutput.at(-1)??0,Halt:1,Fault:0},cycle=runner.cycle();
      rows.push({inputs:{E:1,R:0},expected:expectedOutputs.Out,actual:actual.Out,expectedOutputs,actualOutputs:actual,
        mismatches:passed?[]:[reason],passed,scenarioId:testCase.id,scenarioLabel:testCase.label,stepIndex:cycle,cycle,tick:true,
        program:{expectedOutput:[...testCase.expectedOutput],actualOutput:runner.program().outputs,reason:reason||'输出、内存及停止状态正确。'}});
    }
    return {revision:circuit.revision,passed:rows.length>0&&rows.every(r=>r.passed),rows,failure:rows.find(r=>!r.passed)};
  }catch(error){return {revision:circuit.revision,passed:false,rows:[],error:(error as Error).message};}
}
