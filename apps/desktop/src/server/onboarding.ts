export interface OnboardingState {
  chat: {
    ready: boolean;
    provider?: string | null;
    model?: string | null;
    requestedModel?: string | null;
  };
  math: {
    ready: boolean;
  };
}

export interface OnboardingMarkup {
  status: string;
  panel: string;
}

const DEFAULT_CHAT_MODEL = 'qwen3:4b';

/** Plain-text setup reply for a chat attempt before a model is configured. */
export function chatSetupReply(requestedModel?: string | null): string {
  const requested = (requestedModel || '').trim();
  return (
    'Chat is not configured yet. Local tools and verified math work now. ' +
    (requested ? `The requested Ollama model "${requested}" is not installed. ` : '') +
    'For free offline chat, install Ollama (https://ollama.com), run ' +
    `ollama pull ${requested || DEFAULT_CHAT_MODEL}, then restart Zoveli. ` +
    'Any OpenAI-compatible API key also works.'
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export function onboardingMarkup(state: OnboardingState): OnboardingMarkup {
  const bits = ['Local tools ready'];
  bits.push(state.math.ready ? 'verified math ready' : 'verified math needs setup');
  if (state.chat.ready) {
    const model = state.chat.model ? ` (${escapeHtml(state.chat.model)})` : '';
    bits.push(`chat ready${model}`);
  } else {
    bits.push('chat needs a model');
  }
  const needsSetup = !state.chat.ready || !state.math.ready;
  const status =
    `<p class="onboard-status" data-testid="onboarding-status" ` +
    `data-chat-ready="${state.chat.ready}" data-math-ready="${state.math.ready}">` +
    `${bits.join(' · ')}${needsSetup ? ' — <a href="#setup">Setup details</a>' : ''}</p>`;

  if (!needsSetup) return { status, panel: '' };

  const items: string[] = [];
  if (!state.math.ready) {
    items.push(
      '<li><strong>Verified math</strong> — mathcore-mcp was not found. From the repo root, ' +
        'activate a Python 3.11+ venv and run <code>python -m pip install -e ./mathcore</code>, ' +
        'or set <code>MATHCORE_MCP_COMMAND</code> to the binary path. Then restart Zoveli.</li>'
    );
  }
  if (!state.chat.ready) {
    const requested = (state.chat.requestedModel || '').trim();
    const lead = requested
      ? `The requested Ollama model <code>${escapeHtml(requested)}</code> is not installed. `
      : '';
    const pull = escapeHtml(requested || DEFAULT_CHAT_MODEL);
    items.push(
      '<li><strong>Chat</strong> — local tools work now. ' +
        lead +
        'For free offline chat, install <a href="https://ollama.com">Ollama</a>, run ' +
        `<code>ollama pull ${pull}</code>, then restart Zoveli. ` +
        'Any OpenAI-compatible API key also works.</li>'
    );
  }
  const panel =
    '<section id="setup" class="setup" data-testid="onboarding" aria-labelledby="setup-heading">' +
    '<h2 id="setup-heading">Finish setup</h2>' +
    '<p>Zoveli already runs local tools and keeps everything on this machine. ' +
    'These optional pieces unlock the rest:</p>' +
    `<ul>${items.join('')}</ul>` +
    '<p>Check anytime: <code>pnpm run doctor</code> · <code>pnpm health:check</code></p>' +
    '</section>';
  return { status, panel };
}
