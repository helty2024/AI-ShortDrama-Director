import test from 'node:test'
import assert from 'node:assert/strict'
import { creatorStatus, creatorTaskStatus } from '../../src/components/creator-shell/status.js'
import { creatorModuleOf, primaryModules } from '../../src/components/creator-shell/modules.js'

test('creator navigation keeps the six production stages in order and maps legacy locations', () => {
  assert.deepEqual(primaryModules, ['story', 'scripts', 'assetsHub', 'storyboard', 'generation', 'shotVideos'])
  assert.equal(creatorModuleOf('characters'), 'assetsHub')
  assert.equal(creatorModuleOf('production'), 'generation')
  assert.equal(creatorModuleOf('operations'), 'operations')
})
test('creator status mapping preserves review and official binding semantics', () => {
  assert.equal(creatorStatus('queued'), '生成中')
  assert.equal(creatorStatus('waiting-user'), '等待用户')
  assert.equal(creatorStatus('approved'), '待审核')
  assert.equal(creatorStatus('succeeded'), '待审核')
  assert.equal(creatorStatus('succeeded', true), '已确认')
  assert.equal(creatorTaskStatus('queued'), '排队')
  assert.equal(creatorTaskStatus('succeeded'), '完成')
  assert.equal(creatorStatus('capability-blocked'), '不可用')
})
