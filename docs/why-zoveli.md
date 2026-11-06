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
| Offline | **Yes for local tools** — 59 default tools; web research needs network |
| Your data | **Never leaves home**; SQLite store you own (+ Markdown mirror); **never trained on** |
| Math answers | **Verified or withheld** (mathcore: independent methods must agree + sealed certificate; governed specialists memorize proofs) |
| Model lock-in | None — any API key, any compatible base (incl. local Ollama), or tools-only |
| Memory | SQLite store you own (+ Markdown mirror), wiki-links, knowledge graph |
| Login | Passwordless email OTP, any inbox incl. @proton.me — the only password you'll ever need is your email account's |

## Professionally safe AI

Zoveli aims to make AI **professionally safe by making it provable**. It gives
you the power of a world-class brain without the anxiety of not knowing whether
that brain is lying to you or spying on you.

Most people have to choose between a "dumb" AI that runs locally on their laptop
and a "smart" AI that lives in the cloud. Zoveli lets you mix and match: use a
giant cloud brain for the thinking while verification and sensitive data stay
local. You get the intelligence of the cloud with the security of your own
device.

### 1. The confidence signal (the surface)

Trust should be felt, not audited. Instead of showing the whole audit trail on
every answer, Zoveli is designed to show a simple visual cue:

- **Verified** — a subtle green checkmark or "Verified" badge next to the
  response.
- **Unverified** — a neutral gray icon or a quiet warning: "AI-generated; not
  verified."
- **Partially verified** — a yellow icon meaning the reasoning is sound, but one
  specific fact could not be cross-referenced.

The user gets the safety and trust signal without reading a single line of
technical log.

### 2. Proof on demand (the interaction)

If a user wonders "How does it know that?" or "I don't believe this number,"
they can click the badge or **Show proof**. That opens a side panel or
collapsible drawer where technical records are translated into human-readable
receipts:

| Raw record | Human view |
| --- | --- |
| `verifier=mathcore; op=integral; result=15.4` | "Calculated using local math engine (Integration)." |
| `verifier=knowledge; hash=sha256:a1b2...` | "Verified against Trusted KB: [Official Tax Code 2026]." |

### 3. Audit mode (the deep dive)

Power users, developers, and lawyers who need the raw data for a report can turn
on **Audit mode** or **Developer view** in settings. That exposes the raw
JSON-style verifier records and keeps the noise away from the other 95% of users
while keeping the truth available to the 5% who need it.

The current desktop build already marks verified math with a **VERIFIED** badge
and writes a sealed certificate to the local audit chain. Proof-on-demand and
audit mode extend that same design. See [TRUST.md](TRUST.md) for the records
that exist today.

## When to pick Zoveli

- Private notes, journals, or client work that must not touch a third-party server.
- Exact computation (homework, engineering, finance) where a confident wrong
  answer is worse than no answer — `/math` and `/check` give VERIFIED/MATCH/MISMATCH.
- Planes, labs, and locked-down networks — the local tool loop works offline.
- Tinkerers: 22 packages, a plugin surface, and an HTTP API you can extend in an afternoon.

## Sovereign distribution

Zoveli is independently developed. To keep the project free and independent of
corporate gatekeepers, official macOS and Windows binaries are **unsigned**.
There is no Apple Developer Program membership and no Microsoft Authenticode
certificate. macOS Gatekeeper and Windows SmartScreen will warn you on first
launch; that is expected.

Follow the [Sovereign Install Guide](INSTALL_GUIDE.md) for the exact SmartScreen
and Gatekeeper steps, checksum verification, and troubleshooting.

## Honest limits

- Frontier reasoning, vision, voice, or image generation aren't built in
  (Zoveli can call outside models via API, but the models themselves aren't ours).
- It needs a 10-minute install instead of opening a browser tab, and unsigned
  installers trigger a one-time Gatekeeper or SmartScreen warning.
- Team collaboration with shared workspaces, SSO/SAML, audit logs, HIPAA —
  Zoveli is single-user local-first today (see `docs/enterprise.md` for status).

## FAQ

**Does Zoveli need a chat model to work?**
No. Chat is an optional adapter; the core — verified math, SQLite memory,
sysinfo, scheduler, 22 packages — runs with no model; local tools need no network.

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
