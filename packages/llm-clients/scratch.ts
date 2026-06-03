// Usage: npx tsx --env-file=../../.env scratch.ts
//
// Single Mistral embedding call with diagnostic logging from the client.
// STOP the worker first to ensure no other process is using the API key.
//
// To test pacing/batching, set CALLS > 1 or pass a longer input array.

import {
  embed,
  MISTRAL_DEFAULT_MODEL,
  MISTRAL_EMBEDDING_DIM,
} from "./src/mistral";

const CALLS = 1;

console.log(`[scratch] start at ${new Date().toISOString()}`);
console.log(
  `[scratch] model=${MISTRAL_DEFAULT_MODEL}, expected dim=${MISTRAL_EMBEDDING_DIM}`,
);
console.log(`[scratch] planned calls: ${CALLS}\n`);

const t0 = Date.now();

for (let i = 1; i <= CALLS; i++) {
  const startedAt = Date.now() - t0;
  try {
    const result = await embed([`scratch probe ${i} at +${startedAt}ms`]);
    const completedAt = Date.now() - t0;
    console.log(
      `\n[scratch] call ${i} OK: started+${startedAt}ms completed+${completedAt}ms ` +
        `(elapsed ${completedAt - startedAt}ms) dim=${result.embeddings[0].length}\n`,
    );
  } catch (err) {
    const completedAt = Date.now() - t0;
    console.error(
      `\n[scratch] call ${i} FAILED at +${completedAt}ms after ${completedAt - startedAt}ms`,
    );
    console.error(err);
    process.exit(1);
  }
}

console.log(`[scratch] all done in ${Date.now() - t0}ms`);
