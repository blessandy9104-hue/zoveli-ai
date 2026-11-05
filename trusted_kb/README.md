# Trusted knowledge base

Curated, local facts that the `knowledge` claim verifier may certify. Each
domain is a JSONL content file plus a `.manifest` that records the domain URI
and the SHA-256 of the content.

```
trusted_kb/
  general/
    general.jsonl
    general.manifest
  software/
    software.jsonl
    software.manifest
```

`MATHCORE_TRUSTED_KB` can point at this directory (all domains) or at one
content file with a sibling `.manifest`. A missing, malformed, or mismatched
manifest makes the knowledge verifier fail closed with `UNVERIFIABLE`; it never
certifies unauthenticated content. CRLF is canonicalised to LF before hashing,
so a Windows checkout can still verify manifests generated on POSIX.

## Edit a domain

1. Change the JSONL content (`question`, `answer`, optional `source`).
2. Regenerate the manifest hash:

   ```bash
   python -m mathcore.trusted_kb update trusted_kb
   python -m mathcore.trusted_kb verify trusted_kb
   ```

3. Commit the content and manifest together. A content edit without a manifest
   update is a verification failure by design.

Questions are matched after whitespace/case/punctuation normalisation. A question
may appear in only one domain; duplicates are reported as `UNVERIFIABLE` rather
than resolved arbitrarily.
