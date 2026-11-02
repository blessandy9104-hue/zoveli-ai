import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ZoveliHost,
  resolvePlugins,
  resolveChatConfig,
  configuredOllamaModel,
} from '@zoveli/host';
import { promptSectionsText } from '@zoveli/core';
import { zoveliAuth } from '@zoveli/auth';
import { mathcoreCommandAvailable } from '@zoveli/math-intelligence';
import { onboardingMarkup } from './onboarding.js';
import { renderHomePage } from './pages.js';
import { createRequestHandler } from './routes.js';
import { originForHost } from './security.js';

const PORT = parseInt(process.env.PORT || '3080', 10);
const HOST = process.env.HOST || '127.0.0.1';

// Vendored Lenis smooth-scroll runtime (same origin, pinned version).
// Resolves from dist/../../vendor in production and apps/desktop/vendor in dev.
function loadVendorLenis(): Buffer | null {
  // Works in CJS (tsc) and ESM (tsdown) outputs alike.
  const here =
    typeof __dirname === 'string' && __dirname
      ? __dirname
      : path.dirname(process.argv[1] || process.cwd());
  const candidates = [
    path.join(here, '..', '..', 'vendor', 'lenis.min.js'),
    path.join(here, '..', 'vendor', 'lenis.min.js'),
    path.join(process.cwd(), 'apps', 'desktop', 'vendor', 'lenis.min.js'),
  ];
  for (const file of candidates) {
    try {
      return fs.readFileSync(file);
    } catch {
      // try next
    }
  }
  return null;
}

const LENIS_BUNDLE = loadVendorLenis();

async function main(): Promise<void> {
  const host = new ZoveliHost();
  const agent = host.mount([...resolvePlugins(), zoveliAuth]);
  const systemSections = agent.systemSections;
  // Any API key wins; otherwise a free local Ollama server when one answers;
  // otherwise tools-only offline mode (probe refuses instantly when absent).
  const chatCfg = await resolveChatConfig();
  const requestedModel = configuredOllamaModel();
  const mathReady = mathcoreCommandAvailable();
  const onboarding = onboardingMarkup({
    chat: {
      ready: !!chatCfg,
      provider: chatCfg?.provider,
      model: chatCfg?.model,
      requestedModel,
    },
    math: { ready: mathReady },
  });
  // Onboarding is fixed at startup, so the whole home page is static too.
  const homePage = renderHomePage(onboarding);
  const baseSystem = [
    'You are Zoveli, a personal helper that shows its work in math and remembers what matters to you.',
    'For any arithmetic, algebra, calculus, linear algebra, number theory, logic, statistics or unit conversion: do not compute in your head. Call the mathcore tools and state only verified values. If a result is WITHHELD, say so; never guess.',
    promptSectionsText(),
    ...systemSections,
  ].join('\n\n');

  const handler = createRequestHandler({
    host,
    chatCfg,
    requestedModel,
    mathReady,
    homePage,
    baseSystem,
    lenisBundle: LENIS_BUNDLE,
    origin: originForHost(HOST, PORT),
  });
  const server = http.createServer(handler);

  server.listen(PORT, HOST, () => {
    console.log(`Zoveli web UI running at http://${HOST}:${PORT}`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
