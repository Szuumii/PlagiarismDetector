// Usage: npx tsx --env-file=../../.env scratch.ts

import { evaluateChunk } from "./src/judge";

const suspectText =
  "The transformer architecture relies entirely on self-attention mechanisms, dispensing with recurrence and convolutions altogether. By computing attention scores between all pairs of positions in the input, it captures long-range dependencies more directly than previous sequence models.";

const verbatim = suspectText;

const paraphrase =
  "Transformers abandon recurrent and convolutional layers, building sequences purely through self-attention. Pairwise attention between every input position allows the model to surface distant dependencies that older architectures struggled with.";

const unrelated =
  "Photosynthesis converts light energy into chemical energy stored in glucose. The process occurs primarily in the chloroplasts of plant cells, where chlorophyll absorbs photons and drives the conversion of carbon dioxide and water into sugars and oxygen.";

const t0 = Date.now();

const result = await evaluateChunk({
  suspectChunkIdx: 4,
  suspectText,
  candidates: [
    {
      documentId: "11111111-1111-1111-1111-111111111111",
      title: "Verbatim source",
      content: verbatim,
    },
    {
      documentId: "22222222-2222-2222-2222-222222222222",
      title: "Paraphrased source",
      content: paraphrase,
    },
    {
      documentId: "33333333-3333-3333-3333-333333333333",
      title: "Unrelated source",
      content: unrelated,
    },
  ],
});

console.log(`\n[scratch] completed in ${Date.now() - t0}ms\n`);
console.log(JSON.stringify(result, null, 2));
