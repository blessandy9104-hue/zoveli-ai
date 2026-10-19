# Zoveli Enterprise Notes

## Air-gapped deployment
1. Build images: `docker build -f docker/Dockerfile .`
2. Pre-install: Python + mathcore wheel, Ollama + GGUF models, LSP servers.
3. Run with `--network none` except loopback; mount vault + sessions as volumes.
4. Verify: the Playwright e2e suite passes fully offline; `capability_report` shows `mcp.mathcore: available`.

## SSO / RBAC (roadmap)
- Identity via OAuth (GitHub/Google/Microsoft); OIDC/SAML as a future extension point.
- Capability-gated RBAC: map roles → allowed capabilities.
- All decisions logged to session + audit logs.

## Audit & compliance
- Session logs: append-only JSONL (`~/.personal-assistant/sessions`).
- Math certificates: hash-chained `audit.jsonl` (`mathcore verify-log` detects edits).
- SBOM per release (CI `sbom` job); images signed with Cosign.
- EU AI Act Art.12: 6-month log retention supported via session persistence config.

## FIPS / regulated
- Use FIPS-validated OpenSSL base image; `encrypted-file` credential store with AES-256-GCM.
- No telemetry exists in the product; no external calls in local profile.
