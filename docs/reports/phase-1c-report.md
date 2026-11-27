# Slice 1C report: collector attestation, trusted CI job, PNG cause

Status: **Tested** (agent work; not independently verified, not approved). Date: 2026-11-27. Branch `claude/project-thread-tu03yx`. Follows `phase-1b-report.md`.

## 1. What was asked

The owner asked for everything to be done better. The project coordinator turned that into four items for this slice: (a) the verdict must require proof of who collected the evidence, so a run directory that calls itself collected can no longer be accepted; (b) the control-group case of the runtime evaluation as a regression test; (c) the cause of the PNG difference across platforms; (d) actually judging a pull request with the base branch's verifier.

## 2. Collector attestation (items a and b)

Implemented as ADR-0011 and contract 0.4.0 (R-012). A collector signs a statement (Ed25519) naming the artifact's digest, the source revision and the contract; the verifier accepts it only from a key in the operator's collectors file. The repository's own collectors file is empty. Every verdict, under every contract, now ends with `; collector not attested` or `; evidence collected by <id> (attested)`.

`tests/attestation.test.ts`, verbose output at the commit that added it:

```
 ✓ group B regression: evidence that calls itself collected > the run claims collector provenance everywhere
 ✓ group B regression: evidence that calls itself collected > is rejected under 0.4.0 even with a successful re-execution: R-012 fails
 ✓ group B regression: evidence that calls itself collected > is rejected when it signs itself with a key of its own that the operator never listed
 ✓ group B regression: evidence that calls itself collected > is rejected under the repository's own collectors file, which trusts nobody
 ✓ group B regression: evidence that calls itself collected > still shows under 0.3.0, which does not require attestation, that no collector was attested
 ✓ a signed run > from a trusted collector is accepted with re-execution, names the collector and establishes what the operator says it establishes
 ✓ a signed run > is rejected when artifact.json changes after signing
 ✓ a signed run > is rejected when the statement is edited after signing
 ✓ a signed run > is rejected when it was signed for another contract or another revision
 ✓ a signed run > is rejected when the operator has revoked the key
 ✓ the CLI: collector-key, attest, verify --collectors > an operator-made key signs a run and the run is accepted with exit 0
```

(17 tests in the file; the other six cover canonical bytes and the collectors file.)

The group B case is rebuilt from the baseline run, which marks every section `collector` exactly as the control group's agent did; it is not one of the control group's own run directories. Those live on the runtime branch.

`npm run verify` at d19aeab, local Linux x86_64:

```
      Tests  129 passed (129)
collector: not attested (no collector attestation at tenric/attestation.json: nothing shows who collected this evidence)
verdict: accepted under contract research.experiment-report version 0.2.0: 10 of 10 mandatory requirements passed (9 machine, 1 empirical, 0 human); collector not attested
== verify: OK
```

`npm run verify` still judges under 0.2.0: it has no trusted collector key, and under 0.4.0 the baseline is `rejected` by R-012, which is the intended result.

## 3. Judged by the base branch's verifier (item d)

The job ran for the first time on pull request 5, whose base is this branch. From its log (run 45941972996, job "judged by the base branch's verifier"):

```
contract: research.experiment-report version 0.2.0 sha256 6f1d9eafe02d17746ed3e106722fe2ae0a7c1a010f074f688eb5ee3003651e11 (matches the registry)
verifier: revision c9c431fffb2c3b10dbb39b017fb280f7c40aaf10
R-008  pass     A re-execution reproduces the metrics (mandatory, empirical)
verdict: accepted under contract research.experiment-report version 0.2.0: 10 of 10 mandatory requirements passed (9 machine, 1 empirical, 0 human)
```

So pull request 5's code produced a run that the verifier at this branch's then-head, not pull request 5's own verifier, accepted after re-executing it. The job then moved to `.github/workflows/trusted-verify.yml` on `pull_request_target`, so its definition also comes from the base branch (ADR-0007 amendment). That version has not run yet: it runs for a pull request only once the file is on that pull request's base branch.

## 4. PNG cause (item c)

Observed, not inferred this time. CI step "Report the image libraries that encoded the figure", run 45943565920:

```
ubuntu-24.04:  pillow 13.0.0  pillow zlib 1.3              pillow zlib_ng True
macos-15:      pillow 13.0.0  pillow zlib 1.3.1.zlib-ng    pillow zlib_ng True
windows-2025:  pillow 13.0.0  pillow zlib 1.3.1.zlib-ng    pillow zlib_ng True
```

Locally (Linux), `ldd` on Pillow's `_imaging` module shows `libz.so.1 => /lib/x86_64-linux-gnu/libz.so.1`, and `LD_DEBUG=bindings` shows `deflate`, `deflateInit2_` and `zlibVersion` bound to that system library (package `zlib1g 1:1.3.dfsg-3.1ubuntu2.3`). The macOS wheel bundles `libz.1.3.1.zlib-ng.dylib` (zlib-ng 2.3.3) and links to it. So the same pixels are compressed by stock zlib 1.3 on Linux and by zlib-ng elsewhere.

Consequence beyond the cross-platform question: on Linux the PNG's bytes depend on a system package that `uv.lock` does not pin. Two Linux machines with different zlib packages can produce different bytes, and R-008 would see that as a byte difference in an environment it considers equal. Not fixed in this slice; options are recording the zlib version in the environment section, writing the PNG with a fixed compressor, or a `pixel-identical` class (Q18).

## 5. Limits

- No real collector holds a key yet. The accepted 0.4.0 runs in the tests are signed by keys generated in the test process. Whether the runtime's key is out of the agent's reach is the runtime's claim (ADR-0010), not tested here.
- The collectors file is trusted because the verifier's checkout is (same root of trust as the contract registry, Q16). Who keeps it is Q26.
- `capabilities.established` repeats what the operator wrote in the collectors file. It is not something the verifier measured.
- Re-execution still runs producer code without a sandbox on the verifier's machine (Q17).
