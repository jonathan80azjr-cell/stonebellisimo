# Fixing the Contact Form 405 on Static Hosting

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

2. Add the n8n URL as a Worker secret:

   ```sh
   npm run worker:secret
   ```

   Paste the production n8n webhook URL when Wrangler asks for the value.

3. Deploy the Worker and static assets:

   ```sh
   npm run deploy:worker
   ```

4. Wrangler will deploy `cloudflare-worker.mjs` and the files in `public/` using `wrangler.jsonc`. The route is already configured for the whole domain, while `/api/*` runs the Worker code first.

5. Make sure the `stonebellisimollc.com` DNS record is proxied through Cloudflare, shown as the orange cloud.
6. Confirm the route is hitting the Worker:

   ```sh
   curl -i https://stonebellisimollc.com/api/contact
   curl -i https://www.stonebellisimollc.com/api/contact
   ```

   Both should return JSON with `405 Method not allowed` for a GET request. If you see an HTML `405` from GitHub/Fastly, the Worker route is not attached yet.
7. Submit the form again. The frontend can keep posting to `/api/contact`.

You do not add the webhook to Cloudflare DNS. You add it as a Worker secret/env var. You also do not need a GitHub secret for this GitHub Pages deployment, because GitHub Pages has no backend runtime that can read it.

## Alternative

Host the Node app somewhere that runs Express, such as Render, Railway, Fly.io, or a VPS. In that case set `N8N_WEBHOOK_URL` in that hosting provider and point the domain at the Node app instead of using GitHub Pages.
