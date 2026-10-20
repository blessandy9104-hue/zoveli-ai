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
| Session Logs | HIGH | Conversation history, tool executions |
| Mathcore Audit Log | HIGH | Verified computation certificates |
| Configuration | MEDIUM | Settings, plugin configs, profiles |
| Source Code | MEDIUM | Intellectual property |

## Threat Analysis (STRIDE)

### Spoofing

| Threat | Impact | Likelihood | Mitigation |
|--------|--------|------------|------------|
| Impersonate MCP server | HIGH | MEDIUM | Server attestation, pinned certificates |
| Fake LLM provider | HIGH | LOW | Provider registry with verification |
| Spoofed webhook | MEDIUM | MEDIUM | HMAC signatures, IP allowlists |
| User impersonation | HIGH | LOW | Local auth, OS keychain |

### Tampering

| Threat | Impact | Likelihood | Mitigation |
|--------|--------|------------|------------|
| Modify vault files | HIGH | MEDIUM | File integrity checks, git backup |
| Alter session logs | HIGH | LOW | Append-only JSONL, hash chains |
| Inject malicious tool results | HIGH | MEDIUM | Tool result validation, sandboxing |
| Modify mathcore results | CRITICAL | LOW | mathcore verification, audit trail |
| Inject malicious plugin | CRITICAL | MEDIUM | Plugin signatures, trusted registry |

### Repudiation

| Threat | Impact | Likelihood | Mitigation |
|--------|--------|------------|------------|
| Deny action performed | MEDIUM | MEDIUM | Comprehensive audit logging |
| Delete audit trail | HIGH | LOW | Immutable logs, external backup |
| Forge mathcore certificates | CRITICAL | LOW | Cryptographic signatures |

### Information Disclosure

| Threat | Impact | Likelihood | Mitigation |
|--------|--------|------------|------------|
| Vault data exfiltration | CRITICAL | MEDIUM | Local-first, no network by default |
| API key leakage | CRITICAL | MEDIUM | OS keychain, no logging of secrets |
| Session data exposure | HIGH | LOW | Encrypted storage option |
| Telemetry data leakage | MEDIUM | LOW | Opt-in, anonymized, local only |
| Mathcore audit exposure | MEDIUM | LOW | Local file, user-controlled |

### Denial of Service

| Threat | Impact | Likelihood | Mitigation |
|--------|--------|------------|------------|
| Resource exhaustion (LLM) | MEDIUM | HIGH | Rate limits, token budgets |
| Sandbox escape | HIGH | LOW | Multiple sandbox backends |
| MCP server crash | MEDIUM | MEDIUM | Health checks, auto-restart |
| Vault corruption | HIGH | LOW | Integrity checks, backups |
| Plugin infinite loop | MEDIUM | MEDIUM | Timeouts, resource limits |

### Elevation of Privilege

| Threat | Impact | Likelihood | Mitigation |
|--------|--------|------------|------------|
| Shell command injection | CRITICAL | MEDIUM | Input validation, allowlists |
| Filesystem escape | CRITICAL | MEDIUM | Sandbox, path normalization |
| Plugin privilege escalation | HIGH | LOW | Capability-based permissions |
| Container escape | HIGH | LOW | gVisor/Firecracker for untrusted |

## Security Controls

### Preventive
- **Input Validation**: All tool parameters validated with Zod schemas
- **Sandboxing**: Docker/gVisor/Firecracker for untrusted code
- **Capability Model**: Fine-grained permissions per plugin/agent
- **Secret Management**: OS keychain, encrypted file, env vars
- **Plugin Signatures**: Cosign verification for installed plugins

### Detective
- **Audit Logging**: All operations logged with hash chains
- **Health Checks**: Capability health monitoring
- **Anomaly Detection**: Unusual tool usage patterns
- **Integrity Verification**: Vault file checksums

### Corrective
- **Auto-rollback**: Failed deployments revert automatically
- **Circuit Breakers**: Failing services isolated
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

| Requirement | Control |
|-------------|---------|
| EU AI Act Art. 12 (Logging) | Append-only session logs, 6mo retention |
| GDPR Art. 17 (Right to Erasure) | `vault delete`, `session purge` commands |
| SOC 2 CC6.1 (Access Control) | Capability-based permissions |
| ISO 27001 A.8.2 (Info Classification) | Asset classification matrix |

## Review Schedule

- **Monthly**: Automated dependency scans
- **Quarterly**: Threat model review
- **Annually**: Penetration testing
- **Per Release**: SBOM generation, vulnerability scan