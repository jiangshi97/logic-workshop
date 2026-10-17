// 仿真 Worker：承担交互仿真（常驻会话）、判题、证明重验与存档解析四类后台任务。
// 交互会话按「电路去位置后的 JSON + 组件库」作为 sessionKey 缓存运行状态：移动节点不清零试验，改结构即重置。
import { createSimulationSession, judge, replaySequence, simulate } from './simulator';
import { levels, testSequences } from './levels';
import { parseWorkspace } from './storage';
import { isProgrammingLevel, programmingSessionKey } from './programmingMachine';
import { createProgrammingRunner } from './programmingRunner';
import { programmingCases } from './programmingSpec';
import type { Circuit, ComponentLibrary, Inputs, RuntimeState, Simulation, SimulationFrame } from './contracts';

/** 主线程 → Worker 的请求协议；operation 决定其余字段如何解释。 */
interface Request {
  id: number;
  operation: 'simulate' | 'judge' | 'verify' | 'load' | 'tick' | 'reset' | 'replay' | 'programStep' | 'programRun' | 'programCase';
  circuit?: Circuit;
  inputs?: Inputs;
  library?: ComponentLibrary;
  proofs?: Record<number, Circuit>;
  text?: string;
  sessionKey?: string;
  scenarioId?: string;
  stepIndex?: number;
  instruction?: boolean;
  breakpoints?: number[];
  maxCycles?: number;
  caseId?: string;
}

let sessionKey: string | undefined;
let runtime: RuntimeState | undefined;
let trace: SimulationFrame[] = [];
let activeProgram: number[] | undefined;
let programRunner:ReturnType<typeof createProgrammingRunner>|undefined;
let programKey:string|undefined;
let programSnapshot:ReturnType<typeof createSimulationSession>|undefined;

function sameSignals(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}

/** 记录一帧观察并维护最近 64 帧 trace；无沿且输入输出都没变时跳过，避免波形重复。 */
function recordFrame(simulation: Simulation, circuit: Circuit, inputs: Inputs, tick: boolean): Simulation {
  runtime = simulation.state;
  const frame: SimulationFrame = {
    cycle: runtime?.cycle ?? 0,
    inputs: Object.fromEntries(circuit.nodes.filter(node => node.type === 'INPUT').map(node => [node.id, inputs[node.id] ?? 0])),
    outputs: Object.fromEntries(circuit.nodes.filter(node => node.type === 'OUTPUT').map(node => [node.id, simulation.values[node.id]])),
    tick,
  };
  const previous = trace.at(-1);
  if (tick || !previous || previous.cycle !== frame.cycle
    || !sameSignals(previous.inputs, frame.inputs) || !sameSignals(previous.outputs, frame.outputs)) {
    trace = [...trace.slice(-63), frame];
  }
  return { ...simulation, trace };
}

function runSession(request: Request): Simulation {
  const circuit = request.circuit;
  if (!circuit) throw new Error('模拟缺少电路。');
  const library = request.library ?? {};
  if(isProgrammingLevel(circuit.levelId)){
    if(!programRunner){sessionKey=undefined;runtime=undefined;trace=[];activeProgram=undefined;}
    return runProgrammingSession(request,circuit,library);
  }
  if(programRunner){
    programSnapshot?.shutdown();programSnapshot=undefined;programRunner=undefined;programKey=undefined;
    sessionKey=undefined;runtime=undefined;trace=[];activeProgram=undefined;
  }
  const key = JSON.stringify({ caller:request.sessionKey,level: circuit.levelId,
    nodes: circuit.nodes.map(({ position: _position, ...node }) => node), wires: circuit.wires, library });
  // 结构变化（不含节点位置）即视为新会话，试验状态从零开始。
  if (key !== sessionKey || request.operation === 'reset') {
    sessionKey = key;
    runtime = undefined;
    trace = [];
    activeProgram = undefined;
  }
  if (request.operation === 'replay') {
    const scenario = testSequences(circuit.levelId).find(item => item.id === request.scenarioId);
    const stepIndex = request.stepIndex;
    if (!scenario || !Number.isSafeInteger(stepIndex) || stepIndex! < 0 || stepIndex! >= scenario.steps.length) {
      throw new Error('反例场景或步骤无效。');
    }
    const simulation = replaySequence(circuit, library, scenario.steps.slice(0, stepIndex! + 1), scenario.program);
    activeProgram = scenario.program ? [...scenario.program] : undefined;
    runtime = simulation.state;
    trace = simulation.trace?.slice(-64) ?? [];
    return { ...simulation, trace };
  }
  const inputs = request.inputs ?? {};
  const tick = request.operation === 'tick';
  const simulation = simulate(circuit, inputs, library, { state: runtime, tick, program:activeProgram });
  return recordFrame(simulation, circuit, inputs, tick);
}

function runProgrammingSession(request:Request,circuit:Circuit,library:ComponentLibrary):Simulation {
  const key=programmingSessionKey(circuit,library,request.sessionKey),available=programmingCases(circuit.levelId);
  if(key!==programKey||!programRunner){
    const previous=programRunner?.currentCase().id,selected=request.caseId??(available.some(c=>c.id===previous)?previous:undefined);
    programSnapshot?.shutdown();
    programRunner=createProgrammingRunner(circuit,library,selected,true);programSnapshot=createSimulationSession(circuit,library);programKey=key;trace=[];
  }
  const runner=programRunner,inputs={E:1,R:0,...request.inputs};
  if(request.operation==='reset'){runner.restart(runner.currentCase().id);trace=[];}
  else if(request.operation==='programCase'){
    if(typeof request.caseId!=='string')throw new Error('缺少编程测试用例。');
    runner.restart(request.caseId);trace=[];
  }else if(request.operation==='replay'){
    runner.replay(request.scenarioId!,request.stepIndex!);trace=[];
  }else if(request.operation==='tick')runner.step(inputs);
  else if(request.operation==='programStep')request.instruction===false?runner.step(inputs):runner.instruction(inputs);
  else if(request.operation==='programRun')runner.run(inputs,{breakpoints:request.breakpoints??[],maxCycles:request.maxCycles??90});
  const snapshot=programSnapshot!.snapshot(inputs,runner.state());
  trace=runner.frames();
  return {...recordFrame(snapshot,circuit,inputs,false),program:runner.program()};
}

globalThis.addEventListener('message', (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    let result: unknown;
    if (request.operation === 'load') {
      if (typeof request.text !== 'string') throw new Error('存档内容无效。');
      result = parseWorkspace(request.text);
    } else if (['simulate', 'tick', 'reset', 'replay','programStep','programRun','programCase'].includes(request.operation)) {
      result = runSession(request);
    } else if (request.operation === 'judge') {
      result = judge(request.circuit!, request.library ?? {});
    } else if (request.operation === 'verify') {
      // 证明重验：按关卡顺序逐个重跑 judge，遇到第一个无法通过的证明即停止。
      const valid: Record<number, Circuit> = {};
      for (const level of levels) {
        const proof = request.proofs?.[level.id];
        if (!proof || proof.levelId !== level.id || !judge(proof, request.library ?? {}).passed) break;
        valid[level.id] = proof;
      }
      result = valid;
    } else throw new Error('未知模拟任务。');
    globalThis.postMessage({ id: request.id, result });
  } catch (error) {
    globalThis.postMessage({ id: request.id, error: (error as Error).message });
  }
});
