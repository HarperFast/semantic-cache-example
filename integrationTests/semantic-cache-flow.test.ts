/**
 * Integration tests for the semantic-cache-example's actual caching behaviour.
 *
 * The sibling suite (semantic-cache.test.ts) deliberately covers only the
 * validation paths, on the premise that exercising the embed/chat path needs
 * live provider credentials. It does not: `createModelProvider` talks to Ollama
 * over plain HTTP at `OLLAMA_HOST`, so a stub server is enough to drive the real
 * code path end to end.
 *
 * That matters because everything this repo actually demonstrates lives on that
 * path — `SemanticCache.sourcedFrom(SearchSource)`, the HNSW vector index, the
 * exact-hash cache hit, and the `relatedQuery` near-match fallback — and none of
 * it had any coverage.
 *
 * Covered here:
 *   - Cache miss: the chat model is called and the answer is returned + stored.
 *   - Exact repeat: served from the cache by MD5 primary key, chat NOT called again.
 *   - Semantic near-match: a different prompt whose embedding is within
 *     SIMILARITY_THRESHOLD resolves to the original answer via HNSW, chat NOT called.
 *   - Dissimilar prompt: falls through to the chat model.
 */
import { suite, test, before, after, type SuiteContext } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import {
  setupHarperWithFixture,
  teardownHarper,
  type ContextWithHarper,
} from '@harperfast/integration-testing';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '..');

const require = createRequire(import.meta.url);
const harperBinPath = resolve(dirname(require.resolve('harper')), 'bin/harper.js');

const PROMPT_BASE = 'What is Harper?';
const PROMPT_NEAR = 'Tell me about Harper.';
const PROMPT_FAR = 'How do I bake sourdough bread?';

// Unit vectors chosen so cosine distance is well inside / well outside the 0.1
// SIMILARITY_THRESHOLD the fixture is started with.
const VECTORS: Record<string, number[]> = {
  [PROMPT_BASE]: [1, 0, 0, 0],
  [PROMPT_NEAR]: [0.9995, 0.0316, 0, 0], // ~0.0005 cosine distance from BASE
  [PROMPT_FAR]: [0, 1, 0, 0], // orthogonal -> distance 1
};

/** Stub Ollama server: implements just the two endpoints the `ollama` client calls. */
function startStubOllama() {
  const calls = { embed: 0, chat: 0, chatPrompts: [] as string[] };

  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const send = (payload: unknown) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      let parsed: any = {};
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        /* fall through to the 404 below */
      }

      if (req.url?.startsWith('/api/embed')) {
        calls.embed++;
        const prompt: string = parsed.input;
        const vector = VECTORS[prompt] ?? [0, 0, 1, 0];
        return send({ embeddings: [vector] });
      }
      if (req.url?.startsWith('/api/chat')) {
        calls.chat++;
        const prompt: string = parsed.messages?.[0]?.content ?? '';
        calls.chatPrompts.push(prompt);
        return send({ message: { role: 'assistant', content: `answer-for:${prompt}` } });
      }
      res.writeHead(404).end();
    });
  });

  return new Promise<{ url: string; calls: typeof calls; close: () => Promise<void> }>(
    (resolvePromise) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolvePromise({
          url: `http://127.0.0.1:${port}`,
          calls,
          close: () =>
            new Promise<void>((done) => {
              server.closeAllConnections?.();
              server.close(() => done());
            }),
        });
      });
    },
  );
}

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
    headers: { ...headers, Authorization: `Basic ${creds}` },
  });
}

function search(ctx: ContextWithHarper, prompt: string) {
  return authFetch(ctx, '/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
}

const ctx = {} as ContextWithHarper;

void suite('semantic-cache-example — cache behaviour', (_suiteCtx: SuiteContext) => {
  let stub: Awaited<ReturnType<typeof startStubOllama>>;

  before(async () => {
    stub = await startStubOllama();
    await setupHarperWithFixture(ctx, FIXTURE_PATH, {
      harperBinPath,
      env: {
        MODEL_PROVIDER: 'ollama',
        OLLAMA_EMBEDDING_MODEL: 'stub-embed',
        OLLAMA_SEARCH_MODEL: 'stub-chat',
        OLLAMA_HOST: stub.url,
        SIMILARITY_THRESHOLD: '0.1',
      },
    });
  });

  after(async () => {
    if ((ctx as { harper?: unknown }).harper) await teardownHarper(ctx);
    await stub?.close();
  });

  void test('cache miss calls the chat model and returns its answer', async () => {
    const res = await search(ctx, PROMPT_BASE);
    strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    const body = await res.text();
    ok(
      body.includes(`answer-for:${PROMPT_BASE}`),
      `expected the stubbed chat answer, got: ${body}`,
    );
    strictEqual(stub.calls.chat, 1, 'chat model should have been called exactly once');
  });

  void test('exact repeat is served from cache without calling the chat model', async () => {
    const chatCallsBefore = stub.calls.chat;
    const res = await search(ctx, PROMPT_BASE);
    strictEqual(res.status, 200);
    const body = await res.text();
    ok(body.includes(`answer-for:${PROMPT_BASE}`), `expected the cached answer, got: ${body}`);
    strictEqual(
      stub.calls.chat,
      chatCallsBefore,
      'an identical prompt hashes to the same primary key and must not re-invoke the chat model',
    );
  });

  void test('a semantically near prompt reuses the cached answer via the vector index', async () => {
    const chatCallsBefore = stub.calls.chat;
    const res = await search(ctx, PROMPT_NEAR);
    strictEqual(res.status, 200);
    const body = await res.text();
    ok(
      body.includes(`answer-for:${PROMPT_BASE}`),
      `expected the near-match to resolve to the original answer, got: ${body}`,
    );
    strictEqual(
      stub.calls.chat,
      chatCallsBefore,
      'a prompt within SIMILARITY_THRESHOLD must be served from the cache, not the chat model',
    );
  });

  void test('a dissimilar prompt falls through to the chat model', async () => {
    const chatCallsBefore = stub.calls.chat;
    const res = await search(ctx, PROMPT_FAR);
    strictEqual(res.status, 200);
    const body = await res.text();
    ok(body.includes(`answer-for:${PROMPT_FAR}`), `expected a fresh answer, got: ${body}`);
    strictEqual(
      stub.calls.chat,
      chatCallsBefore + 1,
      'an unrelated prompt must reach the chat model',
    );
  });

  void test('GET /SemanticCache/ lists the stored entries with their vectors', async () => {
    const res = await authFetch(ctx, '/SemanticCache/');
    strictEqual(res.status, 200);
    const rows = (await res.json()) as Array<{ query: string; vector?: number[]; result?: string }>;
    ok(Array.isArray(rows), 'expected an array');
    ok(rows.length > 0, 'expected at least one cached entry after the searches above');
    ok(
      rows.some((r) => Array.isArray(r.vector) && r.vector.length === 4),
      'expected a stored 4-dimension embedding vector',
    );
  });
});
