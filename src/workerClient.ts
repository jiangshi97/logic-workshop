// 主线程侧的 Worker 封装，提供两种用法：
// 1. backgroundTask：一次性 Worker，用于判题/证明重验/存档解析，支持 AbortSignal 取消；
// 2. useSimulation：常驻 Worker 的 React Hook，驱动交互仿真，过期回包按请求 id 丢弃。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Circuit, ComponentLibrary, Inputs, Simulation } from './contracts';
import { programmingSessionKey } from './programmingMachine';

interface Reply<T> { id: number; result?: T; error?: string; }
export function backgroundTask<T>(operation: 'judge' | 'verify' | 'load', payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
    const stop = () => { worker.terminate(); signal?.removeEventListener('abort', abort); };
    const abort = () => { stop(); reject(new DOMException('任务已取消', 'AbortError')); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<Reply<T>>) => {
      stop(); data.error ? reject(new Error(data.error)) : resolve(data.result as T);
    };
    worker.onerror = event => { stop(); reject(new Error(event.message || '仿真线程启动失败。')); };
    worker.postMessage({ id: 1, operation, ...payload });
  });
}

const empty: Simulation = { values: {}, portValues: {}, wires: {} };
/**
 * 交互仿真 Hook：图（graphKey，含 epoch 用于强制重置）或输入变化时自动重算；
 * tick/reset/replay/program* 为用户命令。回包 id 与最新请求不符时直接丢弃。
 */
export function useSimulation(circuit: Circuit, inputs: Inputs, library: ComponentLibrary, epoch = 0) {
  const [state, setState] = useState({ ...empty, error: '', pending: true });
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  const graphKey = programmingSessionKey(circuit,library,String(epoch));
  const inputKey = JSON.stringify(inputs);
  const payloadRef = useRef({ circuit, inputs, library, sessionKey: graphKey });
  payloadRef.current = { circuit, inputs, library, sessionKey: graphKey };
  const sentSession = useRef('');
  const send = useCallback((operation: 'simulate' | 'tick' | 'reset' | 'replay' | 'programStep' | 'programRun' | 'programCase', extra: Record<string, unknown> = {}) => {
    const payload = payloadRef.current;
    const changed = sentSession.current !== payload.sessionKey;
    sentSession.current = payload.sessionKey;
    const id = ++requestRef.current;
    setState(previous => ({ ...(changed || operation === 'reset' ? empty : previous), pending: true, error: '' }));
    workerRef.current?.postMessage({ id, operation, ...payload, ...extra });
  }, []);
  useEffect(() => {
    const worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = ({ data }: MessageEvent<Reply<Simulation>>) => {
      if (data.id !== requestRef.current) return;
      setState(data.error ? { ...empty, error: data.error, pending: false } : { ...data.result!, error: '', pending: false });
    };
    worker.onerror = event => setState({ ...empty, error: event.message || '仿真线程启动失败。', pending: false });
    return () => { worker.terminate(); workerRef.current = null; };
  }, []);
  useEffect(() => {
    send('simulate');
  }, [graphKey, inputKey, send]);
  const tick = useCallback(() => send('tick'), [send]);
  const reset = useCallback(() => send('reset'), [send]);
  const replay = useCallback((scenarioId: string, stepIndex: number) => send('replay', { scenarioId, stepIndex }), [send]);
  const programStep=useCallback((instruction=true)=>send('programStep',{instruction}),[send]);
  const programRun=useCallback((breakpoints:number[],maxCycles=90)=>send('programRun',{breakpoints,maxCycles}),[send]);
  const programCase=useCallback((caseId:string)=>send('programCase',{caseId}),[send]);
  return { ...state, tick, reset, replay,programStep,programRun,programCase };
}
