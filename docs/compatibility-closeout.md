# 0.7 Compatibility Closeout

Status: COMPLETE on schema v9 / package 0.6.0. This closes the 0.7 architecture implementation. It does not claim that every external provider is production validated.

## Production paths and legacy boundary

The application retains three visibly distinct paths:

| Path | Purpose | New work |
| --- | --- | --- |
| Legacy compatibility | Read and operate published visual/video/task data without changing its shape | Not recommended |
| Direct Tool Generation | One Image/Video Tool call through routing, approval, reservation, AITask, GenerationRecord and candidate review | Supported |
| Workflow Generation | Fixed Shot keyframe/video orchestration over the same Direct Tool services | Recommended |

WorkflowRun and StepRun only associate and sequence the single underlying AITask, GenerationRecord, reservation and AssetVersion. They never create a parallel generation record. Reference adapters remain development/test fixtures and are excluded from packaged production composition and imported production profiles.

The old Provider, ComfyUI and video paths remain for compatibility. New Tool requests do not fall back to them. Legacy task rows are labelled `Legacy Task`; Tool/Workflow rows are labelled `Production Task`. Restored tasks and workflows are `Historical / Read-only` and have no retry, cancel, poll or submit authority.

## Provenance and lineage

The read-only compatibility IPC accepts only scoped project UUIDs plus an AssetVersion or GenerationRecord UUID. It cannot accept database paths, local paths, URLs, costs, task states, workflow step states or arbitrary provenance writes.

Generated assets are joined from their authoritative rows without copying provenance:

`AssetVersion → GenerationOutput → GenerationRecord → AITask → RoutingDecision → PromptPackage`

When applicable, the query also joins `StepRun → WorkflowRun`, including workflow type/status, candidate, review decisions and adoption result. The UI shows the frozen historical tool ID/version, model, execution mode, capability, workflow template/version, estimated/actual cost and reservation status. It never substitutes the current tool descriptor for historical identity.

Imported versions use independent `ImportProvenance`; no GenerationRecord is fabricated. Published legacy versions without either relation display `Legacy / provenance unavailable`. No provider, cost, approval or model is guessed or backfilled.

## Readiness: validation versus runtime

Validation evidence and current runtime are independent:

| Tool | Validation status | Runtime status |
| --- | --- | --- |
| ComfyUI local text-to-image | `real-local-validated` | Dynamic: `offline`, `capability-blocked`, or `ready-for-configured-template` |
| ComfyUI reference image | `simulated-validated` | Dynamic for its configured template; no real provider claim |
| Packy Image 2.5 | `real-generation-partially-validated` | `configuration-required` or `configured-unverified`; no cloud request in readiness |
| Reference Image | `simulated-validated` | `development-test-only` |
| Reference Video | `simulated-validated` | `development-test-only` |
| Real Video Provider | `not-validated` | `configuration-required` |

ComfyUI readiness uses read-only `/system_stats` and `/object_info`. A previous real validation does not make an offline service appear online. Packy readiness checks only whether an encrypted local credential reference exists; it does not call the provider.

## Actual validation boundary

ComfyUI completed one real local SDXL image generation, Candidate → Review → Adopt, and completed-task recovery after a fresh process with submit count remaining one. Its status is `real-local-validated` for that trusted text-to-image template.

Packy evidence covers real authentication, model visibility, a real request entering the provider, billing activity, observed Sunburst response envelope, and a sanitized local replay through Candidate → Review → Adopt. A single live paid response has not completed direct ingestion and adoption end to end. The precise status is:

> real provider response observed; full live asset-ingestion/adoption not yet validated.

Therefore Packy is not `real-e2e-validated`. The four existing Packy attempts remain read-only facts: three `unknown-submission` and one `malformed-output`, all with `pending-unknown` reservation state in the inspected historical database. This closeout does not reconcile or rewrite them.

No real Video Provider is configured or validated. Reference protocol success is not evidence for Seedance, Kling, Veo, Sora, Runway, Hailuo or another supplier.

## Cost and error semantics

The UI distinguishes known zero, known non-zero and unknown amounts. Reservations independently show reserved/submitted/pending-unknown/consumed/released/cancelled-before-submit/requires-review/historical. Null never means zero. Local ComfyUI estimates are known USD 0 and explicitly exclude electricity/GPU accounting.

`unknown-submission` displays: “请求已发出，但无法确认远端是否已建立任务。为避免重复扣费，系统不会自动重试。” Production tasks do not expose the legacy retry button. Common tool, validation, dependency, remote task, output ingestion, billing, waiting-user, stopped-by-user and legacy-provenance errors are mapped to stable user-facing messages; renderer responses contain no stack traces.

## Backup compatibility matrix

| Backup | Database | Restore to v9 | New provenance invented | Execution authority |
| --- | --- | --- | --- | --- |
| format 1 | schema 6 | Supported | No | None |
| format 2 | schema 7 | Supported | No | None |
| format 3 | schema 8 | Supported | No | None |
| format 4 | schema 9 | Supported, including WorkflowRun/StepRun | No | None |

Current v9 round-trip preserves and remaps project/entity/shot/task/asset, generation, approval, reservation, workflow and step references. Original remote task IDs are retained as `historicalProviderTaskId` for display while active `providerTaskId` is cleared. Approval/reservation rows become historical; all restored workflow/task execution flags are false. No restored project may poll, retry, resubmit or consume budget again.

## Security audit

All compatibility operations use the existing trusted-sender IPC handler and strict Zod discriminated schemas. SQLite, credentials and readiness probes remain main-process only. Renderer cannot choose a database path, endpoint or local file, and cannot mutate provenance, billing, task state or workflow state through the compatibility API.

Tracked-source scans found no real API key, signed URL, credential file or Authorization value. Test credentials are explicitly fixture-only. GenerationRecord, Workflow snapshots and the inspected production database contain no absolute Windows paths. No Tool/Generation/Workflow module uses `taskkill`, `Stop-Process`, `process.kill` or child-process kill to manage ComfyUI or another external tool.

## 0.7 acceptance matrix

| Step | Result |
| --- | --- |
| 07-01 Tool Contract | COMPLETE |
| 07-02 Protocol Fixture | COMPLETE |
| 07-03 Routing / Broker | COMPLETE |
| 07-04 Provenance | COMPLETE |
| 07-05 Approval / Budget | COMPLETE |
| 07-06 Image API | COMPLETE — architecture |
| 07-07 Video API | COMPLETE — architecture |
| 07-08 ComfyUI | COMPLETE — real local validated |
| 07-09 Workflow | COMPLETE |
| 07-10 Compatibility | COMPLETE |

Real Provider Validation remains separate: ComfyUI Local is VALIDATED; Packy Image has PARTIAL REAL VALIDATION and is not full live E2E; Real Video Provider is NOT VALIDATED.

## Current limits and the next release

0.7 does not contain an arbitrary plugin marketplace, node editor, managed ComfyUI process, Blender adapter, infinite canvas, edit timeline, subtitles, BGM or final renderer. The package remains 0.6.0 and SQLite remains v9.

The only prerequisite before a 0.7 Release Candidate is a separate release task that accepts this frozen architecture baseline, changes package/product version to 0.7.0, builds the installer and validates upgrade/install/uninstall. Packy full live E2E and a real Video Provider remain explicitly unvalidated product capabilities; they are required only before a release advertises those suppliers as production-ready.
