# Codex task from G+C (planner/auditor only -- you implement)
Work in the SAME Codex thread/cwd for this repo. User is away; commit+push when green. Do not open a new Desktop chat window.

## Context
Repo: D:\Backup\Documents\ChatGPT\AI-ShortDrama-Director
Branch: codex/09-01-test-ready-alpha
Tip (pushed): e4f6f3c fix: make formal sequence export filename suggestions unique
Prior notes: docs/sequence-export-labeling-09-05.md, docs/sequence-export-unique-name-09-08.md

Known leftover after export labeling:
- Library asset name / history use sequenceClipLabel -> `N 镜头` / `镜数未知`.
- Original labeling brief also allowed shot-number range (or 集·场·镜 labels) from metadata.sequence; only clip count landed.
- Two exports with different shot subsets but same count still look identical in history text (filenames now unique via version UUID).

## Goal (single critical path)
On formal project 「项目成片」 history + new library asset naming path, surface a **shot-number range (or compact shot labels)** from existing `metadata.sequence` so a 2-clip export of shots 1+3 is distinguishable from shots 1+2 without opening the player. Offline only.

User / system should:
1. Extend sequenceClipLabel (or sibling helper) to include shot-number range when project shots are available (e.g. `2 镜头 · 镜1-2` / `2 镜头 · 镜1,3`); if shots missing, keep clip count / 镜数未知 fallback.
2. Use it for new localAssembly / library display name AND 「已导出成片」 row secondary text (keep date · duration · resolution).
3. Do not rewrite old asset names on disk beyond what display already derives; no schema/migration.
4. Document in docs/sequence-history-shot-range-09-09.md; extend unit + formal-project offline smoke (partial 1+3 vs full 1+2+3 labels differ).
5. Keep unique defaultPath, remove, trim-cache offline smoke green; zero paid generation.

## Hard constraints
- Do NOT run paid CompShare/Packy/SenseNova generation.
- Do NOT add drag-reorder, transitions, subtitles, multi-track audio.
- Do NOT relax formal story-order validation or change mute / caps / FFmpeg pipeline.
- Avoid schema/migration/preload/permission churn.
- Follow AGENTS.md. Conventional commits. No force-push. Prefer this branch.
- UI Chinese for user-facing strings.
- Power unstable: when checks PASS, commit AND push to origin immediately.

## Acceptance (report evidence in Desktop/CLI)
- History/library label for a 2-clip partial export differs from a same-count different-subset or a 3-clip export without opening player
- Missing/malformed sequence still shows 镜数未知 (or count-only) safely
- Unique defaultPath + remove + trim-cache behaviors remain green
- Zero generation_records / ai_tasks / production_batches on offline smoke
- npm run lint, typecheck, build, test:unit, test:smoke all PASS; git diff --check clean
- Commit + push when green; say so in the report
- Short note docs/sequence-history-shot-range-09-09.md

## Out of scope
Paid E2E, renaming historical files on disk, undo stack, batch-timeline remove, cloud sync.

Start now. Smallest durable shot-range history label slice.
