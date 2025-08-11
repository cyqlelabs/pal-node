import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PromptCompiler } from '../core/compiler.js';
import { Loader } from '../core/loader.js';
import {
  PALCompilerError,
  PALMissingComponentError,
  PALMissingVariableError,
} from '../exceptions/core.js';
import type { PromptAssembly, ComponentLibrary } from '../types/schema.js';

// Mock loader
vi.mock('../core/loader.js');
const MockedLoader = vi.mocked(Loader, true);

describe('PromptCompiler', () => {
  let compiler: PromptCompiler;
  let mockLoader: any;

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
});
