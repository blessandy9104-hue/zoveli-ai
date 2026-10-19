import { definePlugin } from '@deepseek-ai/dsh-core';
import { MemoryStore, getStore, resolveDbPath, resolveVaultPath, resetStoreForTests } from './store.js';

export { MemoryStore, getStore, resetStoreForTests, resolveDbPath, resolveVaultPath };
export * from './store.js';

export const zoveliMemoryStore = definePlugin({
  name: 'zoveli-memory-store',
  description: 'SQLite-backed local-first memory store with FTS5 (source of truth; vault is export mirror)',

  setup(ctx) {
    const store = getStore();
    ctx.register('memory-store-path', store.dbPath);
    ctx.register('memory-vault-path', store.vaultPath);
    ctx.provide('memory-store', store);

    // Back-compat service: old `memory` consumers keep working, now on SQLite.
    ctx.provide('memory', {
      createNote: (title: string, content: string, tags: string[] = [], links: string[] = []) =>
        store.createNote({ title, content, tags, links }),
      searchNotes: (query: string, tags: string[] = []) =>
        store.searchNotes({ query, tags, limit: 10 }).results.map((r) => ({ file: r.title, preview: r.content })),
      readNote: (title: string) => store.readNote(title).body,
      listTags: () => store.listTags(),
      updateNote: (title: string, content: string, tags?: string[], links?: string[]) =>
        store.updateNote({ title, content, tags, links }),
      deleteNote: (title: string) => store.deleteNote(title),
    });

    ctx.provide('search', {
      search: (options: { query: string; tags?: string[]; limit?: number; offset?: number; highlight?: boolean }) =>
        store.searchNotes(options).results,
      reindex: async () => ({ ok: true, backend: 'sqlite-fts5' }),
      indexNote: async () => ({ ok: true }),
      getStats: () => ({ indexedFiles: store.count(), backend: 'sqlite-fts5', lastReindex: new Date() }),
    });

    // Keep the dedicated graph plugin as the canonical owner of the `graph`
    // service and the `vault_graph` tool. The memory-store package provides
    // search/memory primitives only; registering either here would duplicate
    // `packages/graph/src/index.ts`, and the host's first-wins tool dedup
    // would shadow the graph plugin's vaultPath-aware implementation.

    ctx.register('memory-store-tools', [
      {
        name: 'memory_create_note',
        description: 'Create a note in the knowledge store (SQLite; mirrored to Markdown vault)',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Note title' },
            content: { type: 'string', description: 'Note content in Markdown' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for organization' },
            links: { type: 'array', items: { type: 'string' }, description: 'Wiki-style links to other notes' },
          },
          required: ['title', 'content'],
        },
        async execute({ title, content, tags = [], links = [] }: any) {
          return getStore().createNote({ title, content, tags, links });
        },
      },
      {
        name: 'memory_search',
        description: 'Search the knowledge store (FTS5 ranked + tag filter)',
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
        async execute({ query, tags = [], limit = 10, offset = 0 }: any) {
          const { results } = getStore().searchNotes({ query, tags, limit, offset });
          return { results: results.map((r) => ({ file: r.title, content: r.content, score: r.score, tags: r.tags })) };
        },
      },
      {
        name: 'memory_read_note',
        description: 'Read a specific note from the knowledge store',
        parameters: {
          type: 'object',
          properties: { title: { type: 'string', description: 'Note title or filename' } },
          required: ['title'],
        },
        async execute({ title }: any) {
          const n = getStore().readNote(title);
          return { content: `# ${n.title}\n\n${n.body}` };
        },
      },
      {
        name: 'memory_list_tags',
        description: 'List all tags used in the knowledge store',
        parameters: { type: 'object', properties: {} },
        async execute() {
          return getStore().listTags();
        },
      },
      {
        name: 'memory_update_note',
        description: 'Update a note (content/tags/links, optional rename via newTitle)',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            newTitle: { type: 'string' },
            content: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            links: { type: 'array', items: { type: 'string' } },
          },
          required: ['title'],
        },
        async execute(args: any) {
          return getStore().updateNote(args);
        },
      },
      {
        name: 'memory_delete_note',
        description: 'Delete a note from the knowledge store',
        parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
        async execute({ title }: any) {
          return getStore().deleteNote(title);
        },
      },
      {
        name: 'vault_search',
        description: 'Full-text search the knowledge store (ranked, SQLite FTS5)',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
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

export default zoveliMemoryStore;
