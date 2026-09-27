# Creator UI 0.8 Figma Prototype

## Design source

- File: **AI ShortDrama Director — Creator UI 0.8**
- Figma: <https://www.figma.com/design/zbjnFTfmg7lq2B3Zx8Zj4q>
- File key: `zbjnFTfmg7lq2B3Zx8Zj4q`
- Status: **In review**

## File structure

The Figma Starter workspace supports three pages, so the requested five logical sections are grouped without mixing their responsibilities:

1. `00 Foundations & Components`
2. `01 Creator Screens 2560`
3. `02 Responsive & States`

`00 Foundations & Components` contains the minimal color, spacing, radius, and typography tokens together with the reusable component library. The component library includes ProjectNav, TopBar, ContextInspector, TaskDrawer, StatusBadge, AssetCard, AssetCandidateCard, ShotCard, ShotQueueRow, GeneratePanel, AdvancedGenerationPanel, CandidateCard, CandidateCompare, VideoPreview, ShotSequenceItem, ReviewActions, SourceDetails, EmptyState, ErrorBanner, and GenerationConfirmation.

## Completed frames

### 2560 × 1440

1. `01 Project Shell`
2. `02 Story`
3. `03 Script`
4. `04 Assets`
5. `05 Storyboard`
6. `06 Generate`
7. `07 Shot Videos`

These frames share the same 52 px TopBar, 216 px ProjectNav, 344 px ContextInspector, and collapsed TaskDrawer. `01 Project Shell` also demonstrates the expanded 280 px task drawer.

### 1920 × 1080

1. `Script 1920`
2. `Storyboard 1920`
3. `Generate 1920`

The responsive frames use a 64 px icon rail, a collapsed Inspector rail, and a collapsed bottom task bar so the main workspace keeps priority. The Inspector opens as a right-side overlay and never pushes the workspace. These are separate layouts rather than uniformly scaled versions of the 2560 frames.

## Design coverage

- Story uses a writing workspace with large synopsis, world-building, and requirements areas instead of a dashboard form grid.
- Script exposes the Episode/Scene tree, structured scene editor, real screenplay content, and contextual scene actions.
- Assets shows eight dense cards and distinguishes the current master reference from candidate versions in the Inspector.
- Storyboard presents twelve compact Shot cards with mixed production states and a selected Shot 08 Inspector.
- Generate combines a ten-shot queue, natural-language generation description, collapsed advanced settings, and in-place candidate comparison and adoption.
- Shot Videos combines the shot list, video preview, video candidates, Inspector, and a sequence strip without timeline editing controls.
- The status vocabulary is consistent: 草稿、待生成、准备就绪、生成中、待审核、已确认、失败、等待用户、不可用.
- The advanced generation component keeps tool, model, seed, prompt, and upload details behind a disclosure.
- Empty, error, confirmation, source details, review actions, task drawer, and candidate review patterns are available in the component library.

## Prototype flows

The current prototype connects:

- Storyboard Shot 08 / 去生成 → Generate Shot 08
- Generate Candidate / 查看分镜 → Storyboard Shot 08

The Assets candidate adoption and Shot Videos shot-switch destinations were prepared conceptually, but the final interactions were not written after the Figma Starter MCP call quota was reached. They remain explicit review items before implementation handoff.

## Differences from the baseline

- The five requested logical sections are grouped into three Figma pages because the Starter workspace limits the file to three pages.
- `Noto Sans SC` is used as the safe system sans substitute available in the Figma execution environment.
- The 1920 layouts collapse navigation and Inspector chrome while preserving workspace density; they do not scale the 2560 layouts.
- Prompt and provider details stay inside Advanced Generation and Source Details rather than becoming first-level production stages.

## Locked interaction decisions

- At 1920×1080, the Inspector opens as a right-side overlay and never pushes or compresses the main workspace.
- Generate shows two primary candidates at full size by default. Additional candidates use a horizontal thumbnail switcher.
- Adoption labels are fixed: Asset → 设为主参考, Keyframe → 设为镜头关键帧, Video → 设为当前镜头视频.
- Adoption immediately changes the result to 已确认 and shows a short “已设为……” toast.
- Storyboard stays as one continuous Compact Board through 30 Shots. Above 30 Shots it groups by Scene with collapsible Scene headers.

The dedicated Cloud unknown-state and local ComfyUI confirmation-state board still needs to be written when Figma write quota is available.

No React, CSS, router, Electron, database, schema, Tool, Workflow, or package-version changes are included in this step.
