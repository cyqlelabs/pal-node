import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PromptCompiler } from '../core/compiler.js';
import { Loader } from '../core/loader.js';
import {
  PALCompilerError,
  PALMissingComponentError,
  PALMissingVariableError,
} from '../exceptions/core.js';
import type {
  PromptAssembly,
  ComponentLibrary,
  VariableTypeValue,
} from '../types/schema.js';

// Mock loader
vi.mock('../core/loader.js');
const MockedLoader = vi.mocked(Loader, true);

describe('PromptCompiler', () => {
  let compiler: PromptCompiler;
  let mockLoader: vi.Mocked<Loader>;

  beforeEach(() => {
    mockLoader = new MockedLoader();
    compiler = new PromptCompiler(mockLoader);
    vi.clearAllMocks();
  });

  describe('compile', () => {
    const basicPromptAssembly: PromptAssembly = {
      pal_version: '1.0',
      id: 'test-prompt',
      version: '1.0.0',
      description: 'Test prompt',
      imports: {},
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

    it('should compile a basic prompt with variables', async () => {
      const result = await compiler.compile(basicPromptAssembly, {
        name: 'World',
      });

      expect(result).toBe('Hello World!');
    });

    it('should handle missing required variables', async () => {
      await expect(compiler.compile(basicPromptAssembly, {})).rejects.toThrow(
        PALMissingVariableError
      );
    });

    it('should use default values for optional variables', async () => {
      const promptWithDefault: PromptAssembly = {
        ...basicPromptAssembly,
        variables: [
          {
            name: 'greeting',
            type: 'string',
            description: 'Greeting message',
            required: false,
            default: 'Hello',
          },
          {
            name: 'name',
            type: 'string',
            description: 'Name to greet',
            required: true,
          },
        ],
        composition: ['{{ greeting }} {{ name }}!'],
      };

      const result = await compiler.compile(promptWithDefault, {
        name: 'World',
      });

      expect(result).toBe('Hello World!');
    });

    it('should handle component imports and references', async () => {
      const promptWithImports: PromptAssembly = {
        ...basicPromptAssembly,
        imports: {
          traits: './traits.pal.lib',
        },
        composition: ['{{ traits.helpful }}', '', 'Hello {{ name }}!'],
      };

      const traitsLibrary: ComponentLibrary = {
        pal_version: '1.0',
        library_id: 'com.example.traits',
        version: '1.0.0',
        description: 'Traits library',
        type: 'trait',
        components: [
          {
            name: 'helpful',
            description: 'Helpful trait',
            content: 'You are a helpful assistant.',
            metadata: {},
          },
        ],
        metadata: {},
      };

      // Mock the resolver's resolveDependencies method
      vi.spyOn(compiler['resolver'], 'resolveDependencies').mockResolvedValue({
        traits: traitsLibrary,
      });

      vi.spyOn(compiler['resolver'], 'validateReferences').mockReturnValue([]);

      const result = await compiler.compile(promptWithImports, {
        name: 'World',
      });

      expect(result).toBe('You are a helpful assistant.\n\nHello World!');
    });

    it('should throw error for missing component references', async () => {
      const promptWithBadRef: PromptAssembly = {
        ...basicPromptAssembly,
        imports: {
          traits: './traits.pal.lib',
        },
        composition: ['{{ traits.nonexistent }}'],
      };

      vi.spyOn(compiler['resolver'], 'resolveDependencies').mockResolvedValue(
        {}
      );

      vi.spyOn(compiler['resolver'], 'validateReferences').mockReturnValue([
        'Component nonexistent not found',
      ]);

      await expect(compiler.compile(promptWithBadRef)).rejects.toThrow(
        PALMissingComponentError
      );
    });

    it('should handle type conversion for variables', async () => {
      const promptWithTypes: PromptAssembly = {
        ...basicPromptAssembly,
        variables: [
          {
            name: 'count',
            type: 'integer',
            description: 'Count value',
            required: true,
          },
          {
            name: 'active',
            type: 'boolean',
            description: 'Active flag',
            required: true,
          },
          {
            name: 'items',
            type: 'list',
            description: 'List of items',
            required: true,
          },
        ],
        composition: [
          'Count: {{ count }}',
          'Active: {{ active }}',
          'Items: {{ items | length }}',
        ],
      };

      const result = await compiler.compile(promptWithTypes, {
        count: '42',
        active: 'true',
        items: ['a', 'b', 'c'],
      });

      expect(result).toContain('Count: 42');
      expect(result).toContain('Active: true');
      expect(result).toContain('Items: 3');
    });

    it('should throw error for invalid type conversion', async () => {
      const promptWithTypes: PromptAssembly = {
        ...basicPromptAssembly,
        variables: [
          {
            name: 'count',
            type: 'integer',
            description: 'Count value',
            required: true,
          },
        ],
        composition: ['Count: {{ count }}'],
      };

      await expect(
        compiler.compile(promptWithTypes, { count: 'not-a-number' })
      ).rejects.toThrow(PALCompilerError);
    });

    it('should handle multi-line compositions', async () => {
      const multiLinePrompt: PromptAssembly = {
        ...basicPromptAssembly,
        composition: [
          'You are {{ role }}.',
          '',
          '{% for item in items %}',
          '- {{ item }}',
          '{% endfor %}',
          '',
          'Please help with {{ task }}.',
        ],
        variables: [
          {
            name: 'role',
            type: 'string',
            description: 'Assistant role',
            required: true,
          },
          {
            name: 'items',
            type: 'list',
            description: 'List of items',
            required: true,
          },
          {
            name: 'task',
            type: 'string',
            description: 'Task description',
            required: true,
          },
        ],
      };

      const result = await compiler.compile(multiLinePrompt, {
        role: 'an assistant',
        items: ['item1', 'item2'],
        task: 'testing',
      });

      expect(result).toContain('You are an assistant.');
      expect(result).toContain('- item1');
      expect(result).toContain('- item2');
      expect(result).toContain('Please help with testing.');
    });

    it('should clean up excessive blank lines', async () => {
      const promptWithBlanks: PromptAssembly = {
        ...basicPromptAssembly,
        composition: ['Line 1', '', '', '', 'Line 2'],
      };

      const result = await compiler.compile(promptWithBlanks, {
        name: 'World',
      });

      // Should reduce multiple blank lines to at most 2
      expect(result).not.toContain('\n\n\n\n');
      expect(result).toMatch(/Line 1\n\nLine 2/);
    });
  });

  describe('compileFromFile', () => {
    it('should compile a prompt assembly from file', async () => {
      const mockPromptAssembly: PromptAssembly = {
        pal_version: '1.0',
        id: 'test-prompt',
        version: '1.0.0',
        description: 'Test prompt',
        imports: {},
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

      mockLoader.loadPromptAssembly.mockResolvedValue(mockPromptAssembly);

      const result = await compiler.compileFromFile('/test/prompt.pal', {
        name: 'World',
      });

      expect(result).toBe('Hello World!');
      expect(mockLoader.loadPromptAssembly).toHaveBeenCalledWith(
        '/test/prompt.pal'
      );
    });
  });

  describe('template error handling', () => {
    it('should handle template errors in composition', async () => {
      const promptWithError: PromptAssembly = {
        pal_version: '1.0',
        id: 'test-prompt',
        version: '1.0.0',
        description: 'Test prompt',
        imports: {},
        variables: [],
        composition: ['{% for %}'], // Invalid template syntax
        metadata: {},
      };

      await expect(compiler.compile(promptWithError)).rejects.toThrow(
        PALCompilerError
      );
    });

    it('should truncate long compositions in error messages', async () => {
      const longComposition = 'a'.repeat(600);
      const promptWithError: PromptAssembly = {
        pal_version: '1.0',
        id: 'test-prompt',
        version: '1.0.0',
        description: 'Test prompt',
        imports: {},
        variables: [],
        composition: [`{% for ${longComposition} %}`], // Invalid template syntax with long content
        metadata: {},
      };

      try {
        await compiler.compile(promptWithError);
      } catch (error) {
        expect(error).toBeInstanceOf(PALCompilerError);
        if (error instanceof PALCompilerError) {
          expect(error.context?.composition).toContain('...');
        }
      }
    });

    it('should re-throw non-Error objects', async () => {
      const promptAssembly: PromptAssembly = {
        pal_version: '1.0',
        id: 'test-prompt',
        version: '1.0.0',
        description: 'Test prompt',
        imports: {},
        variables: [],
        composition: ['Hello'],
        metadata: {},
      };

      // Mock nunjucks to throw a non-Error object
      const mockEnv = {
        renderString: vi.fn().mockImplementation(() => {
          throw 'string error'; // Non-Error object
        }),
        addGlobal: vi.fn(),
      };

      vi.spyOn(
        compiler as PromptCompiler & {
          createNunjucksEnvironment: () => unknown;
        },
        'createNunjucksEnvironment'
      ).mockReturnValue(mockEnv);

      await expect(compiler.compile(promptAssembly)).rejects.toBe(
        'string error'
      );
    });
  });

  describe('component template integration', () => {
    it('should handle template compilation with imported components', async () => {
      const promptWithImports: PromptAssembly = {
        pal_version: '1.0',
        id: 'test-prompt',
        version: '1.0.0',
        description: 'Test prompt',
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
        composition: ['{{ traits.helpful }}', '', 'Hello {{ name }}!'],
        metadata: {},
      };

      const traitsLibrary: ComponentLibrary = {
        pal_version: '1.0',
        library_id: 'com.example.traits',
        version: '1.0.0',
        description: 'Traits library',
        type: 'trait',
        components: [
          {
            name: 'helpful',
            description: 'Helpful trait',
            content: 'You are a helpful assistant.',
            metadata: {},
          },
        ],
        metadata: {},
      };

      vi.spyOn(compiler['resolver'], 'resolveDependencies').mockResolvedValue({
        traits: traitsLibrary,
      });
      vi.spyOn(compiler['resolver'], 'validateReferences').mockReturnValue([]);

      const result = await compiler.compile(promptWithImports, {
        name: 'World',
      });

      expect(result).toBe('You are a helpful assistant.\n\nHello World!');
    });
  });

  describe('analyzeTemplateVariables', () => {
    it('should identify template variables in composition', () => {
      const promptAssembly: PromptAssembly = {
        pal_version: '1.0',
        id: 'test',
        version: '1.0.0',
        description: 'Test',
        imports: {
          traits: './traits.pal.lib',
        },
        variables: [
          {
            name: 'name',
            type: 'string',
            description: 'Name',
            required: true,
          },
        ],
        composition: [
          '{{ traits.helpful }}',
          'Hello {{ name }}!',
          'How are you {{ mood }}?', // This should be detected as undefined
        ],
        metadata: {},
      };

      const variables = compiler.analyzeTemplateVariables(promptAssembly);

      expect(variables).toContain('mood');
      expect(variables).not.toContain('name'); // Defined variable
      expect(variables).not.toContain('traits.helpful'); // Component reference
    });

    it('should handle dotted references with unknown aliases', () => {
      const promptAssembly: PromptAssembly = {
        pal_version: '1.0',
        id: 'test',
        version: '1.0.0',
        description: 'Test',
        imports: {},
        variables: [],
        composition: [
          '{{ unknown.component }}', // Unknown alias should be detected
          '{{ traits.helpful }}', // Also unknown alias
        ],
        metadata: {},
      };

      const variables = compiler.analyzeTemplateVariables(promptAssembly);

      expect(variables).toContain('unknown.component');
      expect(variables).toContain('traits.helpful');
    });

    it('should handle empty variable matches', () => {
      const promptAssembly: PromptAssembly = {
        pal_version: '1.0',
        id: 'test',
        version: '1.0.0',
        description: 'Test',
        imports: {},
        variables: [],
        composition: [
          '{{  }}', // Empty variable reference
          '{{ }}', // Empty variable reference
          'Hello world', // No variables
        ],
        metadata: {},
      };

      const variables = compiler.analyzeTemplateVariables(promptAssembly);

      expect(variables.size).toBe(0);
    });

    it('should skip import aliases in template analysis', () => {
      const promptAssembly: PromptAssembly = {
        pal_version: '1.0',
        id: 'test',
        version: '1.0.0',
        description: 'Test',
        imports: {
          traits: './traits.pal.lib',
          utils: './utils.pal.lib',
        },
        variables: [
          {
            name: 'defined_var',
            type: 'string',
            description: 'Defined variable',
            required: true,
          },
        ],
        composition: [
          '{{ traits }}', // This should be skipped (import alias)
          '{{ utils }}', // This should be skipped (import alias)
          '{{ defined_var }}', // This should be skipped (defined variable)
          '{{ undefined_var }}', // This should be included
        ],
        metadata: {},
      };

      const variables = compiler.analyzeTemplateVariables(promptAssembly);

      expect(variables.size).toBe(1);
      expect(variables).toContain('undefined_var');
      expect(variables).not.toContain('traits');
      expect(variables).not.toContain('utils');
      expect(variables).not.toContain('defined_var');
    });
  });

  describe('component loading edge cases', () => {
    it('should handle template errors with component references', async () => {
      const promptWithBadComponent: PromptAssembly = {
        pal_version: '1.0',
        id: 'test-bad-component',
        version: '1.0.0',
        description: 'Test bad component',
        imports: {},
        variables: [],
        composition: [
          '{% include "invalid_reference" %}', // Invalid reference format
        ],
        metadata: {},
      };

      vi.spyOn(compiler['resolver'], 'resolveDependencies').mockResolvedValue(
        {}
      );
      vi.spyOn(compiler['resolver'], 'validateReferences').mockReturnValue([]);

      await expect(compiler.compile(promptWithBadComponent)).rejects.toThrow(
        PALCompilerError
      );
    });

    it('should handle template errors with missing aliases', async () => {
      const promptWithMissingAlias: PromptAssembly = {
        pal_version: '1.0',
        id: 'test-missing-alias',
        version: '1.0.0',
        description: 'Test missing alias',
        imports: {},
        variables: [],
        composition: [
          '{% include "unknown.component" %}', // Unknown alias
        ],
        metadata: {},
      };

      vi.spyOn(compiler['resolver'], 'resolveDependencies').mockResolvedValue(
        {}
      );
      vi.spyOn(compiler['resolver'], 'validateReferences').mockReturnValue([]);

      await expect(compiler.compile(promptWithMissingAlias)).rejects.toThrow(
        PALCompilerError
      );
    });
  });

  describe('template filters', () => {
    it('should apply custom filters correctly', async () => {
      const promptAssembly: PromptAssembly = {
        pal_version: '1.0',
        id: 'test-filters',
        version: '1.0.0',
        description: 'Test filters',
        imports: {},
        variables: [
          {
            name: 'text',
            type: 'string',
            description: 'Text to transform',
            required: true,
          },
        ],
        composition: [
          'Upper: {{ text | upper }}',
          'Lower: {{ text | lower }}',
          'Title: {{ text | title }}',
        ],
        metadata: {},
      };

      const result = await compiler.compile(promptAssembly, {
        text: 'hello WORLD',
      });

      expect(result).toContain('Upper: HELLO WORLD');
      expect(result).toContain('Lower: hello world');
      expect(result).toContain('Title: Hello World');
    });
  });

  describe('unknown variable types', () => {
    it('should throw error for unknown variable type', () => {
      expect(() =>
        compiler['convertVariable'](
          'value',
          'unknown_type' as VariableTypeValue
        )
      ).toThrow('Unknown variable type: unknown_type');
    });
  });

  describe('boolean conversion edge cases', () => {
    it('should handle additional boolean string values', () => {
      expect(compiler['convertVariable']('yes', 'boolean')).toBe(true);
      expect(compiler['convertVariable']('no', 'boolean')).toBe(false);
      expect(compiler['convertVariable']('on', 'boolean')).toBe(true);
      expect(compiler['convertVariable']('off', 'boolean')).toBe(false);
      expect(compiler['convertVariable']('YES', 'boolean')).toBe(true);
      expect(compiler['convertVariable']('NO', 'boolean')).toBe(false);
    });
  });

  describe('variable type conversion', () => {
    it('should convert string values', () => {
      expect(compiler['convertVariable'](123, 'string')).toBe('123');
      expect(compiler['convertVariable'](true, 'string')).toBe('true');
    });

    it('should convert integer values', () => {
      expect(compiler['convertVariable']('42', 'integer')).toBe(42);
      expect(compiler['convertVariable'](42.0, 'integer')).toBe(42);

      expect(() => compiler['convertVariable'](true, 'integer')).toThrow(
        'Boolean cannot be converted to integer'
      );
      expect(() =>
        compiler['convertVariable']('not-a-number', 'integer')
      ).toThrow();
    });

    it('should convert float values', () => {
      expect(compiler['convertVariable']('3.14', 'float')).toBe(3.14);
      expect(compiler['convertVariable'](42, 'float')).toBe(42.0);

      expect(() => compiler['convertVariable'](true, 'float')).toThrow(
        'Boolean cannot be converted to float'
      );
    });

    it('should convert boolean values', () => {
      expect(compiler['convertVariable']('true', 'boolean')).toBe(true);
      expect(compiler['convertVariable']('false', 'boolean')).toBe(false);
      expect(compiler['convertVariable']('1', 'boolean')).toBe(true);
      expect(compiler['convertVariable']('0', 'boolean')).toBe(false);
      expect(compiler['convertVariable'](1, 'boolean')).toBe(true);
      expect(compiler['convertVariable'](0, 'boolean')).toBe(false);

      expect(() => compiler['convertVariable']('invalid', 'boolean')).toThrow(
        "Cannot convert string 'invalid' to boolean"
      );
    });

    it('should convert list values', () => {
      expect(compiler['convertVariable']([1, 2, 3], 'list')).toEqual([1, 2, 3]);

      expect(() => compiler['convertVariable']('not-an-array', 'list')).toThrow(
        'Expected array, got string'
      );
    });

    it('should convert dict values', () => {
      const obj = { key: 'value' };
      expect(compiler['convertVariable'](obj, 'dict')).toEqual(obj);

      expect(() =>
        compiler['convertVariable']('not-an-object', 'dict')
      ).toThrow('Expected object, got string');
    });

    it('should pass through any values', () => {
      const value = { complex: 'object' };
      expect(compiler['convertVariable'](value, 'any')).toBe(value);
    });
  });

  describe('default value handling', () => {
    it('should use default values for non-required variables', async () => {
      const promptWithDefaults: PromptAssembly = {
        pal_version: '1.0',
        id: 'test-defaults',
        version: '1.0.0',
        description: 'Test defaults',
        imports: {},
        variables: [
          {
            name: 'optional_string',
            type: 'string',
            description: 'Optional string',
            required: false,
          },
          {
            name: 'optional_list',
            type: 'list',
            description: 'Optional list',
            required: false,
          },
          {
            name: 'optional_dict',
            type: 'dict',
            description: 'Optional dict',
            required: false,
          },
          {
            name: 'optional_boolean',
            type: 'boolean',
            description: 'Optional boolean',
            required: false,
          },
          {
            name: 'optional_integer',
            type: 'integer',
            description: 'Optional integer',
            required: false,
          },
          {
            name: 'optional_float',
            type: 'float',
            description: 'Optional float',
            required: false,
          },
          {
            name: 'optional_any',
            type: 'any',
            description: 'Optional any',
            required: false,
          },
        ],
        composition: [
          'String: {{ optional_string }}',
          'List length: {{ optional_list | length }}',
          'Boolean: {{ optional_boolean }}',
          'Integer: {{ optional_integer }}',
          'Float: {{ optional_float }}',
          'Any: {{ optional_any if optional_any is not null else "null" }}',
        ],
        metadata: {},
      };

      const result = await compiler.compile(promptWithDefaults, {});

      expect(result).toContain('String: ');
      expect(result).toContain('List length: 0');
      expect(result).toContain('Boolean: false');
      expect(result).toContain('Integer: 0');
      expect(result).toContain('Float: 0');
      expect(result).toContain('Any: null');
    });

    it('should prefer explicit default values over type defaults', async () => {
      const promptWithExplicitDefaults: PromptAssembly = {
        pal_version: '1.0',
        id: 'test-explicit-defaults',
        version: '1.0.0',
        description: 'Test explicit defaults',
        imports: {},
        variables: [
          {
            name: 'greeting',
            type: 'string',
            description: 'Greeting',
            required: false,
            default: 'Custom greeting',
          },
          {
            name: 'count',
            type: 'integer',
            description: 'Count',
            required: false,
            default: 42,
          },
        ],
        composition: ['{{ greeting }}: {{ count }}'],
        metadata: {},
      };

      const result = await compiler.compile(promptWithExplicitDefaults, {});

      expect(result).toBe('Custom greeting: 42');
    });
  });

  describe('compiler constructor', () => {
    it('should use provided loader', () => {
      const customLoader = new MockedLoader();
      const customCompiler = new PromptCompiler(customLoader);

      expect(customCompiler['loader']).toBe(customLoader);
    });

    it('should create default loader if none provided', () => {
      const defaultCompiler = new PromptCompiler();

      expect(defaultCompiler['loader']).toBeDefined();
    });
  });

  describe('error context in compilation errors', () => {
    it('should include prompt ID in error context', async () => {
      const promptWithError: PromptAssembly = {
        pal_version: '1.0',
        id: 'error-prompt-id',
        version: '1.0.0',
        description: 'Error prompt',
        imports: {},
        variables: [],
        composition: ['{% invalid_syntax %}'],
        metadata: {},
      };

      try {
        await compiler.compile(promptWithError);
        expect.fail('Expected compilation to throw error');
      } catch (error) {
        expect(error).toBeInstanceOf(PALCompilerError);
        if (error instanceof PALCompilerError) {
          expect(error.context?.promptId).toBe('error-prompt-id');
        }
      }
    });
  });
});
