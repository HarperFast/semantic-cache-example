# Vector Index Example

A demonstration project that implements semantic search and caching using Harper and Ollama. This project creates a vector-based semantic cache to store and retrieve similar queries, reducing redundant LLM calls.

## Overview

This project showcases how to:
- Generate embeddings for text prompts using Ollama
- Store these embeddings in a vector database
- Implement semantic similarity search to find related queries
- Cache LLM responses to improve performance

## Features

- **Semantic Caching**: Store results of similar queries to reduce redundant LLM calls
- **Vector Similarity Search**: Find semantically similar content using HNSW indexed vector embeddings
- **Configurable Thresholds**: Adjust similarity thresholds to control cache hit rates
- **MD5 Hashing**: Efficient storage and retrieval of cached responses

## Project Structure
- `.env`: Environment file which drives config for Ollama and the Similarity threshold.
- `config.yaml`: Configuration file for the project
- `src/resources.js`: Contains the main implementation of the search resource and semantic caching logic
- `src/schema.graphql`: Defines the GraphQL schema for the SemanticCache table


## Environment File

- `OLLAMA_HOST`: The host address of your Ollama server
- `OLLAMA_EMBEDDING_MODEL`: The embedding model to use (e.g., nomic-embed-text)
- `OLLAMA_SEARCH_MODEL`: The LLM model to use for generating responses (e.g., falcon:7b)
- `SIMILARITY_THRESHOLD`: The similarity threshold for finding related items in the semantic cache

## Usage

This project provides a REST API for semantic search with caching. The main functionality is exposed through the `search` resource:

1. Send a POST request to the search endpoint with your prompt:
   ```
   POST /search
   {
     "prompt": "Your question or query here"
   }
   ```

2. The system will:
    - Check if an identical query exists in the cache (using MD5 hash)
    - If not found, generate an embedding for the query
    - Search for semantically similar queries in the cache
    - If a similar query is found, return its cached result
    - Otherwise, generate a new result using the Ollama model and cache it for future use

## How It Works

1. **Vector Embeddings**: The system uses Ollama to generate vector embeddings for text queries.
2. **Semantic Cache**: These embeddings are stored in a HarperDB table with HNSW indexing for fast similarity search.
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
