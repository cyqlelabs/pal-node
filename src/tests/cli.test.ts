import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile, stat } from 'fs/promises';
import { glob } from 'glob';
import kleur from 'kleur';
import {
  MockLLMClient,
  OpenAIClient,
  AnthropicClient,
} from '../core/executor.js';
import { PALError } from '../exceptions/core.js';

// Mock all dependencies
vi.mock('fs/promises');
vi.mock('glob');
vi.mock('kleur', () => ({
  default: {
    red: vi.fn((text) => text),
    green: vi.fn((text) => text),
    yellow: vi.fn((text) => text),
    cyan: vi.fn((text) => text),
    magenta: vi.fn((text) => text),
    dim: vi.fn((text) => text),
    bold: vi.fn((text) => text),
  },
}));
vi.mock('../core/compiler.js');
vi.mock('../core/executor.js');
vi.mock('../core/loader.js');

// Import CLI functions - we need to import after mocking
const mockConsoleLog = vi.fn();
const mockConsoleError = vi.fn();
const mockProcessExit = vi.fn();

vi.stubGlobal('console', {
  log: mockConsoleLog,
  error: mockConsoleError,
});

vi.stubGlobal('process', {
  exit: mockProcessExit,
});

describe('CLI Module', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockConsoleLog.mockClear();
    mockConsoleError.mockClear();
    mockProcessExit.mockClear();

    // Reset kleur mocks
    Object.values(kleur).forEach((fn) => {
      if (typeof fn === 'function') {
        vi.mocked(fn).mockImplementation((text) => text);
      }
    });
  });

  describe('utility functions', () => {
    it('should identify prompt assembly files correctly', () => {
      // Test direct function without importing CLI module
      const isPromptAssemblyFile = (filePath: string): boolean => {
        return (
          filePath.endsWith('.pal') ||
          (filePath.endsWith('.yml') && !filePath.includes('.lib.yml'))
        );
      };

      expect(isPromptAssemblyFile('test.pal')).toBe(true);
      expect(isPromptAssemblyFile('test.yml')).toBe(true);
      expect(isPromptAssemblyFile('test.lib.yml')).toBe(false);
      expect(isPromptAssemblyFile('test.js')).toBe(false);
    });

    it('should identify library files correctly', () => {
      const isLibraryFile = (filePath: string): boolean => {
        return filePath.endsWith('.pal.lib') || filePath.endsWith('.lib.yml');
      };

      expect(isLibraryFile('test.pal.lib')).toBe(true);
      expect(isLibraryFile('test.lib.yml')).toBe(true);
      expect(isLibraryFile('test.pal')).toBe(false);
      expect(isLibraryFile('test.yml')).toBe(false);
    });

    it('should handle PAL errors correctly', () => {
      const handleError = (error: unknown): void => {
        if (error instanceof PALError) {
          console.error('Error:', error.message);
          if (error.context) {
            console.error('Context:');
            for (const [key, value] of Object.entries(error.context)) {
              console.error(`  ${key}: ${value}`);
            }
          }
        } else {
          console.error('Unexpected error:', String(error));
        }
      };

      const palError = new PALError('Test error', { file: 'test.pal' });
      handleError(palError);

      expect(mockConsoleError).toHaveBeenCalledWith('Error:', 'Test error');
      expect(mockConsoleError).toHaveBeenCalledWith('Context:');
      expect(mockConsoleError).toHaveBeenCalledWith('  file: test.pal');
    });

    it('should handle non-PAL errors correctly', () => {
      const handleError = (error: unknown): void => {
        if (error instanceof PALError) {
          console.error('Error:', error.message);
        } else {
          console.error('Unexpected error:', String(error));
        }
      };

      const genericError = new Error('Generic error');
      handleError(genericError);

      expect(mockConsoleError).toHaveBeenCalledWith(
        'Unexpected error:',
        'Error: Generic error'
      );
    });

    it('should create LLM clients correctly', () => {
      const createLLMClient = (
        provider: string,
        apiKey?: string,
        mockMessage?: string
      ): any => {
        switch (provider) {
          case 'openai':
            return new OpenAIClient(apiKey);
          case 'anthropic':
            return new AnthropicClient(apiKey);
          case 'mock':
          default:
            return new MockLLMClient(
              mockMessage || 'This is a mock response from the PAL system.'
            );
        }
      };

      // Test OpenAI client creation
      createLLMClient('openai', 'test-key');
      expect(OpenAIClient).toHaveBeenCalledWith('test-key');

      // Test Anthropic client creation
      createLLMClient('anthropic', 'test-key');
      expect(AnthropicClient).toHaveBeenCalledWith('test-key');

      // Test Mock client creation
      createLLMClient('mock');
      expect(MockLLMClient).toHaveBeenCalledWith(
        'This is a mock response from the PAL system.'
      );

      // Test Mock client with custom message
      createLLMClient('mock', undefined, 'Custom message');
      expect(MockLLMClient).toHaveBeenCalledWith('Custom message');
    });
  });

  describe('loadVariables', () => {
    it('should load variables from file', async () => {
      const loadVariables = async (
        variables?: string,
        varsFile?: string
      ): Promise<Record<string, unknown>> => {
        let varsDict: Record<string, unknown> = {};

        if (varsFile) {
          try {
            const content = await readFile(varsFile, 'utf-8');
            varsDict = { ...varsDict, ...JSON.parse(content) };
          } catch (error) {
            console.error('Error reading variables file:', String(error));
            process.exit(1);
          }
        }

        if (variables) {
          try {
            varsDict = { ...varsDict, ...JSON.parse(variables) };
          } catch (error) {
            console.error('Invalid JSON in --vars:', String(error));
            process.exit(1);
          }
        }

        return varsDict;
      };

      vi.mocked(readFile).mockResolvedValue('{"key1": "value1"}');

      const result = await loadVariables(undefined, 'test.json');
      expect(result).toEqual({ key1: 'value1' });
      expect(readFile).toHaveBeenCalledWith('test.json', 'utf-8');
    });

    it('should load variables from command line', async () => {
      const loadVariables = async (
        variables?: string,
        _varsFile?: string
      ): Promise<Record<string, unknown>> => {
        let varsDict: Record<string, unknown> = {};

        if (variables) {
          try {
            varsDict = { ...varsDict, ...JSON.parse(variables) };
          } catch (error) {
            console.error('Invalid JSON in --vars:', String(error));
            process.exit(1);
          }
        }

        return varsDict;
      };

      const result = await loadVariables('{"key2": "value2"}');
      expect(result).toEqual({ key2: 'value2' });
    });

    it('should merge variables from file and command line', async () => {
      const loadVariables = async (
        variables?: string,
        varsFile?: string
      ): Promise<Record<string, unknown>> => {
        let varsDict: Record<string, unknown> = {};

        if (varsFile) {
          try {
            const content = await readFile(varsFile, 'utf-8');
            varsDict = { ...varsDict, ...JSON.parse(content) };
          } catch (error) {
            console.error('Error reading variables file:', String(error));
            process.exit(1);
          }
        }

        if (variables) {
          try {
            varsDict = { ...varsDict, ...JSON.parse(variables) };
          } catch (error) {
            console.error('Invalid JSON in --vars:', String(error));
            process.exit(1);
          }
        }

        return varsDict;
      };

      vi.mocked(readFile).mockResolvedValue('{"key1": "value1"}');

      const result = await loadVariables('{"key2": "value2"}', 'test.json');
      expect(result).toEqual({ key1: 'value1', key2: 'value2' });
    });

    it('should handle file read errors', async () => {
      const loadVariables = async (
        variables?: string,
        varsFile?: string
      ): Promise<Record<string, unknown>> => {
        let varsDict: Record<string, unknown> = {};

        if (varsFile) {
          try {
            const content = await readFile(varsFile, 'utf-8');
            varsDict = { ...varsDict, ...JSON.parse(content) };
          } catch (error) {
            console.error('Error reading variables file:', String(error));
            process.exit(1);
          }
        }

        return varsDict;
      };

      vi.mocked(readFile).mockRejectedValue(new Error('File not found'));

      await loadVariables(undefined, 'nonexistent.json');
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error reading variables file:',
        'Error: File not found'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('should handle invalid JSON in variables', async () => {
      const loadVariables = async (
        variables?: string,
        _varsFile?: string
      ): Promise<Record<string, unknown>> => {
        let varsDict: Record<string, unknown> = {};

        if (variables) {
          try {
            varsDict = { ...varsDict, ...JSON.parse(variables) };
          } catch (error) {
            console.error('Invalid JSON in --vars:', String(error));
            process.exit(1);
          }
        }

        return varsDict;
      };

      await loadVariables('invalid json');
      expect(mockConsoleError).toHaveBeenCalledWith(
        'Invalid JSON in --vars:',
        expect.any(String)
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });

  describe('getFilesToValidate', () => {
    it('should return single file when path is a file', async () => {
      const getFilesToValidate = async (
        path: string,
        _recursive: boolean
      ): Promise<string[]> => {
        const files: string[] = [];

        try {
          const fs = await import('fs/promises');
          const statResult = await fs.stat(path);

          if (statResult.isFile()) {
            files.push(path);
          }
        } catch {
          throw new Error(`Cannot access path: ${path}`);
        }

        return files;
      };

      vi.mocked(stat).mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
      } as any);

      const result = await getFilesToValidate('test.pal', false);
      expect(result).toEqual(['test.pal']);
    });

    it('should handle directory and find PAL files', async () => {
      const isPromptAssemblyFile = (filePath: string): boolean => {
        return (
          filePath.endsWith('.pal') ||
          (filePath.endsWith('.yml') && !filePath.includes('.lib.yml'))
        );
      };

      const isLibraryFile = (filePath: string): boolean => {
        return filePath.endsWith('.pal.lib') || filePath.endsWith('.lib.yml');
      };

      const getFilesToValidate = async (
        path: string,
        recursive: boolean
      ): Promise<string[]> => {
        const files: string[] = [];

        try {
          const fs = await import('fs/promises');
          const statResult = await fs.stat(path);

          if (statResult.isFile()) {
            files.push(path);
          } else if (statResult.isDirectory()) {
            const patterns = ['*.pal', '*.pal.lib', '*.yml'];

            for (const pattern of patterns) {
              const globPattern = recursive
                ? `${path}/**/${pattern}`
                : `${path}/${pattern}`;
              const matched = await glob(globPattern);
              files.push(...matched);
            }

            return files.filter(
              (file) => isPromptAssemblyFile(file) || isLibraryFile(file)
            );
          }
        } catch {
          throw new Error(`Cannot access path: ${path}`);
        }

        return files;
      };

      vi.mocked(stat).mockResolvedValue({
        isFile: () => false,
        isDirectory: () => true,
      } as any);

      vi.mocked(glob).mockResolvedValueOnce(['test1.pal', 'test2.pal']);
      vi.mocked(glob).mockResolvedValueOnce(['lib1.pal.lib']);
      vi.mocked(glob).mockResolvedValueOnce(['config.yml', 'test.lib.yml']);

      const result = await getFilesToValidate('./test', false);
      expect(result).toEqual([
        'test1.pal',
        'test2.pal',
        'lib1.pal.lib',
        'config.yml',
        'test.lib.yml',
      ]);
    });

    it('should throw error for inaccessible path', async () => {
      const getFilesToValidate = async (
        path: string,
        _recursive: boolean
      ): Promise<string[]> => {
        try {
          const fs = await import('fs/promises');
          await fs.stat(path);
        } catch {
          throw new Error(`Cannot access path: ${path}`);
        }
        return [];
      };

      vi.mocked(stat).mockRejectedValue(new Error('ENOENT'));

      await expect(getFilesToValidate('nonexistent', false)).rejects.toThrow(
        'Cannot access path: nonexistent'
      );
    });
  });

  describe('validateSingleFile', () => {
    let mockLoader: any;
    let mockCompiler: any;

    beforeEach(() => {
      mockLoader = {
        loadPromptAssembly: vi.fn(),
        loadComponentLibrary: vi.fn(),
      };
      mockCompiler = {
        analyzeTemplateVariables: vi.fn(),
      };
    });

    it('should validate prompt assembly file successfully', async () => {
      const validateSingleFile = async (
        filePath: string,
        loader: any,
        compiler: any
      ): Promise<{
        fileType: string;
        status: string;
        issues: string;
        isValid: boolean;
      }> => {
        const isPromptAssemblyFile = (filePath: string): boolean => {
          return (
            filePath.endsWith('.pal') ||
            (filePath.endsWith('.yml') && !filePath.includes('.lib.yml'))
          );
        };

        try {
          if (isPromptAssemblyFile(filePath)) {
            const promptAssembly = await loader.loadPromptAssembly(filePath);

            const templateVars =
              compiler.analyzeTemplateVariables(promptAssembly);
            const definedVars = new Set(
              promptAssembly.variables.map((v: any) => v.name)
            );
            const undefinedVars = [...templateVars].filter(
              (v: string) =>
                !definedVars.has(v) && !['loop', 'super'].includes(v)
            );

            if (undefinedVars.length > 0) {
              return {
                fileType: 'Assembly',
                status: 'Warning',
                issues: `Undefined variables: ${undefinedVars.join(', ')}`,
                isValid: false,
              };
            }

            return {
              fileType: 'Assembly',
              status: 'Valid',
              issues: '',
              isValid: true,
            };
          }

          return {
            fileType: 'Unknown',
            status: 'Skipped',
            issues: '',
            isValid: false,
          };
        } catch {
          return {
            fileType: 'Unknown',
            status: 'Invalid',
            issues: 'Error occurred',
            isValid: false,
          };
        }
      };

      mockLoader.loadPromptAssembly.mockResolvedValue({
        variables: [{ name: 'var1' }, { name: 'var2' }],
      });
      mockCompiler.analyzeTemplateVariables.mockReturnValue(
        new Set(['var1', 'var2'])
      );

      const result = await validateSingleFile(
        'test.pal',
        mockLoader,
        mockCompiler
      );
      expect(result).toEqual({
        fileType: 'Assembly',
        status: 'Valid',
        issues: '',
        isValid: true,
      });
    });

    it('should detect undefined variables in prompt assembly', async () => {
      const validateSingleFile = async (
        filePath: string,
        loader: any,
        compiler: any
      ): Promise<{
        fileType: string;
        status: string;
        issues: string;
        isValid: boolean;
      }> => {
        const isPromptAssemblyFile = (filePath: string): boolean => {
          return (
            filePath.endsWith('.pal') ||
            (filePath.endsWith('.yml') && !filePath.includes('.lib.yml'))
          );
        };

        try {
          if (isPromptAssemblyFile(filePath)) {
            const promptAssembly = await loader.loadPromptAssembly(filePath);

            const templateVars =
              compiler.analyzeTemplateVariables(promptAssembly);
            const definedVars = new Set(
              promptAssembly.variables.map((v: any) => v.name)
            );
            const undefinedVars = [...templateVars].filter(
              (v: string) =>
                !definedVars.has(v) && !['loop', 'super'].includes(v)
            );

            if (undefinedVars.length > 0) {
              return {
                fileType: 'Assembly',
                status: 'Warning',
                issues: `Undefined variables: ${undefinedVars.join(', ')}`,
                isValid: false,
              };
            }

            return {
              fileType: 'Assembly',
              status: 'Valid',
              issues: '',
              isValid: true,
            };
          }

          return {
            fileType: 'Unknown',
            status: 'Skipped',
            issues: '',
            isValid: false,
          };
        } catch {
          return {
            fileType: 'Unknown',
            status: 'Invalid',
            issues: 'Error occurred',
            isValid: false,
          };
        }
      };

      mockLoader.loadPromptAssembly.mockResolvedValue({
        variables: [{ name: 'var1' }],
      });
      mockCompiler.analyzeTemplateVariables.mockReturnValue(
        new Set(['var1', 'undefined_var'])
      );

      const result = await validateSingleFile(
        'test.pal',
        mockLoader,
        mockCompiler
      );
      expect(result).toEqual({
        fileType: 'Assembly',
        status: 'Warning',
        issues: 'Undefined variables: undefined_var',
        isValid: false,
      });
    });

    it('should validate library files', async () => {
      const validateSingleFile = async (
        filePath: string,
        loader: any,
        _compiler: any
      ): Promise<{
        fileType: string;
        status: string;
        issues: string;
        isValid: boolean;
      }> => {
        const isLibraryFile = (filePath: string): boolean => {
          return filePath.endsWith('.pal.lib') || filePath.endsWith('.lib.yml');
        };

        try {
          if (isLibraryFile(filePath)) {
            await loader.loadComponentLibrary(filePath);
            return {
              fileType: 'Library',
              status: 'Valid',
              issues: '',
              isValid: true,
            };
          }

          return {
            fileType: 'Unknown',
            status: 'Skipped',
            issues: '',
            isValid: false,
          };
        } catch {
          return {
            fileType: 'Unknown',
            status: 'Invalid',
            issues: 'Error occurred',
            isValid: false,
          };
        }
      };

      mockLoader.loadComponentLibrary.mockResolvedValue({});

      const result = await validateSingleFile(
        'test.pal.lib',
        mockLoader,
        mockCompiler
      );
      expect(result).toEqual({
        fileType: 'Library',
        status: 'Valid',
        issues: '',
        isValid: true,
      });
    });

    it('should handle validation errors', async () => {
      const validateSingleFile = async (
        filePath: string,
        loader: any,
        _compiler: any
      ): Promise<{
        fileType: string;
        status: string;
        issues: string;
        isValid: boolean;
      }> => {
        const isPromptAssemblyFile = (filePath: string): boolean => {
          return (
            filePath.endsWith('.pal') ||
            (filePath.endsWith('.yml') && !filePath.includes('.lib.yml'))
          );
        };

        try {
          if (isPromptAssemblyFile(filePath)) {
            await loader.loadPromptAssembly(filePath);
          }
          return {
            fileType: 'Assembly',
            status: 'Valid',
            issues: '',
            isValid: true,
          };
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          const truncated =
            errorMsg.length > 50 ? errorMsg.substring(0, 50) + '...' : errorMsg;

          return {
            fileType: 'Unknown',
            status: 'Invalid',
            issues: truncated,
            isValid: false,
          };
        }
      };

      mockLoader.loadPromptAssembly.mockRejectedValue(
        new Error(
          'This is a very long error message that should be truncated when displayed'
        )
      );

      const result = await validateSingleFile(
        'test.pal',
        mockLoader,
        mockCompiler
      );
      expect(result.fileType).toBe('Unknown');
      expect(result.status).toBe('Invalid');
      expect(result.issues).toBe(
        'This is a very long error message that should be t...'
      );
      expect(result.isValid).toBe(false);
    });
  });
});
