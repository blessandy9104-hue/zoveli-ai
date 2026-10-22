import { describe, expect, it } from 'vitest';
import { chatSetupReply, onboardingMarkup } from '../../apps/desktop/src/server/onboarding';

describe('web onboarding', () => {
  it('shows only the ready status when chat and math are configured', () => {
    const { status, panel } = onboardingMarkup({
      chat: { ready: true, provider: 'ollama', model: 'qwen3:4b' },
      math: { ready: true },
    });
    expect(panel).toBe('');
    expect(status).toContain('data-chat-ready="true"');
    expect(status).toContain('data-math-ready="true"');
    expect(status).toContain('verified math ready');
    expect(status).toContain('chat ready (qwen3:4b)');
    expect(status).not.toContain('Setup details');
  });

  it('gives the exact Ollama fix when chat is missing', () => {
    const { status, panel } = onboardingMarkup({
      chat: { ready: false },
      math: { ready: true },
    });
    expect(status).toContain('data-chat-ready="false"');
    expect(status).toContain('Setup details');
    expect(panel).toContain('data-testid="onboarding"');
    expect(panel).toContain('ollama pull qwen3:4b');
    expect(panel).toContain('https://ollama.com');
    expect(panel).not.toContain('python -m pip install');
  });

  it('names a pinned Ollama model that is missing', () => {
    const { panel } = onboardingMarkup({
      chat: { ready: false, requestedModel: 'mistral:7b' },
      math: { ready: true },
    });
    expect(panel).toContain(
      'The requested Ollama model <code>mistral:7b</code> is not installed'
    );
    expect(panel).toContain('ollama pull mistral:7b');
    expect(panel).not.toContain('ollama pull qwen3:4b');
  });

  it('escapes a pinned model in the setup panel', () => {
    const { panel } = onboardingMarkup({
      chat: { ready: false, requestedModel: '<b>x</b>' },
      math: { ready: true },
    });
    expect(panel).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(panel).not.toContain('<b>x</b>');
  });

  it('gives the exact mathcore fix when verified math is missing', () => {
    const { panel } = onboardingMarkup({
      chat: { ready: true, model: 'deepseek-chat' },
      math: { ready: false },
    });
    expect(panel).toContain('python -m pip install -e ./mathcore');
    expect(panel).toContain('MATHCORE_MCP_COMMAND');
    expect(panel).not.toContain('ollama pull qwen3:4b');
  });

  it('gives the pinned pull command in the chat setup reply', () => {
    expect(chatSetupReply('mistral:7b')).toContain('ollama pull mistral:7b');
    expect(chatSetupReply('mistral:7b')).not.toContain('qwen3:4b');
    expect(chatSetupReply('')).toContain('ollama pull qwen3:4b');
  });

  it('lists both fixes and escapes the model label', () => {
    const { status, panel } = onboardingMarkup({
      chat: { ready: true, model: '<script>alert(1)</script>' },
      math: { ready: false },
    });
    expect(panel).toContain('python -m pip install -e ./mathcore');
    expect(status).not.toContain('<script>');
    expect(status).toContain('&lt;script&gt;');
  });
});
