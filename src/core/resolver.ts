import { dirname, resolve } from 'path';
import {
  PALCircularDependencyError,
  PALResolverError,
} from '../exceptions/core.js';
import { ComponentLibrary, PromptAssembly } from '../types/schema.js';
import { Loader } from './loader.js';

/**
 * Cache for resolved dependencies
 */
export class ResolverCache {
  private cache = new Map<string, ComponentLibrary>();

  get(key: string): ComponentLibrary | undefined {
    return this.cache.get(key);
  }

  set(key: string, library: ComponentLibrary): void {
    this.cache.set(key, library);
  }

  clear(): void {
    this.cache.clear();
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }
}

/**
 * Resolves PAL dependencies and validates component references
 */
export class Resolver {
  private loader: Loader;
  private cache: ResolverCache;

  constructor(loader: Loader, cache: ResolverCache) {
    this.loader = loader;
    this.cache = cache;
  }

  /**
   * Resolve all dependencies for a prompt assembly
   */
  async resolveDependencies(
    promptAssembly: PromptAssembly,
    basePath?: string
  ): Promise<Record<string, ComponentLibrary>> {
    const resolved: Record<string, ComponentLibrary> = {};
    const visitedPaths = new Set<string>();

    for (const [alias, importPath] of Object.entries(promptAssembly.imports)) {
      const resolvedPath = this.resolveImportPath(importPath, basePath);
      await this.loadDependencyRecursive(
        alias,
        resolvedPath,
        resolved,
        visitedPaths
      );
    }

    return resolved;
  }

  /**
   * Validate that all component references exist in resolved libraries
   */
  validateReferences(
    promptAssembly: PromptAssembly,
    resolvedLibraries: Record<string, ComponentLibrary>
  ): string[] {
    const errors: string[] = [];
    const composition = promptAssembly.composition.join('\n');

    // Extract component references (alias.component format)
    const componentRegex =
      /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
    let match;

    while ((match = componentRegex.exec(composition)) !== null) {
      const reference = match[1];

      if (!reference) {
        continue;
      }

      const [alias, componentName] = reference.split('.');

      if (!alias || !resolvedLibraries[alias]) {
        errors.push(`Unknown import alias: ${alias}`);
        continue;
      }

      const library = resolvedLibraries[alias];
      const component = library.components.find(
        (c: any) => c.name === componentName
      );

      if (!component) {
        const available = library.components.map((c: any) => c.name);
        errors.push(
          `Component '${componentName}' not found in library '${alias}'. Available: ${available.join(', ')}`
        );
      }
    }

    return errors;
  }

  /**
   * Recursively load dependencies with circular dependency detection
   */
  private async loadDependencyRecursive(
    alias: string,
    path: string,
    resolved: Record<string, ComponentLibrary>,
    visitedPaths: Set<string>
  ): Promise<void> {
    // Check for circular dependencies
    if (visitedPaths.has(path)) {
      throw new PALCircularDependencyError(
        `Circular dependency detected in path: ${path}`,
        { path, visitedPaths: Array.from(visitedPaths) }
      );
    }

    // Check cache first
    if (this.cache.has(path)) {
      resolved[alias] = this.cache.get(path)!;
      return;
    }

    visitedPaths.add(path);

    try {
      let library: ComponentLibrary;

      if (path.endsWith('.pal.lib') || path.endsWith('.lib.yml')) {
        library = await this.loader.loadComponentLibrary(path);
      } else if (path.endsWith('.pal') || path.endsWith('.yml')) {
        // Handle nested prompt assemblies (recursive imports)
        const nestedAssembly = await this.loader.loadPromptAssembly(path);

        // Resolve nested dependencies
        const nestedResolved = await this.resolveDependencies(
          nestedAssembly,
          dirname(path)
        );

        // Merge nested dependencies into current resolution
        Object.assign(resolved, nestedResolved);

        // Create a synthetic library from the prompt assembly
        library = this.createLibraryFromAssembly(nestedAssembly);
      } else {
        throw new PALResolverError(`Unsupported file type: ${path}`, { path });
      }

      // Cache the library
      this.cache.set(path, library);
      resolved[alias] = library;
    } catch (error) {
      if (error instanceof PALCircularDependencyError) {
        throw error;
      }
      throw new PALResolverError(
        `Failed to load dependency ${path}: ${error instanceof Error ? error.message : String(error)}`,
        { path, alias, error: String(error) }
      );
    } finally {
      visitedPaths.delete(path);
    }
  }

  /**
   * Resolve import path relative to base path
   */
  private resolveImportPath(importPath: string, basePath?: string): string {
    if (this.isURL(importPath)) {
      return importPath;
    }

    if (basePath && !this.isAbsolutePath(importPath)) {
      return resolve(dirname(basePath), importPath);
    }

    return importPath;
  }

  /**
   * Create a synthetic library from a prompt assembly (for nested imports)
   */
  private createLibraryFromAssembly(
    assembly: PromptAssembly
  ): ComponentLibrary {
    return {
      pal_version: '1.0',
      library_id: assembly.id,
      version: assembly.version,
      description: assembly.description,
      type: 'task', // Default type for prompt assemblies
      components: [
        {
          name: 'prompt',
          description: assembly.description,
          content: assembly.composition.join('\n'),
          metadata: assembly.metadata,
        },
      ],
      metadata: assembly.metadata,
    };
  }

  /**
   * Check if path is a URL
   */
  private isURL(path: string): boolean {
    try {
      const url = new URL(path);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Check if path is absolute
   */
  private isAbsolutePath(path: string): boolean {
    return path.startsWith('/') || /^[A-Za-z]:/.test(path);
  }
}
