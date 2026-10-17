/** 生成随机 ID（优先 crypto.randomUUID，HTTP 环境回退到 getRandomValues 拼接），用于节点/导线/组件。 */
export function createId(prefix: string): string {
  const value = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${value}`;
}
