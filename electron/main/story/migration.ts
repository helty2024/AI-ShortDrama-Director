import type { DatabaseSync } from 'node:sqlite'

export const STORY_SCHEMA_VERSION = 10

export function migrateStory(db: DatabaseSync) {
  db.exec(`
    UPDATE projects SET data = json_set(data,
      '$.logline', coalesce(json_extract(data, '$.logline'), ''),
      '$.style', coalesce(json_extract(data, '$.style'), ''),
      '$.worldview', coalesce(json_extract(data, '$.worldview'), ''),
      '$.creativeRequirements', coalesce(json_extract(data, '$.creativeRequirements'), '')
    );
    PRAGMA user_version=10;
  `)
}
