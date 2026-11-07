import { ZoveliHost } from '../host.js';
import { zoveliMathIntelligence } from '@zoveli/math-intelligence';
import {
  zoveliMathAlgebra,
  zoveliMathCalculus,
  zoveliMathStatistics,
  zoveliMathLogic,
  zoveliMathUnits,
  zoveliMathDiscrete,
  zoveliMathArithmetic,
  zoveliMathGeometry,
  zoveliMathTrigonometry,
  zoveliMathProbability,
  zoveliMathLinear,
  zoveliMathNumber,
} from '@zoveli/math-domains';

/**
 * Build a remote-only host that mounts nothing but the verified-math plugins.
 *
 * This is intentionally not `resolvePlugins()`: the desktop/CLI profiles also
 * mount memory, filesystem-adjacent, sysinfo, web, scheduler and other tools.
 * Loading only math here means an allowlist mistake cannot reach those
 * implementations at all (defence in depth), and the remote surface stays
 * separate from the desktop's local tool configuration.
 */
export function createRemoteMcpHost(): ZoveliHost {
  const host = new ZoveliHost();
  host.mount([
    zoveliMathIntelligence,
    zoveliMathAlgebra,
    zoveliMathCalculus,
    zoveliMathStatistics,
    zoveliMathLogic,
    zoveliMathUnits,
    zoveliMathDiscrete,
    zoveliMathArithmetic,
    zoveliMathGeometry,
    zoveliMathTrigonometry,
    zoveliMathProbability,
    zoveliMathLinear,
    zoveliMathNumber,
  ]);
  return host;
}
