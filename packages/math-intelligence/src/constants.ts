import * as os from 'node:os';
import * as path from 'node:path';
import { commandParts, resolveMathcoreCommand } from './resolve.js';

// ---------------------------------------------------------------------------
// ONE AI math intelligence subsystem: every value below is the single source
// of truth for how the TypeScript side reaches the Python mathcore engine.
// packages/math re-exports these (back-compat shim); transport, tools,
// intelligence, and the MCP plugin all reference these — never literals.
// ---------------------------------------------------------------------------

/** Binary that serves verified math over stdio JSON-RPC (pip: ./mathcore). */
export const MATHCORE_MCP_COMMAND = 'mathcore-mcp';

/** Logical server id used in every registration. */
export const MATHCORE_MCP_SERVER_ID = 'mathcore';

/** Where mathcore writes its hash-chained audit certificates by default. */
export function defaultMathcoreAuditPath(): string {
  return process.env.MATHCORE_AUDIT || path.join(os.homedir(), '.mathcore', 'audit.jsonl');
}

/** The one MATH RULES text injected into every agent. Verbatim. */
export const MATH_RULES = `MATH RULES: For any arithmetic, algebra, calculus, linear algebra, number theory, logic, statistics or unit conversion:
1. DO NOT compute in your head
2. CALL mathcore_compute with the request
3. STATE ONLY values it returns as VERIFIED
4. If WITHHELD, say result could not be verified; DO NOT GUESS
5. Before stating any numeric/symbolic result, CALL mathcore_check_answer and correct if MISMATCH`;

/** Extra guidance for the intelligence layer (recall before compute). */
export const MATH_INTELLIGENCE_RULES = `MATH INTELLIGENCE: Before computing, CALL math_recall with the question to reuse verified proofs from memory. After a VERIFIED result, it is memorized automatically (disable with ZOVELI_MATH_MEMORIZE=0). Never state UNVERIFIED numbers as verified.`;

/** The one stdio config for spawning the mathcore server. Shape is frozen:
 * tests assert config.command, and downstream registrations read serverName.
 * The command comes from `resolveMathcoreCommand()` so PATH/venv/.env
 * resolution matches the persistent transport. */
export function mathcoreServerConfig() {
  const { command, args } = commandParts(resolveMathcoreCommand());
  return {
    id: 'mathcore-mcp',
    name: '@deepseek-ai/dsh-mcp-client',
    config: {
      serverName: MATHCORE_MCP_SERVER_ID,
      transport: 'stdio',
      command,
      args,
      cwd: process.cwd(),
      env: {
        MATHCORE_AUDIT: defaultMathcoreAuditPath(),
      },
    },
  };
}
