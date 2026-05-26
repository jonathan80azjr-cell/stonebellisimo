# Fixing the Contact Form 405 on Static Hosting

The site currently posts the estimate wizard to `/api/contact`. That route exists in `server.js`, but `npm run deploy` publishes only `public/` to GitHub Pages. GitHub Pages cannot run `server.js` or read `.env`, so production treats `/api/contact` like a static URL and returns a 405/404 instead of forwarding the lead to n8n.

## Best Option If the Domain Uses Cloudflare

Keep GitHub Pages for the static site and use a Cloudflare Worker only for `/api/*`.

Do not use Cloudflare's "Upload and deploy" static-file screen for `cloudflare-worker.mjs`. A Worker JavaScript file has to be deployed with Wrangler.

1. From this project folder, log in to Cloudflare:

   ```sh
   npx wrangler login
   ```

2. Add the n8n URL as a Worker secret:

   ```sh
   npm run worker:secret
   ```

   Paste the production n8n webhook URL when Wrangler asks for the value.

3. Deploy the Worker:

   ```sh
   npm run deploy:worker
   ```

4. Wrangler will deploy `cloudflare-worker.mjs` using `wrangler.jsonc`. The route is already configured as:

   ```text
   stonebellisimollc.com/api/*
   www.stonebellisimollc.com/api/*
   ```

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
