# Reproducibility semantics

Status: proposed (Phase 0). These are six different guarantees. A document, a contract or a report must name the one it means.

## 1. The six guarantees

| # | Guarantee | Statement | How it is checked | Demonstrated in Phase 0 |
| --- | --- | --- | --- | --- |
| G1 | **Structural consistency** | Two artifacts have the same shape: same schema version, same required records | Schema validation | Yes |
| G2 | **Semantic contract conformance** | The artifact satisfies every requirement of one contract version | Verdict over all requirements | Partly: 3 of 8 mandatory checks exist |
| G3 | **Numerical reproducibility** | Re-execution yields metrics within a stated tolerance | Re-run and compare with an explicit tolerance | Only the degenerate case (same machine, difference of zero) |
| G4 | **Reproducible rendering** | The same figure specification and renderer yield the same image | Re-render from the spec and compare | Yes, same environment |
| G5 | **Byte-identical artifacts** | Output files have equal digests | Compare SHA-256 | Yes for three outputs, same environment |
| G6 | **Reproducible execution** | A third party can run the commands from the recorded inputs and obtain a result | Someone else actually does it, from a clean checkout | **No.** Not attempted on a second machine. |

They are independent in the ways that matter:

- G1 does not imply G2. A structurally perfect report can cite a digest that does not match.
- G2 does not imply the findings are true. It means the requirements that were checked passed.
- G5 implies G3 and G4 for those files, but G3 can hold where G5 cannot: different BLAS builds give metrics that differ in the last bits.
- G6 can hold without G5: the experiment reruns fine and produces slightly different numbers.
- None of them is a statement about scientific validity.

## 2. What must be controlled for each

| Input | G3 numeric | G4 rendering | G5 bytes | Controlled in the baseline by |
| --- | --- | --- | --- | --- |
| Source code | required | required | required | Git revision recorded; a dirty tree is flagged |
| Experiment configuration | required | | required | `config.json` hashed |
| Dataset bytes | required | | required | Dataset file hashed by the collector |
| Random seed | required | | required | In the config; passed to the split and the model |
| Library versions | required (loosely) | required | required (exactly) | `uv.lock`, digest recorded; `uv run --locked` |
| Interpreter version | loosely | loosely | required | Recorded; `.python-version` pins the patch version (3.13.14) and uv installs it |
| CPU architecture, BLAS build, thread count | affects last bits | | required | Threads pinned to 1; architecture recorded, **not controlled** |
| Hash randomisation | | | required where set or dict order leaks | `PYTHONHASHSEED=0` |
| Renderer and backend | | required | required | matplotlib version recorded; `Agg` forced |
| Fonts | | required | required | Font fixed to DejaVu Sans, which ships inside matplotlib |
| Host renderer configuration | | required | required | `matplotlib.rcdefaults()` discards any host `matplotlibrc` |
| Template version | | required for the report | required | Template lives in the repository, so the source revision covers it |
| Embedded metadata (software strings, timestamps) | | | required | PNG `Software` field removed; JSON written with sorted keys |
| Line endings | | | required | Outputs are written with `\n` on every platform; `.gitattributes` checks text out as LF |
| Interpreter environment variables (`PYTHONPATH`, `PYTHONSTARTUP`) | required | required | required | The collector removes every `PYTHON*` variable before adding its own pins; the verifier's re-execution uses an allowlist |
| Wall-clock time, durations, hostnames, absolute paths | | | must be excluded or declared | Listed in `volatile_fields`; the command is recorded with placeholders |
| Locale and timezone | | sometimes | sometimes | `LC_ALL=C.UTF-8`, `TZ=UTC` |

A finding from building this: the first figure rendered on the bootstrap machine used the Inter typeface, because a `matplotlibrc` on that host overrode the default font. The run was "deterministic" and would have produced a different image on any other machine. Host configuration files are inputs, and they are easy to miss.

## 3. How an artifact declares its claim

Each output carries `determinism`:

- `byte-identical`: equal digest expected for equal controlled inputs in the locked environment on the same platform. Across platforms this is not promised for the PNG: the three platforms render exactly the same pixels, and the Linux file is compressed differently from the macOS and Windows files (`docs/reports/phase-1b-report.md` section 5). The cause is the compression library: on Linux Pillow compresses with the operating system's zlib (`libz.so.1`, zlib 1.3 on Ubuntu 24.04), on macOS and Windows with the zlib-ng 2.3.3 its wheel bundles. This also means the PNG's bytes on Linux depend on a system package that `uv.lock` does not pin: two Linux machines with different zlib packages can produce different PNG bytes from the same pixels. R-008 would then report a byte difference in an environment it considers equal. Open question Q18. The two JSON outputs were byte-identical on all three platforms once line endings were fixed.
- `numeric-tolerance`: values agree within the tolerance the contract states; bytes may differ.
- `volatile`: contains declared run-specific values (the rendered report includes start time and runtime).

`volatile_fields` lists the JSON Pointers that may differ between identical reruns. Everything else in the artifact must be equal, and a test checks this on two real runs. Volatile values are declared, not silently ignored: an undeclared difference is a failure.

## 4. What Phase 0 measured

Two executions of the baseline on one machine (Linux x86_64, Python 3.13.18, the locked packages):

- `metrics.json`, the figure specification and the PNG had identical SHA-256 digests.
- The two `artifact.json` documents were equal after removing the declared volatile fields.

What this does **not** show: agreement across operating systems, CPU architectures, Python patch versions or BLAS implementations. The contract's cross-platform tolerance of 0.01 absolute on accuracy is a placeholder with no data behind it.

## 5. Deliberately not promised

- Byte-identical reports. The report shows wall-clock values. If byte identity of the report matters, render it without them and keep them in `artifact.json` only.
- Reproducibility of anything a model writes. Free-text findings from an agent are non-deterministic by nature; the contract can require that they cite evidence, not that they repeat.
- Bit-for-bit numerical agreement across platforms.
