# 0.8 Creator UI Closeout — RC readiness

This is a closeout of the 0.8 development UI on `main`, not an 0.8 release or RC package. The start point was `641cd5f157b8483018d20a0c55771d387c6c96d8` with a clean worktree. The published `v0.7.0` tag remains untouched. Package version is `0.7.0`, SQLite schema is `10`, and backup format is `5`.

## Creator Journey and six pages

The default route is 故事 → 剧本 → 资产 → 分镜 → 生成 → 分镜视频. Project settings and 验收与维护 are secondary; production and legacy tools remain accessible in advanced/compatibility views, not on the primary route. A fresh project can create its first Script, Episode, Scene, Character, Location, Prop and Shot without a Legacy detour. Creating a Shot now creates its Episode's storyboard draft through the existing workspace API if one is missing. This is a UI workflow repair, not a new production model.

| Page | Closeout state |
| --- | --- |
| 故事 | Story fields auto-save with revision checks; Scene context survives a Story round trip. |
| 剧本 | Episode/Scene tree, editor, ordering, deletion and undo/redo remain available. |
| 资产 | Raw media is imported as a candidate; approval does not set the primary. Only explicit “设为主参考” does. |
| 分镜 | Shot order and exact confirmed keyframe binding are shown; candidates do not impersonate fixed media. |
| 生成 | Asset Direct Image and Shot Keyframe Workflow use preview/confirm/review/adopt. Video creation is guarded by Video Tool readiness. Preview exposes the compiled Prompt and compiler version under advanced details. |
| 分镜视频 | Exact confirmed asset+version is played through the controlled media protocol. Candidates remain separate; history remains readable without a current Video Tool. It is not a timeline. |

The fresh-project Electron journey exercises image import, candidate approval, explicit primary selection, Shot creation/editing, keyframe Preview → Confirm → Candidate → Approve → Adopt, fixed-keyframe return, and the unavailable Video tab. The representative existing-production journey combines a character primary reference, a fixed Shot keyframe, a confirmed video, a GenerationRecord and WorkflowRun, then restarts without the test Video Tool and plays the confirmed video. Other isolated tests exercise independent video candidates and their explicit approval/adoption.

## Compatibility and safety

The 08-04 identity fix remains in force: importing with `assetId=null` creates a new raw Asset even for duplicate bytes. Import with a specified `assetId` deduplicates only within that Asset. Import never demotes a referenced primary; approving a candidate never changes an official binding. Shot keyframes and videos require separate explicit adoption. Existing Legacy Character/Location/Prop, raw Asset Library, ProductionBoard, Legacy Generation, VisualPanel/AssetReview, Operations, Diagnostics and Backup entry points remain present.

Story migration adds empty defaults for historical projects without altering older identity or production history. Restore accepts format 1/schema 6, 2/7, 3/8, 4/9 and 5/10 into schema 10. Restored tasks/workflows are historical (`executionAllowed=false`), not reauthorized. Unknown image/video submission tests retain their original remote identity and do not automatically resubmit. Currency entry uses exact micro-unit conversion and rejects invalid, over-precision, negative and overflowing values. Creator media uses version-scoped `director-media://asset/` access rather than arbitrary filesystem paths.

## Responsive and evidence

The closeout smoke stores 13 screenshots under `test-results/creator-closeout/`: 2560×1440 Story, Script, Assets, Storyboard, Generate-Keyframe, Generate-Video-Unavailable and ShotVideos; 1920×1080 Story, Script, Assets, Storyboard, Generate and ShotVideos. These are test artifacts, not committed assets. At 2560 the Inspector is a right rail and the main canvas remains dominant. At 1920 navigation is compact and the Inspector is an overlay; the test compares main width before/after opening and checks document horizontal overflow. Escape closes the overlay. The TaskDrawer is a separate read-only projection and is not a seventh Creator page.

Screenshot review found no blocking clipping, duplicate permanent right rail, technical identifier on the primary canvas, or forced Legacy detour. It did reveal a visible Legacy provenance label in the Asset Inspector; the source block now defaults to a collapsed “来源详情” disclosure, retaining its audit trail. The minimal one-item grid is naturally sparse; a richer design pass is outside this closeout. A short asynchronous asset-card refresh after adoption was observed and guarded in smoke by waiting for its confirmed state before capture.

## Test gates and release decision

Required gates: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build`, `npm run test:smoke`. The Electron smoke includes the full fresh journey, existing production/restart journey, responsive screenshots, project/context navigation, error-boundary recovery, and unknown-submission guards. Unit tests cover migrations, restore, Script/Story persistence, Asset identity and primary protection, fixed bindings, ComfyUI fixture replay, monetary conversion and workflow semantics. No real GPU or paid-provider call is required for this closeout.

Known limitations: packaged desktop has no registered real Video Tool; Reference Video Protocol is test-only; `shot.imagePrompt` is a Legacy field and not the submitted keyframe Prompt; Shot Videos is not a Timeline; there is no Final Movie Editor or Canvas; Blender is not wired into the Creator main route; Legacy technical pages are retained. No Seedance, Kling, Veo, Sora or Runway compatibility is claimed for Creator video generation.

RC packaging is ready only if all gates pass and there are zero release blockers: no data loss/migration/restore error, implicit adoption, cross-project context leak, unknown resubmit, unusable 1920 main workspace, packaged test Video Tool, Legacy dependency in the fresh journey, candidate substitution for fixed media, arbitrary-path media access, or failed test/build gate. This document records readiness for a later packaging decision; it does not change versions, create a tag, or itself ship a release.
