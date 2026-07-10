# Architecture and Harness runtime rules

Apply these reviewed prompt rules when working with:

- `packages/harness-runtime/src/**`
- `packages/harness-runtime/tests/**`
- `packages/harness-runtime/package.json`
- `pi-harness/**`
- Harness architecture documentation under `wiki/architecture/`

## ARCH-DETECTOR-001 — Keep deterministic detectors executable

Keep detector implementations, defaults, thresholds, grouping, and fingerprints in Harness runtime code or a future explicitly-schemaed runtime config.

Do not parse natural-language content from `wiki/**/_rules.md` into executable detector parameters. Prompt rules guide model behavior; they do not configure deterministic analysis.

## ARCH-TEST-001 — Run the Harness runtime suite

For changes under `packages/harness-runtime/`, run:

```bash
npm --prefix packages/harness-runtime test
```

Add or update a focused fixture when changing parser behavior, proposal routing, prompt-rule lint, controlled apply, redaction, or eval behavior.

## ARCH-PRIVACY-001 — Preserve the private evidence boundary

Raw Pi sessions, normalized evidence, reports, reflection prompts, proposal drafts/history, and eval reports remain under the private Harness home by default.

Repository files may contain reviewed outcomes and non-sensitive proposal IDs, not copied private evidence.

## ARCH-APPLY-001 — Keep controlled apply transactional

Controlled apply must require approval, enforce exact target-file allowlists, reject path/symlink escapes, validate changed prompt-rule files, and restore original content when post-apply validation fails.
