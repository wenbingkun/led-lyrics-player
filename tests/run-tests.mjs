import { finalize } from './test-helpers.mjs';

await import('./utils.test.mjs');
await import('./player.core.test.mjs');
await import('./player.ui.test.mjs');

finalize();
