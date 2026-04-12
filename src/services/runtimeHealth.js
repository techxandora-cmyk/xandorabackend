const { CORE_READY_TABLES, listExpectedMigrations } = require("../config/migrations");

async function queryScalar(pool, sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

async function tableExists(pool, tableName) {
  const row = await queryScalar(
    pool,
    `SELECT to_regclass($1) AS regclass_name`,
    [`public.${tableName}`]
  );
  return Boolean(row?.regclass_name);
}

async function checkDatabase(pool) {
  const started = Date.now();

  try {
    const row = await queryScalar(pool, "SELECT NOW() AS now");
    return {
      ok: true,
      status: "up",
      latency_ms: Date.now() - started,
      server_time: row?.now || null,
      pool: {
        total: Number(pool.totalCount || 0),
        idle: Number(pool.idleCount || 0),
        waiting: Number(pool.waitingCount || 0),
      },
    };
  } catch (err) {
    return {
      ok: false,
      status: "down",
      latency_ms: Date.now() - started,
      error: err && err.message ? err.message : String(err),
      pool: {
        total: Number(pool.totalCount || 0),
        idle: Number(pool.idleCount || 0),
        waiting: Number(pool.waitingCount || 0),
      },
    };
  }
}

async function checkSchema(pool) {
  try {
    const hasMigrationsTable = await tableExists(pool, "schema_migrations");
    const expectedMigrations = listExpectedMigrations();

    if (!hasMigrationsTable) {
      return {
        ok: false,
        status: "not_ready",
        error: "schema_migrations table is missing",
        applied: 0,
        expected: expectedMigrations.length,
        missing_migrations: expectedMigrations,
        missing_tables: CORE_READY_TABLES,
      };
    }

    const appliedRows = await pool.query(
      `SELECT filename FROM schema_migrations ORDER BY applied_at ASC`
    );
    const applied = new Set(
      appliedRows.rows.map((row) => String(row.filename || "").trim()).filter(Boolean)
    );

    const missingMigrations = expectedMigrations.filter(
      (filename) => !applied.has(filename)
    );

    const tableChecks = await Promise.all(
      CORE_READY_TABLES.map(async (tableName) => ({
        tableName,
        exists: await tableExists(pool, tableName),
      }))
    );
    const missingTables = tableChecks
      .filter((row) => !row.exists)
      .map((row) => row.tableName);

    const ok = missingMigrations.length === 0 && missingTables.length === 0;
    return {
      ok,
      status: ok ? "ready" : "not_ready",
      applied: applied.size,
      expected: expectedMigrations.length,
      missing_migrations: missingMigrations,
      missing_tables: missingTables,
    };
  } catch (err) {
    return {
      ok: false,
      status: "not_ready",
      error: err && err.message ? err.message : String(err),
      applied: 0,
      expected: listExpectedMigrations().length,
      missing_migrations: [],
      missing_tables: [],
    };
  }
}

async function checkRedis(cache) {
  if (!cache || typeof cache.getStatus !== "function") {
    return {
      ok: true,
      status: "disabled",
      detail: "Redis cache module unavailable",
    };
  }

  const state = cache.getStatus();
  if (!state.enabled) {
    return {
      ok: true,
      status: "disabled",
      detail: "Redis disabled by configuration",
    };
  }

  const result = typeof cache.ping === "function" ? await cache.ping() : null;
  return {
    ok: Boolean(result?.ok),
    status: result?.status || "down",
    error: result?.error || state.lastError || null,
    last_connected_at: state.lastConnectedAt || null,
  };
}

async function checkRabbit(rabbit) {
  if (!rabbit || typeof rabbit.getStatus !== "function") {
    return {
      ok: true,
      status: "disabled",
      detail: "RabbitMQ module unavailable",
    };
  }

  const state = rabbit.getStatus();
  if (!state.enabled) {
    return {
      ok: true,
      status: "disabled",
      detail: "RabbitMQ disabled by configuration",
    };
  }

  const result = typeof rabbit.ping === "function" ? await rabbit.ping() : null;
  return {
    ok: Boolean(result?.ok),
    status: result?.status || "down",
    error: result?.error || state.lastError || null,
    last_connected_at: state.lastConnectedAt || null,
    queue: state.queue || result?.queue || null,
  };
}

function allEnabledDependenciesReady(components) {
  return Object.values(components).every((component) => {
    if (!component) return true;
    if (component.status === "disabled") return true;
    return component.ok !== false;
  });
}

async function buildRuntimeHealth({ pool, cache, rabbit, startedAt }) {
  const db = await checkDatabase(pool);
  const schema = db.ok ? await checkSchema(pool) : {
    ok: false,
    status: "not_ready",
    error: "Database unavailable",
    missing_migrations: listExpectedMigrations(),
    missing_tables: CORE_READY_TABLES,
  };
  const redis = await checkRedis(cache);
  const rabbitmq = await checkRabbit(rabbit);

  const components = {
    database: db,
    schema,
    redis,
    rabbitmq,
  };

  const ready = Boolean(db.ok && schema.ok && allEnabledDependenciesReady({
    redis,
    rabbitmq,
  }));

  return {
    ok: ready,
    status: ready ? "ready" : "degraded",
    uptime_seconds: Math.round(process.uptime()),
    started_at: startedAt || null,
    timestamp: new Date().toISOString(),
    components,
  };
}

module.exports = {
  buildRuntimeHealth,
};
