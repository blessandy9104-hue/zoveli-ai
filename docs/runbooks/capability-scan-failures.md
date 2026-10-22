# Runbook: Capability Scan Failures

## Symptoms
- `capability_scan` returns an empty list
- `capability_check` reports a tool-group capability missing
- Agent says it has no capabilities

## How discovery works now
Capabilities come from the live tool registry, not a hardcoded inventory.
`ZoveliHost` provides `tool-inventory`; the scanner maps mounted tools to
capability groups. If no inventory provider exists, the scan returns an empty
list rather than inventing capabilities.

## Diagnosis

### 1. Check the live tool list
In the CLI, run `/tools`. It should show 58 default tools. The desktop mounts
two auth tools on top, so `GET /api/tools` returns 60 as JSON.

### 2. Scan and inspect
```text
capability_scan {}
capability_check {"capability":"mathcore.verified-compute","details":true}
```

If the tool is present but the capability is missing, check the capability
name in `packages/capability/src/scanner.ts` and the tool name in the owning
plugin.

### 3. Check plugin mounting
```powershell
node --input-type=module -e "import { defaultPlugins } from './packages/host/dist/index.js'; console.log(defaultPlugins.map(p=>p.name).join('\n'))"
```

Expected: 26 plugins. If a plugin is missing, check `defaultPlugins` and
`ZOVELI_PLUGINS`. `guard` is opt-in and is not part of the default set.

### 4. Check the host inventory service
Custom hosts must expose the same `tool-inventory` service as `ZoveliHost`:

```ts
ctx.provide('tool-inventory', { list: () => host.tools() });
```

Without it, an empty scan is correct behavior, not a crash.

### 5. Rebuild after package changes
```powershell
pnpm run build
pnpm run capability:scan
pnpm run capability:report
pnpm exec vitest run tests/unit/capability.test.ts tests/integration/capability.integration.test.ts
```

## Resolution
- **No tools listed**: fix plugin mounting before debugging capabilities.
- **Tool listed, capability missing**: add or correct the capability mapping.
- **Capability listed, tool fails at runtime**: capability discovery only proves
  the tool is mounted. Run the tool (for example `mathcore_status`) to check health.
- **Stale behavior**: rebuild `@zoveli/host` and `@zoveli/capability`; the CLI
  loads `dist`, not `src`.

## Escalation
1. Collect `zoveli health` output and the `/tools` list.
2. Run the capability tests above.
3. Open a GitHub issue with the tool list, expected capability name and scan output.
