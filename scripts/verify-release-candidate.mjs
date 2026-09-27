import { _electron as electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const [executableArg, userDataArg, mode, fixtureRootArg, reportArg] =
  process.argv.slice(2)
if (!executableArg || !userDataArg || !mode || !reportArg)
  throw new Error(
    'Usage: node scripts/verify-release-candidate.mjs <exe> <userData> <fresh|upgrade|backup|retained> <fixtureRoot|-> <report>',
  )

const allowed = resolve(tmpdir(), 'ai-shortdrama-director-release-tests')
const userData = resolve(userDataArg)
const scope = relative(allowed, userData)
if (!scope || scope.startsWith('..') || isAbsolute(scope))
  throw new Error('RC userData must be inside the dedicated temp root')

const executablePath = resolve(executableArg)
const fixtureRoot = fixtureRootArg === '-' ? null : resolve(fixtureRootArg)
const reportPath = resolve(reportArg)
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
delete environment.ELECTRON_RENDERER_URL
delete environment.DIRECTOR_TEXT_API_KEY
environment.DIRECTOR_TEXT_PROVIDER = 'mock'
environment.DIRECTOR_RELEASE_VALIDATION = '0.7.0-rc'
environment.DIRECTOR_TEST_USER_DATA = userData

const launch = () =>
  electron.launch({
    executablePath,
    cwd: join(process.env.SystemRoot, 'System32'),
    env: environment,
  })

const request = async (page, value) => {
  const result = await page.evaluate(
    (input) => window.desktop.workspace.request(input),
    value,
  )
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.data
}

const about = (page) =>
  request(page, {
    action: 'operations',
    command: { operation: 'about' },
  })

const readiness = async (page) => {
  const rows = await request(page, {
    action: 'compatibility',
    command: { op: 'readiness' },
  })
  const comfy = rows.find((row) => row.toolId === 'comfyui.local')
  const packy = rows.find((row) => row.toolId === 'packy.image-25')
  const video = rows.find((row) => row.toolId === 'real-video')
  assert.equal(comfy?.validation, 'real-local-validated')
  assert.ok(
    ['offline', 'capability-blocked', 'ready-for-configured-template'].includes(
      comfy?.runtime,
    ),
  )
  assert.equal(packy?.validation, 'real-generation-partially-validated')
  assert.ok(
    ['configuration-required', 'configured-unverified'].includes(
      packy?.runtime,
    ),
  )
  assert.equal(video?.validation, 'not-validated')
  assert.equal(video?.runtime, 'configuration-required')
  for (const id of ['reference.image', 'reference.video']) {
    const reference = rows.find((row) => row.toolId === id)
    assert.equal(reference?.runtime, 'development-test-only')
  }
  return { comfy, packy, video }
}

async function assertProductionProfiles(page) {
  const images = await request(page, {
    action: 'imageApi',
    command: { op: 'profiles' },
  })
  const videos = await request(page, {
    action: 'videoApi',
    command: { op: 'profiles' },
  })
  assert.equal(
    images.some((profile) => profile.toolId.startsWith('reference.')),
    false,
  )
  assert.equal(
    videos.some((profile) => profile.toolId.startsWith('reference.')),
    false,
  )
  return { imageToolIds: images.map((profile) => profile.toolId), videoToolIds: videos.map((profile) => profile.toolId) }
}

async function openMainPages(page) {
  for (const name of ['项目', '剧本', '角色', '场景', '道具', '分镜', '生成', '素材库']) {
    await page.getByRole('button', { name, exact: true }).click()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  }
}

async function inspectDatabase() {
  const database = new DatabaseSync(join(userData, 'workspace.sqlite'), {
    readOnly: true,
    allowExtension: false,
  })
  try {
    const schema = Number(
      database.prepare('PRAGMA user_version').get()?.user_version,
    )
    const projects = Number(
      database.prepare('SELECT count(*) count FROM projects').get()?.count,
    )
    const taskRows = database.prepare('SELECT project_id,data FROM ai_tasks').all()
    const workflowRows = database
      .prepare('SELECT project_id,data FROM workflow_runs')
      .all()
    const approvals = database
      .prepare('SELECT project_id,data FROM generation_approvals')
      .all()
    const reservations = database
      .prepare('SELECT project_id,data FROM approval_reservations')
      .all()
    const generations = Number(
      database
        .prepare('SELECT count(*) count FROM generation_records')
        .get()?.count,
    )
    return {
      schema,
      projects,
      generations,
      tasks: taskRows.map((row) => ({
        projectId: row.project_id,
        value: JSON.parse(String(row.data)),
      })),
      workflows: workflowRows.map((row) => ({
        projectId: row.project_id,
        value: JSON.parse(String(row.data)),
      })),
      approvals: approvals.map((row) => ({
        projectId: row.project_id,
        value: JSON.parse(String(row.data)),
      })),
      reservations: reservations.map((row) => ({
        projectId: row.project_id,
        value: JSON.parse(String(row.data)),
      })),
    }
  } finally {
    database.close()
  }
}

const report = { mode, executablePath, userData, checks: [] }
let application
try {
  if (mode === 'fresh') {
    application = await launch()
    let page = await application.firstWindow()
    await expect(
      page.getByRole('button', { name: '新建项目', exact: true }),
    ).toBeEnabled()
    report.about = await about(page)
    assert.equal(report.about.version, '0.7.0')
    assert.equal(report.about.schema, 9)
    assert.equal(
      await application.evaluate(({ app }) => app.getPath('userData')),
      userData,
    )
    const projectName = `0.7 RC fresh ${Date.now()}`
    await page.getByRole('button', { name: '新建项目', exact: true }).click()
    await page.getByLabel('名称', { exact: true }).fill(projectName)
    await page.getByLabel('简介', { exact: true }).fill('isolated RC install')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    const projects = await request(page, { action: 'projects.list' })
    report.project = projects.find((project) => project.name === projectName)
    assert.ok(report.project)
    await openMainPages(page)
    report.readiness = await readiness(page)
    report.profiles = await assertProductionProfiles(page)
    report.checks.push('fresh project and all primary pages opened')
    await application.close()
    application = await launch()
    page = await application.firstWindow()
    const reopened = await request(page, {
      action: 'projects.open',
      id: report.project.id,
    })
    assert.equal(reopened.id, report.project.id)
    assert.equal((await about(page)).schema, 9)
    report.checks.push('fresh project reopened after restart')
  } else if (mode === 'retained') {
    if (!fixtureRoot) throw new Error('retained mode requires prior report path')
    const prior = JSON.parse(await readFile(fixtureRoot, 'utf8'))
    application = await launch()
    const page = await application.firstWindow()
    const info = await about(page)
    assert.equal(info.version, '0.7.0')
    assert.equal(info.schema, 9)
    const reopened = await request(page, {
      action: 'projects.open',
      id: prior.project.id,
    })
    assert.equal(reopened.id, prior.project.id)
    report.project = reopened
    report.checks.push('retained project opened after uninstall and reinstall')
  } else if (mode === 'upgrade') {
    if (!fixtureRoot) throw new Error('upgrade mode requires fixture root')
    const fixtures = JSON.parse(
      await readFile(join(fixtureRoot, 'fixtures.json'), 'utf8'),
    )
    application = await launch()
    let page = await application.firstWindow()
    report.about = await about(page)
    assert.equal(report.about.version, '0.7.0')
    assert.equal(report.about.schema, 9)
    const project = await request(page, {
      action: 'projects.open',
      id: fixtures.upgrade.projectId,
    })
    assert.equal(project.name, fixtures.upgrade.projectName)
    await openMainPages(page)
    const visual = await request(page, {
      action: 'visual',
      command: {
        operation: 'snapshot',
        projectId: fixtures.upgrade.projectId,
      },
    })
    assert.ok(
      visual.versions.some(
        (version) => version.id === fixtures.upgrade.versionId,
      ),
    )
    const operations = await request(page, {
      action: 'operations',
      command: {
        operation: 'snapshot',
        projectId: fixtures.upgrade.projectId,
        page: 0,
      },
    })
    const task = operations.tasks.find(
      (item) => item.id === fixtures.upgrade.taskId,
    )
    assert.equal(task?.path, 'Legacy Task')
    assert.equal(task?.remoteId, fixtures.upgrade.providerTaskId)
    const lineage = await request(page, {
      action: 'compatibility',
      command: {
        op: 'lineage',
        projectId: fixtures.upgrade.projectId,
        versionId: fixtures.upgrade.versionId,
      },
    })
    assert.equal(lineage.source, 'Legacy / provenance unavailable')
    const workflows = await request(page, {
      action: 'workflow',
      command: {
        op: 'listWorkflowRuns',
        projectId: fixtures.upgrade.projectId,
      },
    })
    assert.deepEqual(workflows, [])
    report.readiness = await readiness(page)
    report.profiles = await assertProductionProfiles(page)
    const before = await inspectDatabase()
    const originalTask = before.tasks.find(
      (item) => item.value.id === fixtures.upgrade.taskId,
    )?.value
    assert.ok(originalTask)
    assert.equal(before.generations, 0)
    await application.close()
    application = await launch()
    page = await application.firstWindow()
    assert.equal((await about(page)).schema, 9)
    const after = await inspectDatabase()
    const repeatedTask = after.tasks.find(
      (item) => item.value.id === fixtures.upgrade.taskId,
    )?.value
    assert.deepEqual(repeatedTask, originalTask)
    assert.equal(after.generations, 0)
    assert.equal(after.workflows.length, 0)
    report.idempotency = {
      schema: after.schema,
      taskUnchanged: true,
      noInventedGeneration: true,
      noInventedWorkflow: true,
    }
    report.checks.push('v6 data upgraded to v9 and remained identical on second start')
  } else if (mode === 'backup') {
    if (!fixtureRoot) throw new Error('backup mode requires fixture root')
    const fixtures = JSON.parse(
      await readFile(join(fixtureRoot, 'fixtures.json'), 'utf8'),
    )
    application = await launch()
    const page = await application.firstWindow()
    report.restores = []
    for (const backup of fixtures.backups) {
      await application.evaluate(
        ({ dialog }, folder) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [folder],
          })
        },
        backup.folder,
      )
      const restored = await request(page, {
        action: 'operations',
        command: { operation: 'restore' },
      })
      const visual = await request(page, {
        action: 'visual',
        command: { operation: 'snapshot', projectId: restored.id },
      })
      assert.ok(visual.versions.length >= 1)
      const operations = await request(page, {
        action: 'operations',
        command: { operation: 'snapshot', projectId: restored.id, page: 0 },
      })
      assert.ok(operations.tasks.every((task) => task.readOnly))
      const workflows = await request(page, {
        action: 'workflow',
        command: { op: 'listWorkflowRuns', projectId: restored.id },
      })
      if (backup.format === 4) {
        assert.ok(workflows.length > 0)
        assert.ok(workflows.every((run) => run.executionAllowed === false))
        const beforeResume = JSON.stringify(workflows[0])
        const resume = await request(page, {
          action: 'workflow',
          command: {
            op: 'resumeWorkflowRun',
            projectId: restored.id,
            runId: workflows[0].id,
          },
        })
        assert.equal(JSON.stringify(resume.run), beforeResume)
        const afterResume = await request(page, {
          action: 'workflow',
          command: {
            op: 'listWorkflowRuns',
            projectId: restored.id,
          },
        })
        assert.equal(JSON.stringify(afterResume[0]), beforeResume)
      } else {
        assert.deepEqual(workflows, [])
      }
      report.restores.push({
        format: backup.format,
        schema: backup.schema,
        projectId: restored.id,
        versions: visual.versions.length,
        tasks: operations.tasks.length,
        workflows: workflows.length,
      })
    }
    await application.close()
    application = undefined
    const database = await inspectDatabase()
    assert.equal(database.schema, 9)
    assert.ok(
      database.tasks.every(
        (task) =>
          task.value.executionAllowed === false &&
          task.value.providerTaskId === null,
      ),
    )
    assert.ok(
      database.workflows.every(
        (workflow) => workflow.value.executionAllowed === false,
      ),
    )
    assert.ok(
      database.approvals.every(
        (approval) => approval.value.status === 'historical',
      ),
    )
    assert.ok(
      database.reservations.every(
        (reservation) => reservation.value.status === 'historical',
      ),
    )
    report.authority = {
      tasksDisabled: true,
      providerTaskIdsCleared: true,
      workflowsHistorical: true,
      approvalsHistorical: true,
      reservationsHistorical: true,
    }
    report.checks.push('backup formats 1-4 restored without execution authority')
  } else {
    throw new Error(`Unknown mode: ${mode}`)
  }
  report.success = true
} finally {
  if (application) await application.close()
  await writeFile(reportPath, JSON.stringify(report, null, 2))
}

console.log(JSON.stringify({ mode, success: report.success, checks: report.checks }))
