# `npm run ship` Workflow Logic

This project uses `npm run ship` as a small release pipeline. The goal is to make the common shipping path repeatable: stage the current work, block obvious secret leaks, create a commit, push it to GitHub, and deploy the site to Firebase Hosting — with the riskier Firebase backend behind an opt-in prompt.

The logic lives in `scripts/ship.sh` (invoked by `"ship": "sh scripts/ship.sh"` in `package.json`), so it is easier to read and harden than a one-line script.

```sh
sh scripts/ship.sh
```

## What It Does

1. Prompts for a commit message (defaults to `Ship latest changes`).
2. Stages the working tree with `git add .`.
3. Runs `npm run secrets:check`.
4. Commits the staged changes.
5. Pushes the commit to the configured Git remote.
6. Deploys Firebase Hosting with `npm run deploy` — **always**. This runs the `predeploy` build hook, then `firebase deploy --only hosting`.
7. Asks `Also deploy Firebase backend (functions, firestore rules, auth)? [y/N]`. Only on an explicit `y`/`yes` does it run `npm run firebase:deploy` (which runs `npm run check` first). The default is No.

`set -eu` at the top of the script plays the role the `&&` chain used to: each step only runs if the previous one succeeds. If the secrets check fails, the commit is not created. If the commit fails, nothing is pushed. If the push fails, no deploy runs.

## Why This Workflow Exists

Production is served entirely by Firebase:

- Static website files in `public/` are served by **Firebase Hosting**.
- The API (`/api/**`, `/feedback`) is served by the **`siteApi` Firebase Function** via hosting rewrites.
- Auth, Firestore rules/indexes, and the scheduled/event-driven functions round out the backend.

The Cloudflare Worker that used to serve this traffic has been decommissioned — the web DNS records are `DNS only` (grey cloud), so no Worker runs on the request path. Cloudflare now only provides DNS and Email Routing, both managed in the Cloudflare dashboard rather than with Wrangler.

## Why the Backend Is Gated

Hosting is safe to ship on every run: deploys are versioned and instantly rollback-able from the Firebase console. The backend is not. A bad Firestore rule can lock the database, and a bad auth change can lock administrators out. Those targets ship only when you answer `y` at the prompt, so a routine content deploy never touches them by accident.

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

This is intentionally Git-aware. It checks what would actually be committed, instead of scanning only the current folder. Production secrets should live in the hosting provider, such as Firebase Functions secrets set with `firebase functions:secrets:set`, not in committed files.

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
git add public src scripts functions firebase.json package.json
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

For this repo, non-secret production configuration lives in the Firebase Functions runtime environment (see `runtimeEnv()` defaults in `firebase-functions.mjs`), while real secret values are stored as Firebase Functions secrets. That separation is the model to preserve:

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
npm run deploy
```

### 7. Deploy the Correct Runtime

This project has a local Express server (`server.js`) for development and Firebase for production. The ship workflow deploys Firebase Hosting on every run, then optionally the Firebase backend.

Do not point the deploy at the legacy `deploy:ghpages:legacy` (GitHub Pages) path: it publishes only `public/` and does not deploy the `siteApi` Function that serves `/api/**` and `/feedback`, the Firestore rules/indexes, auth config, or the scheduled/event-driven functions.

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
- Make deployment target explicit, such as `deploy:hosting`, `deploy:api`, `deploy:web`, or `deploy:prod`.
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

That script could run `npm run check`, print `git status --short` before staging, and verify that the Firebase CLI is authenticated before trying to deploy. Keeping the release logic in a script file also makes it easier to adapt the same workflow for projects that are not primarily JavaScript.
