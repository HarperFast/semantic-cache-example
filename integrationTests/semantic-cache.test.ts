/**
 * Integration tests for the semantic-cache-example.
 *
 * These tests cover the Harper data and routing layer without requiring a real
 * AI provider (Ollama or Gemini). Tests that exercise the actual embedding/chat
 * path are omitted here because they need live external credentials; those are
 * validated manually or in an environment that has the appropriate keys.
 *
 * Specifically covered:
 *   - Harper starts and the SemanticCache schema loads cleanly.
 *   - GET /search?prompt= validation (missing prompt → 4xx).
 *   - POST /search validation (missing prompt field → 4xx).
 *   - GET /SemanticCache/ returns an empty array (no records yet).
 *   - SemanticCache table accepts a direct PUT and the record is readable.
 */
import { suite, test, before, after } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import {
  setupHarperWithFixture,
  teardownHarper,
  type ContextWithHarper,
} from '@harperfast/integration-testing';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '..');

// harper's `exports` only exposes ".", so 'harper/dist/bin/harper.js' is not
// resolvable via a deep subpath. Resolve the CLI from the exported main entry.
const require = createRequire(import.meta.url);
const harperBinPath = resolve(dirname(require.resolve('harper')), 'bin/harper.js');

function authFetch(
  ctx: ContextWithHarper,
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
) {
  const { headers = {}, ...rest } = init;
  const creds = Buffer.from(
    `${ctx.harper.admin.username}:${ctx.harper.admin.password}`,
  ).toString('base64');
  return fetch(`${ctx.harper.httpURL}${path}`, {
    ...rest,
    headers: { Authorization: `Basic ${creds}`, ...headers },
  });
}

void suite('semantic-cache-example', (ctx: ContextWithHarper) => {
  before(async () => {
    // Use a minimal Ollama env that satisfies the createModelProvider() guard
    // at module-load time. The test avoids triggering any actual AI calls, so
    // the Ollama host can be unreachable — only the validation paths are exercised.
    await setupHarperWithFixture(ctx, FIXTURE_PATH, {
      harperBinPath,
      env: {
        MODEL_PROVIDER: 'ollama',
        OLLAMA_EMBEDDING_MODEL: 'nomic-embed-text',
        OLLAMA_SEARCH_MODEL: 'llama3',
        OLLAMA_HOST: 'http://127.0.0.1:11434',
        SIMILARITY_THRESHOLD: '0.1',
      },
    });
  });

  after(async () => {
    await teardownHarper(ctx);
  });

  void test('Harper starts and responds to root', async () => {
    const res = await authFetch(ctx, '/');
    ok([200, 400, 404].includes(res.status), `Unexpected root status ${res.status}`);
  });

  void test('GET /search without prompt returns an error response', async () => {
    const res = await authFetch(ctx, '/search');
    // The resource throws a generic Error for missing prompt; Harper maps this to 4xx or 5xx.
    ok(res.status >= 400, `Expected error status, got ${res.status}`);
  });

  void test('POST /search without prompt field returns an error response', async () => {
    const res = await authFetch(ctx, '/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notAPrompt: 'hello' }),
    });
    ok(res.status >= 400, `Expected error for missing prompt, got ${res.status}`);
  });

  void test('POST /search with no body returns an error response', async () => {
    const res = await authFetch(ctx, '/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    ok(res.status >= 400, `Expected error for empty body, got ${res.status}`);
  });

  void test('GET /SemanticCache/ returns an array (table is accessible)', async () => {
    const res = await authFetch(ctx, '/SemanticCache/');
    strictEqual(res.status, 200);
    const body = (await res.json()) as unknown;
    ok(Array.isArray(body), `Expected array from /SemanticCache/, got ${JSON.stringify(body)}`);
  });

  void test('PUT record into SemanticCache and retrieve it', async () => {
    const key = 'test-md5-hash-abc123';
    const record = {
      query: key,
      vector: [0.1, 0.2, 0.3],
      result: 'cached test answer',
    };

    // Write
    const putRes = await authFetch(ctx, `/SemanticCache/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    ok(
      [200, 201, 204].includes(putRes.status),
      `Expected 2xx from PUT, got ${putRes.status}`,
    );

    // Read back
    const getRes = await authFetch(ctx, `/SemanticCache/${key}`);
    strictEqual(getRes.status, 200);
    const body = (await getRes.json()) as { query: string; result: string };
    strictEqual(body.query, key);
    strictEqual(body.result, 'cached test answer');
  });

  void test('GET /search?prompt= with empty string returns an error response', async () => {
    const res = await authFetch(ctx, '/search?prompt=');
    ok(res.status >= 400, `Expected error for empty prompt, got ${res.status}`);
  });
});
