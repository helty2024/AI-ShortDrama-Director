# Codex task from G+C (planner/auditor only — you implement)
Work in Codex Desktop so the user can watch progress and quota.

## Context
Repo: D:\Backup\Documents\ChatGPT\AI-ShortDrama-Director
Branch: codex/09-01-test-ready-alpha
Tip (pushed): 991d9c4 docs brief for partial select; 3bf0997 partial confirmed shot selection; 86bed47 sequence draft persist; f35761d shot-video UX
Notes: docs/shot-video-ux-09-02.md, docs/sequence-draft-09-03.md, docs/sequence-partial-select-09-04.md
Known gap after partial select: multiple subset exports look identical — save dialog defaults to `短剧成片.mp4`, library asset name is always `成片 · 已确认镜头`, and「已导出成片」only shows date · duration · resolution (no clip count / shot range).

## Goal (single critical path)
On the formal project 「项目成片」 path, improve **export naming and history labeling** so a 2-clip partial export is distinguishable from a 3-clip (or other) export without opening the player. Offline only.

User / system should:
1. Suggest save-dialog `defaultPath` from project name + clip count (optional duration or local timestamp); sanitize for Windows filenames — not only `短剧成片.mp4`
2. Give richer `localAssembly` / in-library asset name (e.g. include 镜数 or 镜号范围), not only `成片 · 已确认镜头`
3. Surface clip count and/or shot-number range (or 集·场·镜 labels) on「已导出成片」rows from existing `metadata.sequence` (already written on export)
4. Keep mute / 100-shot / 600s / 24fps / formal story order unchanged; document in `docs/sequence-export-labeling-09-05.md`
5. Extend offline unit + smoke for naming/history text via existing formal-project fixture path

## Hard constraints
- Do NOT run paid CompShare/Packy/SenseNova generation.
- Do NOT add arbitrary drag-reorder, transitions, subtitles, or multi-track audio.
- Do NOT relax formal story-order validation.
- Do NOT change export caps, mute policy, or FFmpeg pipeline beyond labels/naming.
- Avoid schema/migration/preload/permission churn beyond what naming needs.
- Follow AGENTS.md. Conventional commits. No force-push. Prefer this branch.
- UI Chinese for user-facing strings.
- Power is unstable: when checks PASS, **commit AND push** to origin on this branch immediately (do not leave unpushed).

## Acceptance (report evidence in Desktop)
- After fixture export, native save dialog default filename is project-derived and not only `短剧成片.mp4`
- New library asset name (or history label) distinguishes a 2-clip partial export from a 3-clip full export without opening the player
-「已导出成片」row shows clip count and/or shot-number range from `metadata.sequence`
- Existing navigate-away / cold-relaunch draft + partial-select smoke still green; zero generation_records / ai_tasks / production_batches
- npm run lint, typecheck, build, test:unit, test:smoke all PASS; `git diff --check` clean
- Commit + push locally when green; say so in the Desktop report
- Short note `docs/sequence-export-labeling-09-05.md` listing naming/history gains and that reorder/subtitles/audio remain out

## Out of scope
Paid E2E, drag-reorder, subtitles, audio mix, transitions, draft history stack, cloud sync, Blender, seedance.

Start now. Smallest durable export-labeling slice over new architecture.
