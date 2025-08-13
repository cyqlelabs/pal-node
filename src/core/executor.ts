import { writeFile } from 'fs/promises';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { PALExecutorError } from '../exceptions/core.js';
import { ExecutionResult, PromptAssembly } from '../types/schema.js';

// AbortSignal is available globally in Node.js 16+, but we need to reference it for ESLint
declare const AbortSignal: typeof globalThis.AbortSignal;

/**
 * Base interface for LLM clients
 */
export interface LLMClient {
  generate(
    prompt: string,
    model: string,
    temperature?: number,
    maxTokens?: number,
    options?: Record<string, unknown>
  ): Promise<{
    response: string;
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    model: string;
    finishReason: string | undefined;
  }>;
}

/**
 * Mock LLM client for testing and development.
 *
 * Provides a mock implementation of the LLM client interface for testing
 * PAL prompts without making actual API calls. Useful for unit tests and
 * local development.
 *
 * @example
 * ```typescript
 * const mockClient = new MockLLMClient('Test response');
 * const executor = new PromptExecutor(mockClient);
 * const result = await executor.execute(assembly, variables);
 * console.log(result.response); // "Test response"
 * ```
 */
export class MockLLMClient implements LLMClient {
  private response: string;
  private callCount = 0;
  private lastPrompt = '';
  private lastModel = '';

  /**
   * Initialize the mock client.
   *
   * @param response - The mock response string to return from generate()
   */
  constructor(response = 'Mock response') {
    this.response = response;
  }

  async generate(
    prompt: string,
    model: string,
    _temperature = 0.7,
    _maxTokens?: number,
    _options?: Record<string, unknown>
  ): Promise<{
    response: string;
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    model: string;
    finishReason: string | undefined;
  }> {
    this.callCount++;
    this.lastPrompt = prompt;
    this.lastModel = model;

    // Simulate some processing time
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      response: this.response,
      inputTokens: Math.floor(prompt.split(' ').length * 1.3), // Rough estimate
      outputTokens: Math.floor(this.response.split(' ').length * 1.3),
      model,
      finishReason: 'stop' as const,
    };
  }

  getCallCount(): number {
    return this.callCount;
  }

  getLastPrompt(): string {
    return this.lastPrompt;
  }

  getLastModel(): string {
    return this.lastModel;
  }
}

/**
 * OpenAI API client for GPT model integration.
 *
 * Implements the LLM client interface for OpenAI's GPT models. Requires
 * the 'openai' package to be installed.
 *
 * @example
 * ```typescript
 * const client = new OpenAIClient('sk-...');
 * const executor = new PromptExecutor(client);
 * const result = await executor.execute(
 *   compiledPrompt,
 *   assembly,
 *   'gpt-4',
 *   0.7,
 *   2000
 * );
 * console.log(result.response);
 * ```
 */
export class OpenAIClient implements LLMClient {
  private client: OpenAI;

  /**
   * Initialize the OpenAI client.
   *
   * @param apiKey - OpenAI API key. If not provided, will use OPENAI_API_KEY env var.
   * @throws {PALExecutorError} If the openai package is not installed
   */
  constructor(apiKey?: string) {
    try {
      this.client = new OpenAI({ apiKey });
    } catch (error) {
      throw new PALExecutorError(
        'Failed to initialize OpenAI client. Make sure openai package is installed.',
        { clientType: 'OpenAI', error: String(error) }
      );
    }
  }

  async generate(
    prompt: string,
    model: string,
    temperature = 0.7,
    maxTokens?: number,
    options: Record<string, unknown> = {}
  ): Promise<{
    response: string;
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    model: string;
    finishReason: string | undefined;
  }> {
    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        max_tokens: maxTokens || null,
        ...options,
      });

      const choice = response.choices[0];
      return {
        response: choice?.message?.content || '',
        inputTokens: response.usage?.prompt_tokens,
        outputTokens: response.usage?.completion_tokens,
        model: response.model,
        finishReason: choice?.finish_reason,
      };
    } catch (error) {
      throw new PALExecutorError(
        `OpenAI API error: ${error instanceof Error ? error.message : String(error)}`,
        { model, error: String(error) }
      );
    }
  }
}

/**
 * Anthropic API client for Claude model integration.
 *
 * Implements the LLM client interface for Anthropic's Claude models. Requires
 * the '@anthropic-ai/sdk' package to be installed.
 *
 * @example
 * ```typescript
 * const client = new AnthropicClient('sk-ant-...');
 * const executor = new PromptExecutor(client);
 * const result = await executor.execute(
 *   compiledPrompt,
 *   assembly,
 *   'claude-3-opus-20240229',
 *   0.7,
 *   1000
 * );
 * console.log(result.response);
 * ```
 */
export class AnthropicClient implements LLMClient {
  private client: Anthropic;

  /**
   * Initialize the Anthropic client.
   *
   * @param apiKey - Anthropic API key. If not provided, will use ANTHROPIC_API_KEY env var.
   * @throws {PALExecutorError} If the @anthropic-ai/sdk package is not installed
   */
  constructor(apiKey?: string) {
    try {
      this.client = new Anthropic({ apiKey });
    } catch (error) {
      throw new PALExecutorError(
        'Failed to initialize Anthropic client. Make sure @anthropic-ai/sdk package is installed.',
        { clientType: 'Anthropic', error: String(error) }
      );
    }
  }

  async generate(
    prompt: string,
    model: string,
    temperature = 0.7,
    maxTokens = 1024,
    options: Record<string, unknown> = {}
  ): Promise<{
    response: string;
    inputTokens: number | undefined;
    outputTokens: number | undefined;
    model: string;
    finishReason: string | undefined;
  }> {
    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: 'user', content: prompt }],
        ...options,
      });

      const content = response.content[0];
      const responseText = content && 'text' in content ? content.text : '';

      return {
        response: responseText,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        model: response.model as string,
        finishReason: response.stop_reason || undefined,
      };
    } catch (error) {
      throw new PALExecutorError(
        `Anthropic API error: ${error instanceof Error ? error.message : String(error)}`,
        { model, error: String(error) }
      );
    }
  }
}

/**
 * Executes compiled prompts with LLM clients and provides observability.
 *
 * The PromptExecutor handles the execution of compiled PAL prompts through
 * various LLM providers. It provides:
 *
 * - Unified interface for different LLM providers (OpenAI, Anthropic, etc.)
 * - Execution tracking and history management
 * - Structured logging and observability
 * - Error handling and retry logic
 * - Live pricing data for cost estimation
 *
 * @example
 * ```typescript
 * const client = new AnthropicClient('sk-ant-...');
 * const executor = new PromptExecutor(client);
 * const compiler = new PromptCompiler();
 * const compiled = await compiler.compileFromFile('prompt.pal');
 * const result = await executor.execute(
 *   compiled,
 *   assembly,
 *   'claude-3-opus-20240229',
 *   0.7
 * );
 * console.log(result.response);
 * ```
 */
export class PromptExecutor {
  private llmClient: LLMClient;
  private logFile: string | undefined;
  private executionHistory: ExecutionResult[] = [];
  private pricingCache: Record<string, unknown> | undefined;
  private cacheExpiry: Date | undefined;
  private readonly cacheTimeout = 5 * 60 * 1000; // 5 minutes in milliseconds
  private readonly pricingUrl =
    'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

  /**
   * Initialize the executor.
   *
   * @param llmClient - An LLM client instance (OpenAIClient, AnthropicClient, etc.)
   * @param logFile - Optional path to write execution logs in JSON format
   */
  constructor(llmClient: LLMClient, logFile?: string) {
    this.llmClient = llmClient;
    this.logFile = logFile;
  }

  /**
   * Execute a compiled prompt and return structured results.
   *
   * @param compiledPrompt - The compiled prompt string from PromptCompiler
   * @param promptAssembly - The original PromptAssembly object
   * @param model - Model identifier (e.g., "gpt-4", "claude-3-opus-20240229")
   * @param temperature - Sampling temperature (0.0 to 1.0)
   * @param maxTokens - Maximum tokens to generate
   * @param options - Additional model-specific parameters
   * @returns ExecutionResult containing the response and metadata
   * @throws {PALExecutorError} If the LLM API call fails
   *
   * @example
   * ```typescript
   * const result = await executor.execute(
   *   'Analyze this code...',
   *   assembly,
   *   'gpt-4',
   *   0.3,
   *   2000
   * );
   * console.log(result.response);
   * ```
   */
  async execute(
    compiledPrompt: string,
    promptAssembly: PromptAssembly,
    model: string,
    temperature = 0.7,
    maxTokens?: number,
    options: Record<string, unknown> = {}
  ): Promise<ExecutionResult> {
    const executionId = this.generateExecutionId();
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // Pre-execution logging
    await this.logPreExecution(
      executionId,
      promptAssembly,
      model,
      compiledPrompt,
      temperature,
      maxTokens,
      options
    );

    try {
      // Execute the prompt
      const responseData = await this.llmClient.generate(
        compiledPrompt,
        model,
        temperature,
        maxTokens,
        options
      );

      const executionTime = Date.now() - startTime;

      // Create execution result
      const result: ExecutionResult = {
        promptId: promptAssembly.id,
        promptVersion: promptAssembly.version,
        model,
        compiledPrompt,
        response: responseData.response,
        metadata: {
          executionId,
          temperature,
          maxTokens,
          finishReason: responseData.finishReason,
          ...options,
        },
        executionTimeMs: executionTime,
        inputTokens: responseData.inputTokens,
        outputTokens: responseData.outputTokens,
        costUsd: await this.estimateCost(
          model,
          responseData.inputTokens,
          responseData.outputTokens
        ),
        timestamp,
        success: true,
      };

      // Post-execution logging
      await this.logPostExecution(result);

      // Store in history
      this.executionHistory.push(result);

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Create error result
      const errorResult: ExecutionResult = {
        promptId: promptAssembly.id,
        promptVersion: promptAssembly.version,
        model,
        compiledPrompt,
        response: '',
        metadata: {
          executionId,
          temperature,
          maxTokens,
          ...options,
        },
        executionTimeMs: executionTime,
        timestamp,
        success: false,
        error: errorMessage,
      };

      // Log the error
      await this.logError(errorResult, error);

      // Store in history
      this.executionHistory.push(errorResult);

      throw new PALExecutorError(
        `Execution failed for ${promptAssembly.id}: ${errorMessage}`,
        {
          executionId,
          promptId: promptAssembly.id,
          model,
          error: errorMessage,
        }
      );
    }
  }

  /**
   * Log pre-execution information
   */
  private async logPreExecution(
    executionId: string,
    promptAssembly: PromptAssembly,
    model: string,
    compiledPrompt: string,
    temperature: number,
    maxTokens?: number,
    options?: Record<string, unknown>
  ): Promise<void> {
    const logData = {
      event: 'prompt_execution_start',
      executionId,
      promptId: promptAssembly.id,
      promptVersion: promptAssembly.version,
      model,
      temperature,
      maxTokens,
      compiledPromptLength: compiledPrompt.length,
      timestamp: new Date().toISOString(),
      ...options,
    };

    console.log(`[PAL] Starting prompt execution: ${executionId}`);

    if (this.logFile) {
      await this.writeToLogFile(logData);
    }
  }

  /**
   * Log post-execution information
   */
  private async logPostExecution(result: ExecutionResult): Promise<void> {
    const logData = {
      event: 'prompt_execution_complete',
      executionId: result.metadata.executionId,
      promptId: result.promptId,
      promptVersion: result.promptVersion,
      model: result.model,
      success: result.success,
      executionTimeMs: result.executionTimeMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
      responseLength: result.response.length,
      timestamp: result.timestamp,
    };

    console.log(
      `[PAL] Prompt execution completed: ${result.metadata.executionId} (${result.executionTimeMs}ms)`
    );

    if (this.logFile) {
      await this.writeToLogFile(logData);
    }
  }

  /**
   * Log execution errors
   */
  private async logError(
    result: ExecutionResult,
    error: unknown
  ): Promise<void> {
    const logData = {
      event: 'prompt_execution_error',
      executionId: result.metadata.executionId,
      promptId: result.promptId,
      model: result.model,
      error: String(error),
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      executionTimeMs: result.executionTimeMs,
      timestamp: result.timestamp,
    };

    console.error(
      `[PAL] Prompt execution failed: ${result.metadata.executionId} - ${String(error)}`
    );

    if (this.logFile) {
      await this.writeToLogFile(logData);
    }
  }

  /**
   * Write log data to file
   */
  private async writeToLogFile(data: Record<string, unknown>): Promise<void> {
    if (!this.logFile) {
      return;
    }

    try {
      const logLine = JSON.stringify(data) + '\n';
      await writeFile(this.logFile, logLine, { flag: 'a', encoding: 'utf-8' });
    } catch (error) {
      console.warn(
        `[PAL] Failed to write to log file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Fetch live pricing data from LiteLLM API with caching
   */
  private async fetchLivePricing(): Promise<
    Record<string, unknown> | undefined
  > {
    const now = new Date();

    if (this.pricingCache && this.cacheExpiry && now < this.cacheExpiry) {
      return this.pricingCache;
    }

    try {
      const response = await fetch(this.pricingUrl, {
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        console.warn(
          '[PAL] Failed to fetch live pricing data: HTTP',
          response.status
        );
        return undefined;
      }

      this.pricingCache = (await response.json()) as Record<string, unknown>;
      this.cacheExpiry = new Date(now.getTime() + this.cacheTimeout);
      console.log('[PAL] Fetched and cached live pricing data');
      return this.pricingCache;
    } catch (error) {
      console.warn(
        '[PAL] Failed to fetch live pricing data:',
        error instanceof Error ? error.message : String(error)
      );
      return undefined;
    }
  }

  /**
   * Estimate cost based on token counts using live pricing data
   */
  private async estimateCost(
    model: string,
    inputTokens?: number,
    outputTokens?: number
  ): Promise<number | undefined> {
    if (inputTokens == null || outputTokens == null) {
      return undefined;
    }

    const pricingData = await this.fetchLivePricing();
    if (!pricingData) {
      return undefined;
    }

    // Look for a direct match
    let modelPricing = pricingData[model] as
      | Record<string, unknown>
      | undefined;

    // Fallback for openrouter models
    if (!modelPricing) {
      const openrouterKey = `openrouter/${model}`;
      modelPricing = pricingData[openrouterKey] as
        | Record<string, unknown>
        | undefined;
    }

    // Fallback for models without provider prefix
    if (!modelPricing) {
      const [, ...modelNameParts] = model.split('/');
      if (modelNameParts.length > 0) {
        const modelName = modelNameParts.join('/');
        modelPricing = pricingData[modelName] as
          | Record<string, unknown>
          | undefined;
      }
    }

    if (modelPricing) {
      try {
        const inputCostPerToken = Number(modelPricing.input_cost_per_token);
        const outputCostPerToken = Number(modelPricing.output_cost_per_token);

        if (isNaN(inputCostPerToken) || isNaN(outputCostPerToken)) {
          console.warn(
            `[PAL] Could not parse pricing for model ${model}:`,
            modelPricing
          );
          return undefined;
        }

        const inputCost = inputTokens * inputCostPerToken;
        const outputCost = outputTokens * outputCostPerToken;
        return inputCost + outputCost;
      } catch (error) {
        console.warn(
          `[PAL] Could not parse pricing for model ${model}:`,
          modelPricing,
          error
        );
        return undefined;
      }
    }

    console.warn(`[PAL] Model not found in live pricing data: ${model}`);
    return undefined;
  }

  /**
   * Generate a unique execution ID
   */
  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get the execution history
   */
  getExecutionHistory(): ExecutionResult[] {
    return [...this.executionHistory];
  }

  /**
   * Clear the execution history
   */
  clearHistory(): void {
    this.executionHistory = [];
  }
}
