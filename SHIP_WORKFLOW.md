# `npm run ship` Workflow Logic

This project uses `npm run ship` as a small release pipeline. The goal is to make the common shipping path repeatable: stage the current work, block obvious secret leaks, create a commit, push it to GitHub, and deploy the Cloudflare Worker plus static assets.

Current script in `package.json`:

```sh
read -r -p "Commit message [Ship latest changes]: " message; message=${message:-Ship latest changes}; git add . && npm run secrets:check && git commit -m "$message" && git push && npm run deploy:worker
```

## What It Does

1. Prompts for a commit message.
2. Uses `Ship latest changes` when no message is entered.
3. Stages the working tree with `git add .`.
4. Runs `npm run secrets:check`.
5. Commits the staged changes.
6. Pushes the commit to the configured Git remote.
7. Deploys production with `npm run deploy:worker`.

The `&&` operators are intentional. Each step only runs if the previous step succeeds. If the secrets check fails, the commit is not created. If the commit fails, nothing is pushed. If the push fails, deployment does not run.

## Why This Workflow Exists

The repo has two important production surfaces:

- Static website files in `public/`.
- Cloudflare Worker code in `cloudflare-worker.mjs`, with Worker assets configured in `wrangler.jsonc`.

Production traffic is served by Cloudflare Workers, not by the local Express server. That means the safest release action after changing frontend files, Worker API routes, email automation, or configuration is:

```sh
npm run deploy:worker
```

`npm run ship` wraps that deploy step with version control hygiene so production changes are also recorded in Git.

## Guardrail: Secret File Check

Before creating the commit, the workflow runs:

```sh
npm run secrets:check
```

That command executes `scripts/check-no-secrets.mjs`. The script asks Git which files are tracked and staged, then blocks commits containing known local secret files:

- `.env`
- `.env.local`
- `.env.production`
- `.env.prod`
- `.env.staging`
- `.dev.vars`
- `.dev.vars.production`

This is intentionally Git-aware. It checks what would actually be committed, instead of scanning only the current folder. Production secrets should live in the hosting provider, such as Cloudflare Worker secrets created with `wrangler secret put`, not in committed files.

## Hardened Release Logic

The workflow follows a portable release pattern that can be reused in many languages and environments:

```text
collect release message
stage intended changes
run safety checks
create version-control checkpoint
push checkpoint
deploy from the checked-in state
```

The exact commands can change per stack, but the order should stay stable.

### 1. Collect a Human Commit Message

The prompt gives each release a clear Git history entry. The fallback message keeps the workflow usable for small updates, but a specific message is better when the change affects production behavior.

Portable examples:

```sh
# JavaScript / Node
npm run ship

# Python
./scripts/ship.sh

# Ruby
bundle exec rake ship

# Go
make ship

# PHP
composer ship
```

### 2. Stage Changes Deliberately

This repo currently stages everything with:

```sh
git add .
```

That is convenient for a small project, but the portable rule is: stage only what should be part of the release. In larger teams or multi-service repos, prefer a reviewed staging step before shipping:

```sh
git status --short
git add public cloudflare-worker.mjs src scripts package.json wrangler.jsonc
```

### 3. Run Checks Before Commit

The current workflow runs only the secret-file guard before committing. The repo also has a broader check command:

```sh
npm run check
```

For a more hardened ship workflow, run the broad check before committing or before deploying. The equivalent per environment is:

```sh
# JavaScript / Node
npm run check
npm test

# Python
python -m compileall .
pytest

# Ruby
ruby -c app.rb
bundle exec rspec

# Go
go test ./...
go vet ./...

# PHP
php -l path/to/file.php
vendor/bin/phpunit
```

The important idea is not the language. The important idea is that release-blocking checks happen before irreversible actions like pushing or deploying.

### 4. Block Secrets and Environment Files

Every environment has local-only files that should not ship:

```text
.env
.env.*
.dev.vars
local.settings.json
secrets.json
*.pem
*.key
service-account*.json
```

For this repo, the allowlisted production configuration lives in `wrangler.jsonc` under `vars`, while real secret values are stored through Wrangler secrets. That separation is the model to preserve:

- Non-secret config can be committed.
- Secret config must live in the deployment platform.
- Local development files must be ignored and blocked if accidentally staged.

### 5. Commit Before Push

The commit creates a local checkpoint. This matters because production should be traceable to a Git state. If a deployment behaves unexpectedly, there is a commit to inspect, revert, or redeploy.

### 6. Push Before Deploy

The workflow pushes before deploying so the remote repository has the release commit before production changes. This makes the deployed state easier to audit and recover.

For CI/CD environments, this same concept usually becomes:

```text
push commit
CI runs checks
CI deploys from the pushed commit
```

For local deploy environments, this repo keeps the deploy command on the developer machine:

```sh
npm run deploy:worker
```

### 7. Deploy the Correct Runtime

This project has both a local Express server and a Cloudflare Worker. The ship workflow deploys the Worker because production uses Cloudflare routes and Worker assets.

Do not replace the final step with a generic static deploy unless the production architecture changes. `npm run deploy` publishes `public/` to GitHub Pages, but it does not deploy the Worker API routes, D1 bindings, Cron trigger, or Worker secrets integration.

## Cross-Environment Template

Use this structure when adapting the workflow outside Node:

```sh
#!/usr/bin/env sh
set -eu

printf "Commit message [Ship latest changes]: "
IFS= read -r message
message=${message:-Ship latest changes}

git status --short
git add .

# Replace these with the language and platform checks for the project.
./scripts/check-secrets.sh
./scripts/check.sh

git commit -m "$message"
git push

# Replace with the production deploy command for the actual runtime.
./scripts/deploy.sh
```

Recommended hardening for multi-language projects:

- Use `set -eu` in shell scripts so unset variables and failed commands stop the release.
- Keep checks in separate scripts so Node, Python, Go, PHP, Ruby, and static-only projects can each define their own implementation.
- Run secret checks before committing and again in CI.
- Make deployment target explicit, such as `deploy:worker`, `deploy:api`, `deploy:web`, or `deploy:prod`.
- Avoid committing generated local state, caches, logs, credentials, or build artifacts unless the hosting platform requires them.
- Prefer platform secret stores for production credentials.
- Keep rollback possible by ensuring every deploy is tied to a Git commit.

## Suggested Future Upgrade

The current one-line `package.json` script works, but a dedicated script would be easier to harden across shells and operating systems:

```json
{
  "scripts": {
    "ship": "sh scripts/ship.sh"
  }
}
```

That script could run `npm run check`, print `git status --short` before staging, and verify that Wrangler is authenticated before trying to deploy. Keeping the release logic in a script file also makes it easier to adapt the same workflow for projects that are not primarily JavaScript.
