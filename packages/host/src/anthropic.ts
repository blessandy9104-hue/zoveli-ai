import type { ChatConfig, ChatMessage } from './chat.js';

/**
 * Native Anthropic Messages API adapter.
 *
 * Zoveli's chat loop speaks the OpenAI chat-completions shape. Anthropic's
 * API differs in three places that matter here: the system prompt is a
 * top-level field, tool calls are content blocks, and tool results are user
 * messages. This module translates in both directions so the rest of the
 * host (tool dispatch, memory brief, guard) is provider-agnostic.
 *
 * Only the chat model moves to the cloud. Verified math still runs through
 * the local mathcore MCP process.
 */

export interface ChatTurn {
  content: string | null;
  tool_calls?: ChatMessage['tool_calls'];
}

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicBlock[];
}

export interface AnthropicRequestShape {
  system: string;
  messages: AnthropicMessage[];
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function contentText(content: string | null | undefined): string {
  return content ?? '';
}

/**
 * Convert OpenAI-shaped history into Anthropic's shape. Consecutive tool
 * results are merged into one user turn, which is what the Messages API
 * expects after a parallel tool-use block. System messages are hoisted.
 */
export function toAnthropicMessages(messages: ChatMessage[]): AnthropicRequestShape {
  const systemParts: string[] = [];
  const converted: AnthropicMessage[] = [];
  let pendingToolResults: AnthropicBlock[] = [];

  const flushToolResults = () => {
    if (pendingToolResults.length === 0) return;
    converted.push({ role: 'user', content: pendingToolResults });
    pendingToolResults = [];
  };

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content) systemParts.push(message.content);
      continue;
    }
    if (message.role === 'tool') {
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: message.tool_call_id || '',
        content: contentText(message.content),
      });
      continue;
    }
    flushToolResults();
    if (message.role === 'user') {
      converted.push({ role: 'user', content: contentText(message.content) });
      continue;
    }
    const blocks: AnthropicBlock[] = [];
    if (message.content) blocks.push({ type: 'text', text: message.content });
    for (const call of message.tool_calls ?? []) {
      blocks.push({
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input: safeJsonParse(call.function.arguments),
      });
    }
    if (blocks.length > 0) converted.push({ role: 'assistant', content: blocks });
  }
  flushToolResults();
  return { system: systemParts.join('\n\n'), messages: converted };
}

/** Convert an Anthropic response body into the OpenAI-shaped turn the loop uses. */
export function fromAnthropicResponse(payload: unknown): ChatTurn {
  const blocks = (payload as { content?: unknown } | null)?.content;
  if (!Array.isArray(blocks)) throw new Error('chat API returned no content blocks');

  const text: string[] = [];
  const toolCalls: NonNullable<ChatTurn['tool_calls']> = [];
  for (const raw of blocks) {
    const block = raw as { type?: string; text?: string; id?: string; name?: string; input?: unknown };
    if (block.type === 'text' && typeof block.text === 'string') {
      text.push(block.text);
    } else if (block.type === 'tool_use' && typeof block.name === 'string') {
      toolCalls.push({
        id: block.id ?? `tool_${toolCalls.length + 1}`,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      });
    }
  }
  const joined = text.join('\n');
  return {
    content: joined || null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}

export function anthropicTools(
  tools: readonly {
    type: 'function';
    function: { name: string; description: string; parameters: unknown };
  }[]
): { name: string; description: string; input_schema: unknown }[] {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

export function chatMaxTokens(raw = process.env.ZOVELI_MAX_TOKENS): number {
  const parsed = parseInt(raw || '', 10);
  if (!Number.isFinite(parsed)) return 4096;
  return Math.min(8192, Math.max(256, parsed));
}

export async function postAnthropicTurn(
  cfg: ChatConfig,
  messages: ChatMessage[],
  tools: readonly {
    type: 'function';
    function: { name: string; description: string; parameters: unknown };
  }[],
  temperature: number,
  timeoutMs: number
): Promise<ChatTurn> {
  const { system, messages: converted } = toAnthropicMessages(messages);
  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: chatMaxTokens(),
    temperature,
    messages: converted,
  };
  if (system) body.system = system;
  if (tools.length > 0) body.tools = anthropicTools(tools);

  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`chat API error ${res.status}: ${detail.slice(0, 300)}`);
  }
  return fromAnthropicResponse(await res.json());
}
