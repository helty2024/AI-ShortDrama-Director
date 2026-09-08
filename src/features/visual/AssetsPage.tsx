import { productionService } from '../../services/production'
import { useState } from 'react'
import { useWorkspace } from '../workspace/state'
import { useVisual } from './use-visual'
import { AssetImage } from './AssetImage'
import { AssetReview } from './AssetReview'
import { VisualPanel } from './VisualPanel'
export function AssetsPage() {
  const { state } = useWorkspace()
  return state.workspace ? (
    <Library projectId={state.workspace.project.id} />
  ) : (
    <>
      <h1>素材库</h1>
      <p>请先打开项目。</p>
    </>
  )
}
function Library({ projectId }: { projectId: string }) {
  const { state, reload } = useWorkspace(),
    visual = useVisual(projectId)
  const [search, setSearch] = useState(''),
    [source, setSource] = useState(''),
    [status, setStatus] = useState(''),
    [type, setType] = useState(''),
    [selected, setSelected] = useState(''),
    [targetId, setTargetId] = useState(''),
    [message, setMessage] = useState('')
  const entities = state.workspace?.entities ?? [],
    versions = visual.snapshot?.versions ?? [],
    assets = entities.filter((e) => e.kind === 'asset')
  const chosen = assets.find((a) => a.id === selected),
    target = entities.find((e) => e.id === targetId)
  const rows = assets.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) &&
      (!type || a.mediaType === type) &&
      (!source ||
        versions.some((v) => v.assetId === a.id && v.sourceType === source)) &&
      (!status ||
        versions.some((v) => v.assetId === a.id && v.status === status)),
  )
  const run = async (action: () => Promise<unknown>) => {
    setMessage('')
    try {
      await action()
      await reload()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '操作失败')
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>素材库</h1>
          <p>受控图片和视频、可追踪版本与人工审核。</p>
        </div>
        <button
          className="primary"
          disabled={visual.busy}
          onClick={() =>
            void run(async () => {
              await visual.execute({
                operation: 'asset.import',
                projectId,
                assetId: null,
                targetId: null,
              })
            })
          }
        >
          导入图片
        </button>
      </div>
      <button
        onClick={() =>
          void run(async () => {
            await productionService.command({
              operation: 'video.import',
              projectId,
            })
            await visual.refresh()
          })
        }
      >
        导入 MP4 视频
      </button>
      <div className="asset-filters">
        <label>
          搜索
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label>
          类型
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">全部</option>
            {['image', 'video', 'audio', 'document'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          来源
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">全部</option>
            {['imported', 'generated', 'edited', 'derived', 'reference'].map(
              (s) => (
                <option key={s}>{s}</option>
              ),
            )}
          </select>
        </label>
        <label>
          状态
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部</option>
            {['draft', 'approved', 'rejected', 'archived'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      {(message || visual.error) && (
        <p role="alert" className="error">
          {message || visual.error}
        </p>
      )}
      {!rows.length && (
        <p className="empty">
          暂无匹配素材，请导入图片或在 Bible / Shot 中生成。
        </p>
      )}
      <div className="asset-grid">
        {rows.map((asset) => {
          const latest = versions.filter((v) => v.assetId === asset.id).at(-1),
            v = versions.find((v) => v.id === asset.approvedVersionId) ?? latest
          return (
            <button
              className="asset-tile"
              key={asset.id}
              onClick={() => setSelected(asset.id)}
            >
              {v ? (
                <AssetImage
                  projectId={projectId}
                  versionId={v.id}
                  alt={asset.name}
                />
              ) : (
                <span>尚无媒体版本</span>
              )}
              <strong>{asset.name}</strong>
              <small>
                {v ? 'v' + v.versionNumber + ' · ' + v.status : asset.status}
              </small>
            </button>
          )
        })}
      </div>
      {chosen && (
        <>
          <AssetReview
            asset={chosen}
            versions={versions}
            entities={entities}
            execute={visual.execute}
            onChanged={reload}
          />
          <div className="actions">
            <button
              disabled={visual.busy || chosen.mediaType !== 'image'}
              onClick={() =>
                void run(async () => {
                  await visual.execute({
                    operation: 'asset.import',
                    projectId,
                    assetId: chosen.id,
                    targetId: null,
                  })
                })
              }
            >
              导入图片新版本
            </button>
            <button
              className="danger"
              disabled={visual.busy || chosen.mediaType !== 'image'}
              onClick={() => {
                if (
                  window.confirm(
                    '删除素材记录及版本？被引用的素材会拒绝删除，文件保留供孤儿扫描。',
                  )
                )
                  void run(async () => {
                    await visual.execute({
                      operation: 'asset.delete',
                      projectId,
                      id: chosen.id,
                      expectedRevision: chosen.revision,
                    })
                    setSelected('')
                  })
              }}
            >
              删除素材
            </button>
          </div>
          <label>
            重新生成的来源
            <select
              aria-label="重新生成的来源"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            >
              <option value="">选择 Bible 或 Shot</option>
              {entities
                .filter((e) =>
                  ['character', 'location', 'prop', 'shot'].includes(e.kind),
                )
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          </label>
          {chosen.mediaType === 'video' && (
            <p>
              请到分镜中展开对应 Shot 的视频生产，编辑 Prompt 并生成新版本。
            </p>
          )}
          {chosen.mediaType === 'image' &&
            target &&
            (target.kind === 'character' ||
              target.kind === 'location' ||
              target.kind === 'prop' ||
              target.kind === 'shot') && (
              <VisualPanel
                key={chosen.id + target.id}
                entity={target}
                entities={entities}
                assetOverride={chosen.id}
              />
            )}
        </>
      )}
      <details>
        <summary>存储维护</summary>
        <p>
          扫描未被任何版本引用的文件，仅报告，不自动删除；包括取消任务、导入重复和事务失败留下的文件。
        </p>
        <button
          onClick={() =>
            void run(async () => {
              const result = await visual.execute({
                operation: 'orphans.scan',
                projectId,
              })
              setMessage(
                Array.isArray(result)
                  ? `发现 ${result.length} 个孤儿文件。请关闭应用并备份后由管理员处理。`
                  : '扫描完成',
              )
            })
          }
        >
          扫描孤儿文件
        </button>
      </details>
    </>
  )
}
