import { defineConfig } from "vitest/config";

// The default limit of 5 s per test is too short for tests that start several
// Node processes one after another when the test files run in parallel on a
// slow machine: tests/cli.test.ts "issues no verdict and exits 2 on a
// precondition failure" starts ten and timed out on windows-2025 in CI run
// 45940109737. Tests that pass their own limit keep it.
export default defineConfig({ test: { testTimeout: 30_000 } });
