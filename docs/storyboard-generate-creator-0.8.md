# 08-05 · Storyboard + Generate Creator Pages

The Creator Shell now mounts a compact Storyboard board and a goal-oriented Generate page. This UI does not replace the 0.7 production services. Legacy Workflow, Image API, Video API, and batch panels remain in the technical compatibility entry.

## Storyboard and context

- Up to 30 Shots render as one continuous board; above 30 they group by Scene. Collapse is renderer view state only and does not reorder persisted Shots.
- A formal thumbnail resolves only the Shot's pinned `approvedKeyframeVersionId`. An unpinned output can appear only with a visible Candidate label.
- The Shot inspector shows context and edits `description` / `plan` through a narrow, revision-checked `shot.save` command. Scene-local up/down ordering validates full membership and uses the Scene revision; deletion is explicit and rejects Shots with production history. Generate's **编辑分镜描述** returns to that Shot; **去生成** returns with the same selection.
- Status is derived from Workflow runs, tasks, candidates, and pinned bindings. Video Tool absence means **不可用**, not a failed Shot. A confirmed video remains confirmed even when the tool is later removed.

## Generation targets and review

- Shot Keyframe uses the existing `shot-keyframe` Workflow. Shot Video uses `shot-video` only when a Video Tool profile exists. Character, Location and Prop reference images use Direct Image API because there is no Asset Workflow.
- The Shot Keyframe path uses confirmed primary Bible references and, where applicable, the previous confirmed keyframe. Draft Candidate media is never silently used as input.
- Candidates are resolved by explicit target identity and generation output. Approval and adoption are separate user actions; approval does not change a Shot binding or Asset primary reference. Rejected versions remain in history. Source details provide provenance and technical data without making IDs primary UI copy.
- Cloud confirmation shows tool, model, dimensions, upload scope and a normal currency-unit ceiling. Conversion to integer micro-units rejects excessive precision, negative input and overflow. Local known-free ComfyUI still requires explicit confirmation and does not include local electricity/GPU cost.
- Unknown remote submission is not retried automatically. The user may refresh/recover the existing task; the existing main-process no-resubmit guard remains in force.

## Video Tool Readiness

The packaged desktop currently has **zero registered real Video Tools**. The Video tab stays visible and says **尚未配置可用的视频生成工具**, with a link to the existing project settings and technical details. Creator UI guards Workflow creation before any empty Tool ID can be submitted. The main-process `Video API 未配置` check remains the final boundary. An unpackaged, isolated smoke-test composition can explicitly inject the Reference Video Adapter with `DIRECTOR_TEST_VIDEO_ORIGIN` bound to an exact loopback fixture origin; it is never a packaged default or an imported production profile. Reference Video Protocol is for controlled tests only and is not evidence of compatibility with Seedance, Kling, Veo or any paid provider. Real Video Provider Configuration & Validation is deferred to 08-07 or a dedicated Tool Integration step, requiring real documentation, a sanitized fixture, local replay and one authorized paid E2E.

## Keyframe Prompt Semantics

`shot.imagePrompt` remains a Legacy field and is **not** the authority for Image API / Keyframe Workflow. It is preserved in storage and hidden in normal Creator UI. The authoritative inputs are Shot description/plan, Bible, continuity and confirmed references passed to the main-process Prompt Compiler. Normal Keyframe UI shows **生成依据**; only after preview does Advanced Generation show the server-returned compiled Prompt, Negative Prompt, compiler version, Tool, Model and reference count. Video differs: `shot.videoPrompt` remains the production service's first non-empty Shot fallback, after explicit input prompt and before direction/plan/description. No Video API fallback order was changed.

## Boundaries

No Tool Protocol, Broker, Routing, Approval, Reservation, GenerationRecord or Workflow transition was changed. No schema migration or backup-format bump: package `0.7.0`, SQLite schema `10`, backup format `5`.
