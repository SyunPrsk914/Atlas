import { register } from 'node:module';

register(new URL('./ext-loader.mjs', import.meta.url).href, {
  parentURL: import.meta.url,
});
