# Codex task from G+C (planner/auditor only — you implement)
Work in Codex Desktop so the user can watch progress and quota.

## Context
Repo: D:\Backup\Documents\ChatGPT\AI-ShortDrama-Director
Branch: codex/09-01-test-ready-alpha
Tip (local, may be unpushed): f629535 docs briefs; 86bed47 sequence draft persist; f35761d shot-video UX
Notes: docs/shot-video-ux-09-02.md, docs/sequence-draft-09-03.md
Known gap: 「用已确认视频建立时间线」always takes **all** valid confirmed shots — no partial selection.

## Goal (single critical path)
On the formal project 「项目成片」 path, let the user **choose a subset** of currently valid confirmed shots when building (or rebuilding) the timeline/sequence draft, then export offline as today.

User should be able to:
1. See the list of valid confirmed shots (episode/scene/shot order)
2. Toggle which ones to include (default: all selected is OK)
3. Build/rebuild sequence from the checked set only
4. Persist that selection via existing `sequenceDraft` (already ships) so navigate-away / relaunch keeps the chosen clips + in/out
5. Export MP4 from that draft with fixtures (same mute / caps OK)

## Hard constraints
- Do NOT run paid CompShare/Packy/SenseNova generation.
- Do NOT add arbitrary free reorder, transitions, subtitles, or multi-track audio.
- Keep story order among the selected shots (subset of formal order, not a new order).
- Mute export and 100-shot / 600s caps may remain; document if unchanged.
- Follow AGENTS.md. Conventional commits. No force-push. Prefer this branch.
- UI Chinese for user-facing strings.

## Acceptance (report evidence in Desktop)
- UI can build a 2-shot formal fixture timeline while leaving at least one other confirmed shot out
- Draft (selected clips + in/out) survives navigate-away and cold relaunch
- Export still works; skipped/unselected shots are not in the MP4
- Empty selection is blocked with a clear Chinese message
- npm run lint, typecheck, build, test:unit, test:smoke all PASS
- Commit locally; push only if checks pass OR leave unpushed and say so
- Short note in docs/ (sibling like sequence-partial-select-09-04.md) listing what was added and what still does not

## Out of scope
Paid E2E, drag-reorder, subtitles, audio mix, Blender, seedance.

Start now. Smallest durable subset-select over new architecture.
