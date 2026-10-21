import { definePlugin } from '@deepseek-ai/dsh-core';
import { getStore } from '@zoveli/memory-store';

/**
 * zoveli-search: SQLite FTS5 search over the memory store.
 *
 * Previously a dependency-free in-memory TF index over Markdown files
 * (watcher + 5-min rescan). Now a thin delegate to @zoveli/memory-store,
 * preserving the `vault_search` contract and the `search` service shape
 * (`search`/`reindex`/`indexNote`/`getStats`).
 */

export const zoveliSearch = definePlugin({
  name: 'zoveli-search',
  description: 'SQLite FTS5 full-text search for knowledge store',

  setup(ctx) {
    ctx.provide('search', {
      search: async (options: { query: string; tags?: string[]; limit?: number; offset?: number; highlight?: boolean }) => {
        return getStore().searchNotes(options).results;
      },
      reindex: async () => ({ ok: true, backend: 'sqlite-fts5' }),
      indexNote: async () => ({ ok: true }),
      getStats: () => ({
        indexedFiles: getStore().count(),
        backend: 'sqlite-fts5',
        lastReindex: new Date(),
      }),
    });

    ctx.register('search-tools', [
      {
        name: 'vault_search',
        description: 'Full-text search the knowledge store (ranked, SQLite FTS5)',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
            limit: { type: 'number', default: 10 },
            offset: { type: 'number', default: 0 },
          },
          required: ['query'],
        },
        async execute({ query, tags, limit, offset }: any) {
          return getStore().searchNotes({ query, tags, limit, offset }).results;
        },
      },
    ]);
  },
});

export default zoveliSearch;

