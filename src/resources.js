import crypto from 'crypto';
import { createModelProvider } from './providers.js';

const { SemanticCache } = databases.cache;
const provider = await createModelProvider(process.env);

/**
 * Converts a given string to its MD5 hash representation.
 *
 * @param {string} input - The string to be converted into an MD5 hash.
 * @return {string} The MD5 hash of the input string, represented as a hexadecimal string.
 */
function stringToMd5(input) {
	return crypto
		.createHash('md5')
		.update(input)
		.digest('hex');
}


/**
 * Represents a search resource that performs operations against a semantic cache.
 * This class extends the Resource class.
 */
export class search extends Resource {
	static loadAsInstance = false;

	async _lookup(prompt) {
		const md5Hash = stringToMd5(prompt);
		const cacheResult = await SemanticCache.get(md5Hash, { prompt });
		return cacheResult.result;
	}

	async get(target) {
		const prompt = target?.get?.('prompt') ?? target?.conditions?.[0]?.value;
		if (!prompt) {
			throw new Error(
				'search requires a "prompt" query param or a conditions[0].value (MCP-style)'
			);
		}
		return this._lookup(prompt);
	}

	async post(target, data) {
		if (!data?.prompt) {
			throw new Error('search POST requires a "prompt" field in the request body');
		}
		return this._lookup(data.prompt);
	}
}

/**
 * The SearchSource class provides a way to retrieve or generate results based on user input.
 * It uses embedding models and semantic caching to efficiently find relevant results.
 * If a similar result exists in the cache, it returns the cached result. Otherwise,
 * it generates a new result using the configured chat model.
 */
class SearchSource extends Resource {
	static SIMILARITY_THRESHOLD = parseFloat(process.env.SIMILARITY_THRESHOLD ?? '0.1');

	/**
	 * Retrieves data associated with the specified key. If a cached result is available, it is returned.
	 * Otherwise, a new result is generated based on the context and embedding.
	 *
	 * @param {string} key - The key used to identify the data to retrieve.
	 * @return {Promise<any>} A promise that resolves to the retrieved or newly generated result.
	 */
	async get(key) {
		const context = this.getContext();
		const promptData = context?.requestContext?.prompt;
		const embedding = await provider.embed(promptData);

		let cachedResult = await this._findCachedResult(embedding);
		if (cachedResult) {
			if (cachedResult.relatedQuery) {
				const resolved = await SemanticCache.get(cachedResult.relatedQuery);
				if (resolved) return resolved;
			} else {
				return cachedResult;
			}
		}

		const resultText = await provider.chat(promptData);
		return {
			vector: embedding,
			result: resultText,
		};
	}

	/**
	 * Searches for a cached result based on the provided embedding by querying a semantic cache and returns the nearest match if found.
	 *
	 * @param {Object} embedding - The embedding vector used to search for a cached result within the similarity threshold.
	 * @return {Promise<Object|undefined>} Returns a cached result entry if a similar entry is found, otherwise returns null.
	 */
	async _findCachedResult(embedding) {
		const nearbyResults = await SemanticCache.search({
			conditions: {
				attribute: 'vector',
				comparator: 'lt',
				value: SearchSource.SIMILARITY_THRESHOLD,
				target: embedding,
			},
		});

		for await (const entry of nearbyResults) {
			return {relatedQuery: entry.query};
		}
		return;
	}
}

SemanticCache.sourcedFrom(SearchSource);
