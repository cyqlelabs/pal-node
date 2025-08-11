/**
 * Base PAL error class
 */
export class PALError extends Error {
  public context: Record<string, unknown> | undefined;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error for PAL schema violations
 */
export class PALValidationError extends PALError {}

/**
 * Load error for file/URL loading failures
 */
export class PALLoadError extends PALError {}

/**
 * Resolver error for dependency resolution issues
 */
export class PALResolverError extends PALError {}

/**
 * Compiler error for template compilation issues
 */
export class PALCompilerError extends PALError {}

/**
 * Executor error for LLM execution failures
 */
export class PALExecutorError extends PALError {}

/**
 * Missing variable error for template variables
 */
export class PALMissingVariableError extends PALCompilerError {}

/**
 * Missing component error for component references
 */
export class PALMissingComponentError extends PALCompilerError {}

/**
 * Circular dependency error for import cycles
 */
export class PALCircularDependencyError extends PALResolverError {}
