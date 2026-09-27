# Creator UI Current Audit

Status: 08-00 code-grounded audit · 2026-09-27

Release baseline: `v0.7.0` / `b1d464d91a2e59e02b71ac1b1b7aa76c059982ac`

## 1. Audit scope and evidence

This audit describes the renderer that exists at the release baseline. It does not claim that the 0.8 interface has been implemented. Evidence was taken from:

- `src/App.tsx` and `src/features/workspace/state.ts` for the shell, module registry, top bar, project switcher, save state and primary navigation.
- `src/features/workspace/pages.tsx` for Project, Character, Location, Prop, Storyboard and Generation page composition.
- `src/features/script/ScriptPage.tsx`, `SceneEditor.tsx`, `ImportPanel.tsx`, `DraftCard.tsx`, `BibleEditor.tsx` and `TaskList.tsx` for script editing and text-intelligence flows.
- `src/features/visual/AssetsPage.tsx`, `VisualPanel.tsx`, `AssetReview.tsx`, `ImageApiPanel.tsx` and `ProviderSettingsPage.tsx` for assets, image generation, review and provider configuration.
- `src/features/production/ProductionBoard.tsx`, `src/features/video/*`, `src/features/workflow/WorkflowPanel.tsx` and `src/features/operations/*` for production, tasks, workflows, validation and provenance.
- `src/App.css` and feature CSS files for the current desktop layout and information density.

The audit is intentionally limited to structure and interaction. Visual accessibility still needs keyboard, contrast and screen-reader verification after the 0.8 implementation exists.

## 2. Current shell

`WorkspaceShell` currently renders a two-column layout: a fixed 200 px sidebar and one main column. The top bar carries project name, save state, a global Simple/Advanced toggle and project switcher. All pages render into one `main` element with `max-width: 1500px`; there is no persistent Context Inspector or bottom task drawer.

The current navigation is a flat list of eleven items:

1. 项目
2. 剧本
3. 角色
4. 场景
5. 道具
6. 分镜
7. 生产看板
8. 生成
9. 素材库
10. 设置
11. 验收与维护

This mixes four different levels in one list: project selection, creator stages, domain taxonomies, production execution, and system maintenance. The Simple/Advanced mode changes selected presentation details but does not change this information architecture.

## 3. Current page inventory

| Current route/module or component | What exists today | 0.8 target | Action |
| --- | --- | --- | --- |
| `projects` / `ProjectPage` | Recent projects, all projects, create, open, rename, delete, development seed | Project List outside Project Shell | Keep |
| `scripts` / `ScriptPage` | Script and episode selection, scene tree, scene editor, import, breakdown drafts, Bible suggestions, shot planning and text tasks | 剧本 | Keep |
| `characters` / `CharactersPage` | Character list, inline Bible editor and inline visual production | 资产 · 角色 | Merge |
| `locations` / `LocationsPage` | Location list, inline Bible editor and inline visual production | 资产 · 场景 | Merge |
| `props` / `PropsPage` | Prop list, inline Bible editor and inline visual production | 资产 · 道具 | Merge |
| `storyboard` / `StoryboardPage` | Batch keyframe panel, Storyboard rows, Shot rows, inline visual and legacy video panels | 分镜 | Merge |
| `production` / `ProductionBoard` | Episode/scene/shot summaries, continuity, keyframes, batches, QC, costs and production settings | 生成 + 分镜 + 分镜视频 contextual surfaces | Merge |
| `generation` / `GenerationPage` | Workflow panel, direct image API, direct video API, task center and legacy generation-task rows | 生成 | Merge |
| `assets` / `AssetsPage` | Imported/generated media grid, filters, version review, compare, provenance and storage maintenance | 资产 + 分镜视频 contextual review | Merge |
| `settings` / `ProviderSettingsPage` | Tool readiness, image Provider, ComfyUI workflow/checkpoint, image parameters and video profiles | 项目设置 | Remove from primary navigation |
| `operations` / `OperationsPage` | Setup wizard, backup/restore, release info, validation, paid validation, error center and task center | 验收与维护 | Move to Maintenance |
| `ImportPanel` | Text/file import, parse preview, raw source preservation and confirm | 剧本 · 导入面板 | Keep |
| `DraftCard` | Breakdown/shot-plan draft edit, merge, create, ignore and confirm | 剧本 · 智能分析区 | Keep |
| `BibleEditor` | Detailed Character/Location/Prop data editing | 资产 · Context Inspector | Merge |
| `VisualPanel` | Reference selection, prompt compile/edit, Provider selection and generation | 资产/分镜/生成 contextual actions | Merge |
| `BatchPanel` | Shot selection and keyframe batch preview/submit | 分镜 selection + 生成 queue | Merge |
| `ImageApiPanel` | Direct Tool target, routing, model, request, approval and candidate action | 生成 · 高级设置 and candidate workspace | Move to Advanced |
| `VideoApiPanel` | Direct video tool/profile, mode, frames, estimate/confirm, remote recovery and candidate action | 生成 · 高级设置 + 分镜视频 review | Move to Advanced |
| `WorkflowPanel` | WorkflowRun selector, StepRun list, confirmation, candidate review/adopt and provenance | 制作流程 summary + Task Drawer | Merge |
| `OperationsPage tasksOnly` | Unified text/image/video/QC task list | 制作任务 drawer | Merge |
| `TaskList` | Script-specific AI task list with retry/cancel | 制作任务 drawer filtered by current context | Merge |
| `AssetReview` | Version grid, compare, approve/reject/promote/regenerate and references | Asset/Candidate contextual review | Merge |
| `VideoPanel` | Legacy Provider selection, video prompt, submit and review for a Shot | 分镜视频 legacy detail | Legacy only |
| `ProductionSettings` | Diagnostics, Provider profiles, credentials and capability configuration | 项目设置 · 工具与模型 | Move to Advanced |
| `ProvenancePanel` | Tool/runtime matrix and full generation/workflow provenance | 来源 → 技术详情 | Move to Advanced |
| `SimpleBoard` | Compact production shot summaries and next action | 分镜/生成 compact cards | Merge |
| `SetupWizard` | First-run checks and links to project/settings | Project List onboarding + Maintenance | Merge |

Every Action value in this table uses the frozen 08-00 vocabulary. No listed component is deleted in this step.

## 4. Largest structural problem

The renderer exposes the system's implementation map instead of the creator's production map. A creator who wants to make Shot 08 can encounter the same object through 分镜, 生产看板, 生成, 素材库, a WorkflowRun, a task row, and legacy visual/video panels. Each entry uses different terms and asks the user to reconstruct the relationship between Shot, AssetVersion, AITask, WorkflowRun and GenerationRecord.

The current shell also gives every module equal navigational weight. Project management and settings sit beside creative stages; Character, Location and Prop are three pages although they are one asset discipline; Production Board and Generation overlap; tasks and maintenance occupy full pages even when the user only needs their status.

## 5. Duplicate entry points

### Generation

- `VisualPanel` generates images inline from Character, Location, Prop and Shot rows.
- `BatchPanel` starts keyframe batch work from Storyboard.
- `ProductionBoard` previews/submits keyframes and video batches.
- `ImageApiPanel` and `VideoApiPanel` submit direct Tool generations.
- `WorkflowPanel` starts or resumes workflow generation and also performs review/adopt.
- `VideoPanel` retains a legacy Shot video path.
- `OperationsPage` contains a legacy paid-validation submission path.

0.8 keeps these execution capabilities but presents one creator-facing Generate workspace. Contextual buttons on an Asset or Shot open that workspace with the target already selected.

### Review and adoption

- `AssetReview` approves, rejects and promotes versions in the library.
- `WorkflowPanel` approves/rejects candidates and adopts them to a Shot.
- `ProductionBoard` reviews keyframes/video and confirms Shot bindings.
- `VideoPanel` contains legacy video review.

0.8 places the candidate beside the current official version in the selected Asset or Shot. “设为主参考” and “设为当前镜头视频” are the principal user actions; internal AssetVersion actions remain traceable in Source Details.

### Tasks

- Script shows `TaskList` in its intelligence panel.
- Generation embeds `OperationsPage tasksOnly`.
- Production Board shows batches and per-shot progress.
- WorkflowPanel exposes current StepRun and related Task IDs.
- OperationsPage shows a full error/task center.

0.8 consolidates these into the global 制作任务 drawer, with page-specific status still visible on the affected card.

### Settings and readiness

- `ProviderSettingsPage` contains Tool readiness, ComfyUI/image settings and video production settings.
- `ProductionBoard` exposes production settings and Provider capability in a page-level details block.
- Generation direct panels expose Tool/model/routing controls again.
- Operations exposes validation and setup shortcuts.

0.8 puts durable configuration in Settings, runtime/diagnostic evidence in Maintenance, and only the minimum corrective link in the current task.

## 6. Technical information overexposure

| Current location | Default technical information | 0.8 treatment |
| --- | --- | --- |
| `WorkflowPanel` | WorkflowRun ID/type, StepRun status, Task ID, GenerationRecord ID, AssetVersion ID, execution flags | Creator-facing “制作流程”; IDs under 来源 → 技术详情 |
| `ImageApiPanel` | Direct Tool Generation, routing mode, Tool ID, model, approval ceiling and raw task/record results | “高级设置”; confirmation uses tool/model/count/cost/upload only |
| `VideoApiPanel` | Tool profile, capability mode, controlled version IDs, micro-cost ceiling and remote task controls | “高级设置”; recovery surfaced as plain task action |
| `VisualPanel` | Provider selector, Prompt Compiler version, positive/negative Prompt and workflow-oriented choices | Default “生成描述”; full Prompt and Tool selection collapsed |
| `ProductionBoard` | Provider capability, task/shot/scene/episode cost details, QC internals and profile quote selection | Contextual summary; deeper evidence in Source Details or Maintenance |
| `AssetsPage` / `AssetReview` | Source type, raw version state, IDs and provenance records | Human labels on cards; exact records in Source Details |
| `OperationsPage` | Validation checklist, runtime status, restart recovery and paid-validation internals | Maintenance only |
| `ProviderSettingsPage` | Workflow JSON, checkpoint, steps, CFG, seed and capability profile | Settings; Provider-specific fields visible only for the selected Tool |

## 7. Broken creator journey

1. Opening a project does not enter a creative stage; the module remains `projects`, so the user must choose another navigation item.
2. There is no Story page. Project description/genre exist, but creative concept, synopsis, world and requirements do not have a dedicated workspace.
3. Character, Location and Prop authoring are separate pages while their media versions live in 素材库. A user moves between an entity list, inline Bible details, an inline generator and the library to finish one asset.
4. Storyboard is a generic entity list with nested panels. Shot sequence, visual hierarchy and multiple-shot scanning are secondary to rows and expandable forms.
5. Production Board and Generation both look like valid production homes. The system does not clearly distinguish “plan a Shot”, “generate it” and “review its video”.
6. Selecting a Shot in one page does not define shared Scene/Shot context for the next page. Moving from Shot 08 to Generate requires selecting the target again.
7. A finished generation can send the user through tasks, WorkflowRun steps, GenerationRecord and AssetVersion before review. The creator-facing result is not always the immediate next surface.
8. System terminology varies by feature: queued/running/waiting-user/candidate/approved/adopted coexist with Chinese business states.

## 8. Pages to merge

- Merge Character, Location and Prop pages with the relevant media/version portions of AssetsPage into one 资产 workspace with three tabs.
- Merge StoryboardPage, the compact parts of SimpleBoard and Shot planning/continuity parts of ProductionBoard into the 分镜 workspace.
- Merge creator-facing generation controls from ProductionBoard, WorkflowPanel, ImageApiPanel, VideoApiPanel and VisualPanel into 生成.
- Merge video playback, candidate comparison and current Shot video binding from ProductionBoard, AssetsPage and new Tool paths into 分镜视频.
- Merge script AI task rows and the general task center into the global 制作任务 drawer while keeping inline status on the source Scene.
- Merge asset/version review actions into the selected Asset or Shot context instead of a separate review destination.

## 9. Content moved to Advanced, Settings or Maintenance

### Advanced within the current task

- Full positive/negative prompt, Tool selection, model, seed, resolution, duration, aspect ratio, Provider-specific parameters and detailed estimate.
- Direct Tool controls that are still required for expert diagnosis.
- SourceDetails with GenerationRecord, WorkflowRun, StepRun, PromptPackage, RoutingDecision, Tool version and immutable IDs.

### Settings

- Tools, models, credentials, ComfyUI base URL/checkpoint/template, cloud Provider profiles, default routing preferences and storage choices.

### Maintenance

- Tool readiness, runtime status, backup/restore, diagnostics, release/schema/backup versions, full error history, validation fixtures and legacy paid-validation flows.

## 10. Existing strengths to preserve

- The script editor already has the correct broad three-region pattern and structured Scene data.
- Unsaved-change protection and save-state feedback already exist globally.
- AI text results already follow Draft → human review → formal object.
- Media already follows Candidate → review → adopt and preserves versions.
- Project Core, preload/IPC boundaries and the 0.7 production records are already separated from renderer components.
- Current pages include actionable empty states, focus-visible styling and explicit error regions that can be standardized rather than discarded.

## 11. Audit decision

The 0.8 change is a view and interaction reorganization over existing capabilities. It does not replace the 0.7 execution architecture. The six-stage Creator Journey becomes the only primary production navigation; technical and maintenance surfaces remain available at lower hierarchy.
