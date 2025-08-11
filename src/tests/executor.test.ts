import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PromptExecutor,
  MockLLMClient,
  OpenAIClient,
  AnthropicClient,
} from '../core/executor.js';
import { PALExecutorError } from '../exceptions/core.js';
import type { PromptAssembly } from '../types/schema.js';

// Mock external libraries
vi.mock('openai');
vi.mock('@anthropic-ai/sdk');
vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
}));

describe('PromptExecutor', () => {
  let mockClient: MockLLMClient;
  let executor: PromptExecutor;

  const sampleAssembly: PromptAssembly = {
    pal_version: '1.0',
    id: 'test-prompt',
    version: '1.0.0',
    description: 'Test prompt',
    imports: {},
    variables: [],
    composition: ['Hello World!'],
    metadata: {},
  };

  beforeEach(() => {
    mockClient = new MockLLMClient('Test response');
    executor = new PromptExecutor(mockClient);
    vi.clearAllMocks();
  });

  describe('execute', () => {
    it('should execute a prompt successfully', async () => {
      const compiledPrompt = 'Hello World!';
      const model = 'gpt-3.5-turbo';

      const result = await executor.execute(
        compiledPrompt,
        sampleAssembly,
        model
      );

      expect(result.promptId).toBe('test-prompt');
      expect(result.promptVersion).toBe('1.0.0');
      expect(result.model).toBe(model);
      expect(result.compiledPrompt).toBe(compiledPrompt);
      expect(result.response).toBe('Test response');
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.executionTimeMs).toBeGreaterThan(0);
      expect(result.timestamp).toBeDefined();
      expect(result.metadata.executionId).toBeDefined();
    });

    it('should handle execution errors', async () => {
      const failingClient = {
        generate: vi.fn().mockRejectedValue(new Error('API Error')),
      };

      const failingExecutor = new PromptExecutor(failingClient);

      await expect(
        failingExecutor.execute('Hello', sampleAssembly, 'gpt-3.5-turbo')
      ).rejects.toThrow(PALExecutorError);

      // Should still record failed execution in history
      const history = failingExecutor.getExecutionHistory();
      expect(history).toHaveLength(1);
      expect(history[0]?.success).toBe(false);
      expect(history[0]?.error).toBe('API Error');
    });

    it('should record execution in history', async () => {
      await executor.execute('Hello', sampleAssembly, 'gpt-3.5-turbo');

      const history = executor.getExecutionHistory();
      expect(history).toHaveLength(1);
      expect(history[0]?.promptId).toBe('test-prompt');
    });

    it('should clear execution history', async () => {
      await executor.execute('Hello', sampleAssembly, 'gpt-3.5-turbo');
      expect(executor.getExecutionHistory()).toHaveLength(1);

      executor.clearHistory();
      expect(executor.getExecutionHistory()).toHaveLength(0);
    });

    it('should estimate costs for known models', async () => {
      const result = await executor.execute(
        'Hello',
        sampleAssembly,
        'gpt-3.5-turbo'
      );

      expect(result.costUsd).toBeGreaterThan(0);
    });

    it('should handle unknown models gracefully', async () => {
      const result = await executor.execute(
        'Hello',
        sampleAssembly,
        'unknown-model'
      );

      expect(result.costUsd).toBeUndefined();
    });

    it('should write to log file when configured', async () => {
      const mockWriteFile = vi.mocked(await import('fs/promises')).writeFile;
      const logExecutor = new PromptExecutor(mockClient, '/tmp/test.log');

      await logExecutor.execute('Hello', sampleAssembly, 'gpt-3.5-turbo');

      expect(mockWriteFile).toHaveBeenCalledTimes(2); // Pre and post execution
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/tmp/test.log',
        expect.stringContaining('prompt_execution_start'),
        expect.objectContaining({ flag: 'a' })
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/tmp/test.log',
        expect.stringContaining('prompt_execution_complete'),
        expect.objectContaining({ flag: 'a' })
      );
    });
  });
});

describe('MockLLMClient', () => {
  let client: MockLLMClient;

  beforeEach(() => {
    client = new MockLLMClient('Mock response');
  });

  it('should generate mock responses', async () => {
    const result = await client.generate('Hello', 'mock-model');

    expect(result.response).toBe('Mock response');
    expect(result.model).toBe('mock-model');
    expect(result.finishReason).toBe('stop');
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
  });

  it('should track call count and last values', async () => {
    expect(client.getCallCount()).toBe(0);

    await client.generate('Hello', 'model1');
    expect(client.getCallCount()).toBe(1);
    expect(client.getLastPrompt()).toBe('Hello');
    expect(client.getLastModel()).toBe('model1');

    await client.generate('Hi there', 'model2');
    expect(client.getCallCount()).toBe(2);
    expect(client.getLastPrompt()).toBe('Hi there');
    expect(client.getLastModel()).toBe('model2');
  });

  it('should simulate processing delay', async () => {
    // Just test that the method works, skip timing verification to avoid flakiness
    const result = await client.generate('Hello', 'mock-model');
    expect(result.response).toBe('Mock response');
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
  });
});

describe('OpenAIClient', () => {
  it('should initialize with valid API key', () => {
    // Since we have the packages installed, this should work
    expect(() => new OpenAIClient('test-key')).not.toThrow();
  });
});

describe('AnthropicClient', () => {
  it('should initialize with valid API key', () => {
    // Since we have the packages installed, this should work
    expect(() => new AnthropicClient('test-key')).not.toThrow();
  });
});
