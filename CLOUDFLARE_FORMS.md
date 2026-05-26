# Fixing the Contact Form 405 on Static Hosting

The site currently posts the estimate wizard to `/api/contact`. That route exists in `server.js`, but `npm run deploy` publishes only `public/` to GitHub Pages. GitHub Pages cannot run `server.js` or read `.env`, so production treats `/api/contact` like a static URL and returns a 405/404 instead of forwarding the lead to n8n.

## Best Option If the Domain Uses Cloudflare

Keep GitHub Pages for the static site and use a Cloudflare Worker only for `/api/*`.

1. Create a Worker in Cloudflare.
2. Use `cloudflare-worker.mjs` as the Worker code.
3. Add a Worker secret or environment variable named `N8N_WEBHOOK_URL` with the production n8n webhook URL.
4. Add a Worker route for:

   ```text
   stonebellisimollc.com/api/*
   ```

5. Make sure the `stonebellisimollc.com` DNS record is proxied through Cloudflare, shown as the orange cloud.
6. Submit the form again. The frontend can keep posting to `/api/contact`.

You do not add the webhook to Cloudflare DNS. You add it as a Worker secret/env var. You also do not need a GitHub secret for this GitHub Pages deployment, because GitHub Pages has no backend runtime that can read it.

## Alternative

Host the Node app somewhere that runs Express, such as Render, Railway, Fly.io, or a VPS. In that case set `N8N_WEBHOOK_URL` in that hosting provider and point the domain at the Node app instead of using GitHub Pages.
