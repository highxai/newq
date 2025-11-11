# Agent Guidelines for newq

## Commands
- **Build**: `bun run build` (bunup bundler with minification and splitting)
- **Dev**: `bun run dev` (bunup with watch mode)
- **Type Check**: `bun run type-check` (tsc --noEmit)
- **Test**: No test framework configured yet
- **Lint**: No lint command configured

## Code Style
- **Language**: TypeScript with strict mode, no fallthrough cases, no unchecked indexed access
- **Target**: ES2023 with verbatim module syntax and bundler resolution
- **Imports**: ES modules with named exports; use `import type` for type-only imports
- **Types**: Explicit type annotations for all function parameters and return types
- **Naming**: camelCase for variables/functions, PascalCase for types/interfaces/classes
- **Strings**: Single quotes for strings, template literals for interpolation
- **Error Handling**: try/catch blocks with specific error types; use optional chaining/nullish coalescing
- **Formatting**: 2-space indentation, trailing commas in multiline structures
- **Modules**: Preserve module syntax with verbatim module syntax enabled