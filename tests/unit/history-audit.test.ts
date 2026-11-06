import { describe, expect, it } from 'vitest';
import {
  checkSource,
  findConflictMarkers,
  languageFor,
} from '../../scripts/audit-history.mjs';

describe('history audit language detection', () => {
  it('maps every supported source extension', () => {
    expect(languageFor('packages/core/src/index.ts')).toBe('ts');
    expect(languageFor('apps/desktop/src/App.tsx')).toBe('tsx');
    expect(languageFor('scripts/tool.mts')).toBe('ts');
    expect(languageFor('scripts/tool.cts')).toBe('ts');
    expect(languageFor('apps/web/src/main.jsx')).toBe('jsx');
    expect(languageFor('scripts/audit-history.mjs')).toBe('js');
    expect(languageFor('scripts/legacy.cjs')).toBe('js');
    expect(languageFor('packages/core/dist/index.js')).toBe('js');
    expect(languageFor('package.json')).toBe('json');
    expect(languageFor('tsconfig.jsonc')).toBe('json');
  });

  it('is case-insensitive and rejects non-source files', () => {
    expect(languageFor('APPS/DESKTOP/SRC/APP.TSX')).toBe('tsx');
    expect(languageFor('README.md')).toBeNull();
    expect(languageFor('scripts/install.sh')).toBeNull();
    expect(languageFor('Makefile')).toBeNull();
  });
});

describe('history audit conflict detection', () => {
  it('reports the line numbers of both conflict sides', () => {
    const source = [
      'const a = 1;',
      '<<<<<<< HEAD',
      'const b = 2;',
      '=======',
      'const b = 3;',
      '>>>>>>> feature',
      'const c = 4;',
    ].join('\n');
    expect(findConflictMarkers(source)).toEqual([2, 6]);
  });

  it('handles CRLF and marker lines with trailing labels', () => {
    expect(findConflictMarkers('ok\r\n<<<<<<< ours\r\n>>>>>>> theirs\r\n')).toEqual([2, 3]);
  });

  it('ignores indented markers and prose mentions', () => {
    const source = [
      '  <<<<<<< not a marker',
      'Use <<<<<<< only inside conflict examples.',
      '=======',
    ].join('\n');
    expect(findConflictMarkers(source)).toEqual([]);
  });
});

describe('history audit source checks', () => {
  it('accepts valid TypeScript, JavaScript, and JSON', () => {
    expect(checkSource('src/ok.ts', 'export const value: number = 1;\n')).toBeNull();
    expect(checkSource('src/ok.tsx', 'export const View = () => <div />;\n')).toBeNull();
    expect(checkSource('src/ok.mjs', '#!/usr/bin/env node\nexport const value = 1;\n')).toBeNull();
    expect(checkSource('package.json', '{ "name": "zoveli" }\n')).toBeNull();
    // The TypeScript parser accepts comments in JSON config files.
    expect(checkSource('tsconfig.json', '{\n  // comment\n  "compilerOptions": {}\n}\n')).toBeNull();
  });

  it('rejects invalid TypeScript with a location', () => {
    const problem = checkSource('src/broken.ts', 'export const value: = 1;\n');
    expect(problem).toMatch(/line 1/i);
  });

  it('rejects invalid JSON', () => {
    const problem = checkSource('package.json', '{ "name": }\n');
    expect(problem).toBeTruthy();
    expect(problem).not.toBe('merge-conflict marker');
  });

  it('rejects conflict markers before parsing', () => {
    expect(checkSource('src/ok.ts', '<<<<<<< HEAD\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> x\n'))
      .toBe('merge-conflict marker');
    expect(checkSource('README.md', '<<<<<<< HEAD\n>>>>>>> x\n')).toBe('merge-conflict marker');
  });

  it('leaves unsupported file types alone', () => {
    expect(checkSource('docs/README.md', '# Title\n')).toBeNull();
    expect(checkSource('scripts/install.sh', 'echo "unbalanced\n')).toBeNull();
  });
});
