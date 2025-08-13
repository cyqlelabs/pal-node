import { describe, it, expect } from 'vitest';
import * as index from '../index.js';

describe('Index Module', () => {
  describe('exports', () => {
    it('should export all core classes', () => {
      expect(index.PromptCompiler).toBeDefined();
      expect(index.PromptExecutor).toBeDefined();
      expect(index.MockLLMClient).toBeDefined();
      expect(index.OpenAIClient).toBeDefined();
      expect(index.AnthropicClient).toBeDefined();
      expect(index.Loader).toBeDefined();
      expect(index.Resolver).toBeDefined();
      expect(index.ResolverCache).toBeDefined();
    });

    it('should export exception classes', () => {
      expect(index.PALError).toBeDefined();
    });

    it('should export type definitions', () => {
      expect(index.PromptAssemblySchema).toBeDefined();
      expect(index.ComponentLibrarySchema).toBeDefined();
    });
  });

  describe('version', () => {
    it('should export version string', () => {
      expect(typeof index.version).toBe('string');
      expect(index.version).toBeTruthy();
    });
  });
});
