# Why Zoveli?

> One paragraph: Zoveli is the assistant for work that must stay yours —
> it runs on your hardware, proves its math instead of guessing, and costs
> nothing to run. The only difference between Zoveli and any other AI:
> Zoveli is offline.

## The 10-second summary (October 2026)

| | Zoveli AI |
|---|---|
| Price | Free forever, MIT licensed |
| Where it runs | **Your machine** (CLI, web UI, desktop, Docker) |
| Offline | **Yes for local tools** — 58 default tools; web research needs network |
| Your data | **Never leaves home**; SQLite store you own (+ Markdown mirror); **never trained on** |
| Math answers | **Verified or withheld** (mathcore: independent methods must agree + sealed certificate; governed specialists memorize proofs) |
| Model lock-in | None — any API key, any compatible base (incl. local Ollama), or tools-only |
| Memory | SQLite store you own (+ Markdown mirror), wiki-links, knowledge graph |
| Login | Passwordless email OTP, any inbox incl. @proton.me — the only password you'll ever need is your email account's |

## When to pick Zoveli

- Private notes, journals, or client work that must not touch a third-party server.
- Exact computation (homework, engineering, finance) where a confident wrong
  answer is worse than no answer — `/math` and `/check` give VERIFIED/MATCH/MISMATCH.
- Planes, labs, and locked-down networks — the local tool loop works offline.
- Tinkerers: 24 packages, a plugin surface, and an HTTP API you can extend in an afternoon.

## Honest limits

- Frontier reasoning, vision, voice, or image generation aren't built in
  (Zoveli can call outside models via API, but the models themselves aren't ours).
- It needs a 10-minute install instead of opening a browser tab.
- Team collaboration with shared workspaces, SSO/SAML, audit logs, HIPAA —
  Zoveli is single-user local-first today (see `docs/enterprise.md` for status).

## FAQ

**Does Zoveli need a chat model to work?**
No. Chat is an optional adapter; the core — verified math, SQLite memory,
sysinfo, scheduler, 24 packages — runs with no model; local tools need no network.

**What does "verified math" mean?**
Every computation runs through independent methods (e.g. symbolic solve +
numeric roots + exact substitution). All must agree or the answer is WITHHELD
with a MISMATCH notice — plus a hash-chained audit certificate (`MATHCORE_AUDIT`).

**What does it cost to run?**
Electricity. No subscription, no credits, no seat fees. Optional model API
usage is billed by whoever provides your key, not by us.

**What password do I need?**
None for Zoveli. Login is optional: enable `ZOVELI_AUTH_REQUIRED=1` to gate
the desktop with a 6-digit email code. The only password you'll ever need is
your email account's.

**Can I use it at work?**
It's MIT licensed with a threat model (`docs/THREAT_MODEL.md`) and security
policy (`SECURITY.md`). But review both first: local-first means *you* own
backups, updates, and access control for the machine it runs on.
