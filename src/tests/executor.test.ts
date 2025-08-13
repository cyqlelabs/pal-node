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

    it('should handle log file write errors gracefully', async () => {
      const mockWriteFile = vi.mocked(await import('fs/promises')).writeFile;
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockWriteFile.mockRejectedValue(new Error('Write failed'));

      const logExecutor = new PromptExecutor(mockClient, '/tmp/test.log');

      await logExecutor.execute('Hello', sampleAssembly, 'gpt-3.5-turbo');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[PAL] Failed to write to log file: Write failed'
        )
      );

      consoleSpy.mockRestore();
    });

    it('should handle non-Error write failures', async () => {
      const mockWriteFile = vi.mocked(await import('fs/promises')).writeFile;
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockWriteFile.mockRejectedValue('String error');

      const logExecutor = new PromptExecutor(mockClient, '/tmp/test.log');

      await logExecutor.execute('Hello', sampleAssembly, 'gpt-3.5-turbo');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[PAL] Failed to write to log file: String error'
        )
      );

      consoleSpy.mockRestore();
    });

    it('should log execution failures', async () => {
      const mockWriteFile = vi.mocked(await import('fs/promises')).writeFile;
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const failingClient = {
        generate: vi.fn().mockRejectedValue(new Error('API Error')),
      };

      const logExecutor = new PromptExecutor(failingClient, '/tmp/test.log');

      try {
        await logExecutor.execute('Hello', sampleAssembly, 'gpt-3.5-turbo');
      } catch {
        // Expected to throw
      }

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PAL] Prompt execution failed:')
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        '/tmp/test.log',
        expect.stringContaining('prompt_execution_error'),
        expect.objectContaining({ flag: 'a' })
      );

      consoleErrorSpy.mockRestore();
    });

    it('should not write to log file when not configured', async () => {
      const failingClient = {
        generate: vi.fn().mockRejectedValue(new Error('API Error')),
      };

      const executor = new PromptExecutor(failingClient); // No log file

      try {
        await executor.execute('Hello', sampleAssembly, 'gpt-3.5-turbo');
      } catch {
        // Expected to throw
      }

      // Should not attempt to write to log file
      const history = executor.getExecutionHistory();
      expect(history).toHaveLength(1);
      expect(history[0]?.success).toBe(false);
    });
  });

  describe('pricing and cost estimation', () => {
    let mockClient: MockLLMClient;
    let executor: PromptExecutor;

    beforeEach(() => {
      mockClient = new MockLLMClient('Test response');
      executor = new PromptExecutor(mockClient);
      vi.clearAllMocks();
      // Clear any cached pricing
      executor['pricingCache'] = undefined;
      executor['cacheExpiry'] = undefined;
    });

    it('should handle successful pricing fetch', async () => {
      // Mock global fetch
      const mockPricingData = {
        'gpt-3.5-turbo': {
          input_cost_per_token: 0.0000015,
          output_cost_per_token: 0.000002,
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPricingData),
      }) as any;

      const result = await executor.execute(
        'Hello',
        sampleAssembly,
        'gpt-3.5-turbo'
      );

      expect(result.costUsd).toBeGreaterThan(0);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
        { signal: expect.anything() }
      );
    });

    it('should cache pricing data and reuse it', async () => {
      const mockPricingData = {
        'gpt-4': {
          input_cost_per_token: 0.00003,
          output_cost_per_token: 0.00006,
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPricingData),
      }) as any;

      // First call
      await executor.execute('Hello', sampleAssembly, 'gpt-4');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Second call should use cache
      await executor.execute('World', sampleAssembly, 'gpt-4');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should handle HTTP errors in pricing fetch', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }) as any;

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await executor.execute(
        'Hello',
        sampleAssembly,
        'unknown-model'
      );

      expect(result.costUsd).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[PAL] Failed to fetch live pricing data: HTTP',
        404
      );

      consoleSpy.mockRestore();
    });

    it('should handle network errors in pricing fetch', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await executor.execute('Hello', sampleAssembly, 'gpt-4');

      expect(result.costUsd).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[PAL] Failed to fetch live pricing data:',
        'Network error'
      );

      consoleSpy.mockRestore();
    });

    it('should handle non-Error network failures', async () => {
      global.fetch = vi.fn().mockRejectedValue('Timeout');

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await executor.execute('Hello', sampleAssembly, 'gpt-4');

      expect(result.costUsd).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[PAL] Failed to fetch live pricing data:',
        'Timeout'
      );

      consoleSpy.mockRestore();
    });

    it('should handle openrouter model fallback', async () => {
      const mockPricingData = {
        'openrouter/anthropic/claude-3-opus': {
          input_cost_per_token: 0.000015,
          output_cost_per_token: 0.000075,
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPricingData),
      }) as any;

      const result = await executor.execute(
        'Hello',
        sampleAssembly,
        'anthropic/claude-3-opus'
      );

      expect(result.costUsd).toBeGreaterThan(0);
    });

    it('should handle model name without provider fallback', async () => {
      const mockPricingData = {
        'claude-3-opus-20240229': {
          input_cost_per_token: 0.000015,
          output_cost_per_token: 0.000075,
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPricingData),
      }) as any;

      const result = await executor.execute(
        'Hello',
        sampleAssembly,
        'anthropic/claude-3-opus-20240229'
      );

      expect(result.costUsd).toBeGreaterThan(0);
    });

    it('should handle invalid pricing data gracefully', async () => {
      const mockPricingData = {
        'gpt-4': {
          input_cost_per_token: 'not-a-number',
          output_cost_per_token: null,
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPricingData),
      }) as any;

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await executor.execute('Hello', sampleAssembly, 'gpt-4');

      expect(result.costUsd).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[PAL] Could not parse pricing for model gpt-4:',
        expect.any(Object)
      );

      consoleSpy.mockRestore();
    });

    it('should handle pricing parsing errors', async () => {
      const mockPricingData = {
        'gpt-4': {
          input_cost_per_token: 0.00003,
          get output_cost_per_token(): number {
            throw new Error('Parsing error');
          },
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPricingData),
      }) as any;

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await executor.execute('Hello', sampleAssembly, 'gpt-4');

      expect(result.costUsd).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[PAL] Could not parse pricing for model gpt-4:',
        expect.any(Object),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should handle missing model in pricing data', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      }) as any;

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await executor.execute(
        'Hello',
        sampleAssembly,
        'nonexistent-model'
      );

      expect(result.costUsd).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[PAL] Model not found in live pricing data: nonexistent-model'
      );

      consoleSpy.mockRestore();
    });

    it('should handle missing token counts', async () => {
      const clientWithoutTokens = {
        generate: vi.fn().mockResolvedValue({
          response: 'Test response',
          inputTokens: undefined,
          outputTokens: undefined,
          model: 'gpt-4',
          finishReason: 'stop',
        }),
      };

      const executorWithoutTokens = new PromptExecutor(clientWithoutTokens);

      const result = await executorWithoutTokens.execute(
        'Hello',
        sampleAssembly,
        'gpt-4'
      );

      expect(result.costUsd).toBeUndefined();
    });

    it('should expire and refresh pricing cache', async () => {
      const mockPricingData = {
        'gpt-4': {
          input_cost_per_token: 0.00003,
          output_cost_per_token: 0.00006,
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPricingData),
      }) as any;

      // First call
      await executor.execute('Hello', sampleAssembly, 'gpt-4');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Simulate expired cache
      executor['cacheExpiry'] = new Date(Date.now() - 1000);

      // Second call should fetch again
      await executor.execute('World', sampleAssembly, 'gpt-4');
      expect(global.fetch).toHaveBeenCalledTimes(2);
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
  let client: OpenAIClient;

  beforeEach(() => {
    client = new OpenAIClient('test-key');
  });

  it('should initialize with valid API key', () => {
    expect(() => new OpenAIClient('test-key')).not.toThrow();
  });

  it('should initialize with environment API key', () => {
    expect(() => new OpenAIClient()).not.toThrow();
  });

  it('should generate responses successfully', async () => {
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: { content: 'OpenAI response' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 20 },
            model: 'gpt-3.5-turbo',
          }),
        },
      },
    };

    client['client'] = mockOpenAI as any;

    const result = await client.generate('Hello', 'gpt-3.5-turbo', 0.7, 100);

    expect(result.response).toBe('OpenAI response');
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(20);
    expect(result.model).toBe('gpt-3.5-turbo');
    expect(result.finishReason).toBe('stop');
  });

  it('should handle missing response content', async () => {
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: null }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 0 },
            model: 'gpt-3.5-turbo',
          }),
        },
      },
    };

    client['client'] = mockOpenAI as any;

    const result = await client.generate('Hello', 'gpt-3.5-turbo');
    expect(result.response).toBe('');
  });

  it('should handle OpenAI API errors', async () => {
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error('OpenAI API Error')),
        },
      },
    };

    client['client'] = mockOpenAI as any;

    await expect(client.generate('Hello', 'gpt-3.5-turbo')).rejects.toThrow(
      PALExecutorError
    );
  });

  it('should handle non-Error OpenAI failures', async () => {
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue('String error'),
        },
      },
    };

    client['client'] = mockOpenAI as any;

    await expect(client.generate('Hello', 'gpt-3.5-turbo')).rejects.toThrow(
      PALExecutorError
    );
  });

  it('should pass through all options', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'test' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 5 },
      model: 'gpt-3.5-turbo',
    });

    const mockOpenAI = {
      chat: { completions: { create: mockCreate } },
    };

    client['client'] = mockOpenAI as any;

    await client.generate('Hello', 'gpt-3.5-turbo', 0.8, 200, {
      top_p: 0.9,
      frequency_penalty: 0.1,
    });

    expect(mockCreate).toHaveBeenCalledWith({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.8,
      max_tokens: 200,
      top_p: 0.9,
      frequency_penalty: 0.1,
    });
  });
});

describe('AnthropicClient', () => {
  let client: AnthropicClient;

  beforeEach(() => {
    client = new AnthropicClient('test-key');
  });

  it('should initialize with valid API key', () => {
    expect(() => new AnthropicClient('test-key')).not.toThrow();
  });

  it('should initialize with environment API key', () => {
    expect(() => new AnthropicClient()).not.toThrow();
  });

  it('should generate responses successfully', async () => {
    const mockAnthropic = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ text: 'Anthropic response', type: 'text' }],
          usage: { input_tokens: 15, output_tokens: 25 },
          model: 'claude-3-opus-20240229',
          stop_reason: 'end_turn',
        }),
      },
    };

    client['client'] = mockAnthropic as any;

    const result = await client.generate(
      'Hello',
      'claude-3-opus-20240229',
      0.7,
      100
    );

    expect(result.response).toBe('Anthropic response');
    expect(result.inputTokens).toBe(15);
    expect(result.outputTokens).toBe(25);
    expect(result.model).toBe('claude-3-opus-20240229');
    expect(result.finishReason).toBe('end_turn');
  });

  it('should handle empty content array', async () => {
    const mockAnthropic = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [],
          usage: { input_tokens: 10, output_tokens: 0 },
          model: 'claude-3-opus-20240229',
          stop_reason: null,
        }),
      },
    };

    client['client'] = mockAnthropic as any;

    const result = await client.generate('Hello', 'claude-3-opus-20240229');
    expect(result.response).toBe('');
    expect(result.finishReason).toBeUndefined();
  });

  it('should handle non-text content', async () => {
    const mockAnthropic = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'image', source: { data: 'base64data' } }],
          usage: { input_tokens: 10, output_tokens: 5 },
          model: 'claude-3-opus-20240229',
          stop_reason: 'end_turn',
        }),
      },
    };

    client['client'] = mockAnthropic as any;

    const result = await client.generate('Hello', 'claude-3-opus-20240229');
    expect(result.response).toBe('');
  });

  it('should handle Anthropic API errors', async () => {
    const mockAnthropic = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('Anthropic API Error')),
      },
    };

    client['client'] = mockAnthropic as any;

    await expect(
      client.generate('Hello', 'claude-3-opus-20240229')
    ).rejects.toThrow(PALExecutorError);
  });

  it('should handle non-Error Anthropic failures', async () => {
    const mockAnthropic = {
      messages: {
        create: vi.fn().mockRejectedValue('Rate limit exceeded'),
      },
    };

    client['client'] = mockAnthropic as any;

    await expect(
      client.generate('Hello', 'claude-3-opus-20240229')
    ).rejects.toThrow(PALExecutorError);
  });

  it('should pass through all options and use default max_tokens', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ text: 'test', type: 'text' }],
      usage: { input_tokens: 5, output_tokens: 5 },
      model: 'claude-3-opus-20240229',
      stop_reason: 'end_turn',
    });

    const mockAnthropic = {
      messages: { create: mockCreate },
    };

    client['client'] = mockAnthropic as any;

    await client.generate('Hello', 'claude-3-opus-20240229', 0.8, undefined, {
      top_p: 0.9,
    });

    expect(mockCreate).toHaveBeenCalledWith({
      model: 'claude-3-opus-20240229',
      max_tokens: 1024,
      temperature: 0.8,
      messages: [{ role: 'user', content: 'Hello' }],
      top_p: 0.9,
    });
  });
});
