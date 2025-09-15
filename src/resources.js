import ollama from 'ollama';
import crypto from 'crypto';
const { SemanticCache } = databases.cache;
const OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text';
const OLLAMA_SEARCH_MODEL = 'falcon:7b';

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
	/**
	 * Sends data to the server and retrieves a cached result based on the data's MD5 hash.
	 *
	 * @param {string} data - The data to be posted and used for generating the cache key.
	 * @return {Promise<any>} Returns a promise that resolves with the result retrieved from the SemanticCache.
	 */
	async post(data) {
		let context = this.getContext();
		//set the posted data to the context for use later
		context.promptData = data.prompt;
		const md5Hash = stringToMd5(data.prompt);
		const cacheResult = await SemanticCache.get(md5Hash);
		return cacheResult.result;
	}
}

/**
 * The SearchSource class provides a way to retrieve or generate results based on user input.
 * It uses embedding models and semantic caching to efficiently find relevant results.
 * If a similar result exists in the cache, it returns the cached result. Otherwise,
 * it generates a new result using a specific chat model.
 */
class SearchSource extends Resource {
	static SIMILARITY_THRESHOLD = 0.1;

	/**
	 * Retrieves data associated with the specified key. If a cached result is available, it is returned.
	 * Otherwise, a new result is generated based on the context and embedding.
	 *
	 * @param {string} key - The key used to identify the data to retrieve.
	 * @return {Promise<any>} A promise that resolves to the retrieved or newly generated result.
	 */
	async get(key) {
		const context = this.getContext();
		let body = await context.data;
		const embedding = await this._generateEmbedding(context.promptData);

		let cachedResult = await this._findCachedResult(embedding);
		if (cachedResult) {
			if( cachedResult.relatedQuery) {
				cachedResult = await SemanticCache.get(cachedResult.relatedQuery)
			}
			return cachedResult;
		}

		return await this._generateNewResult(context.promptData, embedding);
	}

	/**
	 * Generates an embedding for the given prompt data using the specified embedding model.
	 *
	 * @param {string} promptData - The input data for which the embedding is to be generated.
	 * @return {Promise<Array<number>>} A promise that resolves to the generated embedding as an array of numbers.
	 */
	async _generateEmbedding(promptData) {
		const embedding = await ollama.embed({
			model: OLLAMA_EMBEDDING_MODEL,
			input: promptData,
		});
		return embedding.embedding;
	}

	/**
	 * Searches for a cached result based on the provided embedding by querying a semantic cache and returns the nearest match if found.
	 *
	 * @param {Object} embedding - The embedding vector used to search for a cached result within the similarity threshold.
	 * @return {Promise<Object|null>} Returns a cached result entry if a similar entry is found, otherwise returns null.
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
		return null;
	}

	/**
	 * Generates a new result based on the provided prompt data and embedding.
	 *
	 * @param {string} promptData - The input prompt data provided by the user.
	 * @param {Object} embedding - The embedding object containing vector data for generating a result.
	 * @return {Promise<Object>} A promise that resolves to an object containing the vector and the generated result message content.
	 */
	async _generateNewResult(promptData, embedding) {
		const chatResult = await ollama.chat({
			model: OLLAMA_SEARCH_MODEL,
			messages: [{ role: 'user', content: promptData }],
		});

		return {
			vector: embedding,
			result: chatResult.message.content,
		};
	}
}

SemanticCache.sourcedFrom(SearchSource);