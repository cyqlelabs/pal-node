# PAL - Prompt Assembly Language

[![Node.js](https://img.shields.io/badge/node-18+-blue.svg)](https://nodejs.org/en/download/)
[![TypeScript](https://img.shields.io/badge/typescript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![CI](https://github.com/cyqlelabs/pal-node/workflows/CI/badge.svg)](https://github.com/cyqlelabs/pal-js/actions/workflows/ci.yml)

PAL (Prompt Assembly Language) is a JavaScript/TypeScript framework for managing LLM prompts as versioned, composable software artifacts. It treats prompt engineering with the same rigor as software engineering, focusing on modularity, versioning, and testability.

This is the NodeJS port of the [Python version of PAL](https://github.com/cyqlelabs/pal).

## ⚡ Features

- **Modular Components**: Break prompts into reusable, versioned components
- **Template System**: Powerful template engine with variable injection
- **Dependency Management**: Import and compose components from local files or URLs
- **LLM Integration**: Built-in support for OpenAI, Anthropic, and custom providers
- **Evaluation Framework**: Comprehensive testing system for prompt validation
- **Rich CLI**: Beautiful command-line interface with syntax highlighting
- **Flexible Extensions**: Use `.pal/.pal.lib` or `.yml/.lib.yml` extensions
- **Type Safety**: Full TypeScript support with Zod validation for all schemas
- **Observability**: Structured logging and execution tracking

## 📦 Installation

```bash
# Install with npm
npm install pal-framework

# Or with yarn
yarn add pal-framework

# Or with pnpm
pnpm add pal-framework
```

## 📁 Project Structure

```
my_pal_project/
├── prompts/
│   ├── classify_intent.pal     # or .yml for better IDE support
│   └── code_review.pal
├── libraries/
│   ├── behavioral_traits.pal.lib    # or .lib.yml
│   ├── reasoning_strategies.pal.lib
│   └── output_formats.pal.lib
└── evaluation/
    └── classify_intent.eval.yaml
```

## 🚀 Quick Start

### 1. Create a Component Library

```yaml
# libraries/traits.pal.lib
pal_version: '1.0'
library_id: 'com.example.traits'
version: '1.0.0'
description: 'Behavioral traits for AI agents'
type: 'trait'

components:
  - name: 'helpful_assistant'
    description: 'A helpful and polite assistant'
    content: |
      You are a helpful, harmless, and honest AI assistant. You provide
      accurate information while being respectful and considerate.
```

### 2. Create a Prompt Assembly

```yaml
# prompts/classify_intent.pal
pal_version: '1.0'
id: 'classify-user-intent'
version: '1.0.0'
description: 'Classifies user queries into intent categories'

imports:
  traits: './libraries/traits.pal.lib'

variables:
  - name: 'user_query'
    type: 'string'
    description: "The user's input query"
  - name: 'available_intents'
    type: 'list'
    description: 'List of available intent categories'

composition:
  - '{{ traits.helpful_assistant }}'
  - ''
  - '## Task'
  - 'Classify this user query into one of the available intents:'
  - ''
  - '**Available Intents:**'
  - '{% for intent in available_intents %}'
  - '- {{ intent.name }}: {{ intent.description }}'
  - '{% endfor %}'
  - ''
  - '**User Query:** {{ user_query }}'
```

### 3. Use the CLI

```bash
# Compile a prompt
pal compile prompts/classify_intent.pal --vars '{"user_query": "Take me to google.com", "available_intents": [{"name": "navigate", "description": "Go to URL"}]}'

# Execute with an LLM
pal execute prompts/classify_intent.pal --model gpt-4 --provider openai --vars '{"user_query": "Take me to google.com", "available_intents": [{"name": "navigate", "description": "Go to URL"}]}'

# Validate PAL files
pal validate prompts/ --recursive

# Run evaluation tests
pal evaluate evaluation/classify_intent.eval.yaml
```

### 4. Use Programmatically

```typescript
import { PromptCompiler, PromptExecutor, MockLLMClient } from 'pal-framework';

async function main() {
  // Set up components
  const compiler = new PromptCompiler();
  const llmClient = new MockLLMClient('Mock response');
  const executor = new PromptExecutor(llmClient);

  // Compile prompt
  const variables = {
    user_query: "What's the weather?",
    available_intents: [{ name: 'search', description: 'Search for info' }],
  };

  const compiledPrompt = await compiler.compileFromFile(
    'prompts/classify_intent.pal',
    variables
  );

  console.log('Compiled Prompt:', compiledPrompt);

  // Execute with LLM (if you have actual API keys)
  // const result = await executor.execute(compiledPrompt, promptAssembly, 'gpt-4');
  // console.log('Response:', result.response);
}

main().catch(console.error);
```

## 🧪 Evaluation System

Create test suites to validate your prompts:

```yaml
# evaluation/classify_intent.eval.yaml
pal_version: '1.0'
prompt_id: 'classify-user-intent'
target_version: '1.0.0'

test_cases:
  - name: 'navigation_test'
    variables:
      user_query: 'Go to google.com'
      available_intents: [{ 'name': 'navigate', 'description': 'Visit URL' }]
    assertions:
      - type: 'json_valid'
      - type: 'contains'
        config:
          text: 'navigate'
```

## 🛠️ CLI Commands

| Command        | Description                                       |
| -------------- | ------------------------------------------------- |
| `pal compile`  | Compile a PAL file into a prompt string           |
| `pal execute`  | Compile and execute a prompt with an LLM          |
| `pal validate` | Validate PAL files for syntax and semantic errors |
| `pal evaluate` | Run evaluation tests against prompts              |
| `pal info`     | Show detailed information about PAL files         |

## 🧩 Component Types

PAL supports different types of reusable components:

- **persona**: AI personality and role definitions
- **task**: Specific instructions or objectives
- **context**: Background information and knowledge
- **rules**: Constraints and guidelines
- **examples**: Few-shot learning examples
- **output_schema**: Output format specifications
- **reasoning**: Thinking strategies and methodologies
- **trait**: Behavioral characteristics
- **note**: Documentation and comments

## 🏗️ Architecture

PAL follows modern software engineering principles:

- **Schema Validation**: All files are validated against strict Zod schemas
- **Dependency Resolution**: Automatic import resolution with circular dependency detection
- **Template Engine**: Powerful template system for variable interpolation and logic
- **Observability**: Structured logging with execution metrics and cost tracking
- **Type Safety**: Full TypeScript support with runtime validation

## 🔧 Development

```bash
# Clone the repository
git clone <repository-url>
cd pal-js

# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Build the project
npm run build

# Run the CLI in development
npm run dev -- compile examples/basic.pal

# Lint and format
npm run lint
npm run format
```

## 🧪 Testing

The project uses Vitest for testing with comprehensive coverage:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with UI
npm run test:ui

# Generate coverage report
npm run test:coverage
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- 📚 [Documentation](#)
- 🐛 [Issues](https://github.com/cyqlelabs/pal-js/issues)
- 💬 [Discussions](https://github.com/cyqlelabs/pal-js/discussions)

## 🗺️ Roadmap

- [ ] **PAL Registry**: Centralized repository for sharing components
- [ ] **Visual Builder**: Drag-and-drop prompt composition interface
- [ ] **IDE Extensions**: VS Code and other editor integrations

