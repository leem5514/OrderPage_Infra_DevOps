function required(name) {
  const value = __ENV[name];
  if (!value || value.trim() === '') {
    throw new Error(`${name} environment variable is required`);
  }
  return value.trim();
}

function positiveInteger(name, fallback) {
  const raw = __ENV[name] || String(fallback);
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer: ${raw}`);
  }
  return value;
}

export function baseUrl() {
  return required('BASE_URL').replace(/\/$/, '');
}

export function thinkTimeSeconds() {
  const raw = __ENV.K6_THINK_TIME_SECONDS || '0.5';
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`K6_THINK_TIME_SECONDS must be zero or positive: ${raw}`);
  }
  return value;
}

export function buildLoadOptions() {
  const users = positiveInteger('K6_USERS', 100);
  const supportedUsers = [100, 300, 500];
  if (!supportedUsers.includes(users)) {
    throw new Error(`K6_USERS must be one of ${supportedUsers.join(', ')}: ${users}`);
  }

  const p95Ms = positiveInteger('K6_P95_MS', 1000);
  const p99Ms = positiveInteger('K6_P99_MS', 2000);
  const variant = __ENV.K6_VARIANT || 'unassigned';

  return {
    discardResponseBodies: true,
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
    tags: {
      scenario_id: 'S05',
      variant,
      git_commit: __ENV.GIT_COMMIT || 'unknown',
      image_tag: __ENV.IMAGE_TAG || 'unknown',
    },
    scenarios: {
      hpa_product_list: {
        executor: 'ramping-vus',
        startVUs: 0,
        gracefulRampDown: '30s',
        stages: [
          { duration: __ENV.K6_WARMUP || '2m', target: users },
          { duration: __ENV.K6_DURATION || '10m', target: users },
          { duration: __ENV.K6_COOLDOWN || '3m', target: 0 },
        ],
        tags: {
          load_users: String(users),
        },
      },
    },
    thresholds: {
      checks: ['rate>0.99'],
      http_req_failed: ['rate<0.01'],
      product_list_success: ['rate>0.99'],
      product_list_duration: [`p(95)<${p95Ms}`, `p(99)<${p99Ms}`],
    },
  };
}
