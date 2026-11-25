# ADR-0001: Record decisions as ADRs, designs as RFCs

Status: accepted by the bootstrap author; awaiting owner approval. Date: 2026-11-25.

**Context.** The project argues that standards should be explicit and versioned. Its own decisions should be too, without a documentation system to maintain.

**Decision.** Markdown files in the repository. An RFC (`docs/rfcs/`) describes something not yet built and needs review. An ADR (`docs/adr/`) records one decision already taken: context, decision, alternatives, and what would reverse it. Each fact lives in one place; other documents link to it.

**Alternatives.** An issue tracker or wiki (outside the repository, not versioned with the code). No records (decisions get re-argued).

**Reverse if** the number of documents starts to cost more than the decisions are worth.
