# Contributing

## Branch model

```
feature work ─▶ develop ──(PR)──▶ main ──▶ deploys
                (integration)     (protected, production)
```

- **`develop`** is the integration branch — push your work here. It does **not**
  deploy; it's the running record.
- **`main`** is protected and production. You **cannot push to it directly** —
  changes land only via a pull request from `develop`. **Merging a PR into `main`
  triggers a deploy** (rebuilds the rolling `latest` release).
- Cutting a `vX.Y.Z` tag publishes a **pinned snapshot** release (install with
  `RUNE_VERSION=vX.Y.Z`); it does not become the default install.

## One-time local setup

Enable the git hooks so a stray `git push origin main` is caught locally before
it ever reaches the server:

```sh
deno task hooks      # sets core.hooksPath -> .githooks (pre-push blocks main)
```

(`core.hooksPath` is per-clone local config, so each clone runs this once.)

## Day-to-day

```sh
git switch develop
# …work…
git push origin develop
gh pr create --base main --head develop   # open the deploy PR
gh pr merge --merge                        # merge -> deploys
```

## Before opening the PR

```sh
deno test -A src/                      # engine
(cd rune-studio && deno test -A tests/)
(cd lang && cargo test --workspace)    # parser + LSP
deno run -A src/bootstrap/mod.ts example/todos   # lint stays clean
```
