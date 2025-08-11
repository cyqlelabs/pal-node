import { describe, it, expect } from 'vitest';
import {
  ComponentLibrarySchema,
  PromptAssemblySchema,
  EvaluationSuiteSchema,
  ExecutionResultSchema,
} from '../types/schema.js';
import { ZodError } from 'zod';

describe('Schema Validation', () => {
  describe('ComponentLibrarySchema', () => {
    const validLibrary = {
      pal_version: '1.0',
      library_id: 'com.example.test',
      version: '1.0.0',
      description: 'Test library',
      type: 'trait',
      components: [
        {
          name: 'helper',
          description: 'Helper component',
          content: 'You are helpful.',
          metadata: {},
        },
      ],
      metadata: {},
    };

    it('should validate a correct component library', () => {
      const result = ComponentLibrarySchema.parse(validLibrary);
      expect(result).toEqual(validLibrary);
    });

    it('should reject invalid PAL version', () => {
      const invalid = { ...validLibrary, pal_version: '2.0' };
      expect(() => ComponentLibrarySchema.parse(invalid)).toThrow(ZodError);
    });

    it('should reject invalid library ID format', () => {
      const invalid = { ...validLibrary, library_id: 'invalid id!' };
      expect(() => ComponentLibrarySchema.parse(invalid)).toThrow(ZodError);
    });

    it('should reject invalid version format', () => {
      const invalid = { ...validLibrary, version: '1.0' };
      expect(() => ComponentLibrarySchema.parse(invalid)).toThrow(ZodError);
    });

    it('should reject invalid component type', () => {
      const invalid = { ...validLibrary, type: 'invalid_type' };
      expect(() => ComponentLibrarySchema.parse(invalid)).toThrow(ZodError);
    });

    it('should reject duplicate component names', () => {
      const invalid = {
        ...validLibrary,
        components: [
          {
            name: 'helper',
            description: 'Helper 1',
            content: 'Content 1',
            metadata: {},
          },
          {
            name: 'helper',
            description: 'Helper 2',
            content: 'Content 2',
            metadata: {},
          },
        ],
      };
      expect(() => ComponentLibrarySchema.parse(invalid)).toThrow(ZodError);
    });

    it('should reject invalid component name format', () => {
      const invalid = {
        ...validLibrary,
        components: [
          {
            name: '123invalid',
            description: 'Invalid name',
            content: 'Content',
            metadata: {},
          },
        ],
      };
      expect(() => ComponentLibrarySchema.parse(invalid)).toThrow(ZodError);
    });
  });

  describe('PromptAssemblySchema', () => {
    const validAssembly = {
      pal_version: '1.0',
      id: 'test-prompt',
      version: '1.0.0',
      description: 'Test prompt',
      author: 'Test Author',
      imports: {
        traits: './traits.pal.lib',
      },
      variables: [
        {
          name: 'name',
          type: 'string',
          description: 'Name to greet',
          required: true,
        },
      ],
      composition: ['Hello {{ name }}!'],
      metadata: {},
    };

    it('should validate a correct prompt assembly', () => {
      const result = PromptAssemblySchema.parse(validAssembly);
      expect(result).toEqual(validAssembly);
    });

    it('should work with minimal required fields', () => {
      const minimal = {
        pal_version: '1.0',
        id: 'test-prompt',
        version: '1.0.0',
        description: 'Test prompt',
        composition: ['Hello World!'],
      };
      const result = PromptAssemblySchema.parse(minimal);
      expect(result.imports).toEqual({});
      expect(result.variables).toEqual([]);
      expect(result.metadata).toEqual({});
    });

    it('should reject empty composition', () => {
      const invalid = { ...validAssembly, composition: [] };
      expect(() => PromptAssemblySchema.parse(invalid)).toThrow(ZodError);
    });

    it('should reject duplicate variable names', () => {
      const invalid = {
        ...validAssembly,
        variables: [
          {
            name: 'name',
            type: 'string',
            description: 'First name',
            required: true,
          },
          {
            name: 'name',
            type: 'string',
            description: 'Second name',
            required: true,
          },
        ],
      };
      expect(() => PromptAssemblySchema.parse(invalid)).toThrow(ZodError);
    });

    it('should reject invalid import alias format', () => {
      const invalid = {
        ...validAssembly,
        imports: {
          '123invalid': './test.pal.lib',
        },
      };
      expect(() => PromptAssemblySchema.parse(invalid)).toThrow(ZodError);
    });

    it('should reject invalid import path format', () => {
      const invalid = {
        ...validAssembly,
        imports: {
          test: './invalid.txt',
        },
      };
      expect(() => PromptAssemblySchema.parse(invalid)).toThrow(ZodError);
    });

    it('should accept URLs in imports', () => {
      const withUrl = {
        ...validAssembly,
        imports: {
          remote: 'https://example.com/library.pal.lib',
        },
      };
      const result = PromptAssemblySchema.parse(withUrl);
      expect(result.imports.remote).toBe('https://example.com/library.pal.lib');
    });
  });

  describe('EvaluationSuiteSchema', () => {
    const validSuite = {
      pal_version: '1.0',
      prompt_id: 'test-prompt',
      target_version: '1.0.0',
      description: 'Test evaluation',
      test_cases: [
        {
          name: 'basic_test',
          description: 'Basic test case',
          variables: { name: 'World' },
          assertions: [
            {
              type: 'contains',
              name: 'should_contain_hello',
              config: { text: 'Hello' },
            },
          ],
          metadata: {},
        },
      ],
      metadata: {},
    };

    it('should validate a correct evaluation suite', () => {
      const result = EvaluationSuiteSchema.parse(validSuite);
      expect(result).toEqual(validSuite);
    });

    it('should work with minimal assertion', () => {
      const minimal = {
        ...validSuite,
        test_cases: [
          {
            name: 'test',
            variables: {},
            assertions: [{ type: 'json_valid' }],
          },
        ],
      };
      const result = EvaluationSuiteSchema.parse(minimal);
      expect(result.test_cases[0]?.assertions[0]?.config).toEqual({});
    });

    it('should reject duplicate test case names', () => {
      const invalid = {
        ...validSuite,
        test_cases: [
          {
            name: 'test',
            variables: {},
            assertions: [{ type: 'contains', config: { text: 'Hello' } }],
          },
          {
            name: 'test',
            variables: {},
            assertions: [{ type: 'contains', config: { text: 'World' } }],
          },
        ],
      };
      expect(() => EvaluationSuiteSchema.parse(invalid)).toThrow(ZodError);
    });
  });

  describe('ExecutionResultSchema', () => {
    const validResult = {
      promptId: 'test-prompt',
      promptVersion: '1.0.0',
      model: 'gpt-3.5-turbo',
      compiledPrompt: 'Hello World!',
      response: 'Hello! How can I help you?',
      metadata: { executionId: 'exec_123' },
      executionTimeMs: 1234.5,
      inputTokens: 10,
      outputTokens: 15,
      costUsd: 0.001,
      timestamp: '2024-01-01T00:00:00.000Z',
      success: true,
    };

    it('should validate a correct execution result', () => {
      const result = ExecutionResultSchema.parse(validResult);
      expect(result).toEqual(validResult);
    });

    it('should work with minimal required fields', () => {
      const minimal = {
        promptId: 'test-prompt',
        promptVersion: '1.0.0',
        model: 'gpt-3.5-turbo',
        compiledPrompt: 'Hello World!',
        response: 'Response',
        metadata: {},
        executionTimeMs: 100,
        timestamp: '2024-01-01T00:00:00.000Z',
      };
      const result = ExecutionResultSchema.parse(minimal);
      expect(result.success).toBe(true); // Default value
    });

    it('should handle error cases', () => {
      const errorResult = {
        ...validResult,
        success: false,
        error: 'API Error occurred',
        response: '',
      };
      const result = ExecutionResultSchema.parse(errorResult);
      expect(result.success).toBe(false);
      expect(result.error).toBe('API Error occurred');
    });
  });

  describe('Variable Types', () => {
    const validVariable = {
      name: 'test_var',
      type: 'string',
      description: 'Test variable',
      required: true,
    };

    it('should accept all valid variable types', () => {
      const types = ['string', 'integer', 'float', 'boolean', 'list', 'dict', 'any'];
      
      for (const type of types) {
        const variable = { ...validVariable, type };
        // This should not throw
        const assembly = {
          pal_version: '1.0',
          id: 'test',
          version: '1.0.0',
          description: 'Test',
          variables: [variable],
          composition: ['Test'],
        };
        expect(() => PromptAssemblySchema.parse(assembly)).not.toThrow();
      }
    });

    it('should reject invalid variable types', () => {
      const variable = { ...validVariable, type: 'invalid_type' };
      const assembly = {
        pal_version: '1.0',
        id: 'test',
        version: '1.0.0',
        description: 'Test',
        variables: [variable],
        composition: ['Test'],
      };
      expect(() => PromptAssemblySchema.parse(assembly)).toThrow(ZodError);
    });

    it('should handle default values', () => {
      const variable = {
        name: 'test_var',
        type: 'string',
        description: 'Test variable',
        required: false,
        default: 'default_value',
      };
      const assembly = {
        pal_version: '1.0',
        id: 'test',
        version: '1.0.0',
        description: 'Test',
        variables: [variable],
        composition: ['Test'],
      };
      const result = PromptAssemblySchema.parse(assembly);
      expect(result.variables[0]?.default).toBe('default_value');
    });
  });
});