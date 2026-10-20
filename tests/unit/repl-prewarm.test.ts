import { describe, expect, it } from 'vitest';
import { shouldPrewarmMathcore } from '../../packages/host/src/repl';

describe('mathcore prewarm gate', () => {
  it('warms interactive sessions by default when the binary exists', () => {
    expect(shouldPrewarmMathcore({}, true, true)).toBe(true);
    expect(shouldPrewarmMathcore({ ZOVELI_MATHCORE_PREWARM: '1' }, true, true)).toBe(true);
  });

  it('skips batch runs', () => {
    expect(shouldPrewarmMathcore({}, false, true)).toBe(false);
  });

  it('honors the opt-out and a missing binary', () => {
    expect(shouldPrewarmMathcore({ ZOVELI_MATHCORE_PREWARM: '0' }, true, true)).toBe(false);
    expect(shouldPrewarmMathcore({}, true, false)).toBe(false);
  });
});
