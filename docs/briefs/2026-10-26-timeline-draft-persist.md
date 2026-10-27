# Codex task from G+C (planner/auditor only — you implement)
Work in Codex Desktop so the user can watch progress and quota.

## Context
Repo: D:\Backup\Documents\ChatGPT\AI-ShortDrama-Director
Branch: codex/09-01-test-ready-alpha
Just landed (may be unpushed): f35761d feat: wire confirmed shot videos into project sequence export
Acceptance notes: docs/shot-video-ux-09-02.md
Known gap from that acceptance: **timeline/sequence draft is lost when leaving the page** if not exported.

## Goal (single critical path)
Persist the formal project's confirmed-shot selection and timeline/sequence draft across navigation / app relaunch (local project state or DB — match existing patterns). User should be able to:
1. Confirm/adopt shot videos into the formal project
2. Leave the sequence/timeline view and come back later — draft still there
3. Still export MP4 from the restored draft (offline/fixture OK)

## Hard constraints
- Do NOT run paid CompShare/Packy/SenseNova generation.
- Do NOT expand into full NLE (no subtitle track / arbitrary multi-track audio unless already trivial).
- Mute export and 100-shot / 600s caps may remain; document if unchanged.
- Follow AGENTS.md. Conventional commits. No force-push. Prefer this branch.
- UI Chinese for user-facing strings.

## Acceptance (report evidence in Desktop)
- Draft survives navigate-away and cold relaunch for a formal project
- Export still works from restored draft with fixtures
- npm run lint, typecheck, build, test:unit, test:smoke all PASS
- Commit locally; push only if checks pass OR leave unpushed and say so
- Short note in docs/ (update shot-video-ux doc or add a sibling) listing what persists and what still does not

## Out of scope
Paid E2E, Blender, seedance experiments, rewriting batch engine.

Start now. Smallest durable persistence over new architecture.
