# Threat Model - Zoveli Personal Assistant AI

## Overview

This document describes the threat model for Zoveli using the STRIDE methodology.

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Device                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   CLI/Web   │  │  Desktop    │  │   MCP       │             │
│  │   Client    │  │   App       │  │   Client    │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│         └────────────────┼────────────────┘                     │
│                          ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
 │  │              Zoveli Core (Node.js Process)               │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐        │   │
│  │  │ Agent   │ │ Session │ │ Tools   │ │  LLM    │        │   │
│  │  │ Loop    │ │ Manager │ │ Registry│ │ Adapters│        │   │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘        │   │
│  │       │           │           │           │              │   │
│  │  ┌────▼───────────▼───────────▼───────────▼────┐        │   │
│  │  │         Plugin System (Cordis)              │        │   │
│  │  └────────────────────┬────────────────────────┘        │   │
│  └───────────────────────┼──────────────────────────────────┘   │
│                          │                                      │
│         ┌────────────────┼────────────────┐                     │
│         ▼                ▼                ▼                     │
 │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐             │
 │  │ mathcore    │ │ SQLite      │ │ External    │             │
 │  │ MCP Server  │ │ Store +     │ │ Services    │             │
 │  │             │ │ Vault Mirror│ │             │             │
 │  └─────────────┘ └─────────────┘ └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

## Assets

| Asset | Classification | Description |
|-------|---------------|-------------|
| User Data (vault) | HIGH | Personal notes, preferences, project data |
| API Keys/Credentials | CRITICAL | LLM API keys, GitHub tokens, etc. |
| Conversation / trace data | HIGH | In-memory chat history and an opt-in redacted tool trace |
| Mathcore Audit Log | HIGH | Verified computation certificates |
| Configuration | MEDIUM | Settings, plugin configs, profiles |
| Source Code | MEDIUM | Intellectual property |

## Threat Analysis (STRIDE)

### Spoofing

| Threat | Impact | Likelihood | Mitigation |
|--------|--------|------------|------------|
| Impersonate MCP server | HIGH | MEDIUM | `MATHCORE_MCP_COMMAND` is user-controlled; stdio only; no attestation |
| Fake LLM provider | HIGH | LOW | Base URL is user-configured; no provider verification |
| Spoofed webhook | MEDIUM | LOW | No webhook surface exists |
| User impersonation | HIGH | LOW | Optional email OTP + HMAC sessions; bearer token for API clients |

### Tampering

| Threat | Impact | Likelihood | Mitigation |
|--------|--------|------------|------------|
| Modify vault files | HIGH | MEDIUM | User-managed backups (`vault:backup`/`verify`); no live file-integrity check |
| Alter session logs | HIGH | LOW | No session log; optional JSONL trace is not tamper-evident |
| Inject malicious tool results | HIGH | MEDIUM | System prompt treats tool output as untrusted data; no enforcement layer |
| Modify mathcore results | CRITICAL | LOW | mathcore verification plus hash-chained audit log |
| Inject malicious plugin | CRITICAL | MEDIUM | Plugins are trusted local code; no signatures, only contract validation |

### Repudiation

| Threat | Impact | Likelihood | Mitigation |
|--------|--------|------------|------------|
| Deny action performed | MEDIUM | MEDIUM | Optional redacted tool trace; chat is in-memory |
| Delete audit trail | HIGH | LOW | Optional trace has no immutability; mathcore audit is hash-chained |
| Forge mathcore certificates | CRITICAL | LOW | Hash-chained audit detects edits; no public-key signatures |

### Information Disclosure

| Threat | Impact | Likelihood | Mitigation |
|--------|--------|------------|------------|
| Vault data exfiltration | CRITICAL | MEDIUM | Local-first, loopback binding, no default filesystem/shell tools |
| API key leakage | CRITICAL | MEDIUM | Secrets from env vars; redaction in errors/logs; no keychain |
| Session data exposure | HIGH | LOW | Chat history is in-memory; HMAC-signed HttpOnly cookie |
| Telemetry data leakage | MEDIUM | LOW | No telemetry exists |
| Mathcore audit exposure | MEDIUM | LOW | Local file, user-controlled permissions |

### Denial of Service

| Threat | Impact | Likelihood | Mitigation |
|--------|--------|------------|------------|
| Resource exhaustion (LLM) | MEDIUM | HIGH | Per-IP rate limits, 1 MB body cap, 50k message cap, chat timeout |
| Sandbox escape | HIGH | LOW | No sandbox exists; tools run in-process |
| MCP server crash | MEDIUM | MEDIUM | Supervised pool restarts with backoff |
| Vault corruption | HIGH | LOW | SQLite integrity checks, WAL-safe backups with checksums |
| Plugin infinite loop | MEDIUM | MEDIUM | No general tool timeout; MCP calls are bounded |

### Elevation of Privilege

| Threat | Impact | Likelihood | Mitigation |
|--------|--------|------------|------------|
| Shell command injection | CRITICAL | MEDIUM | No shell tool by default; opt-in guard for custom `shell_exec` |
| Filesystem escape | CRITICAL | MEDIUM | No filesystem tool by default; user-added tools are trusted |
| Plugin privilege escalation | HIGH | LOW | Plugins run with full host privileges; no per-plugin permissions |
| Container escape | HIGH | LOW | No container sandbox; Docker deployment is optional |

## Security Controls

### Preventive
- **Input validation**: Tool parameters and HTTP bodies are checked; limits cap message/body size
- **Default surface**: No shell, filesystem or browser tools; optional guard for custom shell tools
- **Host hardening**: Loopback binding, non-loopback Host rejection, security headers, optional bearer/login gates
- **Secret handling**: Secrets come from environment variables; logs redact key material
- **Plugin contract**: Plugin names, setup shape and duplicate tools are validated at mount; code is trusted
- **No sandbox**: Plugins and tools run in the same Node process

### Detective
- **Tool trace**: Optional redacted JSONL (`ZOVELI_TRACE_LOG`) plus in-process counters
- **Diagnostics**: `pnpm health:check` covers runtime, config drift, vault schema, MCP pool and live capability inventory
- **Math audit**: Hash-chained `mathcore` audit log detects certificate edits
- **Vault integrity**: SQLite integrity checks on backup/verify
- **No anomaly detection**

### Corrective
- **Installer rollback**: failed portable upgrades restore the previous runtime; there is no automatic rollback after a successful start
- **MCP restart**: Supervised mathcore pool backs off and retries after crashes
- **Backup/Restore**: `pnpm vault:backup` (WAL-safe DB + vault/auth/audit with SHA-256 manifest), verified by `pnpm vault:verify` before `pnpm vault:restore`
- **Incident Response**: Runbooks for common scenarios

## Risk Assessment

| Risk | Score | Priority |
|------|-------|----------|
| Shell injection via malicious input | 9.0 | CRITICAL |
| Vault data exfiltration | 8.5 | CRITICAL |
| Plugin supply chain attack | 8.0 | HIGH |
| Mathcore result manipulation | 7.5 | HIGH |
| Session hijacking | 7.0 | HIGH |
| Resource exhaustion | 6.5 | MEDIUM |
| Configuration tampering | 6.0 | MEDIUM |

## Compliance Mapping

Zoveli is not certified for any of these frameworks. The table records current
gaps rather than compliance claims.

| Requirement | Current state |
|-------------|---------------|
| EU AI Act Art. 12 (Logging) | Not implemented; chat is in-memory and tool trace is opt-in |
| GDPR Art. 17 (Right to Erasure) | Notes can be deleted with `memory_delete_note`; no formal erasure workflow or session store |
| SOC 2 CC6.1 (Access Control) | Not certified; optional login/bearer gates, no per-plugin permissions |
| ISO 27001 A.8.2 (Info Classification) | Not certified; asset classification is documentation only |

## Review Schedule

- **Monthly**: Automated dependency scans (Dependabot, CI `pnpm audit`, Trivy)
- **Quarterly**: Threat model review
- **Annually**: Penetration testing (planned, not yet performed)
- **Per Release**: SBOM generation, vulnerability scan