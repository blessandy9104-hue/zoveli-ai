import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import type { ChatMessage } from '../../packages/host/src/chat';
import { mintSession } from '../../packages/auth/src/session';
import {
  ConversationHistoryStore,
  conversationKey,
  trimHistory,
} from '../../apps/desktop/src/server/session-history';

function message(role: ChatMessage['role'], content: string): ChatMessage {
  return { role, content };
}

function turn(index: number): ChatMessage[] {
  return [message('user', `q${index}`), message('assistant', `a${index}`)];
}

function request(cookie = '', authorization = '', address = '127.0.0.1'): IncomingMessage {
  return {
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(authorization ? { authorization } : {}),
    },
    socket: { remoteAddress: address },
  } as IncomingMessage;
}

describe('chat history trimming', () => {
  it('keeps the newest complete turns under the message cap', () => {
    const history = Array.from({ length: 30 }, (_, index) => turn(index)).flat();
    const trimmed = trimHistory(history, 40);
    expect(trimmed).toHaveLength(40);
    expect(trimmed[0]).toMatchObject({ role: 'user', content: 'q10' });
    expect(trimmed.at(-1)).toMatchObject({ role: 'assistant', content: 'a29' });
  });

  it('does not start with an orphaned tool result', () => {
    const history = [
      message('user', 'first'),
      message('assistant', 'answer one'),
      message('user', 'calculate'),
      message('assistant', ''),
      message('tool', '42'),
      message('assistant', 'done'),
    ];
    const trimmed = trimHistory(history, 5);
    expect(trimmed[0]).toMatchObject({ role: 'user', content: 'calculate' });
    expect(trimmed).toHaveLength(4);
  });

  it('returns an empty history for a non-positive cap', () => {
    expect(trimHistory([message('user', 'hello')], 0)).toEqual([]);
    expect(trimHistory([message('user', 'hello')], -3)).toEqual([]);
  });
});

describe('conversation history store', () => {
  it('isolates conversations by key', () => {
    const store = new ConversationHistoryStore();
    store.set('alice', turn(1));
    store.set('bob', turn(2));

    expect(store.get('alice').map((m) => m.content)).toEqual(['q1', 'a1']);
    expect(store.get('bob').map((m) => m.content)).toEqual(['q2', 'a2']);
    expect(store.get('nobody')).toEqual([]);
  });

  it('caps retained messages and evicts the least recently used session', () => {
    const store = new ConversationHistoryStore(4, 2);
    store.set('a', [...turn(1), ...turn(2), ...turn(3)]);
    store.set('b', turn(4));
    expect(store.get('a')).toHaveLength(4);
    expect(store.get('a')[0].content).toBe('q2');

    store.get('a');
    store.set('c', turn(5));
    expect(store.size).toBe(2);
    expect(store.get('b')).toEqual([]);
    expect(store.get('a')).toHaveLength(4);
  });

  it('returns copies so callers cannot mutate stored state', () => {
    const store = new ConversationHistoryStore();
    store.set('a', turn(1));
    const copy = store.get('a');
    copy.length = 0;
    expect(store.get('a')).toHaveLength(2);
    expect(store.clear('a')).toBe(true);
    expect(store.get('a')).toEqual([]);
  });
});

describe('conversation identity', () => {
  const previousSecret = process.env.ZOVELI_AUTH_SECRET;

  beforeEach(() => {
    process.env.ZOVELI_AUTH_SECRET = 'test-session-secret-at-least-16';
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.ZOVELI_AUTH_SECRET;
    else process.env.ZOVELI_AUTH_SECRET = previousSecret;
  });

  it('separates distinct login cookies and bearer credentials', () => {
    const first = `zoveli_session=${mintSession('user@example.com')}`;
    const second = `zoveli_session=${mintSession('user@example.com')}`;
    expect(conversationKey(request(first))).not.toBe(conversationKey(request(second)));
    expect(conversationKey(request('', 'Bearer token-one'))).not.toBe(
      conversationKey(request('', 'Bearer token-two'))
    );
  });

  it('is stable for the same credential and falls back to the client address', () => {
    const cookie = `zoveli_session=${mintSession('user@example.com')}`;
    expect(conversationKey(request(cookie))).toBe(conversationKey(request(cookie)));
    expect(conversationKey(request('', '', '127.0.0.2'))).toBe(
      conversationKey(request('', '', '127.0.0.2'))
    );
    expect(conversationKey(request('', '', '127.0.0.2'))).not.toBe(
      conversationKey(request('', '', '127.0.0.3'))
    );
  });

  it('ignores unrelated cookies and cookie ordering', () => {
    const token = mintSession('user@example.com');
    const first = `theme=dark; zoveli_session=${token}; other=1`;
    const reordered = `other=1; zoveli_session=${token}; theme=dark`;
    expect(conversationKey(request(first))).toBe(conversationKey(request(reordered)));
  });

  it('uses the client address when the session cookie is invalid', () => {
    expect(conversationKey(request('zoveli_session=garbage; theme=dark'))).toBe(
      conversationKey(request('theme=light'))
    );
  });
});
