# Creator UI Baseline v1

Status: **DESIGN BASELINE FROZEN** · Step 08-00 · 2026-09-27

Applies after: `v0.7.0` / `b1d464d91a2e59e02b71ac1b1b7aa76c059982ac`

Implementation state: design only; no 0.8 renderer or data-model work is included.

## 1. Product UX Goal

AI ShortDrama Director presents as an AI-native short-drama production workspace. The interface is organized by the next creative decision, not by Provider, API, Tool, task record or database type.

The default experience must let a creator answer three questions at any point:

1. What am I making now?
2. What is the next useful action?
3. Which result is currently official?

The product uses professional desktop density, clear working regions and contextual controls. It must not resemble a SaaS administration dashboard, API console, ComfyUI replacement graph, database browser or generic task-monitoring application.

## 2. Core Creator Journey

The only primary production sequence is:

**故事 → 剧本 → 资产 → 分镜 → 生成 → 分镜视频**

- 故事 establishes intent.
- 剧本 turns intent into episodes and structured scenes.
- 资产 establishes reusable Character, Location and Prop bibles and their main references.
- 分镜 turns scenes into ordered Shots and confirms keyframes.
- 生成 produces and reviews image/video candidates for the selected Shot.
- 分镜视频 shows current and candidate Shot videos in story order.

The sequence guides navigation; it is not a hard gate. A creator may return from 分镜 to adjust an asset, import an existing asset, or open 生成 before every asset is complete. Missing prerequisites are explained at the action point.

## 3. Information Architecture

### Outside the project

- Project List: create, open, rename, delete and recent projects.
- First-run guidance: create/open a project; configuration problems link to Settings or Maintenance.

### Inside Project Shell

Primary navigation, fixed order:

1. 故事
2. 剧本
3. 资产
4. 分镜
5. 生成
6. 分镜视频

Secondary destinations, visually separated at the bottom:

- 项目设置
- 验收与维护

项目概览 may exist as a lightweight entry state but is not a seventh production stage. Tasks, Provider management, approval, routing and provenance are not primary destinations.

### Context model

The shell maintains conceptual Project Context, optional Scene Context, optional Shot Context, optional Asset Context and optional Candidate Context. These names describe 0.8 UX behavior only; Step 08-00 does not add state or persistence.

Contextual transitions preserve the most specific valid selection. For example, “为 Shot 08 生成” opens 生成 with Shot 08 selected; “查看分镜” returns to Shot 08; “编辑角色参考” opens the referenced Character in 资产.

## 4. Global Project Shell

Target structure:

```text
┌────────────────────────────────────────────────────────────────┐
│ TopBar                                                        │
├──────────┬───────────────────────────────────┬─────────────────┤
│          │                                   │                 │
│ Project  │          Main Workspace           │ Context         │
│ Nav      │                                   │ Inspector       │
│          │                                   │                 │
├──────────┴───────────────────────────────────┴─────────────────┤
│ Task Drawer: collapsed status / expanded task list             │
└────────────────────────────────────────────────────────────────┘
```

### ProjectNav

- Expanded width: 200–220 px; default expanded.
- Collapsed width: icon rail, approximately 56–64 px.
- Header: back to Project List and current project name.
- Body: the six primary stages in the frozen order.
- Footer: 项目设置 and 验收与维护 with reduced emphasis.
- Current stage is identified by position, label and state, not color alone.

### TopBar

- Height: 48–56 px.
- Contains project name, current module, save status, one global running-status entrance, settings and required window actions.
- Project switcher may remain accessible without dominating the bar.
- It does not hold large titles, multi-level breadcrumbs or implementation status badges.

### Main Workspace

- Owns page title, page-level primary action and creative content.
- Uses the remaining width before Inspector and respects minimum working widths.
- Has one dominant action per local region.

### ContextInspector

- Expanded width: 320–360 px.
- Optional and collapsible; automatically changes with selection.
- Does not permanently show Provider configuration.

### TaskDrawer

- Collapsed by default to a one-line production status.
- Expanded height: 260–320 px.
- Does not replace page-level status or candidate review.

## 5. Story

Purpose: transform an idea into stable project creative context.

### Main workspace

- Story name
- 一句话概念
- 故事梗概
- 类型
- 风格
- 世界观
- 创作要求

The page reads like a writing surface, with the synopsis and world fields given more space than metadata. Save status is global; field-level validation appears beside the affected input.

Existing `Project.name`, `Project.description` and `Project.genre` can support the first implementation mapping. 一句话概念、风格、世界观、创作要求 are frozen UI requirements but are not claimed to exist in the 0.7 schema; any persistence change requires a later explicit task and migration review.

Reserved contextual actions such as AI 辅助整理、AI 扩写 and AI 结构化 may occupy a secondary action area in later work. They are not implemented by this baseline and do not expose Tool, Model, PromptPackage or GenerationRecord.

Empty state: “先写一句话概念，建立这个短剧的创作方向。” with one primary action to begin editing.

## 6. Script

The current structured editor is retained and reorganized around the script text.

### Left: Episode / Scene structure

- Script selector only when a project has multiple scripts.
- Episode groups with rename/delete in a contextual menu.
- Ordered Scene rows: scene number, heading, short status.
- New Episode and New Scene actions.
- Reorder via keyboard-accessible controls initially; drag can be considered later.

### Center: Script editor

- Current scene heading, interior/exterior, location and time of day.
- Character references.
- Action, structured dialogue, narration and director notes.
- Undo/redo and save state without competing AI controls.

### Right: Scene Inspector

- Current Scene attributes.
- Referenced Characters and Location.
- Continuity summary and issues.
- Smart breakdown/import is a contextual tab or drawer, not a permanent Provider console.

Import keeps its existing Preview → confirm → write boundary and preserved source text. Breakdown and shot-planning drafts remain human-reviewed. AI tasks appear inline as a compact status and globally in TaskDrawer.

## 7. Assets

Assets unifies Character, Location and Prop production. Source or Tool never creates a separate asset category.

### Header

- Tabs: 角色 / 场景 / 道具.
- Search and relevant compact filters.
- One primary action: create the selected asset type.
- Import is secondary and may create a version for a selected asset.

### Main grid

- Dense AssetCard grid.
- Each card shows thumbnail, name, asset type, current main version and user status.
- Default status language: 草稿、待审核、已确认 or a shared vocabulary state.
- Multiple cards remain visible at 2560×1440; cards do not use oversized padding or decorative empty space.

### Inspector

- Bible description and structured fields for the selected Character, Location or Prop.
- Main reference.
- Candidate versions.
- Contextual generation entry.
- Source summary, then expandable technical details.

Candidate review happens inside the selected asset. The primary adoption label is **设为主参考**. AssetVersion IDs, source type and internal status stay in SourceDetails.

The generic media library remains useful for imported video/audio/document and storage inspection, but it is not a seventh primary stage. Non-Bible media can be reached from contextual source/details or Maintenance until a later information-architecture decision.

## 8. Storyboard

Storyboard is a compact Shot Board, not a generic entity list or admin table.

### Page composition

- Header: Episode and Scene scope, view controls and one “新增镜头” primary action.
- Optional compact Scene strip/filter.
- Main: multi-column ShotCard board in shot order.
- Right: selected Shot Inspector.

### ShotCard minimum content

- Shot number
- Keyframe or purposeful placeholder
- Duration
- Short visual description
- Character summary
- Shot type/framing
- Camera movement
- Current creator-facing status

The default is **Compact Shot Board**. At 2560×1440, several Shots must be visible simultaneously; no card should occupy half the viewport. Selecting a card opens the inspector without navigating away. Reordering and batch selection are board actions. Keyframe generation opens 生成 with the Shot context.

## 9. Generate

Generate is the Production Center. Its primary object is a Shot, not a Tool or API request.

### Left: Shot Queue

- Filter by Episode, Scene and creator status.
- Rows show Shot number, small keyframe, readiness and generation state.
- Selecting a row changes the center workspace and inspector.

### Center: current Shot generation workspace

- Shot context and confirmed inputs.
- GenerationDescriptionEditor as the default input.
- One primary 生成 action.
- CandidateCompare appears in place after generation.
- ReviewActions appear beside the result; no detour through a task center.

### Right: Generate Inspector

- Input Asset/Shot summary and readiness.
- Simple routing summary: “生成方式：自动”.
- AdvancedGenerationPanel collapsed by default.
- SourceDetails available for a selected result.

Generate supports image/keyframe and video capabilities through the existing Tool/Workflow paths, while the visible operation names describe the result being made. Fixed tools are an advanced choice. AUTO is the default.

## 10. Shot Videos

Shot Videos is a review and sequence workspace, not a final timeline editor.

### Structure

- Top or left: ordered Shot list with video status.
- Center: VideoPreview for current official video or selected candidate.
- Right: Shot video inspector, versions, review actions and SourceDetails.
- Bottom: ShotSequenceStrip showing story order and missing/completed states.

The strip supports navigation and order comprehension only. It does not provide tracks, trimming, transitions, subtitles, music, audio mixing or final encoding.

The comparison model is explicit: 当前镜头视频, Candidate A, Candidate B. Actions are 播放、对比、批准、拒绝 and **设为当前镜头视频**. GenerationOutput and AssetVersion IDs are not primary labels.

## 11. Context Inspector

The Inspector follows selection, never system implementation.

| Selection | Default inspector content |
| --- | --- |
| Story | Story metadata and creative requirements |
| Scene | Heading, location/time, characters, continuity summary |
| Character | Bible fields, main reference, candidates, related scenes |
| Location | Bible fields, main reference, candidates, related scenes |
| Prop | Bible fields, main reference, candidates, related scenes |
| Shot | Shot plan, references, duration, keyframe/video bindings, status |
| Candidate | Preview metadata, review state, comparison target, source summary |
| No selection | Collapsed or a short page-specific guidance state |

Rules:

- Width 320–360 px at 2560; collapsible at all supported sizes.
- Selection changes content without resetting the page scope.
- Destructive actions require ConfirmationDialog.
- Provider settings never occupy the default Inspector.
- Source and technical details are progressive disclosure.

## 12. Task Drawer

Collapsed state example: **3 个任务进行中 · 1 个等待确认**.

Expanded task rows show:

- Human target: Shot/Asset/Scene name.
- Human action: 生成关键帧、生成视频、剧本拆解, etc.
- Creator-facing status and progress when reliable.
- Started time and useful next action.
- Retry/cancel only when valid.
- A short user-facing error with expandable technical details.

TaskDrawer combines AITask, WorkflowRun and compatible legacy status into one display projection. It does not change their ownership or lifecycle. Waiting for review also appears on the related Asset/Shot so the drawer is never the only route to act.

## 13. Generation UX

### Default mode

The user edits a natural **生成描述**. Confirmed Character, Location, Prop, continuity and Shot context are summarized as included inputs. AUTO routing stays implicit except for a compact “自动” label.

### Advanced mode

AdvancedGenerationPanel may expose:

- Full positive prompt and negative prompt
- Tool: 自动 or fixed trusted Tool
- Model
- Resolution, duration and aspect ratio
- Seed and other common contract fields
- Cost estimate and estimate expiry
- Provider-specific fields only when the selected Tool supports them

Raw workflow JSON, node IDs and arbitrary Provider payloads remain Settings/Maintenance concerns.

### Confirmation

For a paid cloud Tool, ConfirmationDialog shows only:

- Tool
- Model
- Output count
- Estimated cost and currency, or explicit unknown
- Whether source media will be uploaded to cloud

Primary action: 确认生成. Internal Approval and Reservation terms are never shown.

For local ComfyUI, show 本地生成 and 预计 API 费用：0, plus readiness if action is blocked. A zero API charge does not imply zero hardware cost.

### Result

The result appears in the same workspace. Successful execution does not redirect to tasks or a record page. Candidate comparison and ReviewActions are the immediate next step.

## 14. Review / Adopt UX

The internal boundary remains Candidate → Review → Adopt. The interface translates it into creative decisions:

1. Display current official version and candidates together.
2. Let the user inspect full media and compare relevant candidates.
3. 批准 records that a candidate is acceptable but does not silently replace the official binding.
4. 拒绝 records a negative review and preserves history.
5. 设为主参考 or 设为当前镜头视频 performs the explicit adopt action.

Regenerate creates another candidate and never overwrites the current official version. Stale inputs or continuity changes are explained on the candidate before adoption. IDs and internal relation names remain accessible under SourceDetails.

## 15. Status Vocabulary

The user-facing vocabulary is fixed:

| UI status | Meaning | Example internal states mapped here |
| --- | --- | --- |
| 草稿 | Object exists but is not ready for production | draft, placeholder, incomplete |
| 待生成 | Required creative content exists; generation has not started | pending without readiness block |
| 准备就绪 | Validation and inputs allow the next action | ready, validated |
| 生成中 | Work is queued, submitted or running | queued, submitted, running |
| 待审核 | A candidate/result awaits human review or adoption | candidate, waiting-review, approved-not-adopted |
| 已确认 | The official version/binding is selected | adopted, confirmed, completed with binding |
| 失败 | Work ended with an actionable failure | failed |
| 等待用户 | A confirmation, review or input is required | waiting-user, approval-required |
| 不可用 | Capability or required resource is unavailable | unavailable, capability-blocked |

Internal states remain unchanged. Mapping is contextual: for example, a workflow can be succeeded while its candidate remains 待审核. StatusBadge always includes text; color is supplemental.

## 16. Advanced / Technical Information

Default UI hides these implementation objects:

- AITask
- GenerationRecord
- RoutingDecision
- PromptPackage
- WorkflowRun
- StepRun
- Reservation
- Approval

Users first see **来源** with generation method, Tool, model, generation time, cost and workflow summary. Expanding **技术详情** may reveal record IDs, versions, request fingerprint, Prompt snapshot and execution history.

Settings owns durable Tool/model/credential/ComfyUI/Provider/storage configuration. Maintenance owns readiness, runtime status, provenance audits, backup, diagnostics and version information. Missing configuration is explained in context with one link to the relevant setting.

## 17. Visual Direction

- Dark neutral desktop workspace, not pure black.
- Work surfaces are one tonal step brighter than the app background.
- One restrained primary accent; status colors only communicate status.
- Separation uses 1 px borders, tonal hierarchy and small shadows.
- No neon, glassmorphism, glow-heavy effects or decorative gradient system.
- Windows-safe font stack: `Microsoft YaHei UI`, `Segoe UI`, system sans-serif.
- Page title: 20–22 px; section title: 15–16 px; body: 13–14 px; supporting text: 12 px.
- Spacing base: 4/8 px; common spacing: 8, 12, 16 and 24 px.
- Control radius: 6–8 px; panel radius: 8–10 px.
- One Primary CTA per local region. Secondary and text actions are visually subordinate.
- Icons use an established icon library in implementation; text symbols and emoji do not substitute for product icons.

## 18. Responsive Desktop Rules

### 2560×1440 primary target

- TopBar 52 px reference height.
- ProjectNav 216 px expanded.
- ContextInspector 344 px expanded.
- TaskDrawer 32–40 px collapsed / 280 px expanded.
- Main workspace keeps the remaining width and can show multiple Shot/Asset cards.
- Fixed shell regions do not cause the center to fall below a useful creative width.

### 1920×1080 secondary target

- Main workspace remains the priority.
- ContextInspector may default collapsed or overlay on demand.
- ProjectNav may shrink or collapse to icon rail.
- TaskDrawer expands over the lower workspace rather than permanently reducing content height.
- Toolbar actions may move into an overflow menu; labels remain available.
- Do not scale the whole interface down. Preserve type sizes and target sizes, reduce concurrent panels instead.

### Minimum desktop behavior

This baseline does not prioritize mobile. Below the supported desktop working width, panels collapse in the order Inspector → ProjectNav labels → nonessential toolbar actions. The creative editor itself remains usable and horizontally stable.

## 19. Canvas Boundary

Infinite Canvas is a future Creator UI ViewExtension for asset relationships, spatial storyboard layout or inspiration boards. It may reference Scene, Shot, Character, Location, Prop, Asset and AssetVersion and store view-only position, group, connection and layout state.

Canvas is not a Workflow Scheduler, Generation Engine, task database or second Project Core. It does not become primary navigation in 08-00 and no Canvas screen is designed in the first Figma handoff.

## 20. Blender Boundary

Blender remains a future ToolAdapter. It is invoked contextually from 分镜 or 生成 for supported previz/render capabilities. There is no top-level Blender page. Blender-specific settings belong under Settings and technical execution details under SourceDetails/Maintenance.

## 21. 0.7 Architecture Boundary

Creator UI is a new View/Interaction Layer over the released architecture. Step 08-00 does not modify:

- Tool Protocol or Capability Contracts
- RoutingPolicy, RoutingDecision or Broker
- GenerationRecord or provenance
- GenerationApproval or Reservation
- AITask or its runtime
- AssetVersion and formal bindings
- WorkflowRun or StepRun
- SQLite schema v9 or backup format 4

WorkflowRun/StepRun become the internal basis for the visible 制作流程. Candidate/Review/Adopt remains the formal production boundary. Renderer still uses preload white-list APIs; SQLite and credentials remain main-process only.

## 22. Figma Handoff

The design handoff is defined in [figma-brief-0.8.md](figma-brief-0.8.md). It requires seven low/mid-fidelity 2560×1440 frames:

1. Project Shell
2. Story
3. Script
4. Assets
5. Storyboard
6. Generate
7. Shot Videos

The set is also checked at 1920×1080 and covers Normal, Empty, Generating, Waiting Review and Error states. Figma may refine visual tokens but cannot change the six-stage order, shell responsibilities, progressive disclosure, context preservation or 0.7 architecture boundary without revising this baseline.

## 23. Frozen component inventory

Only the recurring components needed for the seven frames are named now:

| Component | Responsibility |
| --- | --- |
| `ProjectNav` | Six-stage navigation plus secondary settings/maintenance |
| `TopBar` | Project/module/save/global status/window actions |
| `ContextInspector` | Selected creative object's properties and actions |
| `TaskDrawer` | Collapsed production status and expanded task list |
| `StatusBadge` | Shared creator-facing status label |
| `AssetCard` | Dense Character/Location/Prop summary |
| `AssetCandidateCard` | Candidate preview and review state |
| `ShotCard` | Compact Shot board item |
| `ShotSequenceStrip` | Ordered Shot-video navigation only |
| `GeneratePanel` | Current Shot generation workspace |
| `GenerationDescriptionEditor` | Default natural-language generation input |
| `AdvancedGenerationPanel` | On-demand Tool/model/prompt/parameter details |
| `CandidateCompare` | Official version and candidates side by side |
| `VideoPreview` | Current/candidate Shot video playback |
| `ReviewActions` | Approve, reject and explicit adopt actions |
| `SourceDetails` | Human source summary and technical expansion |
| `EmptyState` | Next-action guidance for empty workspaces |
| `ErrorBanner` | User-facing failure and optional technical details |
| `ConfirmationDialog` | Destructive or paid/local-execution confirmation |

This is not a full design system. New components require evidence of reuse during implementation.

## 24. Baseline change control

08-01 may implement the shell and navigation projection incrementally, but it must preserve all existing business operations until each is remapped and tested. Old pages may stay reachable during transition. Removal requires a later task with compatibility evidence; 08-00 authorizes none.
