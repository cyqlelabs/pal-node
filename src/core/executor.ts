import { writeFile } from 'fs/promises';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { PALExecutorError } from '../exceptions/core.js';
import { ExecutionResult, PromptAssembly } from '../types/schema.js';

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
 * Mock LLM client for testing
 */
export class MockLLMClient implements LLMClient {
  private response: string;
  private callCount = 0;
  private lastPrompt = '';
  private lastModel = '';

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
 * OpenAI API client
 */
export class OpenAIClient implements LLMClient {
  private client: OpenAI;

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
 * Anthropic API client
 */
export class AnthropicClient implements LLMClient {
  private client: Anthropic;

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
 * Executes compiled prompts with LLM clients and provides observability
 */
export class PromptExecutor {
  private llmClient: LLMClient;
  private logFile: string | undefined;
  private executionHistory: ExecutionResult[] = [];

  constructor(llmClient: LLMClient, logFile?: string) {
    this.llmClient = llmClient;
    this.logFile = logFile;
  }

  /**
   * Execute a compiled prompt and return structured results
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
        costUsd: this.estimateCost(
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
   * Estimate cost based on token counts (rough estimates)
   */
  private estimateCost(
    model: string,
    inputTokens?: number,
    outputTokens?: number
  ): number | undefined {
    if (!inputTokens || !outputTokens) {
      return undefined;
    }

    // Rough cost estimates per 1K tokens (as of 2024)
    const costTable: Record<string, { input: number; output: number }> = {
      // OpenAI models
      'gpt-4': { input: 0.03, output: 0.06 },
      'gpt-4-turbo': { input: 0.01, output: 0.03 },
      'gpt-3.5-turbo': { input: 0.0015, output: 0.002 },
      // Anthropic models
      'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
      'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 },
      'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
    };

    // Find matching model (prefix matching)
    let modelCosts: { input: number; output: number } | undefined;
    for (const [modelKey, costs] of Object.entries(costTable)) {
      if (model.startsWith(modelKey)) {
        modelCosts = costs;
        break;
      }
    }

    if (!modelCosts) {
      return undefined; // Unknown model
    }

    const inputCost = (inputTokens / 1000) * modelCosts.input;
    const outputCost = (outputTokens / 1000) * modelCosts.output;

    return inputCost + outputCost;
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
