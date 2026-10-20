import * as readline from 'node:readline';
import type { ZoveliHost } from './host.js';
import { resolveChatConfig, chat } from './chat.js';
import { mathcore } from '@zoveli/core/mathcore-mcp';
import { promptSectionsText } from '@zoveli/core';

/** True for the error Node throws when piped stdin ends mid-session. */
function isReadlineClosed(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return (
    err?.code === 'ERR_USE_AFTER_CLOSE' || err?.message === 'readline was closed'
  );
}

const MATH_HINT =
  /\b(solve|derivative|integrat|differentiat|determinant|eigenvalu|prime|factor|gcd|lcm|simplify|expand|limit|matrix|statistic|convert|probability)\b/i;

function looksLikeMath(text: string): boolean {
  const t = text.trim();
  if (MATH_HINT.test(t)) return true;
  // bare arithmetic, e.g. "2+2", "(3+4)*5", "10!"
  return /^[0-9\s+\-*/^().!%]+$/.test(t) && /\d/.test(t) && /[+\-*/^!%]/.test(t);
}

const HELP = `zoveli commands:
  /help                 show this help
  /tools                list available tools
  /math <expression>    verified computation (mathcore, offline)
  /mcp                  mathcore MCP pool status (pid, restarts, last error)
  /health               runtime health rollup (config, vault, pool, capabilities)
  /trace                recent tool calls and failures
  /check <q> ;; <a>     audit a proposed answer against mathcore
  /sys                  host snapshot (OS/CPU/RAM/disk/GPU)
  /caps                 capability summary
  /persona [name]       show or switch persona (friend, tutor, engineer, coach)
  /quit                 exit
Anything else: chat (any API key, or free local Ollama) or math when it looks like math.`;

export async function runRepl(host: ZoveliHost, agent: { systemSections: string[] }): Promise<void> {
  const chatCfg = await resolveChatConfig();
  const baseSystem = [
    'You are Zoveli, a personal helper that shows its work in math and remembers what matters to you.',
    'For any arithmetic, algebra, calculus, linear algebra, number theory, logic, statistics or unit conversion: do not compute in your head. Call the mathcore tools and state only verified values. If a result is WITHHELD, say so; never guess.',
    promptSectionsText(),
    ...agent.systemSections,
  ].join('\n\n');

  console.log('zoveli — local-first assistant. Type /help for commands, /quit to exit.'); // banner: keep 'local-first assistant' substring (e2e asserts it)
  if (!chatCfg) {
    console.log(
      'No chat model found: all local tools work ' +
        '(math, memory, sysinfo, languages, search, scheduler, ...). ' +
        'For free offline chat set any API key (OPENAI_API_KEY, DEEPSEEK_API_KEY, ' +
        'OPENROUTER_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY or ZOVELI_API_KEY), or ' +
        'install Ollama (https://ollama.com) and run: ollama pull qwen3:4b'
    );
  } else if (chatCfg.provider === 'ollama') {
    console.log(
      `Local Ollama detected: free offline chat enabled (model ${chatCfg.model}), no API key needed.`
    );
  } else {
    console.log(`Chat enabled via ${chatCfg.provider} (model ${chatCfg.model}).`);
  }
  // First-30-seconds starters (TTY only, so piped/batch output stays
  // byte-identical for scripts and tests): show what to try first.
  if (process.stdin.isTTY) {
    console.log('Try in 30 seconds (all offline, math is verified or withheld):');
    console.log('  /math solve x^2 - 5x + 6 = 0   proven answer + certificate');
    console.log('  /sys                           this machine: OS/CPU/RAM/disk/GPU');
    console.log('  /tools                         every local tool (~63), no API key needed');
  }

  // Created lazily in TTY mode only: an Interface starts consuming stdin
  // immediately, which would steal bytes from batch mode below.
  let rl: readline.Interface | null = null;
  const shutdown = () => {
    try {
      mathcore.stop();
    } catch {
      // already stopped
    }
    try {
      rl?.close();
    } catch {
      // already closed
    }
    // ZOVELI_DEBUG=1 dumps live handles so a hung shutdown names its owner.
    if (process.env.ZOVELI_DEBUG === '1') {
      try {
        const handles = (process as any)._getActiveHandles?.() ?? [];
        const kinds = handles.map((h: any) => h?.constructor?.name ?? typeof h);
        console.error(`[zoveli-debug] shutdown with ${handles.length} live handles: ${kinds.join(',')}`);
      } catch {
        // diagnostics must never break shutdown
      }
    }
  };
  process.once('SIGINT', () => {
    shutdown();
    process.exit(0);
  });

  let history: any[] = [];

  const handleLine = async (raw: string): Promise<boolean> => {
    const text = raw.trim();
    if (!text) return true;
    try {
      if (text === '/quit' || text === '/exit') return false;
      if (text === '/help') {
        console.log(HELP);
      } else if (text === '/tools') {
        for (const t of host.tools()) {
          console.log(`- ${t.name}  [${t.plugin}]`);
        }
      } else if (text === '/caps') {
        try {
          const caps = await host.runTool('capability_scan', { deep: false });
          const list = caps as any[];
          const ok = list.filter((c: any) => c.status === 'available').length;
          console.log(`${ok}/${list.length} capabilities available`);
        } catch {
          console.log('capability scan unavailable in this profile');
        }
      } else if (text === '/persona' || text.startsWith('/persona ')) {
        const name = text.slice('/persona'.length).trim();
        try {
          if (!name) {
            console.log(JSON.stringify(await host.runTool('persona_current', {})));
          } else {
            console.log(JSON.stringify(await host.runTool('persona_switch', { persona: name })));
          }
        } catch {
          console.log('personas unavailable in this profile (choose friend, tutor, engineer, or coach)');
        }
      } else if (text === '/sys') {
        console.log(JSON.stringify(await host.runTool('sysinfo_snapshot', {}), null, 2).slice(0, 2000));
      } else if (text.startsWith('/math ')) {
        console.log(await host.runTool('mathcore_compute', { expression: text.slice(6) }));
      } else if (text === '/mcp') {
        const s = mathcore.status();
        console.log(
          `mathcore MCP: ${s.running ? `running (pid ${s.pid})` : 'stopped'} · ` +
            `spawns ${s.spawns} · restarts ${s.restarts} · pending ${s.pending}` +
            (s.lastError ? ` · last error: ${s.lastError}` : '')
        );
      } else if (text === '/health') {
        const report = (await host.runTool('health_report', { probeMathcore: false })) as any;
        console.log(`health: ${report.status} (${report.checkedAt})`);
        for (const check of report.checks ?? []) {
          console.log(`  [${check.level}] ${check.title}: ${check.summary}`);
        }
      } else if (text === '/trace') {
        const stats = host.toolStats(10);
        const avg = stats.calls > 0 ? Math.round(stats.totalMs / stats.calls) : 0;
        console.log(
          `tool calls: ${stats.calls} · failures: ${stats.failures} · avg ${avg}ms` +
            (stats.lastError ? ` · last error: ${stats.lastError}` : '')
        );
        for (const call of stats.recent) {
          const outcome = call.ok ? 'ok  ' : 'FAIL';
          const error = call.error ? ` — ${call.error}` : '';
          console.log(
            `  ${call.at.slice(11, 19)} ${outcome} ${call.tool} ${call.durationMs}ms${error}`
          );
        }
      } else if (text.startsWith('/check ')) {
        const rest = text.slice(7);
        const sep = rest.indexOf(';;');
        if (sep < 0) {
          console.log('usage: /check <question> ;; <proposed answer>');
        } else {
          console.log(
            await host.runTool('mathcore_check_answer', {
              question: rest.slice(0, sep).trim(),
              answer: rest.slice(sep + 2).trim(),
            })
          );
        }
      } else if (looksLikeMath(text)) {
        console.log(await host.runTool('mathcore_compute', { expression: text }));
      } else if (chatCfg) {
        history = await chat(host, chatCfg, baseSystem, history, text, (kind, out) => {
          console.log(kind === 'tool' ? `  [tool ${out}]` : out);
        });
      } else {
        console.log(
          'That looks like a chat request, but no chat model is configured.\n' +
            'Set any API key (OPENAI_API_KEY, DEEPSEEK_API_KEY, OPENROUTER_API_KEY, ' +
            'GROQ_API_KEY, TOGETHER_API_KEY or ZOVELI_API_KEY with ZOVELI_API_BASE), ' +
            'or run local Ollama for free: ollama pull qwen3:4b\n' +
            'Meanwhile try: /math 2+2 · /sys · /tools · /help'
        );
      }
    } catch (e) {
      console.log(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
    return true;
  };

  if (!process.stdin.isTTY) {
    // Batch mode (piped stdin): consume the stream incrementally so an
    // always-open pipe (e.g. a test harness holding stdin) does not block
    // startup, and EOF arriving mid-tool-call cannot discard buffered
    // lines the way readline's async iterator does.
    await new Promise<void>((resolve) => {
      let remainder = '';
      let busy = false;
      let ended = false;
      let quit = false;
      const queue: string[] = [];
      const pump = async (): Promise<void> => {
        if (busy) return;
        busy = true;
        try {
          while (queue.length > 0 && !quit) {
            const raw = queue.shift() as string;
            const cont = await handleLine(raw);
            if (!cont) {
              quit = true;
            }
          }
        } finally {
          busy = false;
        }
        if (quit || (ended && queue.length === 0)) {
          shutdown();
          resolve();
        }
      };
      process.stdin.setEncoding('utf-8');
      process.stdin.on('data', (chunk: string) => {
        remainder += chunk;
        const parts = remainder.split(/\r?\n/);
        remainder = parts.pop() ?? '';
        queue.push(...parts);
        void pump();
      });
      process.stdin.on('end', () => {
        if (remainder.trim()) queue.push(remainder);
        remainder = '';
        ended = true;
        void pump();
      });
      process.stdin.on('error', () => {
        ended = true;
        void pump();
      });
      process.stdin.resume();
    });
    // Detach so an always-open pipe cannot hold the event loop after quit.
    // Order matters on Linux: destroy() releases the pipe handle itself
    // (paused stdio pipes have been observed keeping the loop alive there),
    // while removeAllListeners stops our own callbacks first.
    process.stdin.removeAllListeners('data');
    process.stdin.removeAllListeners('end');
    process.stdin.removeAllListeners('error');
    try {
      process.stdin.destroy();
    } catch {
      // already gone
    }
    process.stdin.pause();
    // Backstop: if any handle still pins the loop (platform drain quirks),
    // leave deterministically instead of hanging forever. Unref'd so a
    // clean drain exits on its own first.
    setTimeout(() => process.exit(0), 250).unref();
    return;
  }

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chatCfg ? 'zoveli> ' : 'zoveli (tools-only, no chat model)> ',
  });
  rl.prompt();
  try {
    for await (const line of rl) {
      const cont = await handleLine(line);
      if (!cont) break;
      rl.prompt();
    }
  } catch (e) {
    // Piped stdin ended while a tool call was in flight: the readline
    // iterator throws. That is a clean EOF, not a failure.
    if (!isReadlineClosed(e)) throw e;
  } finally {
    shutdown();
  }
}

