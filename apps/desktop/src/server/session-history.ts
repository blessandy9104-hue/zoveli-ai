import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { sessionTokenFromCookie, verifySession } from '@zoveli/auth';
import type { ChatMessage } from '@zoveli/host';

/** Keep the last 20 user turns while allowing up to 40 messages. */
export const DEFAULT_HISTORY_MESSAGE_CAP = 40;
/** Bound abandoned/expired conversations in a long-running process. */
export const DEFAULT_SESSION_CAP = 200;

/**
 * Trim to the newest complete user turn.
 *
 * Starting at a fixed message offset could leave a tool result without the
 * assistant tool call that produced it, which providers reject. Moving
 * forward to the next user message keeps every retained turn self-contained.
 */
export function trimHistory(
  messages: readonly ChatMessage[],
  maxMessages = DEFAULT_HISTORY_MESSAGE_CAP
): ChatMessage[] {
  if (!Number.isInteger(maxMessages) || maxMessages < 1) return [];
  if (messages.length <= maxMessages) return [...messages];

  let start = messages.length - maxMessages;
  while (start < messages.length && messages[start].role !== 'user') start += 1;
  return messages.slice(start);
}

/**
 * Stable, non-reversible identity for a caller's conversation.
 *
 * Sessions are keyed by the validated session token rather than the email so
 * two logins for the same account (or two browsers) do not share context.
 * Only the token itself is hashed, so unrelated cookies cannot churn keys.
 * Bearer credentials are hashed for the same reason; anonymous local callers
 * fall back to their socket address.
 */
export function conversationKey(req: IncomingMessage): string {
  const token = sessionTokenFromCookie(req.headers.cookie);
  if (token && verifySession(token)) {
    return `session:${digest(token)}`;
  }
  const authorization = req.headers.authorization || '';
  if (authorization) {
    return `bearer:${digest(authorization)}`;
  }
  return `client:${req.socket?.remoteAddress || 'unknown'}`;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Per-conversation chat history with a message cap and LRU session cap. */
export class ConversationHistoryStore {
  private readonly histories = new Map<string, ChatMessage[]>();

  constructor(
    private readonly maxMessages = DEFAULT_HISTORY_MESSAGE_CAP,
    private readonly maxSessions = DEFAULT_SESSION_CAP
  ) {}

  get size(): number {
    return this.histories.size;
  }

  /** Read a conversation and mark it as most recently used. */
  get(key: string): ChatMessage[] {
    const history = this.histories.get(key);
    if (!history) return [];
    this.histories.delete(key);
    this.histories.set(key, history);
    return [...history];
  }

  /** Replace a conversation with its newest complete turns. */
  set(key: string, messages: readonly ChatMessage[]): void {
    const trimmed = trimHistory(messages, this.maxMessages);
    this.histories.delete(key);
    if (trimmed.length === 0) return;
    this.histories.set(key, trimmed);
    while (this.histories.size > this.maxSessions) {
      const oldest = this.histories.keys().next().value;
      if (oldest === undefined) break;
      this.histories.delete(oldest);
    }
  }

  clear(key: string): boolean {
    return this.histories.delete(key);
  }
}
