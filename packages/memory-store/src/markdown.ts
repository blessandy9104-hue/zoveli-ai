import { SCHEMA_VERSION } from './database.js';

export interface ParsedMarkdown {
  title: string;
  body: string;
  tags: string[];
  created?: string;
  updated?: string;
}

export function sanitizeFilename(str: string): string {
  return str.replace(/[<>:"/\\|?*]/g, '_').trim();
}

export function normalizeTags(tags: string[] = []): string[] {
  const out = new Set<string>();
  for (const t of tags) {
    const v = String(t).trim().replace(/^#+/, '');
    if (v) out.add(v);
  }
  return [...out];
}

export function extractWikiLinks(body: string): string[] {
  // Linear scan instead of a nested-quantifier regex (ReDoS-safe).
  const out = new Set<string>();
  let i = 0;
  while (i < body.length) {
    const start = body.indexOf('[[', i);
    if (start === -1) break;
    const end = body.indexOf(']]', start + 2);
    if (end === -1) break;
    const inner = body.slice(start + 2, end);
    const pipe = inner.indexOf('|');
    const target = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
    if (target && !target.includes('[') && !target.includes(']')) {
      out.add(target);
      i = end + 2;
    } else {
      i = start + 2;
    }
  }
  return [...out];
}

function parseTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const clean = value.trim().replace(/^["']|["']$/g, '');
  return Number.isNaN(Date.parse(clean)) ? undefined : clean;
}

export function parseMarkdownFile(content: string, fallbackTitle: string): ParsedMarkdown {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  let title = fallbackTitle;
  let tags: string[] = [];
  let created: string | undefined;
  let updated: string | undefined;
  let body = content;
  if (fm) {
    const yaml = fm[1];
    const titleMatch = yaml.match(/title:\s*"([^"]+)"/) || yaml.match(/title:\s*(.+)/);
    if (titleMatch) title = titleMatch[1].trim().replace(/"/g, '');
    const tagsMatch = yaml.match(/tags:\s*\[([^\]]*)\]/);
    if (tagsMatch && tagsMatch[1].trim()) {
      tags = tagsMatch[1]
        .split(',')
        .map((t) => t.trim().replace(/"/g, '').replace(/^#+/, ''))
        .filter(Boolean);
    }
    created = parseTimestamp(yaml.match(/^created:\s*(.+)$/m)?.[1]);
    updated = parseTimestamp(yaml.match(/^updated:\s*(.+)$/m)?.[1]);
    body = content.slice(fm[0].length).trim();
  } else {
    const h1 = content.match(/^#\s+(.+)$/m);
    if (h1) title = h1[1].trim();
  }
  // Collect #hashtags in body as well (graph parity).
  const hashTags = [...body.matchAll(/#([\w-]+)/g)].map((m) => m[1]).slice(0, 20);
  const merged = [...new Set([...tags, ...hashTags])];
  return { title, body, tags: merged, created, updated };
}

export function toMarkdownFile(
  title: string,
  body: string,
  tags: string[],
  links: string[],
  created: string,
  updated: string
): string {
  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, "'")}"`,
    `created: ${created}`,
    `updated: ${updated}`,
    `schema: ${SCHEMA_VERSION}`,
    `tags: [${tags.map((t) => `"${t}"`).join(', ')}]`,
    '---',
    '',
  ].join('\n');
  const linkSection = links.length > 0 ? '\n## Links\n' + links.map((l) => `- [[${l}]]`).join('\n') : '';
  return frontmatter + body + linkSection;
}
