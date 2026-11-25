# ADR-0004: Files and content hashes only; no database

Status: proposed; awaiting owner approval. Date: 2026-11-25.

**Context.** The brief allows SQLite "when persistence becomes necessary".

**Decision.** It is not necessary yet. A run is a directory containing `artifact.json` and the outputs it lists by SHA-256. Git holds specifications and source. Nothing queries across runs.

**Why.** A directory of hashed files can be inspected with standard tools, copied, attested and diffed. A database would add state that the trust model then has to cover.

**Reverse if** a feature needs to query across runs (verdict history, regression tracking for contract changes). Prefer an append-only log of verdict records before a relational store, and SQLite before any server.
