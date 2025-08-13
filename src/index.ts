/**
 * PAL (Prompt Assembly Language) - A framework for managing LLM prompts
 * as versioned, composable software artifacts.
 */

// Core classes
export { PromptCompiler } from './core/compiler.js';
export {
  PromptExecutor,
  MockLLMClient,
  OpenAIClient,
  AnthropicClient,
} from './core/executor.js';
export type { LLMClient } from './core/executor.js';
export { Loader } from './core/loader.js';
export { Resolver, ResolverCache } from './core/resolver.js';

// Type definitions and schemas
export * from './types/schema.js';

// Exceptions
export * from './exceptions/core.js';

// Version info - dynamically loaded from package.json
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

function getVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const packagePath = resolve(__dirname, '..', 'package.json');
    const packageData = JSON.parse(readFileSync(packagePath, 'utf-8'));
    return packageData.version || '0.0.1';
  } catch {
    return '0.0.1'; // Fallback version
  }
}

export const version = getVersion();
