import { existsSync } from 'node:fs';

const isDevScript =
  process.env.npm_lifecycle_event === 'dev' ||
  process.execArgv.some((arg) => arg.includes('tsx'));

if (!isDevScript && existsSync('./dist/server/index.js')) {
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'production';
  }
  await import('./dist/server/index.js');
} else {
  await import('./src/server/index.js');
}
