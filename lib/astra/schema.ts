/**
 * Schema inspector — pure, side-effect-free utilities for deriving
 * collection capabilities from raw Data API collection options.
 */

import type { CollectionDefinition, CollectionCapabilities } from './gateway';

/**
 * Derive a normalized capability summary from raw collection definition.
 * This function is pure — no I/O, no env access, no side effects.
 */
export function parseCapabilities(definition: CollectionDefinition): CollectionCapabilities {
  const vector = definition.vector;
  const vectorService = vector?.service;
  const rerank = definition.rerank;

  return {
    hasVector: !!vector,
    vectorDimension: vector?.dimension ?? null,
    vectorMetric: vector?.metric ?? null,
    vectorizeProvider: vectorService?.provider ?? null,
    vectorizeModel: vectorService?.modelName ?? null,
    hasLexical: !!definition.lexical?.enabled,
    hasRerank: !!rerank?.enabled,
  };
}

/**
 * Human-readable label for the vector index (e.g. "1024d cosine").
 * Returns null when the collection has no vector index.
 */
export function vectorLabel(caps: CollectionCapabilities): string | null {
  if (!caps.hasVector) return null;
  const dim = caps.vectorDimension ?? '?';
  const metric = caps.vectorMetric ?? 'unknown';
  return `${dim}d ${metric}`;
}

/**
 * Human-readable label for the vectorize integration (e.g. "NVIDIA/nv-embedqa-e5-v5").
 * Returns null when vectorize is not configured.
 */
export function vectorizeLabel(caps: CollectionCapabilities): string | null {
  if (!caps.vectorizeProvider || !caps.vectorizeModel) return null;
  return `${caps.vectorizeProvider}/${caps.vectorizeModel}`;
}