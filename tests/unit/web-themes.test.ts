import { describe, it, expect } from 'vitest';
import {
  THEMES,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  UNICORN_SDK_URL,
  DEFAULT_UNICORN_PROJECT,
  unicornProjectId,
  themeById,
  themeCSS,
  themeSwitcherHTML,
  themeHeadScript,
  themeBootScript,
} from '../../apps/desktop/src/server/themes';

const REQUIRED_VARS = ['--bg', '--fg', '--muted', '--accent', '--panel', '--border', '--badge-bg', '--badge-fg'];

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('interface themes', () => {
  it('ships daylight (default), midnight, forest, sunset, unicorn', () => {
    expect(THEMES.map((t) => t.id).sort()).toEqual(
      ['daylight', 'forest', 'midnight', 'sunset', 'unicorn'].sort()
    );
    expect(DEFAULT_THEME).toBe('daylight');
    expect(themeById('daylight').id).toBe('daylight');
  });

  it('falls back to daylight for unknown ids', () => {
    expect(themeById('nope').id).toBe('daylight');
  });

  it('every theme defines the full variable contract', () => {
    for (const t of THEMES) {
      for (const v of REQUIRED_VARS) {
        expect(t.vars[v], `${t.id} missing ${v}`).toBeDefined();
      }
      expect(['light', 'dark'], `${t.id} scheme`).toContain(t.scheme);
    }
  });

  it('keeps text and control boundaries above WCAG AA contrast', () => {
    for (const t of THEMES) {
      const bg = t.vars['--bg'];
      const panel = t.vars['--panel'];
      for (const v of ['--fg', '--muted', '--accent']) {
        expect(contrast(t.vars[v], bg), `${t.id} ${v} on bg`).toBeGreaterThanOrEqual(4.5);
        if (panel.startsWith('#')) {
          expect(contrast(t.vars[v], panel), `${t.id} ${v} on panel`).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(contrast(t.vars['--border'], bg), `${t.id} border on bg`).toBeGreaterThanOrEqual(3);
      if (panel.startsWith('#')) {
        expect(contrast(t.vars['--border'], panel), `${t.id} border on panel`).toBeGreaterThanOrEqual(3);
      }
      expect(
        contrast(t.vars['--badge-fg'], t.vars['--badge-bg']),
        `${t.id} badge contrast`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('exactly one theme needs the network (unicorn)', () => {
    expect(THEMES.filter((t) => t.unicorn).map((t) => t.id)).toEqual(['unicorn']);
  });

  it('css covers every theme plus Lenis and the backdrop', () => {
    const css = themeCSS();
    for (const t of THEMES) {
      expect(css).toContain(`html[data-theme="${t.id}"]`);
      expect(css).toContain(`color-scheme:${t.scheme}`);
    }
    expect(css).toContain('.lenis.lenis-smooth');
    expect(css).toContain('#us-bg');
  });

  it('css adds visible focus, screen-reader text, and reduced-motion fallbacks', () => {
    const css = themeCSS();
    expect(css).toContain(':focus-visible');
    expect(css).toContain('.sr-only');
    expect(css).toContain('.skip-link');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  it('switcher lists every theme with test ids and pressed state', () => {
    const html = themeSwitcherHTML();
    expect(html).toContain('data-testid="theme-switcher"');
    expect(html).toContain('role="status"');
    for (const t of THEMES) {
      expect(html).toContain(`data-testid="theme-option-${t.id}"`);
      expect(html).toContain(`aria-pressed="${t.id === DEFAULT_THEME ? 'true' : 'false'}"`);
    }
  });

  it('head script applies stored theme before paint', () => {
    const js = themeHeadScript();
    expect(js).toContain(THEME_STORAGE_KEY);
    expect(js).toContain('data-theme');
  });

  it('boot script lazily loads unicorn only, guards lenis', () => {
    const js = themeBootScript('proj123');
    expect(js).toContain(UNICORN_SDK_URL);
    expect(js).toContain('proj123');
    expect(js).toContain('window.Lenis');
    expect(js).toContain('DOMContentLoaded');
    expect(js).toContain('us-fallback');
  });

  it('boot script honors reduced-motion preferences', () => {
    const js = themeBootScript('proj123');
    expect(js).toContain('prefers-reduced-motion: reduce');
    expect(js).toContain('us-fallback');
    expect(js).toContain('initLenis');
  });

  it('unicorn project id honors env override', () => {
    const prev = process.env.ZOVELI_UNICORN_PROJECT;
    try {
      delete process.env.ZOVELI_UNICORN_PROJECT;
      expect(unicornProjectId()).toBe(DEFAULT_UNICORN_PROJECT);
      process.env.ZOVELI_UNICORN_PROJECT = '  custom-id-9 ';
      expect(unicornProjectId()).toBe('custom-id-9');
    } finally {
      if (prev === undefined) delete process.env.ZOVELI_UNICORN_PROJECT;
      else process.env.ZOVELI_UNICORN_PROJECT = prev;
    }
  });
});
