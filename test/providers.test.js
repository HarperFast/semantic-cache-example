import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelProvider } from '../src/providers.js';

function makeOllamaCtor(spy = {}) {
	spy.calls = [];
	spy.embedArgs = null;
	spy.chatArgs = null;
	function OllamaCtor(opts) {
		spy.calls.push(opts);
		return {
			async embed(args) {
				spy.embedArgs = args;
				return { embeddings: [[0.1, 0.2, 0.3]] };
			},
			async chat(args) {
				spy.chatArgs = args;
				return { message: { content: 'ollama-reply' } };
			},
		};
	}
	return { OllamaCtor, spy };
}

function makeGeminiCtor(spy = {}) {
	spy.calls = [];
	spy.embedArgs = null;
	spy.chatArgs = null;
	function GoogleGenAICtor(opts) {
		spy.calls.push(opts);
		return {
			models: {
				async embedContent(args) {
					spy.embedArgs = args;
					return { embeddings: [{ values: [0.4, 0.5, 0.6] }] };
				},
				async generateContent(args) {
					spy.chatArgs = args;
					return { text: 'gemini-reply' };
				},
			},
		};
	}
	return { GoogleGenAICtor, spy };
}

test('MODEL_PROVIDER unset defaults to ollama', async () => {
	const { OllamaCtor } = makeOllamaCtor();
	const provider = await createModelProvider(
		{ OLLAMA_HOST: 'http://x', OLLAMA_EMBEDDING_MODEL: 'm', OLLAMA_SEARCH_MODEL: 'c' },
		{ OllamaCtor }
	);
	assert.equal(provider.name, 'ollama');
});

test('MODEL_PROVIDER=bogus throws with the bad value in the message', async () => {
	await assert.rejects(
		() => createModelProvider({ MODEL_PROVIDER: 'bogus' }, {}),
		/Unknown MODEL_PROVIDER "bogus"/
	);
});

test('MODEL_PROVIDER=gemini without GEMINI_API_KEY throws', async () => {
	await assert.rejects(
		() => createModelProvider({ MODEL_PROVIDER: 'gemini' }, {}),
		/GEMINI_API_KEY/
	);
});

test('ollama embed passes model + input through and returns embeddings unchanged', async () => {
	const { OllamaCtor, spy } = makeOllamaCtor();
	const provider = await createModelProvider(
		{
			MODEL_PROVIDER: 'ollama',
			OLLAMA_HOST: 'http://h',
			OLLAMA_EMBEDDING_MODEL: 'nomic',
			OLLAMA_SEARCH_MODEL: 'falcon',
		},
		{ OllamaCtor }
	);
	const vec = await provider.embed('hello');
	assert.deepEqual(vec, [[0.1, 0.2, 0.3]]);
	assert.deepEqual(spy.embedArgs, { model: 'nomic', input: 'hello' });
	assert.deepEqual(spy.calls[0], { host: 'http://h' });
});

test('ollama chat returns message.content and sends user-role message', async () => {
	const { OllamaCtor, spy } = makeOllamaCtor();
	const provider = await createModelProvider(
		{
			MODEL_PROVIDER: 'ollama',
			OLLAMA_EMBEDDING_MODEL: 'nomic',
			OLLAMA_SEARCH_MODEL: 'falcon',
		},
		{ OllamaCtor }
	);
	const reply = await provider.chat('hi');
	assert.equal(reply, 'ollama-reply');
	assert.deepEqual(spy.chatArgs, {
		model: 'falcon',
		messages: [{ role: 'user', content: 'hi' }],
	});
});

test('gemini embed normalizes embeddings[0].values into number[][]', async () => {
	const { GoogleGenAICtor, spy } = makeGeminiCtor();
	const provider = await createModelProvider(
		{ MODEL_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' },
		{ GoogleGenAICtor }
	);
	const vec = await provider.embed('hello');
	assert.deepEqual(vec, [[0.4, 0.5, 0.6]]);
	assert.deepEqual(spy.embedArgs, {
		model: 'gemini-embedding-001',
		contents: 'hello',
	});
	assert.deepEqual(spy.calls[0], { apiKey: 'k' });
});

test('gemini chat returns result.text and forwards contents', async () => {
	const { GoogleGenAICtor, spy } = makeGeminiCtor();
	const provider = await createModelProvider(
		{ MODEL_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' },
		{ GoogleGenAICtor }
	);
	const reply = await provider.chat('hello');
	assert.equal(reply, 'gemini-reply');
	assert.deepEqual(spy.chatArgs, { model: 'gemini-2.5-flash', contents: 'hello' });
});

test('gemini uses default model names when env unset and overrides when set', async () => {
	const { GoogleGenAICtor: GeminiDefault, spy: spyDefault } = makeGeminiCtor();
	const providerDefault = await createModelProvider(
		{ MODEL_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' },
		{ GoogleGenAICtor: GeminiDefault }
	);
	await providerDefault.embed('x');
	await providerDefault.chat('x');
	assert.equal(spyDefault.embedArgs.model, 'gemini-embedding-001');
	assert.equal(spyDefault.chatArgs.model, 'gemini-2.5-flash');

	const { GoogleGenAICtor: GeminiOverride, spy: spyOverride } = makeGeminiCtor();
	const providerOverride = await createModelProvider(
		{
			MODEL_PROVIDER: 'gemini',
			GEMINI_API_KEY: 'k',
			GEMINI_EMBEDDING_MODEL: 'custom-embed',
			GEMINI_CHAT_MODEL: 'custom-chat',
		},
		{ GoogleGenAICtor: GeminiOverride }
	);
	await providerOverride.embed('x');
	await providerOverride.chat('x');
	assert.equal(spyOverride.embedArgs.model, 'custom-embed');
	assert.equal(spyOverride.chatArgs.model, 'custom-chat');
});

test('only the selected provider SDK ctor is invoked', async () => {
	const { OllamaCtor, spy: ollamaSpy } = makeOllamaCtor();
	const { GoogleGenAICtor, spy: geminiSpy } = makeGeminiCtor();

	await createModelProvider(
		{
			MODEL_PROVIDER: 'ollama',
			OLLAMA_HOST: 'h',
			OLLAMA_EMBEDDING_MODEL: 'm',
			OLLAMA_SEARCH_MODEL: 'c',
		},
		{ OllamaCtor, GoogleGenAICtor }
	);
	assert.equal(ollamaSpy.calls.length, 1);
	assert.equal(geminiSpy.calls.length, 0);

	const o2 = makeOllamaCtor();
	const g2 = makeGeminiCtor();
	await createModelProvider(
		{ MODEL_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' },
		{ OllamaCtor: o2.OllamaCtor, GoogleGenAICtor: g2.GoogleGenAICtor }
	);
	assert.equal(o2.spy.calls.length, 0);
	assert.equal(g2.spy.calls.length, 1);
});

test('gemini embed throws a descriptive error when the response has no values', async () => {
	function GoogleGenAICtor() {
		return {
			models: {
				async embedContent() {
					return { embeddings: [] };
				},
				async generateContent() {
					return { text: '' };
				},
			},
		};
	}
	const provider = await createModelProvider(
		{ MODEL_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' },
		{ GoogleGenAICtor }
	);
	await assert.rejects(() => provider.embed('hello'), /Gemini returned no embedding/);
});

test('ollama provider fails fast when OLLAMA_EMBEDDING_MODEL is missing', async () => {
	const { OllamaCtor } = makeOllamaCtor();
	await assert.rejects(
		() =>
			createModelProvider(
				{ MODEL_PROVIDER: 'ollama', OLLAMA_SEARCH_MODEL: 'falcon' },
				{ OllamaCtor }
			),
		/OLLAMA_EMBEDDING_MODEL/
	);
});

test('ollama provider fails fast when OLLAMA_SEARCH_MODEL is missing', async () => {
	const { OllamaCtor } = makeOllamaCtor();
	await assert.rejects(
		() =>
			createModelProvider(
				{ MODEL_PROVIDER: 'ollama', OLLAMA_EMBEDDING_MODEL: 'nomic' },
				{ OllamaCtor }
			),
		/OLLAMA_SEARCH_MODEL/
	);
});

test('MODEL_PROVIDER is trimmed and case-insensitive', async () => {
	const { OllamaCtor } = makeOllamaCtor();
	const ollamaEnv = {
		MODEL_PROVIDER: '  Ollama  ',
		OLLAMA_EMBEDDING_MODEL: 'm',
		OLLAMA_SEARCH_MODEL: 'c',
	};
	const ollamaProvider = await createModelProvider(ollamaEnv, { OllamaCtor });
	assert.equal(ollamaProvider.name, 'ollama');

	const { GoogleGenAICtor } = makeGeminiCtor();
	const geminiProvider = await createModelProvider(
		{ MODEL_PROVIDER: '\tGEMINI\n', GEMINI_API_KEY: 'k' },
		{ GoogleGenAICtor }
	);
	assert.equal(geminiProvider.name, 'gemini');
});
