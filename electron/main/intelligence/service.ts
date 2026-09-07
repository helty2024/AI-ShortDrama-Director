import { DomainError } from '../database.js'
import { IntelligenceRepository } from './repository.js'
import { AITaskQueue } from './queue.js'
import { confirmDraft } from './review.js'
import type { IntelligenceCommand } from '../../../src/shared/intelligence.js'
export class IntelligenceService {
  readonly repo: IntelligenceRepository
  readonly queue: AITaskQueue
  constructor(repo: IntelligenceRepository, queue: AITaskQueue) {
    this.repo = repo
    this.queue = queue
  }
  execute(command: IntelligenceCommand) {
    const p = command.projectId
    switch (command.operation) {
      case 'snapshot':
        return this.repo.snapshot(p, this.queue.provider.name)
      case 'scene.save':
        return this.repo.saveScene(
          p,
          command.id,
          command.expectedRevision,
          command.content,
        )
      case 'episode.rename':
        return this.repo.renameEpisode(
          p,
          command.id,
          command.expectedRevision,
          command.name,
        )
      case 'tree.delete':
        return this.repo.deleteTree(p, command.id, command.expectedRevision)
      case 'scenes.reorder':
        return this.repo.reorder(
          p,
          command.id,
          command.expectedRevision,
          command.sceneIds,
        )
      case 'bible.save':
        return this.repo.saveBible(
          p,
          command.id,
          command.expectedRevision,
          command.name,
          command.description,
          command.assetIds,
          command.bible,
        )
      case 'task.start':
        if ('request' in command.input)
          throw new DomainError(
            'FORBIDDEN',
            '图像任务必须经 Prompt Compiler 和受控配置创建',
          )
        return this.queue.start(p, command.input)
      case 'task.cancel':
        return this.queue.cancel(p, command.id)
      case 'task.retry':
        return this.queue.retry(p, command.id)
      case 'import.confirm':
        return this.repo.confirmImport(
          p,
          command.id,
          command.expectedRevision,
          command.parsed,
        )
      case 'draft.edit':
        return this.repo.editDraft(
          p,
          command.id,
          command.expectedRevision,
          command.payload,
        )
      case 'draft.ignore':
        return this.repo.editDraft(
          p,
          command.id,
          command.expectedRevision,
          null,
        )
      case 'draft.confirm':
        return confirmDraft(
          this.repo,
          p,
          command.id,
          command.expectedRevision,
          command.targetId,
          command.targetRevision,
        )
    }
  }
}
