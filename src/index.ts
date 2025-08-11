/**
 * PAL (Prompt Assembly Language) - A framework for managing LLM prompts 
 * as versioned, composable software artifacts.
 */

// Core classes
export { PromptCompiler } from './core/compiler.js';
export { PromptExecutor, MockLLMClient, OpenAIClient, AnthropicClient } from './core/executor.js';
export type { LLMClient } from './core/executor.js';
export { Loader } from './core/loader.js';
export { Resolver, ResolverCache } from './core/resolver.js';

// Type definitions and schemas
export * from './types/schema.js';

// Exceptions
export * from './exceptions/core.js';

// Version info
export const version = '0.0.1';