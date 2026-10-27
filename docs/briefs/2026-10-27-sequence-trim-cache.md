# Codex task from G+C (planner/auditor only -- you implement)
Work in this SAME Codex Desktop thread (do not open a new chat). User is away; commit+push when green.

## Context
Repo: D:\Backup\Documents\ChatGPT\AI-ShortDrama-Director
Branch: codex/09-01-test-ready-alpha
Tip (pushed): 317985c feat: remove project timeline clips and sync draft selection
Prior notes: docs/sequence-timeline-remove-09-06.md, docs/sequence-partial-select-09-04.md, docs/sequence-draft-09-03.md

Known leftover after timeline remove:
- Removing a clip syncs checkboxes and can save an empty draft.
- Re-adding a previously removed shot via checkbox + rebuild uses FULL duration again (existing build rule).
- 09-06 explicitly deferred: no undo stack / no removed-clip in-out cache.

## Goal (single critical path)
On formal project project-sequence path, when the user removes a timeline clip and later re-selects that same shot (same confirmed version) and rebuilds, **restore the previous in/out trim** for that shot if still valid. Offline only. Session/draft-local memory is enough; no new DB schema.

User / system should:
1. Keep a small in-memory (and optionally draft-adjacent) cache of removed clip trims keyed by shotId+versionId while the ProjectVideoSequence panel is mounted / draft lives.
2. On rebuild/build, prefer cached in/out for a returning shot+version when still within source duration and schema-valid; otherwise fall back to full duration (current behavior).
3. Changing confirmed version invalidates that shot cache entry. Clearing project / loading a different history sequence should not leak wrong trims.
4. Document in docs/sequence-trim-cache-09-07.md; extend unit and formal-project offline smoke (build 3 -> trim middle -> remove middle -> recheck+rebuild -> middle in/out restored; cold relaunch expectations documented honestly).
5. Keep remove/empty-draft/export-labeling behavior green.

## Hard constraints
- Do NOT run paid CompShare/Packy/SenseNova generation.
- Do NOT add drag-reorder, transitions, subtitles, multi-track audio, or a full undo stack UI.
- Do NOT relax formal story-order validation or change mute / 100-shot / 600s / 24fps / FFmpeg pipeline beyond trim restore.
- Avoid schema/migration/preload/permission churn if possible; prefer component state or existing sequenceDraft metadata only if already safe.
- Follow AGENTS.md. Conventional commits. No force-push. Prefer this branch.
- UI Chinese for any new user-facing strings.
- Power unstable: when checks PASS, commit AND push to origin immediately.

## Acceptance (report evidence in Desktop)
- Remove a trimmed clip, re-check same shot+version, rebuild: prior in/out restored when still valid
- Version change / invalid cached range falls back to full duration without crashing
- Empty-after-remove + navigate/cold restore still correct; export labeling still distinguishes clip counts
- Zero generation_records / ai_tasks / production_batches on offline smoke
- npm run lint, typecheck, build, test:unit, test:smoke all PASS; git diff --check clean
- Commit + push when green; say so in the Desktop report
- Short note docs/sequence-trim-cache-09-07.md

## Out of scope
Paid E2E, multi-step undo UI, batch-timeline remove, cloud sync, rename exports again.

Start now. Smallest durable trim-restore slice.
