import { DomainError, metadata } from '../database.js'
import { IntelligenceRepository } from './repository.js'
import { productionElementSchema } from '../../../src/shared/intelligence.js'
import type { Entity } from '../../../src/shared/domain.js'

function append(old: string, addition: string) {
  return old.includes(addition)
    ? old
    : [old, addition].filter(Boolean).join('\n')
}
export function confirmDraft(
  repo: IntelligenceRepository,
  projectId: string,
  id: string,
  revision: number,
  targetId: string | null,
  targetRevision: number | null,
) {
  return repo.database.transaction(() => {
    const draft = repo.draft(projectId, id)
    if (draft.status === 'confirmed') return draft
    repo.checkRevision(draft.revision, revision)
    if (draft.status !== 'pending')
      throw new DomainError('CONFLICT', '草稿已忽略')
    const scene = repo.entity(projectId, draft.sceneId)
    if (scene.kind !== 'scene' || scene.revision !== draft.sourceRevision)
      throw new DomainError('CONFLICT', '来源场次已改变，请重新分析后确认')
    let confirmedId: string
    if (draft.payload.type === 'shot') {
      if (targetId)
        throw new DomainError('CONFLICT', '镜头草稿只支持确认新镜头')
      const plan = draft.payload.item
      const entities = repo.database.workspace(projectId).entities
      let board = entities.find(
        (e) => e.kind === 'storyboard' && e.episodeId === scene.episodeId,
      )
      board ??= repo.database.createDraft({
        projectId,
        kind: 'storyboard',
        name: '导演拆镜',
        parentId: scene.episodeId,
      })
      const shot = repo.database.insertEntities(projectId, [
        {
          ...metadata(),
          projectId,
          kind: 'shot',
          name: `${plan.shotNumber}. ${plan.shotType} ${plan.subject}`.slice(
            0,
            120,
          ),
          description: plan.action,
          storyboardId: board.id,
          sceneId: scene.id,
          order: entities.filter(
            (e) => e.kind === 'shot' && e.storyboardId === board.id,
          ).length,
          durationSeconds: plan.durationSuggestion,
          characterIds: plan.characterRefs,
          locationId: plan.locationRef,
          propIds: plan.propRefs,
          assetIds: [],
          imagePrompt: '',
          videoPrompt: '',
          previousVersionId: null,
          plan,
        },
      ])[0]!
      confirmedId = shot.id
    } else {
      const item = draft.payload.item
      if (
        item.category === 'character' ||
        item.category === 'location' ||
        item.category === 'prop'
      ) {
        let target: Entity
        if (targetId) {
          target = repo.entity(projectId, targetId)
          if (target.kind !== item.category || targetRevision === null)
            throw new DomainError('CONFLICT', '请选择同类型正式实体进行合并')
          repo.checkRevision(target.revision, targetRevision)
        } else
          target = repo.database.createDraft({
            projectId,
            kind: item.category,
            name: item.name,
          })
        if (
          target.kind !== 'character' &&
          target.kind !== 'location' &&
          target.kind !== 'prop'
        )
          throw new DomainError('CONFLICT', '错误的 Bible 类型')
        const bible: Record<string, unknown> = { ...target.bible }
        for (const attribute of item.attributes) {
          if (
            Object.hasOwn(bible, attribute.field) &&
            typeof bible[attribute.field] === 'string' &&
            !bible[attribute.field]
          )
            bible[attribute.field] = attribute.value
        }
        bible.continuityNotes = append(
          String(bible.continuityNotes ?? ''),
          `来源场次：${scene.content.heading || scene.name}。${item.reason}`,
        )
        if (target.kind === 'character' && item.name !== target.name)
          bible.aliases = [...new Set([...target.bible.aliases, item.name])]
        if (target.kind === 'prop')
          bible.sceneIds = [...new Set([...target.bible.sceneIds, scene.id])]
        const updated = repo.saveBible(
          projectId,
          target.id,
          target.revision,
          target.name,
          append(target.description, item.description),
          target.assetIds,
          bible,
        )
        confirmedId = updated.id
      } else {
        let existing = targetId
          ? repo
              .list(projectId, 'production_elements', productionElementSchema)
              .find((e) => e.id === targetId)
          : undefined
        if (
          targetId &&
          (!existing ||
            existing.category !== item.category ||
            targetRevision === null)
        )
          throw new DomainError(
            'CONFLICT',
            '请选择同类别 Production Bible 元素',
          )
        if (existing && targetRevision !== null)
          repo.checkRevision(existing.revision, targetRevision)
        existing = existing
          ? {
              ...existing,
              description: append(existing.description, item.description),
              sceneIds: [...new Set([...existing.sceneIds, scene.id])],
              draftIds: [...new Set([...existing.draftIds, draft.id])],
              revision: existing.revision + 1,
              updatedAt: new Date().toISOString(),
            }
          : {
              ...metadata(),
              projectId,
              category: item.category,
              name: item.name,
              description: item.description,
              sceneIds: [scene.id],
              draftIds: [draft.id],
              notes: item.reason,
            }
        repo.putProduction(existing)
        confirmedId = existing.id
      }
    }
    return repo.putDraft({
      ...draft,
      status: 'confirmed',
      targetId: confirmedId,
      revision: draft.revision + 1,
      updatedAt: new Date().toISOString(),
    })
  })
}
