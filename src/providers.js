/**
 * Pure, Harper-free provider dispatch for embedding + chat.
 *
 * createModelProvider(env, deps) returns:
 *   {
 *     name: 'ollama' | 'gemini',
 *     embed(prompt): Promise<number[][]>,
 *     chat(prompt): Promise<string>,
 *   }
 *
 * `env` is a plain object (typically `process.env`). `deps` may inject
 * `{ OllamaCtor, GoogleGenAICtor }` for tests; otherwise the real SDKs are
 * dynamically imported on demand for the selected provider only.
 */
export async function createModelProvider(env, deps = {}) {
	const name = (env.MODEL_PROVIDER ?? 'ollama').trim().toLowerCase();

	if (name === 'ollama') {
		const embeddingModel = env.OLLAMA_EMBEDDING_MODEL;
		const chatModel = env.OLLAMA_SEARCH_MODEL;
		if (!embeddingModel) {
			throw new Error('MODEL_PROVIDER=ollama requires OLLAMA_EMBEDDING_MODEL to be set');
		}
		if (!chatModel) {
			throw new Error('MODEL_PROVIDER=ollama requires OLLAMA_SEARCH_MODEL to be set');
		}
		const OllamaCtor = deps.OllamaCtor ?? (await import('ollama')).Ollama;
		const client = new OllamaCtor({ host: env.OLLAMA_HOST });

		return {
			name,
			async embed(prompt) {
				const result = await client.embed({ model: embeddingModel, input: prompt });
				return result.embeddings;
			},
			async chat(prompt) {
				const result = await client.chat({
					model: chatModel,
					messages: [{ role: 'user', content: prompt }],
				});
				return result.message.content;
			},
		};
	}

	if (name === 'gemini') {
		if (!env.GEMINI_API_KEY) {
			throw new Error('MODEL_PROVIDER=gemini requires GEMINI_API_KEY to be set');
		}
		const GoogleGenAICtor =
			deps.GoogleGenAICtor ?? (await import('@google/genai')).GoogleGenAI;
		const client = new GoogleGenAICtor({ apiKey: env.GEMINI_API_KEY });
		const embeddingModel = env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001';
		const chatModel = env.GEMINI_CHAT_MODEL ?? 'gemini-2.5-flash';

		return {
			name,
			async embed(prompt) {
				const result = await client.models.embedContent({
					model: embeddingModel,
					contents: prompt,
				});
				const values = result?.embeddings?.[0]?.values;
				if (!Array.isArray(values) || values.length === 0) {
					throw new Error(
						`Gemini returned no embedding for model "${embeddingModel}" (response was empty or malformed)`
					);
				}
				return [values];
			},
			async chat(prompt) {
				const result = await client.models.generateContent({
					model: chatModel,
					contents: prompt,
				});
				return result.text;
			},
		};
	}

	throw new Error(`Unknown MODEL_PROVIDER "${name}". Expected "ollama" or "gemini".`);
}
