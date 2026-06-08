# Semantic Cache Example

A demonstration project that implements semantic search and caching using Harper. It creates a vector-based semantic cache to store and retrieve similar queries, reducing redundant LLM calls.

NOTE: This project requires **either** a local Ollama server (running an embedding model and an LLM model) **or** a Google Gemini API key. The active backend is selected at runtime via the `MODEL_PROVIDER` env var.

## Overview

This project showcases how to:
- Generate embeddings for text prompts (via Ollama or Gemini)
- Store these embeddings in a vector database
- Implement semantic similarity search to find related queries
- Cache LLM responses to improve performance

## Getting Started

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and set `MODEL_PROVIDER` to either `ollama` (default) or `gemini`.
3. Fill in the matching block of credentials:
   - **Ollama**: make sure `OLLAMA_HOST` points at a running Ollama server and both `OLLAMA_EMBEDDING_MODEL` and `OLLAMA_SEARCH_MODEL` are pulled locally.
   - **Gemini**: set `GEMINI_API_KEY`. `GEMINI_EMBEDDING_MODEL` and `GEMINI_CHAT_MODEL` have working defaults (`gemini-embedding-001` / `gemini-2.5-flash`).
4. Install dependencies and start the project as you normally would with Harper.

> **Important:** `.env` is gitignored and must not be committed — it can contain API keys. `.env.example` is the source of truth for which keys exist; update it whenever you add a new variable.
>
> **Switching providers invalidates the cache.** Ollama and Gemini produce embeddings in different vector spaces (and often different dimensionalities), so an existing cache populated by one provider will return meaningless similarity scores under the other. Start with a fresh database when you change `MODEL_PROVIDER`.

## Features

- **Semantic Caching**: Store results of similar queries to reduce redundant LLM calls
- **Vector Similarity Search**: Find semantically similar content using HNSW indexed vector embeddings
- **Configurable Thresholds**: Adjust similarity thresholds to control cache hit rates
- **MD5 Hashing**: Efficient storage and retrieval of cached responses

## Project Structure
- `.env.example`: Committed template listing every supported environment variable.
- `.env`: Your local, gitignored copy of `.env.example` with real values filled in.
- `config.yaml`: Configuration file for the project
- `src/resources.js`: Contains the main implementation of the search resource and semantic caching logic
- `src/schema.graphql`: Defines the GraphQL schema for the SemanticCache table


## Environment Variables

Shared:
- `MODEL_PROVIDER`: `ollama` (default) or `gemini`. Controls both the embedding and chat backends.
- `SIMILARITY_THRESHOLD`: The similarity threshold for finding related items in the semantic cache (lower = stricter match).

Used when `MODEL_PROVIDER=ollama`:
- `OLLAMA_HOST`: The host address of your Ollama server (e.g., `http://127.0.0.1:11434`).
- `OLLAMA_EMBEDDING_MODEL`: The embedding model to use (e.g., `nomic-embed-text`).
- `OLLAMA_SEARCH_MODEL`: The LLM model to use for generating responses (e.g., `falcon:7b`).

Used when `MODEL_PROVIDER=gemini`:
- `GEMINI_API_KEY`: Your Google Gemini API key (required).
- `GEMINI_EMBEDDING_MODEL`: Embedding model (default `gemini-embedding-001`).
- `GEMINI_CHAT_MODEL`: Chat/generation model (default `gemini-2.5-flash`).

## Usage

This project provides a REST API for semantic search with caching. The main functionality is exposed through the `search` resource:

1. Send a POST request with a JSON body:
   ```
   POST /search
   {
     "prompt": "Your question or query here"
   }
   ```
   …or a GET request with the prompt as a query-string parameter:
   ```
   GET /search?prompt=Your+question+or+query+here
   ```
   Both verbs share the same cache (identical prompts hash to the same MD5 key). The GET handler also accepts the Harper MCP-server condition shape (`conditions: [{ attribute: "prompt", value: "..." }]`) so the resource can be invoked through MCP without changes. Requests with no prompt return a `4xx` error rather than an empty response.

2. The system will:
    - Check if an identical query exists in the cache (using MD5 hash)
    - If not found, generate an embedding for the query
    - Search for semantically similar queries in the cache
    - If a similar query is found, return its cached result
    - Otherwise, generate a new result using the configured chat model (Ollama or Gemini) and cache it for future use

## How It Works

1. **Vector Embeddings**: The system uses the configured provider (Ollama or Gemini) to generate vector embeddings for text queries.
2. **Semantic Cache**: These embeddings are stored in a Harper table with HNSW indexing for fast similarity search.
3. **Similarity Matching**: When a new query comes in, the system looks for semantically similar queries based on vector distance.
4. **Caching Strategy**: Results are cached with an expiration of one week to balance freshness and performance.

## Data Model

The project uses a single table for the semantic cache, defined in GraphQL schema:

### SemanticCache Table

The core of this project is the `SemanticCache` table structure, which efficiently stores query embeddings and their results:

**Table Attributes:**
- **query** (String, Primary Key): MD5 hash of the original prompt
- **vector** (Float Array, HNSW Indexed): Vector embedding representation of the prompt
- **result** (String): The cached response from the LLM
- **relatedQuery** (Relationship): Self-referential relationship to similar queries

**Properties:**
- Database: "cache"
- Expiration: 604800 seconds (1 week)
- Vector Indexing: HNSW (Hierarchical Navigable Small World)

This data model enables efficient semantic similarity search by:
1. Converting text prompts to vector embeddings
2. Storing these vectors with HNSW indexing for fast similarity lookups
3. Creating relationships between semantically similar queries
4. Automatically expiring cached results after one week
