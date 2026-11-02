import { describe, expect, it } from 'vitest';
import {
  extractWikiLinks,
  normalizeTags,
  parseMarkdownFile,
  sanitizeFilename,
  toMarkdownFile,
} from '../../packages/memory-store/src/markdown';

describe('memory Markdown codec', () => {
  it('parses frontmatter, timestamps, tags, and body hashtags', () => {
    const parsed = parseMarkdownFile(
      [
        '---',
        'title: "Plan"',
        'created: 2026-01-01T00:00:00.000Z',
        'updated: 2026-01-02T00:00:00.000Z',
        'tags: ["work", "#ideas"]',
        '---',
        'Body with #extra',
      ].join('\n'),
      'fallback'
    );

    expect(parsed.title).toBe('Plan');
    expect(parsed.tags).toEqual(['work', 'ideas', 'extra']);
    expect(parsed.created).toBe('2026-01-01T00:00:00.000Z');
    expect(parsed.updated).toBe('2026-01-02T00:00:00.000Z');
    expect(parsed.body).toContain('Body with #extra');
  });

  it('round-trips exported Markdown through the parser', () => {
    const created = '2026-01-01T00:00:00.000Z';
    const updated = '2026-01-02T00:00:00.000Z';
    const markdown = toMarkdownFile('A "quote"', 'Body', ['work'], ['Other'], created, updated);
    const parsed = parseMarkdownFile(markdown, 'fallback');

    expect(markdown).toContain('title: "A \'quote\'"');
    expect(markdown).toContain('## Links');
    expect(parsed.title).toBe("A 'quote'");
    expect(parsed.tags).toEqual(['work']);
    expect(parsed.created).toBe(created);
    expect(parsed.updated).toBe(updated);
  });

  it('sanitizes filenames, normalizes tags, and dedupes links', () => {
    expect(sanitizeFilename('a/b:c*?')).toBe('a_b_c__');
    expect(normalizeTags([' #work ', 'work', '#ideas', ''])).toEqual(['work', 'ideas']);
    expect(extractWikiLinks('[[One]] [[Two|label]] [[One]] [[bad[link]]')).toEqual([
      'One',
      'Two',
    ]);
  });
});
