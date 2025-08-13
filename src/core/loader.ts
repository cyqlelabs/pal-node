import { readFile } from 'fs/promises';
import { resolve } from 'path';
import YAML from 'yaml';
import { ZodError } from 'zod';
import { PALLoadError, PALValidationError } from '../exceptions/core.js';
import {
  ComponentLibrary,
  ComponentLibrarySchema,
  EvaluationSuite,
  EvaluationSuiteSchema,
  PromptAssembly,
  PromptAssemblySchema,
} from '../types/schema.js';

/**
 * Handles loading and parsing of PAL files from local filesystem and URLs.
 *
 * The Loader provides unified file loading capabilities for all PAL file types:
 * - Prompt assemblies (.pal)
 * - Component libraries (.pal.lib)
 * - Evaluation suites (.eval.yaml)
 *
 * Supports loading from both local files and remote URLs with automatic
 * format validation using Zod schemas.
 *
 * @example
 * ```typescript
 * const loader = new Loader();
 *
 * // Load a prompt assembly
 * const assembly = await loader.loadPromptAssembly('api_design.pal');
 *
 * // Load from URL
 * const library = await loader.loadComponentLibrary(
 *   'https://example.com/libs/personas.pal.lib'
 * );
 * ```
 */
export class Loader {
  private timeout: number;
  private abortController?: AbortController;

  /**
   * Initialize the loader.
   *
   * @param timeout - Timeout in milliseconds for HTTP requests when loading from URLs
   */
  constructor(timeout = 30000) {
    this.timeout = timeout;
  }

  /**
   * Load and validate a .pal prompt assembly file.
   *
   * @param pathOrUrl - Path to local .pal file or URL
   * @returns Validated PromptAssembly object
   * @throws {PALLoadError} If file cannot be loaded
   * @throws {PALValidationError} If file format is invalid
   */
  async loadPromptAssembly(pathOrUrl: string): Promise<PromptAssembly> {
    const content = await this.loadContent(pathOrUrl);
    const data = this.parseYAML(content, pathOrUrl);

    try {
      return PromptAssemblySchema.parse(data);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new PALValidationError(
          `Invalid prompt assembly format in ${pathOrUrl}`,
          {
            validationErrors: error.errors,
            path: pathOrUrl,
          }
        );
      }
      throw error;
    }
  }

  /**
   * Load and validate a .pal.lib component library file.
   *
   * @param pathOrUrl - Path to local .pal.lib file or URL
   * @returns Validated ComponentLibrary object
   * @throws {PALLoadError} If file cannot be loaded
   * @throws {PALValidationError} If file format is invalid
   */
  async loadComponentLibrary(pathOrUrl: string): Promise<ComponentLibrary> {
    const content = await this.loadContent(pathOrUrl);
    const data = this.parseYAML(content, pathOrUrl);

    try {
      return ComponentLibrarySchema.parse(data);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new PALValidationError(
          `Invalid component library format in ${pathOrUrl}`,
          {
            validationErrors: error.errors,
            path: pathOrUrl,
          }
        );
      }
      throw error;
    }
  }

  /**
   * Load and validate a .eval.yaml evaluation suite file.
   *
   * @param pathOrUrl - Path to local .eval.yaml file or URL
   * @returns Validated EvaluationSuite object
   * @throws {PALLoadError} If file cannot be loaded
   * @throws {PALValidationError} If file format is invalid
   */
  async loadEvaluationSuite(pathOrUrl: string): Promise<EvaluationSuite> {
    const content = await this.loadContent(pathOrUrl);
    const data = this.parseYAML(content, pathOrUrl);

    try {
      return EvaluationSuiteSchema.parse(data);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new PALValidationError(
          `Invalid evaluation suite format in ${pathOrUrl}`,
          {
            validationErrors: error.errors,
            path: pathOrUrl,
          }
        );
      }
      throw error;
    }
  }

  /**
   * Load content from file path or URL
   */
  private async loadContent(pathOrUrl: string): Promise<string> {
    if (this.isURL(pathOrUrl)) {
      return this.loadFromURL(pathOrUrl);
    }
    return this.loadFromFile(pathOrUrl);
  }

  /**
   * Load content from local file
   */
  private async loadFromFile(path: string): Promise<string> {
    try {
      const resolvedPath = resolve(path);
      return await readFile(resolvedPath, 'utf-8');
    } catch (error) {
      if (error instanceof Error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === 'ENOENT') {
          throw new PALLoadError(`File not found: ${path}`, { path });
        }
        if (nodeError.code === 'EACCES') {
          throw new PALLoadError(`Permission denied reading file: ${path}`, {
            path,
          });
        }
        throw new PALLoadError(
          `Failed to read file ${path}: ${error.message}`,
          {
            path,
            error: error.message,
          }
        );
      }
      throw error;
    }
  }

  /**
   * Load content from URL
   */
  private async loadFromURL(url: string): Promise<string> {
    this.abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      this.abortController?.abort();
    }, this.timeout);

    try {
      const response = await fetch(url, {
        signal: this.abortController.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new PALLoadError(
          `HTTP ${response.status} error loading ${url}: ${response.statusText}`,
          {
            url,
            statusCode: response.status,
          }
        );
      }

      return await response.text();
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new PALLoadError(`Request timeout loading ${url}`, {
            url,
            timeout: this.timeout,
          });
        }
        throw new PALLoadError(
          `Network error loading ${url}: ${error.message}`,
          {
            url,
            error: error.message,
          }
        );
      }
      throw error;
    }
  }

  /**
   * Parse YAML content with error handling
   */
  private parseYAML(content: string, source: string): unknown {
    try {
      const data = YAML.parse(content);
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new PALValidationError(
          `YAML content must be an object, got ${typeof data}`,
          { source }
        );
      }
      return data;
    } catch (error) {
      if (error instanceof PALValidationError) {
        throw error;
      }
      if (error instanceof Error) {
        throw new PALValidationError(
          `Invalid YAML syntax in ${source}: ${error.message}`,
          {
            source,
            yamlError: error.message,
          }
        );
      }
      throw error;
    }
  }

  /**
   * Check if string is a URL
   */
  private isURL(str: string): boolean {
    try {
      const url = new URL(str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }
}
