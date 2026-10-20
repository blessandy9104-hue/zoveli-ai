// Minimal line-delimited JSON-RPC MCP server used by transport/pool tests.
// No shebang on purpose: GitHub's Windows checkout uses CRLF and a shebang
// breaks Vitest/Node module loading for files imported by tests.
import { appendFileSync } from 'node:fs';

if (process.env.FAKE_MCP_LOG) {
  appendFileSync(process.env.FAKE_MCP_LOG, `${process.pid}\n`);
}
if (process.env.FAKE_MCP_EXIT_IMMEDIATELY === '1') {
  process.exit(3);
}

const delayMs = Number(process.env.FAKE_MCP_DELAY_MS || '0');
const crashOn = process.env.FAKE_MCP_CRASH_ON || '';
let buffer = '';

function respond(id, result) {
  const payload = JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n';
  if (delayMs > 0) {
    setTimeout(() => process.stdout.write(payload), delayMs);
  } else {
    process.stdout.write(payload);
  }
}

function handle(line) {
  if (crashOn && line.includes(crashOn)) {
    process.exit(7);
  }
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === 'tools/list') {
    respond(msg.id, { tools: [{ name: 'compute' }, { name: 'check_answer' }] });
    return;
  }
  if (msg.method === 'tools/call') {
    const args = (msg.params && msg.params.arguments) || {};
    const request = String(args.request ?? args.question ?? '');
    const name = (msg.params && msg.params.name) || 'unknown';
    respond(msg.id, {
      content: [{ type: 'text', text: `fake:${name}:${request}` }],
    });
    return;
  }
  respond(msg.id, {});
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) handle(line);
  }
});
