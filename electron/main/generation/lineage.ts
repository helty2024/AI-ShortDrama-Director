import { GenerationRepository } from './repository.js'
import { WorkflowRepository } from '../workflow/repository.js'
import { reservationSchema } from '../../../src/shared/approval.js'
import { lineageSchema, moneyLabel, productionMessage, type Lineage } from '../../../src/shared/compatibility.js'
import type { ProjectDatabase } from '../database.js'

const emptyLinks = (): Lineage['links'] => ({ outputId: null, recordId: null, taskId: null, routingDecisionId: null, promptPackageId: null, importId: null, stepRunId: null, workflowRunId: null })
/** Read-only joins over authoritative tables. No backfill and no runtime/provider calls. */
export class LineageService {
  readonly repo: GenerationRepository
  readonly database: ProjectDatabase
  constructor(database: ProjectDatabase) { this.database = database; this.repo = new GenerationRepository(database) }
  version(p: string, id: string): Lineage {
    const version = this.repo.version(p, id)
    const row = this.database.connection.prepare('SELECT id FROM generation_outputs WHERE project_id=? AND version_id=?').get(p, id)
    if (row) {
      const output = this.repo.get('generation_outputs', p, String(row.id))
      const result = this.generation(p, output.generationRecordId)
      const entities = this.database.workspace(p).entities
      const adopted = entities.some(e => e.kind === 'shot' ? e.approvedKeyframeVersionId === id || e.confirmedVideoAssetVersionId === id
        : 'visualReferences' in e && e.visualReferences.some(ref => ref.assetId === version.assetId) && entities.some(a => a.kind === 'asset' && a.id === version.assetId && a.approvedVersionId === id))
      return lineageSchema.parse({ ...result, versionId: id, createdAt: version.createdAt,
        status: adopted ? 'Adopted' : version.status, links: { ...result.links, outputId: output.id } })
    }
    const imported = this.database.connection.prepare('SELECT id FROM import_provenance WHERE project_id=? AND version_id=?').get(p, id)
    if (imported) {
      const source = this.repo.get('import_provenance', p, String(imported.id))
      return lineageSchema.parse({ source: 'Imported', versionId: id, status: version.status, createdAt: version.createdAt,
        fields: [{ label: 'Import Provenance', value: source.id }, { label: '导入时间', value: source.importedAt }], links: { ...emptyLinks(), importId: source.id } })
    }
    return lineageSchema.parse({ source: 'Legacy / provenance unavailable', versionId: id, status: version.status, createdAt: version.createdAt, fields: [], links: emptyLinks() })
  }
  generation(p: string, id: string): Lineage {
    const record = this.repo.getRecord(p, id), task = this.repo.task(p, record.taskId)
    // Verify every edge in this project's scope; never infer identity from current tools.
    this.repo.get('routing_decisions', p, record.routingDecisionId)
    if (record.promptPackageId) this.repo.get('prompt_packages', p, record.promptPackageId)
    const row = this.database.connection.prepare('SELECT data FROM approval_reservations WHERE project_id=? AND record_id=?').get(p, id)
    const reservation = row ? reservationSchema.parse(JSON.parse(String(row.data))) : null
    const stepRow = this.database.connection.prepare('SELECT run_id FROM step_runs WHERE project_id=? AND record_id=? LIMIT 1').get(p, id)
    const workflow = stepRow ? new WorkflowRepository(this.database).get(p, String(stepRow.run_id)) : null
    const step = workflow?.steps.find(s => s.relatedGenerationRecordId === id)
    const fields = [
      ['Tool', `${record.toolId} @ ${record.toolVersion}`], ['Execution Mode', record.executionMode ?? 'Unavailable / Legacy'],
      ['Model', record.modelId ?? 'Unavailable / Legacy'], ['Capability', record.generationType],
      ['Generation Record', record.id], ['AITask', `${task.id} · ${task.status}`],
      ['Routing Decision', record.routingDecisionId], ['Prompt Package', record.promptPackageId ?? 'Unavailable / Legacy'],
      ['Estimated Cost', record.estimatedCost.status === 'known' ? moneyLabel(record.estimatedCost.estimatedCost) : 'unknown / 费用未知'],
      ['Actual Cost', moneyLabel(record.actualCost)], ['Cost Status', record.costStatus],
      ['Reservation', reservation ? `${reservation.status}${reservation.historicalStatus ? ` (${reservation.historicalStatus})` : ''}` : 'Unavailable / Legacy'],
      ['费用核对', reservation && ['pending-unknown', 'requires-review'].includes(reservation.historicalStatus ?? reservation.status) ? productionMessage(reservation.historicalStatus ?? reservation.status) : record.actualCost ? '费用已确认' : '费用未知'],
      ['Outcome', `${record.outcome}${record.outcome === 'unknown-submission' || record.outcome === 'malformed-output' ? ' · ' + productionMessage(record.outcome) : ''}`],
    ]
    if (record.workflowTemplateId) fields.push(['Workflow Template', `${record.workflowTemplateId} @ ${record.workflowVersion}`])
    if (task.historicalProviderTaskId) fields.push(['Historical remote ID (read-only)', task.historicalProviderTaskId])
    if (workflow) fields.push(['Workflow Type', workflow.run.workflowType], ['Workflow Run', workflow.run.id],
      ['Workflow Status', `${workflow.run.status} · ${workflow.run.currentStepKey}${!workflow.run.executionAllowed ? ' · Historical / Read-only' : ''}`],
      ['Step', step?.stepKey ?? 'Unavailable'], ['Candidate', workflow.run.resultSummary.assetVersionId ?? step?.relatedAssetVersionId ?? '尚未产生'],
      ['Review decisions', workflow.steps.flatMap(s => s.outputSnapshot.decisions).map(d => `${d.action} (${d.id})`).join('; ') || '等待确认'],
      ['Adopt result', workflow.run.resultSummary.adopted ? 'Adopted' : '尚未采用'])
    return lineageSchema.parse({ source: 'Generated', versionId: null, status: record.outcome, createdAt: record.createdAt,
      fields: fields.map(([label, value]) => ({ label, value })), links: { ...emptyLinks(), recordId: record.id, taskId: task.id,
        routingDecisionId: record.routingDecisionId, promptPackageId: record.promptPackageId, stepRunId: step?.id ?? null, workflowRunId: workflow?.run.id ?? null } })
  }
}
