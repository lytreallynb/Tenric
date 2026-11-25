# ADR-0005: One instruction file, one verification command

Status: proposed; awaiting owner approval. Date: 2026-11-25.

**Context.** Tenric's development should follow its own principles without building infrastructure first.

**Decision.**

- `AGENTS.md` is the single instruction file. `CLAUDE.md` contains only a pointer and an import of it.
- `npm run verify` is the single verification command. It executes the experiment for real; tests that need a run fail when none exists, and never skip.
- Work status uses five words (proposed, implemented, tested, independently verified, approved) defined in AGENTS.md.
- Reports in `docs/reports/` quote actual command output.
- No CI configuration yet, because there is no hosted repository. Adding one is the first step after the repository has a home, and it is what moves work from "tested" to "independently verified".

**Known gap.** These are instructions, which is exactly the mechanism Tenric says is insufficient. Rule 1 in AGENTS.md (do not weaken acceptance criteria) is not enforced by anything. Dogfooding means replacing it with a mechanism: a protected path rule or a CI check that flags changes to `spec/`, `src/verdict.ts` and rejection tests for owner review.

**Reverse if** it gets in the way of a single engineer working alone.
