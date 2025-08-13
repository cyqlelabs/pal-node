import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Loader } from '../core/loader.js';
import { PALLoadError, PALValidationError } from '../exceptions/core.js';
import YAML from 'yaml';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('Loader', () => {
  let loader: Loader;
  let mockReadFile: any;
  const mockFetch = vi.mocked(fetch);

  beforeEach(async () => {
    loader = new Loader();
    mockReadFile = vi.mocked((await import('fs/promises')).readFile);
    vi.clearAllMocks();
  });

  describe('loadPromptAssembly', () => {
    const validPromptAssembly = {
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

    it('should load a valid prompt assembly from file', async () => {
      const yamlContent = `
pal_version: "1.0"
id: "test-prompt"
version: "1.0.0"
description: "Test prompt"
composition:
  - "Hello {{ name }}!"
variables:
  - name: "name"
    type: "string" 
    description: "Name to greet"
    required: true
      `;

      mockReadFile.mockResolvedValue(yamlContent);

      const result = await loader.loadPromptAssembly('/test/prompt.pal');

      expect(result).toEqual(validPromptAssembly);
      expect(mockReadFile).toHaveBeenCalledWith('/test/prompt.pal', 'utf-8');
    });

    it('should load a valid prompt assembly from URL', async () => {
      const yamlContent = `
pal_version: "1.0"
id: "test-prompt"
version: "1.0.0"
description: "Test prompt"
composition:
  - "Hello {{ name }}!"
variables:
  - name: "name"
    type: "string"
    description: "Name to greet"
    required: true
      `;

      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(yamlContent),
      } as Response);

      const result = await loader.loadPromptAssembly(
        'https://example.com/prompt.pal'
      );

      expect(result).toEqual(validPromptAssembly);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/prompt.pal',
        expect.any(Object)
      );
    });

    it('should throw PALLoadError for file not found', async () => {
      const error = new Error(
        'ENOENT: no such file or directory'
      ) as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      await expect(
        loader.loadPromptAssembly('/nonexistent/file.pal')
      ).rejects.toThrow(PALLoadError);
    });

    it('should throw PALLoadError for HTTP error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);

      await expect(
        loader.loadPromptAssembly('https://example.com/404.pal')
      ).rejects.toThrow(PALLoadError);
    });

    it('should throw PALValidationError for invalid YAML', async () => {
      mockReadFile.mockResolvedValue('invalid: yaml: content: [');

      await expect(
        loader.loadPromptAssembly('/test/invalid.pal')
      ).rejects.toThrow(PALValidationError);
    });

    it('should throw PALValidationError for invalid schema', async () => {
      const invalidYaml = `
pal_version: "1.0"
id: "test-prompt"
# Missing required fields
      `;

      mockReadFile.mockResolvedValue(invalidYaml);

      await expect(
        loader.loadPromptAssembly('/test/invalid.pal')
      ).rejects.toThrow(PALValidationError);
    });

    it('should throw PALValidationError for null YAML content', async () => {
      mockReadFile.mockResolvedValue('null');

      await expect(loader.loadPromptAssembly('/test/null.pal')).rejects.toThrow(
        PALValidationError
      );
    });

    it('should throw PALValidationError for array YAML content', async () => {
      mockReadFile.mockResolvedValue('- item1\n- item2');

      await expect(
        loader.loadPromptAssembly('/test/array.pal')
      ).rejects.toThrow(PALValidationError);
    });

    it('should throw PALValidationError for primitive YAML content', async () => {
      mockReadFile.mockResolvedValue('"just a string"');

      await expect(
        loader.loadPromptAssembly('/test/string.pal')
      ).rejects.toThrow(PALValidationError);
    });

    it('should handle generic errors during loading', async () => {
      const genericError = new Error('Unexpected error');
      mockReadFile.mockRejectedValue(genericError);

      await expect(
        loader.loadPromptAssembly('/test/prompt.pal')
      ).rejects.toThrow('Unexpected error');
    });

    it('should throw PALLoadError for permission denied', async () => {
      const error = new Error('Permission denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      mockReadFile.mockRejectedValue(error);

      await expect(
        loader.loadPromptAssembly('/test/restricted.pal')
      ).rejects.toThrow(PALLoadError);
    });

    it('should handle fetch network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(
        loader.loadPromptAssembly('https://example.com/prompt.pal')
      ).rejects.toThrow(PALLoadError);
    });
  });

  describe('loadComponentLibrary', () => {
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

    it('should load a valid component library', async () => {
      const yamlContent = `
pal_version: "1.0"
library_id: "com.example.test"
version: "1.0.0" 
description: "Test library"
type: "trait"
components:
  - name: "helper"
    description: "Helper component"
    content: "You are helpful."
      `;

      mockReadFile.mockResolvedValue(yamlContent);

      const result = await loader.loadComponentLibrary('/test/library.pal.lib');

      expect(result).toEqual(validLibrary);
    });

    it('should throw PALValidationError for duplicate component names', async () => {
      const invalidYaml = `
pal_version: "1.0"
library_id: "com.example.test"
version: "1.0.0"
description: "Test library"
type: "trait"
components:
  - name: "helper"
    description: "Helper 1"
    content: "You are helpful."
  - name: "helper"
    description: "Helper 2"  
    content: "You are very helpful."
      `;

      mockReadFile.mockResolvedValue(invalidYaml);

      await expect(
        loader.loadComponentLibrary('/test/invalid.pal.lib')
      ).rejects.toThrow(PALValidationError);
    });

    it('should handle generic errors during library loading', async () => {
      const genericError = new Error('Unexpected library error');
      mockReadFile.mockRejectedValue(genericError);

      await expect(
        loader.loadComponentLibrary('/test/library.pal.lib')
      ).rejects.toThrow('Unexpected library error');
    });

    it('should load component library from URL', async () => {
      const yamlContent = `
pal_version: "1.0"
library_id: "com.example.test"
version: "1.0.0" 
description: "Test library"
type: "trait"
components:
  - name: "helper"
    description: "Helper component"
    content: "You are helpful."
      `;

      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(yamlContent),
      } as Response);

      const result = await loader.loadComponentLibrary(
        'https://example.com/library.pal.lib'
      );

      expect(result.library_id).toBe('com.example.test');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/library.pal.lib',
        expect.any(Object)
      );
    });
  });

  describe('loadEvaluationSuite', () => {
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
              config: { text: 'Hello' },
            },
          ],
          metadata: {},
        },
      ],
      metadata: {},
    };

    it('should load a valid evaluation suite', async () => {
      const yamlContent = `
pal_version: "1.0"
prompt_id: "test-prompt"
target_version: "1.0.0"
description: "Test evaluation"
test_cases:
  - name: "basic_test"
    description: "Basic test case"
    variables:
      name: "World"
    assertions:
      - type: "contains"
        config:
          text: "Hello"
      `;

      mockReadFile.mockResolvedValue(yamlContent);

      const result = await loader.loadEvaluationSuite('/test/eval.yaml');

      expect(result).toEqual(validSuite);
    });

    it('should handle generic errors during evaluation suite loading', async () => {
      const genericError = new Error('Unexpected eval error');
      mockReadFile.mockRejectedValue(genericError);

      await expect(
        loader.loadEvaluationSuite('/test/eval.yaml')
      ).rejects.toThrow('Unexpected eval error');
    });

    it('should throw PALValidationError for invalid evaluation suite schema', async () => {
      const invalidYaml = `
pal_version: "1.0"
# Missing required fields
      `;

      mockReadFile.mockResolvedValue(invalidYaml);

      await expect(
        loader.loadEvaluationSuite('/test/invalid.yaml')
      ).rejects.toThrow(PALValidationError);
    });

    it('should load evaluation suite from URL', async () => {
      const yamlContent = `
pal_version: "1.0"
prompt_id: "test-prompt"
target_version: "1.0.0"
description: "Test evaluation"
test_cases:
  - name: "basic_test"
    description: "Basic test case"
    variables:
      name: "World"
    assertions:
      - type: "contains"
        config:
          text: "Hello"
      `;

      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(yamlContent),
      } as Response);

      const result = await loader.loadEvaluationSuite(
        'https://example.com/eval.yaml'
      );

      expect(result.prompt_id).toBe('test-prompt');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/eval.yaml',
        expect.any(Object)
      );
    });
  });

  describe('URL detection', () => {
    it('should handle various URL formats', async () => {
      const yamlContent = `
pal_version: "1.0"
id: "test"
version: "1.0.0"
description: "Test"
composition:
  - "Hello"
      `;

      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(yamlContent),
      } as Response);

      // Should work with http
      mockFetch.mockClear();
      await loader.loadPromptAssembly('http://example.com/test.pal');
      expect(mockFetch).toHaveBeenCalled();

      // Should work with https
      mockFetch.mockClear();
      await loader.loadPromptAssembly('https://example.com/test.pal');
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should correctly identify non-URLs', async () => {
      const yamlContent = `
pal_version: "1.0"
id: "test"
version: "1.0.0"
description: "Test"
composition:
  - "Hello"
      `;

      mockReadFile.mockResolvedValue(yamlContent);

      // Should use file loading for relative paths
      await loader.loadPromptAssembly('./test.pal');
      expect(mockReadFile).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle request timeout', async () => {
      const loader = new Loader(100); // 100ms timeout

      mockFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 200))
      );

      await expect(
        loader.loadPromptAssembly('https://slow.example.com/test.pal')
      ).rejects.toThrow(PALLoadError);
    }, 1000);

    it('should handle AbortError for timeout', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      await expect(
        loader.loadPromptAssembly('https://example.com/test.pal')
      ).rejects.toThrow(PALLoadError);
    });

    it('should handle various HTTP error codes', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      await expect(
        loader.loadPromptAssembly('https://example.com/error.pal')
      ).rejects.toThrow(PALLoadError);
    });

    it('should handle successful response with clearTimeout cleanup', async () => {
      const yamlContent = `
pal_version: "1.0"
id: "test"
version: "1.0.0"
description: "Test"
composition:
  - "Hello"
      `;

      let timeoutCleared = false;
      const originalClearTimeout = global.clearTimeout;
      global.clearTimeout = vi.fn((id) => {
        timeoutCleared = true;
        return originalClearTimeout(id);
      });

      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(yamlContent),
      } as Response);

      await loader.loadPromptAssembly('https://example.com/test.pal');

      expect(timeoutCleared).toBe(true);
      global.clearTimeout = originalClearTimeout;
    });

    it('should handle file read errors other than ENOENT and EACCES', async () => {
      const error = new Error('Disk full') as NodeJS.ErrnoException;
      error.code = 'ENOSPC';
      mockReadFile.mockRejectedValue(error);

      await expect(loader.loadPromptAssembly('/test/file.pal')).rejects.toThrow(
        PALLoadError
      );
    });

    it('should handle non-Error objects thrown during parsing', async () => {
      mockReadFile.mockResolvedValue('valid: yaml');

      const originalParse = YAML.parse;
      YAML.parse = vi.fn().mockImplementation(() => {
        throw 'String error thrown';
      });

      try {
        await expect(
          loader.loadPromptAssembly('/test/file.pal')
        ).rejects.toThrow('String error thrown');
      } finally {
        YAML.parse = originalParse;
      }
    });

    it('should handle non-Error objects thrown during URL loading', async () => {
      mockFetch.mockRejectedValue('String network error');

      await expect(
        loader.loadPromptAssembly('https://example.com/test.pal')
      ).rejects.toBe('String network error');
    });
  });
});
