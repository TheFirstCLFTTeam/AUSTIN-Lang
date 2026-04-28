// Registers the adjacent JSON loader hook. Used with `node --import` so the
// loader is active before dump_mocks.mjs starts resolving imports.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./json-loader.mjs', pathToFileURL('./').href);
