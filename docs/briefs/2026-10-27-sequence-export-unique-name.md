# Codex task from G+C (planner/auditor only -- you implement)
Work in this SAME Codex Desktop thread (do not open a new chat). User is away; commit+push when green.

## Context
Repo: D:\Backup\Documents\ChatGPT\AI-ShortDrama-Director
Branch: codex/09-01-test-ready-alpha
Tip (pushed): 1cc4e5b feat: restore removed sequence trims within the panel session
Prior notes: docs/sequence-export-labeling-09-05.md, docs/sequence-trim-cache-09-07.md, docs/sequence-timeline-remove-09-06.md

Known leftover after export labeling:
- Formal project save dialog suggests `项目名-成片-N镜头.mp4`.
- Same project + same clip count still suggests the SAME default name on later exports.
- 09-05 deferred unique timestamp / export version stack; users must rename manually in the native dialog.

## Goal (single critical path)
On formal project project-sequence export only, make the **suggested defaultPath uniquely distinguishable across repeated exports** with the same clip count, without changing mute/order/FFmpeg. Offline only.

User / system should:
1. Append a compact local timestamp (or equivalent unique local suffix) to the suggested filename, e.g. `项目名-成片-2镜头-20261027-143752.mp4` (exact pattern ok if documented and Windows-safe).
2. Keep existing project-name sanitization + clip-count labeling; library asset name / history clip-count labels can stay as-is unless a tiny consistency tweak is needed.
3. Do NOT invent a cloud version stack, schema migration, or rename already-exported assets.
4. Document in docs/sequence-export-unique-name-09-08.md; extend unit + formal-project offline smoke (two exports with same clip count yield different defaultPath suggestions; Windows illegal chars still sanitized).
5. Keep partial-select / remove / trim-cache offline smoke green; zero paid generation.

## Hard constraints
- Do NOT run paid CompShare/Packy/SenseNova generation.
- Do NOT add drag-reorder, transitions, subtitles, multi-track audio.
- Do NOT relax formal story-order validation or change mute / 100-shot / 600s / 24fps / FFmpeg pipeline beyond defaultPath naming.
- Avoid schema/migration/preload/permission churn.
- Follow AGENTS.md. Conventional commits. No force-push. Prefer this branch.
- UI Chinese for any new user-facing strings.
- Power unstable: when checks PASS, commit AND push to origin immediately.

## Acceptance (report evidence in Desktop)
- Two same-clip-count formal exports in one offline run suggest different defaultPath strings
- Sanitization + clip-count segment still present; native dialog still chooses final path
- Existing history clip-count labels / trim-cache / remove behaviors remain green
- Zero generation_records / ai_tasks / production_batches on offline smoke
- npm run lint, typecheck, build, test:unit, test:smoke all PASS; git diff --check clean
- Commit + push when green; say so in the Desktop report
- Short note docs/sequence-export-unique-name-09-08.md

## Out of scope
Paid E2E, export version DB stack, auto-rename of old assets, cloud sync, batch-timeline naming.

Start now. Smallest durable unique-defaultPath slice.
