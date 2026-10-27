# Codex task from G+C (planner/auditor only — you implement)
Work in this SAME Codex Desktop thread (do not open a new chat). User is away; commit+push when green.

## Context
Repo: D:\Backup\Documents\ChatGPT\AI-ShortDrama-Director
Branch: codex/09-01-test-ready-alpha
Tip (pushed): 6b2cbbd feat: label formal sequence exports by project and clip count
Prior notes: docs/sequence-partial-select-09-04.md, docs/sequence-export-labeling-09-05.md, docs/sequence-draft-09-03.md

Known gap after partial select + export labeling:
- 「选择成片镜头」勾选 +「建立/重新建立」可改时间线成员，但时间线表格本身没有「移出本镜」入口。
- 用户若想从已建立时间线拿掉一镜，只能改勾选再点重建；希望在时间线行内直接移出，并同步上方勾选与草稿。

## Goal (single critical path)
On formal project 「项目成片」 timeline, allow **removing a clip from the current draft timeline** and **keep checkbox selection + persisted draft in sync**. Offline only.

User / system should:
1. On each timeline row, offer a clear Chinese control (e.g. 「移出时间线」) that removes that shot from `draft.clips` immediately (and via existing `onEdit`/`persist` path).
2. After remove: update `selectedIds` to match remaining timeline shotIds (or equivalent) so checkboxes reflect the timeline; clear ``selectionChanged`` mismatch; persist draft revision.
3. Block empty timeline: if last clip removed, clear draft or show Chinese empty state + disable export/preview; require re-select + 建立 to continue (mirror existing empty-select UX).
4. Preserve in/out of remaining clips; formal story order of remaining clips unchanged; no drag-reorder.
5. Document in `docs/sequence-timeline-remove-09-06.md`; extend offline unit and/or smoke on the formal-project fixture (build 3 clips → remove middle → export/preview asserts only remaining; checkboxes match; navigate/cold restore still OK).

## Hard constraints
- Do NOT run paid CompShare/Packy/SenseNova generation.
- Do NOT add arbitrary drag-reorder, transitions, subtitles, or multi-track audio.
- Do NOT relax formal story-order validation or change mute / 100-shot / 600s / 24fps / FFmpeg pipeline beyond remove+sync.
- Avoid schema/migration/preload/permission churn; reuse sequenceDraft persistence.
- Follow AGENTS.md. Conventional commits. No force-push. Prefer this branch.
- UI Chinese for user-facing strings.
- Power unstable: when checks PASS, **commit AND push** to origin immediately.

## Acceptance (report evidence in Desktop)
- Timeline row can remove a shot; remaining clips keep prior in/out; order stays formal story order among remaining
- Checkboxes above match remaining timeline shotIds without needing an extra rebuild click
- Draft persists across navigate-away / cold relaunch with the reduced set
- Empty-after-remove is blocked with Chinese UX (no export of empty sequence)
- Existing partial-select + export-labeling offline smoke still green; zero generation_records / ai_tasks / production_batches
- npm run lint, typecheck, build, test:unit, test:smoke all PASS; `git diff --check` clean
- Commit + push when green; say so in the Desktop report
- Short note `docs/sequence-timeline-remove-09-06.md`

## Out of scope
Paid E2E, drag-reorder, subtitles, audio, transitions, draft history stack, cloud sync, renaming exports again.

Start now. Smallest durable timeline-remove + checkbox-sync slice.