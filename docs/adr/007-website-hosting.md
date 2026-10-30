# ADR 007: Serve the Website from GitHub Pages

## Status
Accepted

## Context
The public site lives in `website/` as plain static HTML/CSS and is published by
`.github/workflows/pages.yml` to
`https://blessandy9104-hue.github.io/zoveli-ai/` whenever `website/**` changes.

A Vercel project is also connected to the repository and opened an automated
pull request (PR #36) that added Vercel Web Analytics: the `@vercel/analytics`
package at the workspace root plus
`<script defer src="/_vercel/insights/script.js">` in every page. That
integration does not fit the current deployment:

- The Vercel deployment for the PR failed, and `website/` has no Vercel build
  configuration.
- GitHub Pages is the canonical host and does not serve
  `/_vercel/insights/script.js`, so the tag would request a missing script.
- `@vercel/analytics` was added as a root dependency but the static site never
  imports it, so it only adds install and lockfile weight.
- `SECURITY.md` and `docs/THREAT_MODEL.md` state that the product has no
  telemetry. The marketing site should not quietly contradict that posture.

## Decision
GitHub Pages is the canonical website host. The site stays dependency-free
static HTML/CSS and does not include third-party analytics or tracking scripts.
Vercel may be used for preview deployments only; it is not a deploy target and
its analytics snippet is not embedded.

Any future marketing-site analytics needs a separate proposal that names the
host, the data collected, the retention period, and how the site discloses it.

## Consequences

### Positive
- One deploy path (`pages.yml`) and no build step or Node dependency for the
  public site.
- The published site matches the no-telemetry posture documented for the
  product and cannot fail on a missing host-specific script.
- Host-specific script PRs can be rejected without re-litigating the decision.

### Negative
- There is no visitor analytics on the public site; traffic questions rely on
  GitHub repository and Pages metrics.
- If Vercel ever becomes the canonical host, this ADR and the analytics
  decision must be revisited.

## Triggers (revisit this ADR when any hits)
- The site moves to Vercel, a custom domain with a build step, or another host.
- A concrete analytics requirement is proposed with a privacy review.
- `website/` stops being plain static HTML.

## References
- `.github/workflows/pages.yml`
- `website/`
- `SECURITY.md` (no telemetry)
- PR #36 (closed; Vercel Web Analytics)
