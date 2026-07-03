import {
  handleContactRequest,
  handleFeedbackRequest,
  handlePostmarkInboundRequest,
  handlePostmarkWebhookRequest,
  methodNotAllowed,
  processDueFeedbackEmails,
  SECURITY_HEADERS,
  withSecurityHeaders
} from './src/lead-automation.mjs';
import { handleGoogleReviewsRequest } from './src/google-reviews.mjs';

const SECURITY_TXT = `Contact: mailto:Stonebellisimollc@outlook.com
Preferred-Languages: en
Canonical: https://stonebellisimollc.com/.well-known/security.txt
Expires: 2027-06-26T23:59:59Z
`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.protocol === 'http:' || request.headers.get('x-forwarded-proto') === 'http') {
      url.protocol = 'https:';
      return Response.redirect(url, 301);
    }

    if (url.pathname === '/api/contact') {
      return handleContactRequest(request, env, { requireWebhook: true });
    }

    if (url.pathname === '/api/google-reviews') {
      return handleGoogleReviewsRequest(request, env);
    }

    if (url.pathname === '/feedback') {
      return handleFeedbackRequest(request, env);
    }

    if (url.pathname === '/api/postmark/inbound') {
      return handlePostmarkInboundRequest(request, env);
    }

    if (url.pathname === '/api/postmark/webhook') {
      return handlePostmarkWebhookRequest(request, env);
    }

    if (url.pathname === '/.well-known/security.txt' || url.pathname === '/security.txt') {
      return new Response(SECURITY_TXT, {
        headers: {
          ...SECURITY_HEADERS,
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'public, max-age=3600'
        }
      });
    }

    if (url.pathname === '/favicon.ico') {
      return Response.redirect(new URL('/assets/img/logo-280.png', url), 302);
    }

    if (url.pathname === '/api/performance') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
      if (request.method !== 'POST') return methodNotAllowed(['POST', 'OPTIONS']);
      return new Response(null, { status: 204 });
    }

    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },

  async scheduled(controller, env) {
    const result = await processDueFeedbackEmails(env);
    console.info('Stone Bellisimo feedback cron processed:', {
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
      ...result
    });
  }
};
