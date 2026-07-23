#!/usr/bin/env sh
# Release pipeline for the site. Invoked by `npm run ship`.
#
#   collect commit message
#   stage -> secret guard -> commit -> push
#   deploy Firebase Hosting (the static site) -- always
#   OPTIONALLY deploy the Firebase backend (functions, firestore rules, auth)
#
# The backend deploy is gated behind a y/N prompt because bad Firestore rules
# or auth config can lock the database or lock users out. Hosting is safe to
# ship on every run: it is versioned and instantly rollback-able in the
# Firebase console.
set -eu

# 1. Collect a human commit message (falls back to a default).
printf "Commit message [Ship latest changes]: "
IFS= read -r message
message=${message:-Ship latest changes}

# 2. Stage, block secret files, commit, push.
git add .
npm run secrets:check
git commit -m "$message"
git push

# 3. Deploy Firebase Hosting -- always. `npm run deploy` runs the predeploy
#    build hook, then `firebase deploy --only hosting`.
npm run deploy

# 4. Gated backend deploy: functions + firestore rules/indexes + auth.
#    Default is No, so nothing risky ships unless explicitly confirmed.
printf "Also deploy Firebase backend (functions, firestore rules, auth)? [y/N]: "
IFS= read -r deploy_backend || deploy_backend=""
case "$deploy_backend" in
  [yY] | [yY][eE][sS])
    # `npm run firebase:deploy` runs `npm run check` before deploying.
    npm run firebase:deploy
    ;;
  *)
    echo "Skipping backend deploy (functions, firestore rules, auth)."
    ;;
esac

echo "Ship complete."
