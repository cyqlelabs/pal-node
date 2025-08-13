import nunjucks, { Environment } from 'nunjucks';
import {
  PALCompilerError,
  PALMissingComponentError,
  PALMissingVariableError,
} from '../exceptions/core.js';
import {
  ComponentLibrary,
  PALVariable,
  PromptAssembly,
  VariableTypeValue,
} from '../types/schema.js';
import { Loader } from './loader.js';
import { Resolver, ResolverCache } from './resolver.js';

/**
 * Custom Nunjucks loader for PAL components
 */
class ComponentTemplateLoader extends nunjucks.FileSystemLoader {
  private resolvedLibraries: Record<string, ComponentLibrary>;

  constructor(resolvedLibraries: Record<string, ComponentLibrary>) {
    super([]); // Empty searchpaths since we handle resolution manually
    this.resolvedLibraries = resolvedLibraries;
  }

  getSource(name: string): nunjucks.LoaderSource {
    if (!name.includes('.')) {
      throw new Error(
        `Component reference must be in format 'alias.component', got: ${name}`
      );
    }

    const [alias, componentName] = name.split('.', 2);

    if (!alias || !componentName) {
      throw new Error(
        `Invalid component reference format. Expected 'alias.component', got: ${name}`
      );
    }

    if (!this.resolvedLibraries[alias]) {
      throw new Error(`Unknown import alias: ${alias}`);
    }

    const library = this.resolvedLibraries[alias];
    const component = library.components.find(
      (c: any) => c.name === componentName
    );

    if (!component) {
      const available = library.components.map((c: any) => c.name);
      throw new Error(
        `Component '${componentName}' not found in library '${alias}'. Available: ${available.join(', ')}`
      );
    }

    return {
      src: component.content,
      path: name,
      noCache: true,
    };
  }
}

/**
 * Compiles PAL prompt assemblies into executable prompt strings.
 *
 * The PromptCompiler is responsible for transforming PAL prompt assemblies
 * into fully rendered prompt strings ready for LLM execution. It handles:
 *
 * - Template variable resolution and type checking
 * - Component library imports and dependencies
 * - Nunjucks template compilation with custom loaders
 * - Variable validation and default value assignment
 *
 * @example
 * ```typescript
 * const compiler = new PromptCompiler();
 * const prompt = await compiler.compileFromFile(
 *   'prompts/api_design.pal',
 *   { api_name: 'UserService', requirements: ['REST', 'JSON'] }
 * );
 * console.log(prompt);
 * ```
 */
export class PromptCompiler {
  private loader: Loader;
  private resolver: Resolver;

  /**
   * Initialize the compiler.
   *
   * @param loader - Optional Loader instance. If not provided, a default Loader is created.
   */
  constructor(loader?: Loader) {
    this.loader = loader || new Loader();
    this.resolver = new Resolver(this.loader, new ResolverCache());
  }

  /**
   * Compile a PAL file into a prompt string.
   *
   * @param palFile - Path to the .pal file to compile
   * @param variables - Optional dictionary of variables to use in template rendering
   * @returns The compiled prompt string ready for LLM execution
   * @throws {PALLoadError} If the file cannot be loaded
   * @throws {PALMissingVariableError} If required variables are missing
   * @throws {PALCompilerError} If compilation fails
   *
   * @example
   * ```typescript
   * const compiler = new PromptCompiler();
   * const prompt = await compiler.compileFromFile(
   *   'code_review.pal',
   *   { language: 'python', code: 'def add(a, b): return a + b' }
   * );
   * console.log(prompt);
   * ```
   */
  async compileFromFile(
    palFile: string,
    variables?: Record<string, unknown>
  ): Promise<string> {
    const promptAssembly = await this.loader.loadPromptAssembly(palFile);
    return this.compile(promptAssembly, variables, palFile);
  }

  /**
   * Compile a prompt assembly into a final prompt string.
   *
   * This is the core compilation method that processes a PromptAssembly object,
   * resolves all dependencies, validates variables, and renders the final prompt.
   *
   * @param promptAssembly - The PromptAssembly object to compile
   * @param variables - Dictionary of variables for template rendering
   * @param basePath - Base path for resolving relative imports
   * @returns The fully compiled and rendered prompt string
   * @throws {PALMissingComponentError} If referenced components are not found
   * @throws {PALMissingVariableError} If required variables are missing
   * @throws {PALCompilerError} If template compilation fails
   */
  async compile(
    promptAssembly: PromptAssembly,
    variables?: Record<string, unknown>,
    basePath?: string
  ): Promise<string> {
    const vars = variables || {};

    // Resolve dependencies
    const resolvedLibraries = await this.resolver.resolveDependencies(
      promptAssembly,
      basePath
    );

    // Validate all component references exist
    const validationErrors = this.resolver.validateReferences(
      promptAssembly,
      resolvedLibraries
    );
    if (validationErrors.length > 0) {
      throw new PALMissingComponentError(
        `Missing component references in ${promptAssembly.id}`,
        { errors: validationErrors }
      );
    }

    // Validate required variables are provided
    const missingVars = this.checkMissingVariables(promptAssembly, vars);
    if (missingVars.length > 0) {
      throw new PALMissingVariableError(
        `Missing required variables for ${promptAssembly.id}: ${missingVars.join(', ')}`,
        { missingVariables: missingVars }
      );
    }

    // Type check and convert variables
    const typedVariables = this.typeCheckVariables(promptAssembly, vars);

    // Create Nunjucks environment
    const env = this.createNunjucksEnvironment(resolvedLibraries);

    // Build context for templating
    const context = this.buildTemplateContext(
      resolvedLibraries,
      typedVariables
    );

    // Join composition items and compile as a single template
    const fullComposition = promptAssembly.composition.join('\n');

    try {
      const compiledPrompt = env.renderString(fullComposition, context);
      return this.cleanCompiledPrompt(compiledPrompt);
    } catch (error) {
      if (error instanceof Error) {
        throw new PALCompilerError(
          `Template error in composition: ${error.message}`,
          {
            composition:
              fullComposition.length > 500
                ? fullComposition.substring(0, 500) + '...'
                : fullComposition,
            error: error.message,
            promptId: promptAssembly.id,
          }
        );
      }
      throw error;
    }
  }

  /**
   * Check for missing required variables
   */
  private checkMissingVariables(
    promptAssembly: PromptAssembly,
    providedVars: Record<string, unknown>
  ): string[] {
    const missing: string[] = [];

    for (const varDef of promptAssembly.variables) {
      if (
        varDef.required &&
        !(varDef.name in providedVars) &&
        varDef.default === undefined
      ) {
        missing.push(varDef.name);
      }
    }

    return missing;
  }

  /**
   * Type check and convert variables according to their definitions
   */
  private typeCheckVariables(
    promptAssembly: PromptAssembly,
    variables: Record<string, unknown>
  ): Record<string, unknown> {
    const typedVars: Record<string, unknown> = {};
    const varDefs = new Map(promptAssembly.variables.map((v) => [v.name, v]));

    // Process provided variables
    for (const [name, value] of Object.entries(variables)) {
      const varDef = varDefs.get(name);
      if (varDef) {
        try {
          typedVars[name] = this.convertVariable(value, varDef.type);
        } catch {
          throw new PALCompilerError(
            `Type error for variable '${name}': expected ${varDef.type}, got ${typeof value}`,
            {
              variable: name,
              expectedType: varDef.type,
              actualType: typeof value,
              value: String(value),
            }
          );
        }
      } else {
        // Variable not defined in schema, pass through as-is
        typedVars[name] = value;
      }
    }

    // Add defaults for missing variables
    this.addDefaultVariables(promptAssembly.variables, typedVars);

    return typedVars;
  }

  /**
   * Add default values for missing variables
   */
  private addDefaultVariables(
    varDefinitions: PALVariable[],
    typedVars: Record<string, unknown>
  ): void {
    const defaultValues: Record<VariableTypeValue, unknown> = {
      string: '',
      list: [],
      dict: {},
      boolean: false,
      integer: 0,
      float: 0.0,
      any: null,
    };

    for (const varDef of varDefinitions) {
      if (!(varDef.name in typedVars)) {
        if (varDef.default !== undefined) {
          typedVars[varDef.name] = varDef.default;
        } else if (!varDef.required) {
          typedVars[varDef.name] = defaultValues[varDef.type];
        }
      }
    }
  }

  /**
   * Convert a variable to the specified type
   */
  private convertVariable(value: unknown, varType: VariableTypeValue): unknown {
    switch (varType) {
      case 'any':
        return value;
      case 'string':
        return String(value);
      case 'integer':
        return this.convertToInt(value);
      case 'float':
        return this.convertToFloat(value);
      case 'boolean':
        return this.convertToBool(value);
      case 'list':
        return this.convertToList(value);
      case 'dict':
        return this.convertToDict(value);
      default:
        throw new Error(`Unknown variable type: ${varType}`);
    }
  }

  /**
   * Convert value to integer
   */
  private convertToInt(value: unknown): number {
    if (typeof value === 'boolean') {
      throw new TypeError('Boolean cannot be converted to integer');
    }
    const num = Number(value);
    if (!Number.isInteger(num)) {
      throw new TypeError(`Cannot convert ${typeof value} to integer`);
    }
    return num;
  }

  /**
   * Convert value to float
   */
  private convertToFloat(value: unknown): number {
    if (typeof value === 'boolean') {
      throw new TypeError('Boolean cannot be converted to float');
    }
    const num = Number(value);
    if (Number.isNaN(num)) {
      throw new TypeError(`Cannot convert ${typeof value} to float`);
    }
    return num;
  }

  /**
   * Convert value to boolean
   */
  private convertToBool(value: unknown): boolean {
    if (typeof value === 'string') {
      const lowerVal = value.toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(lowerVal)) {
        return true;
      }
      if (['false', '0', 'no', 'off'].includes(lowerVal)) {
        return false;
      }
      throw new Error(`Cannot convert string '${value}' to boolean`);
    }
    return Boolean(value);
  }

  /**
   * Convert value to list
   */
  private convertToList(value: unknown): unknown[] {
    if (!Array.isArray(value)) {
      throw new TypeError(`Expected array, got ${typeof value}`);
    }
    return value;
  }

  /**
   * Convert value to dict
   */
  private convertToDict(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError(`Expected object, got ${typeof value}`);
    }
    return value as Record<string, unknown>;
  }

  /**
   * Create a configured Nunjucks environment
   */
  private createNunjucksEnvironment(
    resolvedLibraries: Record<string, ComponentLibrary>
  ): Environment {
    const loader = new ComponentTemplateLoader(resolvedLibraries);

    const env = new Environment(loader, {
      autoescape: false,
      throwOnUndefined: true,
      trimBlocks: true,
      lstripBlocks: true,
    });

    // Add custom filters
    env.addFilter('upper', (str: string) => str.toUpperCase());
    env.addFilter('lower', (str: string) => str.toLowerCase());
    env.addFilter('title', (str: string) =>
      str.replace(
        /\w\S*/g,
        (txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase()
      )
    );

    return env;
  }

  /**
   * Build the context for Nunjucks templating
   */
  private buildTemplateContext(
    resolvedLibraries: Record<string, ComponentLibrary>,
    variables: Record<string, unknown>
  ): Record<string, unknown> {
    const context = { ...variables };

    // Add component access via aliases
    for (const [alias, library] of Object.entries(resolvedLibraries)) {
      const componentDict: Record<string, string> = {};
      for (const component of library.components) {
        componentDict[component.name] = component.content;
      }
      context[alias] = componentDict;
    }

    return context;
  }

  /**
   * Clean up the compiled prompt string
   */
  private cleanCompiledPrompt(prompt: string): string {
    // Remove excessive blank lines (more than 2 consecutive)
    const cleaned = prompt.replace(/\n\s*\n\s*\n+/g, '\n\n');

    // Strip leading and trailing whitespace
    return cleaned.trim();
  }

  /**
   * Analyze and extract undeclared template variables from the composition.
   *
   * This method helps identify which variables are referenced in the template
   * but not explicitly declared in the variables section. Useful for debugging
   * and validation.
   *
   * @param promptAssembly - The PromptAssembly to analyze
   * @returns Set of undeclared variable names found in the composition
   *
   * @example
   * ```typescript
   * const compiler = new PromptCompiler();
   * const loader = new Loader();
   * const assembly = await loader.loadPromptAssembly('prompt.pal');
   * const undeclared = compiler.analyzeTemplateVariables(assembly);
   * console.log(`Undeclared variables: ${Array.from(undeclared)}`);
   * ```
   */
  analyzeTemplateVariables(promptAssembly: PromptAssembly): Set<string> {
    const variables = new Set<string>();
    const fullComposition = promptAssembly.composition.join('\n');

    // Simple regex to find Nunjucks variables
    const variableRegex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g;
    let match;

    const importAliases = new Set(Object.keys(promptAssembly.imports));
    const definedVars = new Set(promptAssembly.variables.map((v) => v.name));

    while ((match = variableRegex.exec(fullComposition)) !== null) {
      const variable = match[1];

      if (!variable) {
        continue;
      }

      if (importAliases.has(variable)) {
        // Skip import aliases
        continue;
      }

      if (definedVars.has(variable)) {
        // Skip defined variables
        continue;
      }

      if (variable.includes('.')) {
        // This is a dotted reference like "alias.component"
        const alias = variable.split('.')[0];
        if (alias && !importAliases.has(alias)) {
          variables.add(variable);
        }
      } else {
        // This is a simple variable that's truly undeclared
        variables.add(variable);
      }
    }

    return variables;
  }
}
