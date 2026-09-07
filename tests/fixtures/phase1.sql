CREATE TABLE projects (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
        CREATE TABLE entities (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          kind TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(project_id, id)
        );
        CREATE INDEX entities_project_kind ON entities(project_id, kind);
        CREATE TABLE entity_refs (
          project_id TEXT NOT NULL, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
          PRIMARY KEY(source_id, target_id),
          FOREIGN KEY(project_id, source_id) REFERENCES entities(project_id, id) ON DELETE CASCADE,
          FOREIGN KEY(project_id, target_id) REFERENCES entities(project_id, id) ON DELETE CASCADE
        );
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        PRAGMA user_version = 1;
