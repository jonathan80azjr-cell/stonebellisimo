import { build } from 'esbuild';

const shared = {
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ['es2020'],
  legalComments: 'none',
  logLevel: 'info'
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ['src/client/site-analytics.js'],
    outfile: 'public/performance.js',
    format: 'iife'
  }),
  build({
    ...shared,
    entryPoints: ['src/client/admin.js'],
    outfile: 'public/assets/js/admin.js',
    format: 'iife'
  })
]);
