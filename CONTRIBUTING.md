# Contributing to FORCH.iA WinOptimizer

Thank you for your interest in contributing! This document outlines the standards and workflow for contributions.

## Code Standards

### TypeScript

- **Strict mode** — All code must pass `tsc --noEmit` with strict settings
- **No `any`** — Use proper types or `unknown` with type guards
- **Explicit return types** — All functions must have return type annotations
- **No unused variables** — Enforced by ESLint

### React

- **Functional components** — No class components
- **Hooks only** — Custom hooks for reusable logic
- **Props interface** — Every component must have a typed props interface
- **Forward refs** — Use `React.forwardRef` for ref forwarding

### Styling

- **CSS Variables only** — No hardcoded colors, use `var(--color-*)`
- **Design tokens** — Follow DESIGN.md token system
- **No inline styles** — Except for dynamic values (width, etc.)

### Testing

- **TDD** — Write tests before implementation (RED-GREEN-REFACTOR)
- **Coverage** — Aim for 80%+ coverage
- **Test files** — Colocated as `*.test.tsx` next to source

## Commit Convention

```
feat: add new feature
fix: fix bug
docs: documentation changes
style: formatting changes
refactor: code restructuring
test: add/update tests
chore: maintenance tasks
```

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`feat/my-feature`)
3. Write tests first (TDD)
4. Implement the feature
5. Ensure all tests pass (`pnpm test`)
6. Run linter (`pnpm lint`)
7. Run type checker (`pnpm typecheck`)
8. Run formatting check (`pnpm run format:check`)
9. Submit PR with clear description

## Development Setup

```bash
git clone https://github.com/forchia-ecosystem/forch-i-winoptimizer.git
cd forch-i-winoptimizer
pnpm install
pnpm run electron:dev
```

## Code Review Checklist

- [ ] Tests written and passing
- [ ] TypeScript strict mode compliant
- [ ] Prettier formatting applied (`pnpm run format:check`)
- [ ] No hardcoded colors (use CSS variables)
- [ ] Component has typed props interface
- [ ] Documentation updated if needed
- [ ] No console.log statements
- [ ] Accessibility considered (ARIA, keyboard nav)

---

**Built with FORCH.i by Paulo Velasco**
