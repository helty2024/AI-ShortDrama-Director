import { isAbsolute, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'

export const releaseValidationRoot = () =>
  resolve(tmpdir(), 'ai-shortdrama-director-release-tests')

export function isolatedUserData(
  packaged: boolean,
  environment: NodeJS.ProcessEnv,
): string | null {
  const requested = environment.DIRECTOR_TEST_USER_DATA
  if (!requested) return null
  if (!packaged) return resolve(requested)
  if (environment.DIRECTOR_RELEASE_VALIDATION !== '0.7.0-rc') return null
  const root = releaseValidationRoot()
  const target = resolve(requested)
  const scope = relative(root, target)
  if (!scope || scope.startsWith('..') || isAbsolute(scope)) return null
  return target
}

export function releaseValidationPath(...parts: string[]) {
  return join(releaseValidationRoot(), ...parts)
}
