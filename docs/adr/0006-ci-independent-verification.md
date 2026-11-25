# ADR-0006: GitHub Actions runs `npm run verify` on three platforms

Status: proposed; awaiting owner approval. Date: 2026-11-25.

**Context.** Everything in Phase 0 was executed on one Linux x86_64 machine by its author. ADR-0005 named CI as the first step once the repository had a home, and the Phase 0 report lists it as the first independent check and the first run on a second machine.

**Decision.**

- One workflow, `.github/workflows/verify.yml`, runs on pushes to `main`, on pull requests and on manual dispatch.
- It runs the existing command, `npm run verify`, unchanged, on `ubuntu-24.04`, `macos-15` and `windows-2025`. Each platform reports separately (`fail-fast: false`).
- A second job compares the SHA-256 digests of the three outputs declared `byte-identical` across the platforms and prints each platform's `metrics.json`. A difference is reported as a warning and does not fail the job, because `docs/reproducibility.md` claims byte identity on one platform only. A platform with no outputs to compare fails the job (fail closed).
- Tool versions match the Phase 0 evidence: Node 22.23.5 and uv 0.11.32. Python is the one uv selects from `.python-version`. Actions are pinned to commit hashes. uv is installed with `pipx`, which is on the hosted runners, so no third-party action is used.
- The workflow has read-only permissions and uses no secrets.

**What a green run does and does not mean.** It means the committed revision passed `npm run verify` on machines its author does not control. It is still triggered and configured by the same author, the collector is still not isolated from the producer (`docs/trust-model.md`), and the baseline's verdict stays `inconclusive`. It supports "independently verified" for reproducible execution (G6) on the platforms that passed, and nothing more.

**Alternatives.** Linux only: cheaper, and says nothing about other platforms. The `astral-sh/setup-uv` action: adds caching and a third-party action for a job that takes minutes. Failing on any cross-platform difference: would turn a guarantee the project deliberately does not make into an acceptance criterion.

**Cost.** macOS and Windows runners are billed at a multiple of Linux minutes on private repositories.

**Reverse if** hosted minutes become a cost concern (drop to Linux plus manual dispatch for the others), or once the contract states a cross-platform guarantee that the compare job should enforce.
