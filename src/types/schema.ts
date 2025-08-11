import { z } from 'zod';

/**
 * Valid component types in PAL libraries
 */
export const ComponentType = z.enum([
  'persona',
  'task',
  'context',
  'rules',
  'examples',
  'output_schema',
  'reasoning',
  'trait',
  'note',
]);

/**
 * Valid variable types in PAL
 */
export const VariableType = z.enum([
  'string',
  'integer',
  'float',
  'boolean',
  'list',
  'dict',
  'any',
]);

/**
 * PAL variable definition schema
 */
export const PALVariableSchema = z.object({
  name: z
    .string()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Must be a valid identifier'),
  type: VariableType,
  description: z.string(),
  required: z.boolean().default(true),
  default: z.any().optional(),
});

/**
 * PAL component definition schema
 */
export const PALComponentSchema = z.object({
  name: z
    .string()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Must be a valid identifier'),
  description: z.string(),
  content: z.string(),
  metadata: z.record(z.any()).default({}),
});

/**
 * Component library schema
 */
export const ComponentLibrarySchema = z
  .object({
    pal_version: z.literal('1.0'),
    library_id: z
      .string()
      .regex(/^[a-zA-Z0-9._-]+$/, 'Invalid library ID format'),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be semantic version'),
    description: z.string(),
    type: ComponentType,
    components: z.array(PALComponentSchema),
    metadata: z.record(z.any()).default({}),
  })
  .refine(
    (data) => {
      const names = data.components.map((c) => c.name);
      return names.length === new Set(names).size;
    },
    {
      message: 'Component names must be unique within the library',
      path: ['components'],
    }
  );

/**
 * Prompt assembly schema
 */
export const PromptAssemblySchema = z
  .object({
    pal_version: z.literal('1.0'),
    id: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Invalid assembly ID format'),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be semantic version'),
    description: z.string(),
    author: z.string().optional(),
    imports: z
      .record(z.string())
      .default({})
      .refine(
        (imports) => {
          for (const [alias, path] of Object.entries(imports)) {
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(alias)) {
              return false;
            }
            if (
              !path.includes('://') &&
              !path.endsWith('.pal.lib') &&
              !path.endsWith('.pal')
            ) {
              return false;
            }
          }
          return true;
        },
        {
          message: 'Invalid import alias or path format',
        }
      ),
    variables: z.array(PALVariableSchema).default([]),
    composition: z.array(z.string()).min(1, 'Composition cannot be empty'),
    metadata: z.record(z.any()).default({}),
  })
  .refine(
    (data) => {
      const names = data.variables.map((v) => v.name);
      return names.length === new Set(names).size;
    },
    {
      message: 'Variable names must be unique within the assembly',
      path: ['variables'],
    }
  );

/**
 * Evaluation assertion schema
 */
export const EvaluationAssertionSchema = z.object({
  type: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  config: z.record(z.any()).default({}),
});

/**
 * Evaluation test case schema
 */
export const EvaluationTestCaseSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  variables: z.record(z.any()),
  assertions: z.array(EvaluationAssertionSchema),
  metadata: z.record(z.any()).default({}),
});

/**
 * Evaluation suite schema
 */
export const EvaluationSuiteSchema = z
  .object({
    pal_version: z.literal('1.0'),
    prompt_id: z.string(),
    target_version: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, 'Must be semantic version'),
    description: z.string().optional(),
    test_cases: z.array(EvaluationTestCaseSchema),
    metadata: z.record(z.any()).default({}),
  })
  .refine(
    (data) => {
      const names = data.test_cases.map((tc) => tc.name);
      return names.length === new Set(names).size;
    },
    {
      message: 'Test case names must be unique within the suite',
      path: ['test_cases'],
    }
  );

/**
 * Execution result schema
 */
export const ExecutionResultSchema = z.object({
  promptId: z.string(),
  promptVersion: z.string(),
  model: z.string(),
  compiledPrompt: z.string(),
  response: z.string(),
  metadata: z.record(z.any()),
  executionTimeMs: z.number(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  costUsd: z.number().optional(),
  timestamp: z.string(),
  success: z.boolean().default(true),
  error: z.string().optional(),
});

// Type exports
export type ComponentTypeValue = z.infer<typeof ComponentType>;
export type VariableTypeValue = z.infer<typeof VariableType>;
export type PALVariable = z.infer<typeof PALVariableSchema>;
export type PALComponent = z.infer<typeof PALComponentSchema>;
export type ComponentLibrary = z.infer<typeof ComponentLibrarySchema>;
export type PromptAssembly = z.infer<typeof PromptAssemblySchema>;
export type EvaluationAssertion = z.infer<typeof EvaluationAssertionSchema>;
export type EvaluationTestCase = z.infer<typeof EvaluationTestCaseSchema>;
export type EvaluationSuite = z.infer<typeof EvaluationSuiteSchema>;
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
