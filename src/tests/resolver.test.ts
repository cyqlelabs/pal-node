import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Resolver, ResolverCache } from '../core/resolver.js';
import { Loader } from '../core/loader.js';
import { PALResolverError } from '../exceptions/core.js';
import { ComponentLibrary, PromptAssembly } from '../types/schema.js';

describe('ResolverCache', () => {
  let cache: ResolverCache;

  beforeEach(() => {
    cache = new ResolverCache();
  });

  it('should store and retrieve values', () => {
    const library: ComponentLibrary = {
      pal_version: '1.0',
      library_id: 'test-lib',
      version: '1.0.0',
      description: 'Test library',
      type: 'trait',
      components: [],
      metadata: {}
    };

    cache.set('key1', library);
    expect(cache.get('key1')).toEqual(library);
  });

  it('should return undefined for non-existent keys', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('should check if key exists', () => {
    const library: ComponentLibrary = {
      pal_version: '1.0',
      library_id: 'test-lib',
      version: '1.0.0',
      description: 'Test library',
      type: 'trait',
      components: [],
      metadata: {}
    };

    expect(cache.has('key1')).toBe(false);
    cache.set('key1', library);
    expect(cache.has('key1')).toBe(true);
  });

  it('should clear all cached values', () => {
    const library: ComponentLibrary = {
      pal_version: '1.0',
      library_id: 'test-lib',
      version: '1.0.0',
      description: 'Test library',
      type: 'trait',
      components: [],
      metadata: {}
    };

    cache.set('key1', library);
    cache.set('key2', library);
    expect(cache.has('key1')).toBe(true);
    expect(cache.has('key2')).toBe(true);

    cache.clear();
    expect(cache.has('key1')).toBe(false);
    expect(cache.has('key2')).toBe(false);
  });
});

describe('Resolver', () => {
  let resolver: Resolver;
  let mockLoader: any;
  let cache: ResolverCache;

  const mockLibrary: ComponentLibrary = {
    pal_version: '1.0',
    library_id: 'test-lib',
    version: '1.0.0',
    description: 'Test library',
    type: 'trait',
    components: [
      {
        name: 'helper',
        description: 'Helper component',
        content: 'You are helpful.',
        metadata: {}
      }
    ],
    metadata: {}
  };

  const mockPromptAssembly: PromptAssembly = {
    pal_version: '1.0',
    id: 'test-prompt',
    version: '1.0.0',
    description: 'Test prompt assembly',
    imports: {},
    variables: [],
    composition: ['Hello world'],
    metadata: {}
  };

  beforeEach(() => {
    mockLoader = {
      loadComponentLibrary: vi.fn(),
      loadPromptAssembly: vi.fn()
    };
    cache = new ResolverCache();
    resolver = new Resolver(mockLoader, cache);
    vi.clearAllMocks();
  });

  describe('resolveDependencies', () => {
    it('should resolve simple dependencies', async () => {
      const promptAssembly: PromptAssembly = {
        ...mockPromptAssembly,
        imports: {
          'lib1': './library1.pal.lib'
        }
      };

      mockLoader.loadComponentLibrary.mockResolvedValue(mockLibrary);

      const result = await resolver.resolveDependencies(promptAssembly);

      expect(result).toEqual({ lib1: mockLibrary });
      expect(mockLoader.loadComponentLibrary).toHaveBeenCalledWith('./library1.pal.lib');
    });

    it('should handle URL imports', async () => {
      const promptAssembly: PromptAssembly = {
        ...mockPromptAssembly,
        imports: {
          'lib1': 'https://example.com/library1.pal.lib'
        }
      };

      mockLoader.loadComponentLibrary.mockResolvedValue(mockLibrary);

      const result = await resolver.resolveDependencies(promptAssembly);

      expect(result).toEqual({ lib1: mockLibrary });
      expect(mockLoader.loadComponentLibrary).toHaveBeenCalledWith('https://example.com/library1.pal.lib');
    });

    it('should use cached libraries', async () => {
      const promptAssembly: PromptAssembly = {
        ...mockPromptAssembly,
        imports: {
          'lib1': './library1.pal.lib'
        }
      };

      cache.set('./library1.pal.lib', mockLibrary);

      const result = await resolver.resolveDependencies(promptAssembly);

      expect(result).toEqual({ lib1: mockLibrary });
      expect(mockLoader.loadComponentLibrary).not.toHaveBeenCalled();
    });

    it('should handle loader errors', async () => {
      const promptAssembly: PromptAssembly = {
        ...mockPromptAssembly,
        imports: {
          'lib1': './library1.pal.lib'
        }
      };

      mockLoader.loadComponentLibrary.mockRejectedValue(new Error('File not found'));

      await expect(resolver.resolveDependencies(promptAssembly))
        .rejects.toThrow(PALResolverError);
    });

    it('should handle unsupported file types', async () => {
      const promptAssembly: PromptAssembly = {
        ...mockPromptAssembly,
        imports: {
          'invalid': './invalid.txt'
        }
      };

      await expect(resolver.resolveDependencies(promptAssembly))
        .rejects.toThrow(PALResolverError);
    });
  });

  describe('validateReferences', () => {
    it('should validate existing component references', () => {
      const promptAssembly: PromptAssembly = {
        ...mockPromptAssembly,
        composition: ['{{ lib1.helper }} says hello']
      };

      const resolvedLibraries = {
        lib1: mockLibrary
      };

      const errors = resolver.validateReferences(promptAssembly, resolvedLibraries);

      expect(errors).toEqual([]);
    });

    it('should detect unknown import aliases', () => {
      const promptAssembly: PromptAssembly = {
        ...mockPromptAssembly,
        composition: ['{{ unknown.helper }} says hello']
      };

      const resolvedLibraries = {};

      const errors = resolver.validateReferences(promptAssembly, resolvedLibraries);

      expect(errors).toContain('Unknown import alias: unknown');
    });

    it('should detect missing components', () => {
      const promptAssembly: PromptAssembly = {
        ...mockPromptAssembly,
        composition: ['{{ lib1.missing }} says hello']
      };

      const resolvedLibraries = {
        lib1: mockLibrary
      };

      const errors = resolver.validateReferences(promptAssembly, resolvedLibraries);

      expect(errors).toContain("Component 'missing' not found in library 'lib1'. Available: helper");
    });

    it('should handle references with whitespace', () => {
      const promptAssembly: PromptAssembly = {
        ...mockPromptAssembly,
        composition: ['{{  lib1.helper  }} says hello']
      };

      const resolvedLibraries = {
        lib1: mockLibrary
      };

      const errors = resolver.validateReferences(promptAssembly, resolvedLibraries);

      expect(errors).toEqual([]);
    });
  });

  describe('path resolution', () => {
    it('should resolve absolute paths', async () => {
      const promptAssembly: PromptAssembly = {
        ...mockPromptAssembly,
        imports: {
          'lib1': '/absolute/path/library1.pal.lib'
        }
      };

      mockLoader.loadComponentLibrary.mockResolvedValue(mockLibrary);

      await resolver.resolveDependencies(promptAssembly, '/some/base/path');

      expect(mockLoader.loadComponentLibrary).toHaveBeenCalledWith('/absolute/path/library1.pal.lib');
    });

    it('should resolve HTTP URLs', async () => {
      const promptAssembly: PromptAssembly = {
        ...mockPromptAssembly,
        imports: {
          'lib1': 'http://example.com/library1.pal.lib'
        }
      };

      mockLoader.loadComponentLibrary.mockResolvedValue(mockLibrary);

      await resolver.resolveDependencies(promptAssembly);

      expect(mockLoader.loadComponentLibrary).toHaveBeenCalledWith('http://example.com/library1.pal.lib');
    });

    it('should resolve HTTPS URLs', async () => {
      const promptAssembly: PromptAssembly = {
        ...mockPromptAssembly,
        imports: {
          'lib1': 'https://example.com/library1.pal.lib'
        }
      };

      mockLoader.loadComponentLibrary.mockResolvedValue(mockLibrary);

      await resolver.resolveDependencies(promptAssembly);

      expect(mockLoader.loadComponentLibrary).toHaveBeenCalledWith('https://example.com/library1.pal.lib');
    });

    it('should handle relative path resolution with base path', async () => {
      const promptAssembly: PromptAssembly = {
        ...mockPromptAssembly,
        imports: {
          'lib1': './library1.pal.lib'
        }
      };

      mockLoader.loadComponentLibrary.mockResolvedValue(mockLibrary);

      await resolver.resolveDependencies(promptAssembly, '/base/path/prompt.pal');

      expect(mockLoader.loadComponentLibrary).toHaveBeenCalledWith('/base/path/library1.pal.lib');
    });
  });
});