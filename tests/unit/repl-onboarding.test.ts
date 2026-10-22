import { describe, expect, it } from 'vitest';
import { startupGuidance } from '../../packages/host/src/repl';

describe('startup guidance', () => {
  it('gives exact fixes when chat and math are both missing', () => {
    const text = startupGuidance({ chat: null, mathReady: false }).join('\n');
    expect(text).toContain('No chat model found');
    expect(text).toContain('ollama pull qwen3:4b');
    expect(text).toContain('OPENAI_API_KEY');
    expect(text).toContain('python -m pip install -e ./mathcore');
    expect(text).toContain('MATHCORE_MCP_COMMAND');
  });

  it('names a pinned Ollama model that is not installed', () => {
    const text = startupGuidance({
      chat: null,
      mathReady: true,
      requestedModel: 'mistral:7b',
    }).join('\n');
    expect(text).toContain('Requested Ollama model "mistral:7b" is not available');
    expect(text).toContain('ollama pull mistral:7b');
    expect(text).not.toContain('ollama pull qwen3:4b');
  });

  it('names the detected Ollama model and stays quiet when fully ready', () => {
    const lines = startupGuidance({
      chat: { provider: 'ollama', model: 'qwen3:4b' },
      mathReady: true,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('qwen3:4b');
    expect(lines[0]).toContain('no API key needed');
  });

  it('reports only the missing math backend when chat is configured', () => {
    const lines = startupGuidance({
      chat: { provider: 'deepseek', model: 'deepseek-chat' },
      mathReady: false,
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Chat enabled via deepseek');
    expect(lines[1]).toContain('Verified math is not ready');
  });
});
