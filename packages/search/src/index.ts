import { definePlugin } from '@deepseek-ai/dsh-core';
import { getStore } from '@zoveli/memory-store';

/**
 * zoveli-search: SQLite FTS5 search over the memory store.
 *
 * Legacy compatibility plugin: it only provides the `search` service.
 * The canonical `vault_search` tool is owned by @zoveli/memory-store.
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
  },
});

export default zoveliSearch;

