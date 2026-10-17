// 声明式关卡注册表：编译 levelData.generated（源自 content/levels/*.json，见 npm run regen:levels）。
// 生成文件保证 Vite/vitest/Playwright 任何环境都能静态导入；校验或编译失败会抛出带关卡号的错误。
import type { Level } from './levels';
import { compileLevelSpec } from './levelSpec';
import { levelData } from './levelData.generated';

/** 编译全部 JSON 关卡（懒调用：首次访问 levels 数组时执行一次）。 */
export function specLevels(): Level[] {
  return levelData.map((spec, index) => {
    try {
      return compileLevelSpec(spec);
    } catch (error) {
      throw new Error(`content/levels 第 ${index + 1} 个文件：${(error as Error).message}`);
    }
  });
}
