# Zoveli Enterprise Notes

## Air-gapped deployment
1. Build images: `docker build -f docker/Dockerfile .`
2. Pre-install: Python + mathcore wheel; optionally Ollama + a GGUF model for chat.
3. Run with `--network none` except loopback; mount the vault and auth directory as volumes.
4. Verify: the Playwright e2e suite passes fully offline; `capability_check` reports `mathcore.verified-compute` available and `capability_report` lists only mounted tools.

## SSO / RBAC (roadmap)
- Identity via OAuth (GitHub/Google/Microsoft); OIDC/SAML as a future extension point.
- Capability-gated RBAC: map roles → allowed capabilities.
- All decisions logged to session + audit logs.

## Audit & compliance
- Chat history is in-memory per session; there is no append-only session log.
- Optional JSONL tool trace: set `ZOVELI_TRACE_LOG` and `/trace`/host events
  record redacted tool calls.
- Math certificates: hash-chained `audit.jsonl` (`mathcore verify-log` detects edits).
- SBOM per release (CI `sbom` job); images and release archives are not signed yet.
- EU AI Act Art.12 logging/retention is not implemented; a durable audit log is roadmap work.

## FIPS / regulated
- The default image and Node runtime are not FIPS-validated. Use your own
  FIPS-validated base image if required.
- There is no `encrypted-file` credential store; secrets come from environment
  variables and should be provided by your secret manager.
- No telemetry exists in the product; no external calls in local profile.
