import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isolatedUserData,
  releaseValidationPath,
} from '../../electron/main/release-validation.js'

test('packaged release validation userData is explicit and temp-scoped', () => {
  const valid = releaseValidationPath('fresh', 'user-data')
  assert.equal(
    isolatedUserData(true, {
      DIRECTOR_RELEASE_VALIDATION: '0.7.0-rc',
      DIRECTOR_TEST_USER_DATA: valid,
    }),
    valid,
  )
  assert.equal(
    isolatedUserData(true, { DIRECTOR_TEST_USER_DATA: valid }),
    null,
  )
  assert.equal(
    isolatedUserData(true, {
      DIRECTOR_RELEASE_VALIDATION: '0.7.0-rc',
      DIRECTOR_TEST_USER_DATA: releaseValidationPath('..', 'escaped'),
    }),
    null,
  )
  assert.equal(
    isolatedUserData(true, {
      DIRECTOR_RELEASE_VALIDATION: 'wrong',
      DIRECTOR_TEST_USER_DATA: valid,
    }),
    null,
  )
})

test('development test userData remains available without the RC token', () => {
  const valid = releaseValidationPath('development')
  assert.equal(
    isolatedUserData(false, { DIRECTOR_TEST_USER_DATA: valid }),
    valid,
  )
})
