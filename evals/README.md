# Hypha evals

Scaffolded in W13-14; v1-B ships a placeholder directory so downstream
evaluation work has a home. Full harness lands when LLM plumbing matures:

- **LongMemEval subset** — adapted for static-export queries.
- **Custom synthetic Takeout benchmark** — ingest synthetic corpus → run
  identity-resolver → check precision/recall of `person.*` clusters → run
  `ask` queries against ground truth.

Target (per synthesis): within 10% of Zep/Graphiti on comparable tasks.

## How to run (once implemented)

```bash
bun run evals/run.ts --profile default --suite longmemeval-mini
```
