import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile } from 'fs/promises';
import { PromptCompiler } from '../core/compiler.js';
import {
  PromptExecutor,
  MockLLMClient,
  OpenAIClient,
  AnthropicClient,
} from '../core/executor.js';
import { Loader } from '../core/loader.js';
import { Resolver, ResolverCache } from '../core/resolver.js';
import { PALValidationError, PALLoadError } from '../exceptions/core.js';

vi.mock('fs/promises');
vi.mock('openai');
vi.mock('@anthropic-ai/sdk');

describe('Error Path Coverage Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Compiler Type Conversion Errors', () => {
    let compiler: PromptCompiler;

    beforeEach(() => {
      compiler = new PromptCompiler();
    });

    // These error paths are tested through the public API since convertVariable is private
    it('should test type conversion errors through compile method - boolean to integer', async () => {
      const assembly = {
        pal_version: '1.0',
        id: 'test',
        version: '1.0.0',
        description: 'Test',
        variables: [
          {
            name: 'num',
            type: 'integer',
            description: 'Number',
            required: true,
          },
        ],
        imports: {},
        composition: ['{{ num }}'],
        metadata: {},
      };

      await expect(
        compiler.compile(assembly, { num: true }, 'test.pal')
      ).rejects.toThrow('expected integer, got boolean');
    });

    it('should test type conversion errors through compile method - object to integer', async () => {
      const assembly = {
        pal_version: '1.0',
        id: 'test',
        version: '1.0.0',
        description: 'Test',
        variables: [
          {
            name: 'num',
            type: 'integer',
            description: 'Number',
            required: true,
          },
        ],
        imports: {},
        composition: ['{{ num }}'],
        metadata: {},
      };

      await expect(
        compiler.compile(assembly, { num: {} }, 'test.pal')
      ).rejects.toThrow('expected integer, got object');
    });

    it('should test type conversion errors through compile method - boolean to float', async () => {
      const assembly = {
        pal_version: '1.0',
        id: 'test',
        version: '1.0.0',
        description: 'Test',
        variables: [
          { name: 'num', type: 'float', description: 'Float', required: true },
        ],
        imports: {},
        composition: ['{{ num }}'],
        metadata: {},
      };

      await expect(
        compiler.compile(assembly, { num: true }, 'test.pal')
      ).rejects.toThrow('expected float, got boolean');
    });

    it('should test type conversion errors through compile method - invalid string to boolean', async () => {
      const assembly = {
        pal_version: '1.0',
        id: 'test',
        version: '1.0.0',
        description: 'Test',
        variables: [
          {
            name: 'flag',
            type: 'boolean',
            description: 'Boolean',
            required: true,
          },
        ],
        imports: {},
        composition: ['{{ flag }}'],
        metadata: {},
      };

      await expect(
        compiler.compile(assembly, { flag: 'invalid' }, 'test.pal')
      ).rejects.toThrow('expected boolean, got string');
    });

    it('should test type conversion errors through compile method - string to list', async () => {
      const assembly = {
        pal_version: '1.0',
        id: 'test',
        version: '1.0.0',
        description: 'Test',
        variables: [
          { name: 'items', type: 'list', description: 'List', required: true },
        ],
        imports: {},
        composition: ['{{ items }}'],
        metadata: {},
      };

      await expect(
        compiler.compile(assembly, { items: 'not an array' }, 'test.pal')
      ).rejects.toThrow('expected list, got string');
    });

    it('should test type conversion errors through compile method - string to dict', async () => {
      const assembly = {
        pal_version: '1.0',
        id: 'test',
        version: '1.0.0',
        description: 'Test',
        variables: [
          {
            name: 'obj',
            type: 'dict',
            description: 'Dictionary',
            required: true,
          },
        ],
        imports: {},
        composition: ['{{ obj }}'],
        metadata: {},
      };

      await expect(
        compiler.compile(assembly, { obj: 'not an object' }, 'test.pal')
      ).rejects.toThrow('expected dict, got string');
    });
  });

  describe('Executor Client Initialization', () => {
    it('should create OpenAI client successfully', () => {
      expect(() => new OpenAIClient('test-key')).not.toThrow();
      expect(() => new OpenAIClient()).not.toThrow(); // API key is optional in constructor
    });

    it('should create Anthropic client successfully', () => {
      expect(() => new AnthropicClient('test-key')).not.toThrow();
      expect(() => new AnthropicClient()).not.toThrow(); // API key is optional in constructor
    });
  });

  describe('Loader File System Error Paths', () => {
    let loader: Loader;

    beforeEach(() => {
      loader = new Loader();
    });

    it('should throw PALLoadError for file not found (ENOENT)', async () => {
      const error = new Error('ENOENT: no such file or directory');
      (error as any).code = 'ENOENT';
      vi.mocked(readFile).mockRejectedValue(error);

      await expect(
        loader.loadPromptAssembly('nonexistent.pal')
      ).rejects.toThrow(PALLoadError);
    });

    it('should throw PALLoadError for permission denied (EACCES)', async () => {
      const error = new Error('EACCES: permission denied');
      (error as any).code = 'EACCES';
      vi.mocked(readFile).mockRejectedValue(error);

      await expect(loader.loadPromptAssembly('denied.pal')).rejects.toThrow(
        PALLoadError
      );
    });

    it('should throw PALLoadError for other file system errors', async () => {
      const error = new Error('EIO: input/output error');
      (error as any).code = 'EIO';
      vi.mocked(readFile).mockRejectedValue(error);

      await expect(loader.loadPromptAssembly('error.pal')).rejects.toThrow(
        PALLoadError
      );
    });

    it('should throw PALValidationError for invalid JSON', async () => {
      vi.mocked(readFile).mockResolvedValue('{ invalid json');

      await expect(loader.loadPromptAssembly('invalid.pal')).rejects.toThrow(
        PALValidationError
      );
    });

    it('should throw PALValidationError for invalid YAML', async () => {
      vi.mocked(readFile).mockResolvedValue('invalid: yaml: [unclosed');

      await expect(
        loader.loadComponentLibrary('invalid.lib.yml')
      ).rejects.toThrow(PALValidationError);
    });

    it('should throw PALValidationError for schema validation failure - prompt assembly', async () => {
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({
          id: 'test',
          // Missing required fields like version, description, etc.
        })
      );

      await expect(loader.loadPromptAssembly('invalid.pal')).rejects.toThrow(
        PALValidationError
      );
    });

    it('should throw PALValidationError for schema validation failure - component library', async () => {
      vi.mocked(readFile).mockResolvedValue(`
library_id: test-lib
# Missing required fields like version, type, etc.
`);

      await expect(
        loader.loadComponentLibrary('invalid.lib.yml')
      ).rejects.toThrow(PALValidationError);
    });
  });

  describe('Loader URL Error Paths', () => {
    let loader: Loader;

    beforeEach(() => {
      loader = new Loader();
    });

    it('should throw PALLoadError for URL timeout through loadPromptAssembly', async () => {
      // Mock fetch to simulate timeout
      global.fetch = vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout')), 50);
          })
      );

      await expect(
        loader.loadPromptAssembly('https://example.com/test.pal')
      ).rejects.toThrow(PALLoadError);
    });

    it('should throw PALLoadError for URL network error through loadPromptAssembly', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await expect(
        loader.loadPromptAssembly('https://example.com/test.pal')
      ).rejects.toThrow(PALLoadError);
    });
  });

  describe('Resolver Error Paths', () => {
    let resolver: Resolver;
    let loader: Loader;

    beforeEach(() => {
      loader = new Loader();
      resolver = new Resolver(loader, new ResolverCache());
    });

    it('should successfully resolve dependencies', async () => {
      const mockLibrary = {
        library_id: 'test-lib',
        version: '1.0.0',
        type: 'components' as const,
        description: 'Test library',
        components: [],
      };

      vi.spyOn(loader, 'loadComponentLibrary').mockResolvedValue(mockLibrary);

      const promptAssembly = {
        pal_version: '1.0',
        id: 'test',
        version: '1.0.0',
        description: 'Test',
        variables: [],
        imports: { lib: 'test.pal.lib' },
        composition: [],
        metadata: {},
      };

      const result = await resolver.resolveDependencies(promptAssembly);
      expect(result['lib']).toBe(mockLibrary);
    });

    it('should handle dependency loading failures', async () => {
      vi.spyOn(loader, 'loadComponentLibrary').mockRejectedValue(
        new Error('Load failed')
      );

      const promptAssembly = {
        pal_version: '1.0',
        id: 'test',
        version: '1.0.0',
        description: 'Test',
        variables: [],
        imports: { lib: 'failing.pal.lib' },
        composition: [],
        metadata: {},
      };

      await expect(
        resolver.resolveDependencies(promptAssembly)
      ).rejects.toThrow();
    });
  });

  describe('Simple Success Paths for Coverage', () => {
    it('should handle successful variable conversions through compile method', async () => {
      const compiler = new PromptCompiler();

      const assembly = {
        pal_version: '1.0',
        id: 'test',
        version: '1.0.0',
        description: 'Test successful conversions',
        variables: [
          { name: 'name', type: 'string', description: 'Name', required: true },
        ],
        imports: {},
        composition: ['Hello {{ name }}!'],
        metadata: {},
      };

      const result = await compiler.compile(
        assembly,
        { name: 'World' },
        'test.pal'
      );
      expect(result).toContain('Hello World!');
    });

    it('should handle edge case boolean conversions through compile method', async () => {
      const compiler = new PromptCompiler();

      const assembly = {
        pal_version: '1.0',
        id: 'test',
        version: '1.0.0',
        description: 'Test boolean edge cases',
        variables: [
          {
            name: 'bool1',
            type: 'boolean',
            description: 'Bool1',
            required: true,
          },
          {
            name: 'bool2',
            type: 'boolean',
            description: 'Bool2',
            required: true,
          },
          {
            name: 'bool3',
            type: 'boolean',
            description: 'Bool3',
            required: true,
          },
          {
            name: 'bool4',
            type: 'boolean',
            description: 'Bool4',
            required: true,
          },
          {
            name: 'bool5',
            type: 'boolean',
            description: 'Bool5',
            required: true,
          },
          {
            name: 'bool6',
            type: 'boolean',
            description: 'Bool6',
            required: true,
          },
        ],
        imports: {},
        composition: [
          '{{ bool1 }}-{{ bool2 }}-{{ bool3 }}-{{ bool4 }}-{{ bool5 }}-{{ bool6 }}',
        ],
        metadata: {},
      };

      const result = await compiler.compile(
        assembly,
        {
          bool1: 'yes',
          bool2: 'no',
          bool3: '1',
          bool4: '0',
          bool5: 1,
          bool6: 0,
        },
        'test.pal'
      );

      expect(result).toContain('true-false-true-false-true-false');
    });

    it('should handle MockLLMClient successfully', async () => {
      const client = new MockLLMClient('Test response');
      const executor = new PromptExecutor(client);

      const promptAssembly = {
        id: 'test',
        version: '1.0.0',
        description: 'Test',
        variables: [],
        imports: {},
        composition: [],
      };

      const result = await executor.execute(
        'test prompt',
        promptAssembly,
        'mock'
      );
      expect(result.response).toBe('Test response');
      expect(result.inputTokens).toBeGreaterThan(0);
      expect(result.outputTokens).toBeGreaterThan(0);
    });

    it('should analyze template variables correctly', () => {
      const compiler = new PromptCompiler();

      const promptAssembly = {
        pal_version: '1.0',
        id: 'test',
        version: '1.0.0',
        description: 'Test',
        variables: [],
        imports: {},
        composition: ['Hello {{ name }}, you have {{ count }} messages.'],
        metadata: {},
      };

      const variables = compiler.analyzeTemplateVariables(promptAssembly);
      expect(variables).toContain('name');
      expect(variables).toContain('count');
    });
  });
});
