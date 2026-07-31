# Stand-alone Agent Skill

`build-learning-booklet/` is the enterprise-installable, self-encapsulated edition of the Learning Booklet skill. Copy that directory directly into an Agent skills location; do not copy the repository around it.

The directory contains its own prompt, host metadata, phase references, HTML template, JSON schemas, workflow engine, and command-line helpers. Runtime state is written only to `<workspace>/.learning-booklet/runs/` (or an explicitly selected safe run path). The workflow requires Node.js 20 or newer. Schema validation uses the bundled zero-dependency validator. Browser auditing additionally uses a locally available Playwright installation; missing optional browser capabilities are reported as `not_run`, never as passing.

## Install

```sh
cp -R standalone/build-learning-booklet "$CODEX_HOME/skills/build-learning-booklet"
```

The installed directory is relocatable. Its scripts resolve supporting code exclusively within that directory and do not require this source repository, a package installation, a service process, or a user interface.

## Verify the source bundle

From this repository root:

```sh
npm run test:standalone
```
