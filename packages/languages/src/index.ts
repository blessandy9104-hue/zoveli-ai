import { definePlugin } from '@deepseek-ai/dsh-core';
import { LanguageDetector } from './detector';
import { CodeAnalyzer } from './analyzer';
import { CodeFormatter } from './formatter';
import { TestRunner } from './runner';
import { LanguageTooling } from './tooling';

export const zoveliLanguages = definePlugin({
  name: 'zoveli-languages',
  description: 'Multi-language programming support: detection, analysis, formatting, testing, and tooling',

  setup(ctx) {
    const detector = new LanguageDetector();
    const analyzer = new CodeAnalyzer(ctx);
    const formatter = new CodeFormatter(ctx);
    const runner = new TestRunner(ctx);
    const tooling = new LanguageTooling(ctx);

    // Provide unified API
    ctx.provide('languages', {
      detect: detector.detect.bind(detector),
      analyze: analyzer.analyze.bind(analyzer),
      format: formatter.format.bind(formatter),
      lint: formatter.lint.bind(formatter),
      runTests: runner.run.bind(runner),
      getTooling: tooling.getForLanguage.bind(tooling),
      getSupportedLanguages: detector.getSupportedLanguages.bind(detector)
    });

    // Register language tools
    ctx.register('language-tools', [
      {
        name: 'language_detect',
        description: 'Detect programming language from file content or path',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string' },
            content: { type: 'string' }
          },
          required: ['filePath']
        },
        async execute({ filePath, content }: any) {
          return detector.detect(filePath, content);
        }
      },
      {
        name: 'language_analyze',
        description: 'Analyze code structure, complexity, and issues',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string' },
            content: { type: 'string' },
            language: { type: 'string' },
            includeMetrics: { type: 'boolean', default: true },
            includeIssues: { type: 'boolean', default: true }
          },
          required: ['filePath']
        },
        async execute({ filePath, content, language, includeMetrics, includeIssues }: any) {
          return analyzer.analyze({ filePath, content, language, includeMetrics, includeIssues });
        }
      },
      {
        name: 'language_format',
        description: 'Format code according to language standards',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string' },
            content: { type: 'string' },
            language: { type: 'string' },
            options: { type: 'object' }
          },
          required: ['filePath', 'content']
        },
        async execute({ filePath, content, language, options }: any) {
          return formatter.format({ filePath, content, language, options });
        }
      },
      {
        name: 'language_lint',
        description: 'Lint code for issues and style violations',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string' },
            content: { type: 'string' },
            language: { type: 'string' },
            config: { type: 'object' }
          },
          required: ['filePath', 'content']
        },
        async execute({ filePath, content, language, config }: any) {
          return formatter.lint({ filePath, content, language, config });
        }
      },
      {
        name: 'language_run_tests',
        description: 'Run tests for a project or file',
        parameters: {
          type: 'object',
          properties: {
            projectPath: { type: 'string' },
            language: { type: 'string' },
            testPath: { type: 'string' },
            args: { type: 'array', items: { type: 'string' } }
          },
          required: ['projectPath', 'language']
        },
        async execute({ projectPath, language, testPath, args }: any) {
          return runner.run({ projectPath, language, testPath, args });
        }
      },
      {
        name: 'language_get_tooling',
        description: 'Get recommended tooling for a language',
        parameters: {
          type: 'object',
          properties: {
            language: { type: 'string' }
          },
          required: ['language']
        },
        async execute({ language }: any) {
          return tooling.getForLanguage(language);
        }
      }
    ]);

    // Inject language awareness into agent
    ctx.on('agent/created', (agent) => {
      const langs = detector.getSupportedLanguages().map(l => l.name).join(', ');
      agent.inject({
        type: 'system',
        content: `LANGUAGE SUPPORT: You can work with ${langs}. 
Use language_detect to identify code, language_analyze for structure/issues, 
language_format to format, language_lint for style checks, and language_run_tests to execute tests.`
      });
    });
  }
});

export { LanguageDetector } from './detector';
export { CodeAnalyzer } from './analyzer';
export { CodeFormatter } from './formatter';
export { TestRunner } from './runner';
export { LanguageTooling } from './tooling';
export type { LanguageInfo, AnalysisResult, FormatResult, LintResult, TestResult } from './types';

