# $title

Experiment `$experiment_id` · data class: **$data_class** · rendered from `artifact.json` by a fixed template.

## Execution record (observed by the collector)

| Field | Value |
| --- | --- |
| Status | $status (exit code $exit_code) |
| Started (UTC) | $started_at |
| Runtime | $runtime s |
| Source revision | `$revision` |
| Platform | $platform, Python $python |
| Packages | $packages |
| Lockfile sha256 | `$lock_sha` |
| Dataset | $dataset |
| Dataset file sha256 | `$dataset_sha` |
| Seed | $seed |

## Configuration

```json
$config_json
```

## Metrics (reported by the experiment process)

| Metric | Value |
| --- | --- |
$metric_rows

## Figure

![Confusion matrix](figures/confusion_matrix.png)

Rendered from `figures/confusion_matrix.spec.json`.

## Findings

$findings

## Limitations

$limitations

## Produced outputs

| Path | Role | Determinism | sha256 |
| --- | --- | --- | --- |
$output_rows

## Reproduction

```sh
$reproduction
```
