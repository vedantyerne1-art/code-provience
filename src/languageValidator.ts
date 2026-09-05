/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SyntaxMismatchError {
  lineIndex: number;
  lineNumber: number;
  lineContent: string;
  detectedToken: string;
  expectedLanguage: string;
  apparentLanguage: string;
  message: string;
  suggestion: string;
}

export interface ValidationResult {
  isValid: boolean;
  selectedLanguageId: string;
  detectedDominantLanguage?: string;
  errors: SyntaxMismatchError[];
  warnings: string[];
}

interface LanguageRule {
  apparentLang: string;
  pattern: RegExp;
  tokenName: string;
  explanation: string;
  suggestion: string;
}

// Language-specific illegal patterns (syntax that indicates another language is being written)
const MISMATCH_RULES: Record<string, LanguageRule[]> = {
  python: [
    {
      apparentLang: 'JavaScript/TypeScript',
      pattern: /\bfunction\s+[a-zA-Z0-9_$]*\s*\(/,
      tokenName: 'function',
      explanation: 'In Python, functions are declared using "def", not "function".',
      suggestion: 'Replace "function name(...) {" with "def name(...):"'
    },
    {
      apparentLang: 'JavaScript/TypeScript',
      pattern: /\b(const|let|var)\s+[a-zA-Z0-9_$]+\s*=/,
      tokenName: 'const / let / var',
      explanation: 'Python does not use "const", "let", or "var" variable keywords.',
      suggestion: 'Assign variables directly without declarations: "x = value"'
    },
    {
      apparentLang: 'JavaScript/TypeScript',
      pattern: /===|!==/,
      tokenName: '=== or !==',
      explanation: 'Python uses "==" and "!=" for equality comparison, not strict "===" or "!==".',
      suggestion: 'Use "==" or "!=" instead of "===" or "!=="'
    },
    {
      apparentLang: 'JavaScript/Node.js',
      pattern: /\bconsole\.(log|error|warn|info)\s*\(/,
      tokenName: 'console.log',
      explanation: 'In Python, printing to stdout is done via "print()", not "console.log()".',
      suggestion: 'Use print(...) instead of console.log(...)'
    },
    {
      apparentLang: 'JavaScript/TypeScript',
      pattern: /=>\s*\{|\)\s*:\s*void\s*\{|\)\s*:\s*[a-zA-Z<>]+\s*\{/,
      tokenName: 'Arrow / typed block',
      explanation: 'Arrow functions (=>) and curly brace blocks are JavaScript/TypeScript syntax.',
      suggestion: 'Use Python functions "def foo():" or "lambda x: ..."'
    },
    {
      apparentLang: 'C/C++',
      pattern: /#\s*include\s*[<"][a-zA-Z0-9_.]+[>"]/,
      tokenName: '#include',
      explanation: '#include is C/C++ syntax. In Python, use "import module".',
      suggestion: 'Use "import module" or "from module import function"'
    },
    {
      apparentLang: 'Java/C#',
      pattern: /\b(public|private|protected)\s+(static\s+)?(void|class|int|String|boolean)\b/,
      tokenName: 'public/private class/void',
      explanation: 'Access modifiers (public/private/protected) and static types are Java/C# syntax.',
      suggestion: 'In Python, define classes simply with "class ClassName:"'
    },
    {
      apparentLang: 'Java',
      pattern: /\bSystem\.out\.print(ln)?\s*\(/,
      tokenName: 'System.out.println',
      explanation: 'System.out.println is Java syntax. Use print() in Python.',
      suggestion: 'Use print(...)'
    },
    {
      apparentLang: 'Rust',
      pattern: /\bfn\s+[a-zA-Z0-9_]+\s*\(.*?\)\s*(->\s*[a-zA-Z0-9_<>]+)?\s*\{/,
      tokenName: 'fn keyword',
      explanation: '"fn" is Rust syntax. In Python, use "def".',
      suggestion: 'Replace "fn name() {" with "def name():"'
    },
    {
      apparentLang: 'Go',
      pattern: /\bfunc\s+[a-zA-Z0-9_]+\s*\(/,
      tokenName: 'func keyword',
      explanation: '"func" is Go syntax. In Python, use "def".',
      suggestion: 'Replace "func" with "def"'
    },
    {
      apparentLang: 'SQL',
      pattern: /^\s*(SELECT\s+.+\s+FROM|INSERT\s+INTO|CREATE\s+TABLE|DROP\s+TABLE)\b/i,
      tokenName: 'SQL query',
      explanation: 'SQL statement written directly at root level of Python file.',
      suggestion: 'If running a query, wrap it in a Python string or switch language to SQL.'
    },
    {
      apparentLang: 'HTML',
      pattern: /^\s*<(html|div|p|h1|h2|h3|span|button|input|form|head|body)\b.*?>/i,
      tokenName: 'HTML markup',
      explanation: 'HTML markup detected in Python source code.',
      suggestion: 'Switch language to HTML or use Python templating (Jinja/FastAPI).'
    }
  ],

  javascript: [
    {
      apparentLang: 'Python',
      pattern: /\bdef\s+[a-zA-Z0-9_]+\s*\(.*?\)\s*:/,
      tokenName: 'def ... :',
      explanation: '"def" is Python syntax. In JavaScript, use "function" or arrow function.',
      suggestion: 'Use "function name() { ... }" or "const name = () => { ... }"'
    },
    {
      apparentLang: 'Python',
      pattern: /\belif\s+.*?:/,
      tokenName: 'elif',
      explanation: '"elif" is Python. In JavaScript, use "else if (...) {".',
      suggestion: 'Replace "elif" with "else if (...)"'
    },
    {
      apparentLang: 'Python',
      pattern: /(^|\s+)print\s*\(.*?\)\s*($|;)/,
      tokenName: 'print()',
      explanation: 'In JavaScript/TypeScript, standard output is "console.log()", not "print()".',
      suggestion: 'Use console.log(...) instead of print(...)'
    },
    {
      apparentLang: 'Python',
      pattern: /\b(None|True|False)\b(?!\s*[:=])/,
      tokenName: 'None / True / False',
      explanation: 'Python keywords "None", "True", "False" are not standard in JavaScript.',
      suggestion: 'Use "null" or "undefined" instead of "None", and "true"/"false" in lowercase'
    },
    {
      apparentLang: 'C/C++',
      pattern: /#\s*include\s*[<"][a-zA-Z0-9_.]+[>"]/,
      tokenName: '#include',
      explanation: '#include is C/C++ syntax. In JavaScript, use "import" or "require()".',
      suggestion: 'Use "import { foo } from \'./module\'" or "const foo = require(\'./module\')"'
    },
    {
      apparentLang: 'Rust',
      pattern: /\bfn\s+[a-zA-Z0-9_]+\s*\(/,
      tokenName: 'fn keyword',
      explanation: '"fn" is Rust syntax. In JavaScript, use "function".',
      suggestion: 'Use "function name() {"'
    },
    {
      apparentLang: 'Go',
      pattern: /\bfunc\s+[a-zA-Z0-9_]+\s*\(/,
      tokenName: 'func keyword',
      explanation: '"func" is Go syntax. In JavaScript, use "function".',
      suggestion: 'Use "function name() {"'
    },
    {
      apparentLang: 'SQL',
      pattern: /^\s*(SELECT\s+.+\s+FROM|INSERT\s+INTO|CREATE\s+TABLE)\b/i,
      tokenName: 'SQL query',
      explanation: 'Direct SQL query statement found in JavaScript file.',
      suggestion: 'Wrap query in a string or template literal.'
    }
  ],

  typescript: [
    // Java-specific syntax forbidden in TypeScript
    {
      apparentLang: 'Java',
      pattern: /\bSystem\.out\.print(ln)?\s*\(/,
      tokenName: 'System.out.println',
      explanation: 'System.out.println is Java syntax. In TypeScript, use console.log(...).',
      suggestion: 'Use console.log(...) instead of System.out.println(...)'
    },
    {
      apparentLang: 'Java',
      pattern: /\bpublic\s+static\s+void\s+main\s*\(/,
      tokenName: 'public static void main',
      explanation: '"public static void main" is Java application entry point syntax, not TypeScript.',
      suggestion: 'Define a TypeScript entry function: "export function main() { ... }"'
    },
    {
      apparentLang: 'Java',
      pattern: /\b(public|private|protected)\s+(static\s+)?(void|int|boolean|double|float|char|byte|short|long|String)\s+[a-zA-Z0-9_$]+\s*\(/,
      tokenName: 'Java method signature',
      explanation: 'Java method return types precede the method name (e.g. "public void foo()"). In TypeScript, types follow parameters (e.g. "public foo(): void").',
      suggestion: 'Use TypeScript syntax: "public methodName(params): ReturnType { ... }"'
    },
    {
      apparentLang: 'Java',
      pattern: /^\s*package\s+[a-zA-Z0-9_.]+\s*;/m,
      tokenName: 'package declaration',
      explanation: '"package com.example;" is Java package namespace syntax.',
      suggestion: 'TypeScript uses ES modules ("import" / "export") instead of package declarations.'
    },
    {
      apparentLang: 'Java',
      pattern: /^\s*import\s+(java|javax)\.[a-zA-Z0-9_.*]+\s*;/m,
      tokenName: 'import java.*',
      explanation: '"import java.*" is a Java standard library import.',
      suggestion: 'Use TypeScript/Node.js module imports, e.g. "import fs from \'fs\';"'
    },
    {
      apparentLang: 'Java',
      pattern: /^\s*@Override\b/m,
      tokenName: '@Override',
      explanation: '@Override is a Java compiler annotation. In TypeScript, use the "override" keyword on method declarations.',
      suggestion: 'Use TypeScript override keyword: "override myMethod() { ... }"'
    },
    {
      apparentLang: 'Java',
      pattern: /\bthrows\s+[A-Z][a-zA-Z0-9_]*Exception\b/,
      tokenName: 'throws Exception',
      explanation: '"throws Exception" is Java checked exception syntax.',
      suggestion: 'TypeScript does not support checked throws clauses. Handle errors with try/catch.'
    },
    {
      apparentLang: 'Java',
      pattern: /\bnew\s+(ArrayList|HashMap|HashSet|LinkedList)<[a-zA-Z0-9_,\s<>]+>\s*\(/,
      tokenName: 'Java Collections (ArrayList/HashMap)',
      explanation: 'Java collection instantiation syntax.',
      suggestion: 'In TypeScript, use Array: "[]" or "new Array()" and Map: "new Map()".'
    },
    // Python-specific syntax forbidden in TypeScript
    {
      apparentLang: 'Python',
      pattern: /\bdef\s+[a-zA-Z0-9_]+\s*\(.*?\)\s*:/,
      tokenName: 'def ... :',
      explanation: '"def" is Python syntax. In TypeScript, use "function" or arrow function.',
      suggestion: 'Use "function name(): ReturnType { ... }"'
    },
    {
      apparentLang: 'Python',
      pattern: /\belif\s+.*?:/,
      tokenName: 'elif',
      explanation: '"elif" is Python. In TypeScript, use "else if (...) {".',
      suggestion: 'Replace "elif" with "else if (...)"'
    },
    {
      apparentLang: 'Python',
      pattern: /(^|\s+)print\s*\(.*?\)\s*($|;)/,
      tokenName: 'print()',
      explanation: 'In TypeScript, standard console logging is "console.log()", not "print()".',
      suggestion: 'Use console.log(...) instead of print(...)'
    },
    {
      apparentLang: 'Python',
      pattern: /\b(None|True|False)\b(?!\s*[:=])/,
      tokenName: 'None / True / False',
      explanation: 'Python keywords "None", "True", "False" are not recognized in TypeScript.',
      suggestion: 'Use "null" / "undefined" and lowercase "true" / "false"'
    },
    {
      apparentLang: 'Python',
      pattern: /^\s*from\s+[a-zA-Z0-9_.]+\s+import\s+[a-zA-Z0-9_*, ]+/m,
      tokenName: 'from ... import ...',
      explanation: '"from module import symbol" is Python import syntax. TypeScript uses "import { symbol } from \'module\'".',
      suggestion: 'Use "import { symbol } from \'./module\';"'
    },
    {
      apparentLang: 'Python',
      pattern: /\b__init__\s*\(self\b/,
      tokenName: '__init__(self)',
      explanation: '__init__(self) is Python class constructor syntax. In TypeScript, use "constructor()".',
      suggestion: 'Use "constructor(args) { ... }"'
    },
    // C/C++ syntax forbidden in TypeScript
    {
      apparentLang: 'C/C++',
      pattern: /#\s*include\s*[<"][a-zA-Z0-9_.]+[>"]/,
      tokenName: '#include',
      explanation: '#include is C/C++ syntax. In TypeScript, use "import".',
      suggestion: 'Use "import { item } from \'module\'"'
    },
    {
      apparentLang: 'C/C++',
      pattern: /\bstd::(cout|cin|cerr|endl)\b/,
      tokenName: 'std::cout',
      explanation: 'std::cout is C++ stream output. In TypeScript, use console.log().',
      suggestion: 'Use console.log(...)'
    },
    // Rust syntax forbidden in TypeScript
    {
      apparentLang: 'Rust',
      pattern: /\bfn\s+[a-zA-Z0-9_]+\s*\(/,
      tokenName: 'fn keyword',
      explanation: '"fn" is Rust syntax. In TypeScript, use "function".',
      suggestion: 'Use "function name() {"'
    },
    {
      apparentLang: 'Rust',
      pattern: /\blet\s+mut\s+[a-zA-Z0-9_]+/,
      tokenName: 'let mut',
      explanation: '"let mut" is Rust mutable binding syntax. In TypeScript, use "let".',
      suggestion: 'Use "let variableName = ..."'
    },
    {
      apparentLang: 'Rust',
      pattern: /\bprintln!\s*\(/,
      tokenName: 'println!',
      explanation: '"println!" macro is Rust syntax. In TypeScript, use "console.log()".',
      suggestion: 'Use console.log(...)'
    },
    // Go syntax forbidden in TypeScript
    {
      apparentLang: 'Go',
      pattern: /\bfunc\s+[a-zA-Z0-9_]+\s*\(/,
      tokenName: 'func keyword',
      explanation: '"func" is Go syntax. In TypeScript, use "function".',
      suggestion: 'Use "function name() {"'
    },
    {
      apparentLang: 'Go',
      pattern: /\bfmt\.(Println|Printf|Sprintf)\s*\(/,
      tokenName: 'fmt.Println',
      explanation: '"fmt.Println" is Go standard library syntax. In TypeScript, use console.log().',
      suggestion: 'Use console.log(...)'
    },
    {
      apparentLang: 'Go',
      pattern: /^\s*package\s+main\b/m,
      tokenName: 'package main',
      explanation: '"package main" is Go package syntax.',
      suggestion: 'Remove package declaration in TypeScript.'
    },
    // SQL syntax forbidden in TypeScript
    {
      apparentLang: 'SQL',
      pattern: /^\s*(SELECT\s+.+\s+FROM|INSERT\s+INTO|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i,
      tokenName: 'SQL query',
      explanation: 'Direct SQL statement written at root level of TypeScript file.',
      suggestion: 'Wrap SQL in a string literal or switch file language to SQL.'
    }
  ],

  cpp: [
    {
      apparentLang: 'Python',
      pattern: /\bdef\s+[a-zA-Z0-9_]+\s*\(.*?\)\s*:/,
      tokenName: 'def ... :',
      explanation: '"def" is Python. In C++, specify a return type, e.g. "int func() { ... }".',
      suggestion: 'Define C++ functions with return types: "void name() { ... }"'
    },
    {
      apparentLang: 'JavaScript/TypeScript',
      pattern: /\b(const|let|var)\s+[a-zA-Z0-9_$]+\s*=.*=>/,
      tokenName: 'const / let arrow func',
      explanation: 'Arrow functions and JS variable declarations are invalid in C++.',
      suggestion: 'Use standard C++ functions or C++ lambdas "[&](args) { ... }"'
    },
    {
      apparentLang: 'JavaScript',
      pattern: /\bconsole\.(log|error)\s*\(/,
      tokenName: 'console.log',
      explanation: 'In C++, output is streamed via "std::cout << ... << std::endl;" or "printf()".',
      suggestion: 'Use std::cout << "..." << \'\\n\''
    },
    {
      apparentLang: 'Python',
      pattern: /(^|\s+)print\s*\(.*?\)\s*($|;)/,
      tokenName: 'print()',
      explanation: 'In C++, use "std::cout" or "printf()", not Python "print()".',
      suggestion: 'Use std::cout or printf'
    },
    {
      apparentLang: 'Java',
      pattern: /\bSystem\.out\.println\s*\(/,
      tokenName: 'System.out.println',
      explanation: 'System.out.println is Java syntax. Use std::cout in C++.',
      suggestion: 'Use std::cout << ...'
    }
  ],

  rust: [
    {
      apparentLang: 'Python',
      pattern: /\bdef\s+[a-zA-Z0-9_]+\s*\(.*?\)\s*:/,
      tokenName: 'def ... :',
      explanation: '"def" is Python syntax. In Rust, functions are declared with "fn".',
      suggestion: 'Use "fn name() -> ReturnType { ... }"'
    },
    {
      apparentLang: 'JavaScript/TypeScript',
      pattern: /\bfunction\s+[a-zA-Z0-9_$]*\s*\(/,
      tokenName: 'function keyword',
      explanation: '"function" is JavaScript/TypeScript syntax. In Rust, use "fn".',
      suggestion: 'Replace "function" with "fn"'
    },
    {
      apparentLang: 'JavaScript',
      pattern: /\bconsole\.(log|error)\s*\(/,
      tokenName: 'console.log',
      explanation: 'In Rust, logging to stdout is done via println!(...).',
      suggestion: 'Use println!("{}" , value)'
    },
    {
      apparentLang: 'C/C++',
      pattern: /#\s*include\s*[<"][a-zA-Z0-9_.]+[>"]/,
      tokenName: '#include',
      explanation: '#include is C/C++ syntax. In Rust, use "use crate::..." or "mod ...".',
      suggestion: 'Use "use std::collections::HashMap;"'
    }
  ],

  go: [
    {
      apparentLang: 'Python',
      pattern: /\bdef\s+[a-zA-Z0-9_]+\s*\(.*?\)\s*:/,
      tokenName: 'def ... :',
      explanation: '"def" is Python. In Go, declare functions with "func".',
      suggestion: 'Use "func name() { ... }"'
    },
    {
      apparentLang: 'JavaScript/TypeScript',
      pattern: /\bfunction\s+[a-zA-Z0-9_$]*\s*\(/,
      tokenName: 'function keyword',
      explanation: '"function" is JavaScript. In Go, use "func".',
      suggestion: 'Use "func name() { ... }"'
    },
    {
      apparentLang: 'JavaScript',
      pattern: /\bconsole\.(log|error)\s*\(/,
      tokenName: 'console.log',
      explanation: 'In Go, output is printed using "fmt.Println(...)".',
      suggestion: 'Use fmt.Println(...) with "import \"fmt\""'
    },
    {
      apparentLang: 'C/C++',
      pattern: /#\s*include\s*[<"][a-zA-Z0-9_.]+[>"]/,
      tokenName: '#include',
      explanation: '#include is C/C++ syntax. In Go, use "import (...)".',
      suggestion: 'Use import "package"'
    }
  ],

  java: [
    // JavaScript/TypeScript syntax forbidden in Java
    {
      apparentLang: 'JavaScript/TypeScript',
      pattern: /\b(const|let)\s+[a-zA-Z0-9_$]+\s*=/,
      tokenName: 'const / let keyword',
      explanation: 'Java variables are declared with types (e.g. "String s = ...", "int x = ...") or "var". "const" and "let" are not valid in Java.',
      suggestion: 'Use a Java type declaration: "String name = ...;" or "var x = ...;"'
    },
    {
      apparentLang: 'JavaScript/TypeScript',
      pattern: /\bfunction\s+[a-zA-Z0-9_$]*\s*\(/,
      tokenName: 'function keyword',
      explanation: '"function" is JavaScript/TypeScript syntax. In Java, methods specify return types (e.g. "public void methodName() { ... }").',
      suggestion: 'Declare a Java method: "public void name() { ... }"'
    },
    {
      apparentLang: 'JavaScript/TypeScript',
      pattern: /\bconsole\.(log|error|warn|info)\s*\(/,
      tokenName: 'console.log',
      explanation: 'In Java, standard output is "System.out.println()", not "console.log()".',
      suggestion: 'Use System.out.println(...)'
    },
    {
      apparentLang: 'JavaScript/TypeScript',
      pattern: /^\s*import\s+.*?\s+from\s+['"][^'"]+['"]/m,
      tokenName: 'import ... from ...',
      explanation: '"import x from \'y\'" is ES module syntax. In Java, use "import package.Class;".',
      suggestion: 'Use Java import syntax: "import java.util.List;"'
    },
    {
      apparentLang: 'JavaScript/TypeScript',
      pattern: /^\s*export\s+(default|function|const|class|interface|type)\b/m,
      tokenName: 'export keyword',
      explanation: '"export" is JavaScript/TypeScript module syntax. In Java, access is controlled via "public", "protected", or "private".',
      suggestion: 'Use "public class" or "public interface" without "export".'
    },
    {
      apparentLang: 'JavaScript/TypeScript',
      pattern: /===|!==/,
      tokenName: '=== or !==',
      explanation: 'Java uses "==" and "!=" for comparison (or .equals() for objects), not strict "===" or "!==".',
      suggestion: 'Use "==" or "!=" instead of "===" or "!=="'
    },
    // Python syntax forbidden in Java
    {
      apparentLang: 'Python',
      pattern: /\bdef\s+[a-zA-Z0-9_]+\s*\(.*?\)\s*:/,
      tokenName: 'def ... :',
      explanation: '"def" is Python syntax. In Java, methods belong to classes and specify return types.',
      suggestion: 'Declare Java methods: "public void name() { ... }"'
    },
    {
      apparentLang: 'Python',
      pattern: /(^|\s+)print\s*\(.*?\)\s*($|;)/,
      tokenName: 'print()',
      explanation: 'In Java, standard output is "System.out.println()", not Python "print()".',
      suggestion: 'Use System.out.println(...)'
    },
    {
      apparentLang: 'Python',
      pattern: /\belif\s+.*?:/,
      tokenName: 'elif',
      explanation: '"elif" is Python. In Java, use "else if (...) {".',
      suggestion: 'Use "else if (condition) { ... }"'
    },
    {
      apparentLang: 'Python',
      pattern: /^\s*from\s+[a-zA-Z0-9_.]+\s+import\s+/m,
      tokenName: 'from ... import',
      explanation: '"from module import symbol" is Python syntax. Use Java imports: "import package.Class;".',
      suggestion: 'Use "import package.Class;"'
    },
    // C/C++ syntax forbidden in Java
    {
      apparentLang: 'C/C++',
      pattern: /#\s*include\s*[<"][a-zA-Z0-9_.]+[>"]/,
      tokenName: '#include',
      explanation: '#include is C/C++ syntax. In Java, use "import package.Class;".',
      suggestion: 'Use import package.Class;'
    },
    {
      apparentLang: 'C/C++',
      pattern: /\bstd::/,
      tokenName: 'std:: namespace',
      explanation: '"std::" is C++ syntax. In Java, use standard classes like System or List.',
      suggestion: 'Use standard Java classes.'
    },
    // Rust syntax forbidden in Java
    {
      apparentLang: 'Rust',
      pattern: /\bfn\s+[a-zA-Z0-9_]+\s*\(/,
      tokenName: 'fn keyword',
      explanation: '"fn" is Rust syntax. In Java, declare methods: "public void name() { ... }".',
      suggestion: 'Use "public void name() { ... }"'
    },
    {
      apparentLang: 'Rust',
      pattern: /\bprintln!\s*\(/,
      tokenName: 'println!',
      explanation: '"println!" macro is Rust syntax. In Java, use "System.out.println()".',
      suggestion: 'Use System.out.println(...)'
    },
    // Go syntax forbidden in Java
    {
      apparentLang: 'Go',
      pattern: /\bfunc\s+[a-zA-Z0-9_]+\s*\(/,
      tokenName: 'func keyword',
      explanation: '"func" is Go syntax. In Java, declare methods with return types.',
      suggestion: 'Use "public void name() { ... }"'
    },
    {
      apparentLang: 'Go',
      pattern: /\bfmt\.(Println|Printf)\s*\(/,
      tokenName: 'fmt.Println',
      explanation: '"fmt.Println" is Go syntax. In Java, use System.out.println().',
      suggestion: 'Use System.out.println(...)'
    }
  ],

  sql: [
    {
      apparentLang: 'Python/JS',
      pattern: /\b(def|function|class|const|let|var)\s+[a-zA-Z0-9_]+/,
      tokenName: 'procedural keyword',
      explanation: 'Procedural keywords (def, function, class, const) are invalid in pure SQL scripts.',
      suggestion: 'Use SQL queries: SELECT, INSERT, UPDATE, DELETE, or CREATE TABLE/VIEW.'
    },
    {
      apparentLang: 'JavaScript/Python',
      pattern: /\b(console\.log|print)\s*\(/,
      tokenName: 'print/console.log',
      explanation: 'Output print statements cannot be executed in standard SQL scripts.',
      suggestion: 'Use SELECT ... AS output or print in your application layer.'
    }
  ],

  html: [
    {
      apparentLang: 'Python',
      pattern: /^\s*def\s+[a-zA-Z0-9_]+\s*\(.*?\)\s*:/,
      tokenName: 'def statement outside script',
      explanation: 'Python function definition found in HTML file.',
      suggestion: 'HTML should contain markup tags (<html>, <body>, <div>, etc.).'
    },
    {
      apparentLang: 'C/C++',
      pattern: /^\s*#\s*include\s*[<"][a-zA-Z0-9_.]+[>"]/,
      tokenName: '#include statement',
      explanation: 'C/C++ preprocessor statement found in HTML document.',
      suggestion: 'Use HTML tags or <link> / <script> tags for assets.'
    }
  ],

  css: [
    {
      apparentLang: 'JavaScript/Python',
      pattern: /\b(def|function|console\.log|print|class\s+[A-Z][a-zA-Z0-9]*\s*\{)\b/,
      tokenName: 'programming construct',
      explanation: 'Programming language keyword detected inside CSS stylesheet.',
      suggestion: 'CSS stylesheets should only contain style rules, e.g. ".selector { color: red; }".'
    }
  ]
};

/**
 * Validates code content against the selected language.
 * Returns any syntax mismatch errors with exact line numbers and suggestions.
 */
export function validateCodeForLanguage(
  code: string,
  selectedLanguageId: string
): ValidationResult {
  const lines = code.split('\n');
  const errors: SyntaxMismatchError[] = [];
  const warnings: string[] = [];

  const langKey = selectedLanguageId.toLowerCase();
  const rules = MISMATCH_RULES[langKey] || [];

  // Track counts of apparent languages to suggest dominant detected language
  const languageVotes: Record<string, number> = {};

  lines.forEach((lineText, idx) => {
    const trimmed = lineText.trim();
    // Ignore pure comment lines
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || (trimmed.startsWith('#') && langKey === 'python')) {
      return;
    }
    // Ignore empty lines
    if (!trimmed) return;

    for (const rule of rules) {
      if (rule.pattern.test(lineText)) {
        errors.push({
          lineIndex: idx,
          lineNumber: idx + 1,
          lineContent: trimmed,
          detectedToken: rule.tokenName,
          expectedLanguage: selectedLanguageId,
          apparentLanguage: rule.apparentLang,
          message: rule.explanation,
          suggestion: rule.suggestion
        });

        languageVotes[rule.apparentLang] = (languageVotes[rule.apparentLang] || 0) + 1;
        break; // Stop at first error per line
      }
    }
  });

  // Determine dominant mismatched language if any
  let dominantLanguage: string | undefined = undefined;
  let maxVotes = 0;
  for (const [lang, count] of Object.entries(languageVotes)) {
    if (count > maxVotes) {
      maxVotes = count;
      dominantLanguage = lang;
    }
  }

  return {
    isValid: errors.length === 0,
    selectedLanguageId,
    detectedDominantLanguage: dominantLanguage,
    errors,
    warnings
  };
}

/**
 * Removes all lines containing foreign language syntax, returning clean compliant code.
 */
export function stripMismatchedLines(code: string, selectedLanguageId: string): string {
  const result = validateCodeForLanguage(code, selectedLanguageId);
  if (result.isValid) return code;
  const badIndices = new Set(result.errors.map(e => e.lineIndex));
  const lines = code.split('\n');
  const cleaned = lines.filter((_, idx) => !badIndices.has(idx));
  return cleaned.join('\n');
}

/**
 * Checks if a code snippet (e.g. pasted or inserted) complies with the selected environment.
 */
export function isSnippetCompatible(
  snippet: string,
  targetLanguageId: string
): { compatible: boolean; detectedLang?: string; reason?: string; firstErrorLine?: number } {
  const res = validateCodeForLanguage(snippet, targetLanguageId);
  if (res.isValid) return { compatible: true };
  const first = res.errors[0];
  return {
    compatible: false,
    detectedLang: res.detectedDominantLanguage || first?.apparentLanguage,
    reason: first?.message || 'Foreign syntax detected',
    firstErrorLine: first?.lineNumber
  };
}

