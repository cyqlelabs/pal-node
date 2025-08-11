import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Loader } from '../core/loader.js';
import { PALLoadError, PALValidationError } from '../exceptions/core.js';

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

      const result = await loader.loadPromptAssembly('https://example.com/prompt.pal');
      
      expect(result).toEqual(validPromptAssembly);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/prompt.pal',
        expect.any(Object)
      );
    });

    it('should throw PALLoadError for file not found', async () => {
      const error = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockReadFile.mockRejectedValue(error);

      await expect(loader.loadPromptAssembly('/nonexistent/file.pal'))
        .rejects.toThrow(PALLoadError);
    });

    it('should throw PALLoadError for HTTP error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);

      await expect(loader.loadPromptAssembly('https://example.com/404.pal'))
        .rejects.toThrow(PALLoadError);
    });

    it('should throw PALValidationError for invalid YAML', async () => {
      mockReadFile.mockResolvedValue('invalid: yaml: content: [');

      await expect(loader.loadPromptAssembly('/test/invalid.pal'))
        .rejects.toThrow(PALValidationError);
    });

    it('should throw PALValidationError for invalid schema', async () => {
      const invalidYaml = `
pal_version: "1.0"
id: "test-prompt"
# Missing required fields
      `;

      mockReadFile.mockResolvedValue(invalidYaml);

      await expect(loader.loadPromptAssembly('/test/invalid.pal'))
        .rejects.toThrow(PALValidationError);
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

      await expect(loader.loadComponentLibrary('/test/invalid.pal.lib'))
        .rejects.toThrow(PALValidationError);
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

    it('should handle request timeout', async () => {
      const loader = new Loader(100); // 100ms timeout
      
      mockFetch.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 200))
      );

      await expect(loader.loadPromptAssembly('https://slow.example.com/test.pal'))
        .rejects.toThrow(PALLoadError);
    }, 1000);
  });
});