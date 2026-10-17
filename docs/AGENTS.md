# Coding Agent Guidelines

> **CRITICAL MANDATE**: Before modifying any code or configuration in this repository, **you MUST read and adhere to [`AGENT_RULES.md`](./AGENT_RULES.md)**.

## Workflow Overview
1. **First Step**: Review [`AGENT_RULES.md`](./AGENT_RULES.md) for protected areas and operating rules.
2. **Sync with Remote**: Run `git fetch origin` and verify `origin/main` commits to ensure no colleague has already implemented or auto-merged the feature.
3. **Current State**: Check [`STATE.md`](./STATE.md) for actual current implementation status and live endpoints.
4. **Project Context**: Check [`GEMINI.md`](./GEMINI.md) and [`MEME_CAPSULE_KNOWLEDGE.md`](./MEME_CAPSULE_KNOWLEDGE.md) for master architecture.
5. **Execution**: Make focused changes without refactoring unrelated features.
6. **Testing**: Run `npm run build` and tests to verify TypeScript and bundling.
7. **Documentation**: Update relevant Markdown docs in `docs/` and synchronize knowledge.
