# Fixing the Contact Form 405 on Static Hosting

> The Firebase migration is implemented and documented in [FIREBASE_ANALYTICS.md](./FIREBASE_ANALYTICS.md). The D1 instructions below describe the stabilization fallback and should remain available for 30 days after production cutover.

The site posts the estimate wizard to `/api/contact`. That route exists in `server.js` for local development and in `cloudflare-worker.mjs` for production. GitHub Pages cannot run `server.js` or read `.env`, so production should be deployed with Wrangler instead of relying on the GitHub Pages-only deploy.

## Current Production Setup

Cloudflare now serves both the static site files and the `/api/*` routes from the Worker deployment. This avoids the production image-loading issue caused by requests falling through to the GitHub Pages origin over a bad IPv6 DNS path.

The `wrangler.jsonc` file deploys `public/` as Worker assets and routes the whole domain through the Worker:

```text
stonebellisimollc.com/*
www.stonebellisimollc.com/*
```

Only `/api/*` runs the Worker code first. Regular pages, scripts, and images are served from the uploaded static assets.

Use this command after changing files in `public/` or `cloudflare-worker.mjs`:

```sh
npm run deploy:worker
```

The older GitHub Pages deploy can still exist as a backup, but production traffic should not depend on GitHub Pages for images.

## Contact Form Setup

Do not use Cloudflare's "Upload and deploy" static-file screen for `cloudflare-worker.mjs`. A Worker JavaScript file and its assets have to be deployed with Wrangler.

1. From this project folder, log in to Cloudflare:

   ```sh
   npx wrangler login
   ```

2. Create and migrate the D1 database used for lead storage and feedback automation:

   ```sh
   npm run worker:d1:create
   ```

   Copy the returned database id into the `LEADS_DB` entry in `wrangler.jsonc`, then run:

   ```sh
   npm run worker:d1:migrate
   ```

3. Add the Postmark and feedback secrets:

   ```sh
   npm run worker:secret:postmark
   npm run worker:secret:feedback
   npm run worker:secret:inbound
   ```

   Required production secrets are `POSTMARK_SERVER_TOKEN`, `FEEDBACK_TOKEN_SECRET`, `POSTMARK_INBOUND_SECRET`, and optionally `POSTMARK_WEBHOOK_SECRET`.

4. Deploy the Worker and static assets:

   ```sh
   npm run deploy:worker
   ```

5. Wrangler will deploy `cloudflare-worker.mjs` and the files in `public/` using `wrangler.jsonc`. The route is already configured for the whole domain, while `/api/*`, `/feedback`, and the scheduled feedback Cron run through the Worker.

6. Make sure the `stonebellisimollc.com` DNS record is proxied through Cloudflare, shown as the orange cloud.
7. Confirm the route is hitting the Worker:

   ```sh
   curl -i https://stonebellisimollc.com/api/contact
   curl -i https://www.stonebellisimollc.com/api/contact
   ```

   Both should return JSON with `405 Method not allowed` for a GET request. If you see an HTML `405` from GitHub/Fastly, the Worker route is not attached yet.
8. Submit the form again. The frontend can keep posting to `/api/contact`.

You do not need a GitHub secret for this GitHub Pages deployment, because GitHub Pages has no backend runtime that can read it.

## Google Reviews Setup

The homepage calls `/api/google-reviews` to load the newest 5-star Google reviews for Stone Bellisimo. The API key must stay server-side as a Worker secret.

1. In Google Cloud, enable the Places API for the project that owns the Maps API key.
2. Add the key to the Worker:

   ```sh
   npm run worker:secret:google
   ```

   Paste the Google Maps Platform API key when Wrangler asks for the value.

3. Deploy the Worker:

   ```sh
   npm run deploy:worker
   ```

4. Confirm the live endpoint:

   ```sh
   curl -i https://stonebellisimollc.com/api/google-reviews
   ```

The public place ID, review limit, and cache duration live in `wrangler.jsonc`. Official Google Place Details responses can return up to 5 reviews, so the page keeps static fallback reviews if the live response has no matching 5-star reviews.

## Postmark Automation

The Worker now stores every valid lead in D1, sends the immediate confirmation email through Postmark, and schedules the feedback request through Worker Cron.

Postmark does not schedule the delayed email. The delay is controlled by:

```jsonc
"triggers": {
  "crons": ["0 * * * *"]
},
"vars": {
  "FEEDBACK_DELAY_DAYS": "3"
}
```

See [POSTMARK_AUTOMATION.md](./POSTMARK_AUTOMATION.md) for Postmark dashboard setup, inbound reply parsing, D1 schema, local testing, and webhook payloads.

## Alternative

Host the Node app somewhere that runs Express, such as Render, Railway, Fly.io, or a VPS. In that case point the domain at the Node app instead of using GitHub Pages.
