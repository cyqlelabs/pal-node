#!/usr/bin/env node

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { Command } from 'commander';
import { glob } from 'glob';
import * as kleur from 'kleur';
import { PromptCompiler } from './core/compiler.js';
import {
  PromptExecutor,
  LLMClient,
  MockLLMClient,
  OpenAIClient,
  AnthropicClient,
} from './core/executor.js';
import { Loader } from './core/loader.js';
import { PALError } from './exceptions/core.js';

const program = new Command();

/**
 * Handle and display errors consistently
 */
function handleError(error: unknown): void {
  if (error instanceof PALError) {
    console.error(kleur.red('Error:'), error.message);
    if (error.context) {
      console.error(kleur.dim('Context:'));
      for (const [key, value] of Object.entries(error.context)) {
        console.error(`  ${key}: ${value}`);
      }
    }
  } else {
    console.error(kleur.red('Unexpected error:'), String(error));
  }
}

/**
 * Check if a file is a prompt assembly file (.pal or .yml without .lib)
 */
function isPromptAssemblyFile(filePath: string): boolean {
  return (
    filePath.endsWith('.pal') ||
    (filePath.endsWith('.yml') && !filePath.includes('.lib.yml'))
  );
}

/**
 * Check if a file is a library file (.pal.lib or .lib.yml)
 */
function isLibraryFile(filePath: string): boolean {
  return filePath.endsWith('.pal.lib') || filePath.endsWith('.lib.yml');
}

/**
 * Load variables from file and/or command line
 */
async function loadVariables(
  variables?: string,
  varsFile?: string
): Promise<Record<string, unknown>> {
  let varsDict: Record<string, unknown> = {};

  if (varsFile) {
    try {
      const content = await readFile(varsFile, 'utf-8');
      varsDict = { ...varsDict, ...JSON.parse(content) };
    } catch (error) {
      console.error(kleur.red('Error reading variables file:'), String(error));
      process.exit(1);
    }
  }

  if (variables) {
    try {
      varsDict = { ...varsDict, ...JSON.parse(variables) };
    } catch (error) {
      console.error(kleur.red('Invalid JSON in --vars:'), String(error));
      process.exit(1);
    }
  }

  return varsDict;
}

/**
 * Create LLM client based on provider
 */
function createLLMClient(
  provider: string,
  apiKey?: string,
  mockMessage?: string
): LLMClient {
  switch (provider) {
    case 'openai':
      return new OpenAIClient(apiKey);
    case 'anthropic':
      return new AnthropicClient(apiKey);
    case 'mock':
    default:
      return new MockLLMClient(
        mockMessage || 'This is a mock response from the PAL system.'
      );
  }
}

/**
 * Get list of files to validate
 */
async function getFilesToValidate(
  path: string,
  recursive: boolean
): Promise<string[]> {
  const files: string[] = [];

  try {
    const stat = await import('fs/promises').then((fs) => fs.stat(path));

    if (stat.isFile()) {
      files.push(path);
    } else if (stat.isDirectory()) {
      const patterns = ['*.pal', '*.pal.lib', '*.yml'];

      for (const pattern of patterns) {
        const globPattern = recursive
          ? `${path}/**/${pattern}`
          : `${path}/${pattern}`;
        const matched = await glob(globPattern);
        files.push(...matched);
      }

      // Filter to only include PAL-related files
      return files.filter(
        (file) => isPromptAssemblyFile(file) || isLibraryFile(file)
      );
    }
  } catch {
    throw new Error(`Cannot access path: ${path}`);
  }

  return files;
}

/**
 * Validate a single file
 */
async function validateSingleFile(
  filePath: string,
  loader: Loader,
  compiler: PromptCompiler
): Promise<{
  fileType: string;
  status: string;
  issues: string;
  isValid: boolean;
}> {
  try {
    if (isPromptAssemblyFile(filePath)) {
      const promptAssembly = await loader.loadPromptAssembly(filePath);

      // Additional validation - check template variables
      const templateVars = compiler.analyzeTemplateVariables(promptAssembly);
      const definedVars = new Set(promptAssembly.variables.map((v) => v.name));
      const undefinedVars = [...templateVars].filter(
        (v) => !definedVars.has(v) && !['loop', 'super'].includes(v) // Nunjucks builtins
      );

      if (undefinedVars.length > 0) {
        return {
          fileType: 'Assembly',
          status: kleur.yellow('Warning'),
          issues: `Undefined variables: ${undefinedVars.join(', ')}`,
          isValid: false,
        };
      }

      return {
        fileType: 'Assembly',
        status: kleur.green('Valid'),
        issues: '',
        isValid: true,
      };
    }

    if (isLibraryFile(filePath)) {
      await loader.loadComponentLibrary(filePath);
      return {
        fileType: 'Library',
        status: kleur.green('Valid'),
        issues: '',
        isValid: true,
      };
    }

    return {
      fileType: 'Unknown',
      status: kleur.yellow('Skipped'),
      issues: '',
      isValid: false,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const truncated =
      errorMsg.length > 50 ? errorMsg.substring(0, 50) + '...' : errorMsg;

    return {
      fileType: 'Unknown',
      status: kleur.red('Invalid'),
      issues: truncated,
      isValid: false,
    };
  }
}

/**
 * Display validation results table
 */
function displayValidationResults(
  results: Array<{
    filePath: string;
    fileType: string;
    status: string;
    issues: string;
    isValid: boolean;
  }>,
  basePath: string
): void {
  console.log(kleur.cyan('\nPAL Validation Results\n'));

  const maxFileLength = Math.max(
    ...results.map((r) => r.filePath.replace(basePath + '/', '').length),
    'File'.length
  );
  const maxTypeLength = Math.max(
    ...results.map((r) => r.fileType.length),
    'Type'.length
  );
  const maxStatusLength = 8; // Account for color codes

  // Header
  console.log(
    kleur.cyan('File'.padEnd(maxFileLength)) +
      ' | ' +
      kleur.magenta('Type'.padEnd(maxTypeLength)) +
      ' | ' +
      kleur.green('Status'.padEnd(maxStatusLength)) +
      ' | ' +
      kleur.red('Issues')
  );

  console.log('-'.repeat(maxFileLength + maxTypeLength + maxStatusLength + 20));

  // Results
  for (const result of results) {
    const relativePath = result.filePath.replace(basePath + '/', '');
    console.log(
      kleur.cyan(relativePath.padEnd(maxFileLength)) +
        ' | ' +
        kleur.magenta(result.fileType.padEnd(maxTypeLength)) +
        ' | ' +
        result.status.padEnd(maxStatusLength) +
        ' | ' +
        kleur.red(result.issues)
    );
  }

  const validCount = results.filter((r) => r.isValid).length;
  const totalCount = results.length;

  console.log(kleur.bold(`\nSummary: ${validCount}/${totalCount} files valid`));
}

// CLI Commands

program
  .name('pal')
  .description('PAL - Prompt Assembly Language CLI')
  .version('0.0.1');

program
  .command('compile')
  .description('Compile a PAL file into a prompt string')
  .argument('<pal-file>', 'PAL file to compile')
  .option('--vars <json>', 'Variables as JSON string')
  .option('--vars-file <file>', 'Load variables from JSON file')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .option('--no-format', 'Disable syntax highlighting')
  .action(async (palFile: string, options) => {
    try {
      const vars = await loadVariables(options.vars, options.varsFile);

      const compiler = new PromptCompiler();
      const compiledPrompt = await compiler.compileFromFile(palFile, vars);

      if (options.output) {
        await writeFile(options.output, compiledPrompt, 'utf-8');
        console.log(
          kleur.green('✓'),
          `Compiled prompt written to ${options.output}`
        );
      } else {
        if (options.noFormat) {
          console.log(compiledPrompt);
        } else {
          console.log(kleur.cyan('Compiled Prompt:'));
          console.log(kleur.dim('─'.repeat(80)));
          console.log(compiledPrompt);
          console.log(kleur.dim('─'.repeat(80)));
        }
      }
    } catch (error) {
      handleError(error);
      process.exit(1);
    }
  });

program
  .command('execute')
  .description('Compile and execute a PAL file with an LLM')
  .argument('<pal-file>', 'PAL file to execute')
  .requiredOption('-m, --model <model>', 'LLM model to use')
  .option('--provider <provider>', 'LLM provider', 'mock')
  .option('--vars <json>', 'Variables as JSON string')
  .option('--vars-file <file>', 'Load variables from JSON file')
  .option('-t, --temperature <number>', 'Temperature for generation', '0.7')
  .option('--max-tokens <number>', 'Maximum tokens to generate')
  .option('--api-key <key>', 'API key for the provider')
  .option('--log-file <file>', 'Log execution details to file')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .option('--json-output', 'Output full result as JSON')
  .action(async (palFile: string, options) => {
    try {
      const vars = await loadVariables(options.vars, options.varsFile);
      const llmClient = createLLMClient(options.provider, options.apiKey);

      const compiler = new PromptCompiler();
      const loader = new Loader();

      const promptAssembly = await loader.loadPromptAssembly(palFile);
      const compiledPrompt = await compiler.compile(
        promptAssembly,
        vars,
        palFile
      );

      const executor = new PromptExecutor(llmClient, options.logFile);
      const result = await executor.execute(
        compiledPrompt,
        promptAssembly,
        options.model,
        parseFloat(options.temperature),
        options.maxTokens ? parseInt(options.maxTokens, 10) : undefined
      );

      if (options.output) {
        if (options.jsonOutput) {
          await writeFile(
            options.output,
            JSON.stringify(result, null, 2),
            'utf-8'
          );
        } else {
          await writeFile(options.output, result.response, 'utf-8');
        }
        console.log(kleur.green('✓'), `Response written to ${options.output}`);
      } else {
        if (options.jsonOutput) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(kleur.cyan(`Response from ${options.model}:`));
          console.log(kleur.dim('─'.repeat(80)));
          console.log(result.response);
          console.log(kleur.dim('─'.repeat(80)));
          console.log(
            kleur.dim(
              `Tokens: ${result.inputTokens}→${result.outputTokens} | ` +
                `Time: ${result.executionTimeMs.toFixed(1)}ms`
            )
          );
        }
      }
    } catch (error) {
      handleError(error);
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate PAL files for syntax and semantic errors')
  .argument('<path>', 'Path to validate (file or directory)')
  .option('-r, --recursive', 'Validate recursively')
  .action(async (path: string, options) => {
    try {
      const loader = new Loader();
      const compiler = new PromptCompiler();

      const filesToCheck = await getFilesToValidate(path, options.recursive);

      if (filesToCheck.length === 0) {
        console.log(kleur.yellow('No PAL files found to validate'));
        return;
      }

      const results: Array<{
        filePath: string;
        fileType: string;
        status: string;
        issues: string;
        isValid: boolean;
      }> = [];

      for (const filePath of filesToCheck) {
        const result = await validateSingleFile(filePath, loader, compiler);
        results.push({ filePath, ...result });
      }

      displayValidationResults(results, resolve(path));

      const validFiles = results.filter((r) => r.isValid).length;
      if (validFiles < results.length) {
        process.exit(1);
      }
    } catch (error) {
      handleError(error);
      process.exit(1);
    }
  });

program
  .command('info')
  .description('Show information about a PAL file')
  .argument('<pal-file>', 'PAL file to analyze')
  .action(async (palFile: string) => {
    try {
      const loader = new Loader();

      if (isLibraryFile(palFile)) {
        const library = await loader.loadComponentLibrary(palFile);

        console.log(kleur.cyan(`Component Library: ${library.library_id}`));
        console.log(kleur.dim('─'.repeat(50)));
        console.log(`Library ID: ${kleur.cyan(library.library_id)}`);
        console.log(`Version: ${kleur.green(library.version)}`);
        console.log(`Type: ${kleur.magenta(library.type)}`);
        console.log(`Description: ${library.description}`);
        console.log(`Components: ${library.components.length}`);

        if (library.components.length > 0) {
          console.log(kleur.cyan('\nComponents:'));
          for (const component of library.components) {
            console.log(
              `  • ${kleur.cyan(component.name)}: ${
                component.description.length > 50
                  ? component.description.substring(0, 50) + '...'
                  : component.description
              } (${component.content.length} chars)`
            );
          }
        }
      } else {
        const assembly = await loader.loadPromptAssembly(palFile);

        console.log(kleur.cyan(`Prompt Assembly: ${assembly.id}`));
        console.log(kleur.dim('─'.repeat(50)));
        console.log(`ID: ${kleur.cyan(assembly.id)}`);
        console.log(`Version: ${kleur.green(assembly.version)}`);
        console.log(`Description: ${assembly.description}`);
        if (assembly.author) {
          console.log(`Author: ${assembly.author}`);
        }
        console.log(`Variables: ${assembly.variables.length}`);
        console.log(`Imports: ${Object.keys(assembly.imports).length}`);
        console.log(`Composition Items: ${assembly.composition.length}`);

        if (assembly.variables.length > 0) {
          console.log(kleur.cyan('\nVariables:'));
          for (const variable of assembly.variables) {
            console.log(
              `  • ${kleur.cyan(variable.name)} (${kleur.magenta(variable.type)}): ` +
                `${variable.description} ${variable.required ? kleur.green('✓') : kleur.red('✗')}`
            );
          }
        }

        if (Object.keys(assembly.imports).length > 0) {
          console.log(kleur.cyan('\nImports:'));
          for (const [alias, path] of Object.entries(assembly.imports)) {
            console.log(`  • ${kleur.cyan(alias)}: ${kleur.green(path)}`);
          }
        }
      }
    } catch (error) {
      handleError(error);
      process.exit(1);
    }
  });

// Parse arguments and run
program.parse();
