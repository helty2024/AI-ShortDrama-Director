# Codex task from G+C (planner/auditor only — you implement)

## Context
Repo: D:\Backup\Documents\ChatGPT\AI-ShortDrama-Director
Branch: codex/09-01-test-ready-alpha (synced with origin; tip includes commits 9b01d4e / 5e9cf5e / 514f617 for execution-binding, video-batch+timeline export, docs).
G+C will audit and accept; do not wait for G+C to write code.

## Goal (single critical path)
Wire already-landed **video batch** + **timeline sequence export** into the **formal project UX** so a user can, offline/with fixtures (NO new paid CompShare/Packy generation):
1. Confirm / promote shot videos into the formal project
2. Build a timeline from confirmed assets
3. Export an MP4 sequence

## Hard constraints
- Do NOT run paid real generation (no CompShare H3 paid, no Packy paid spend).
- Do NOT restart unrelated large refactors (seedance experiments, Blender, skill A/B).
- Follow AGENTS.md. Conventional commits. No force-push. Prefer this branch or `codex/09-02-shot-video-ux` if you need isolation.
- Keep UI Chinese where user-facing.

## Acceptance (must report evidence)
- Formal project path: confirm candidates → timeline → export MP4 works with fixture/offline media
- `npm run lint`, `typecheck`, `build`, `test:unit`, `test:smoke` all PASS
- Commits landed locally; push only if checks pass (or leave unpushed and say so)
- Final message: files changed, how to verify in UI, command results, remaining gaps

## Out of scope
Paid E2E, SenseNova network diagnosis, Blender previz.

Start now. Prefer smallest UX wiring over new architecture.
