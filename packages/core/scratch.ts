// Usage: npx tsx --env-file=../../.env scratch.ts

import { judge } from "./src/judge";

const suspectSummary =
  "We propose a sequence-to-sequence model that relies entirely on self-attention. The transformer architecture dispenses with recurrence and convolutions altogether. By computing attention scores between all pairs of positions in the input, it captures long-range dependencies more directly than previous models, achieving state of the art on translation benchmarks while training in significantly less wall-clock time.";

const candidateSummary =
  "Photosynthesis in C4 plants involves a spatial separation of the initial CO2 fixation step from the Calvin cycle. PEP carboxylase fixes CO2 into oxaloacetate in mesophyll cells, which is then transported to bundle sheath cells where the Calvin cycle operates under elevated CO2 concentrations. This adaptation reduces photorespiration and improves water-use efficiency in hot, dry environments compared to C3 plants.";

const pair1Suspect =
  "We propose a sequence-to-sequence model that relies entirely on self-attention.";
const pair1Source =
  "Photosynthesis in C4 plants involves a spatial separation of the initial CO2 fixation step from the Calvin cycle.";

const pair2Suspect =
  "achieving state of the art on translation benchmarks while training in significantly less wall-clock time";
const pair2Source =
  "This adaptation reduces photorespiration and improves water-use efficiency in hot, dry environments compared to C3 plants.";

const pair3Suspect =
  "By computing attention scores between all pairs of positions in the input";
const pair3Source =
  "PEP carboxylase fixes CO2 into oxaloacetate in mesophyll cells";

const t0 = Date.now();

const result = await judge({
  suspectSummary,
  candidate: {
    documentId: "99999999-9999-9999-9999-999999999999",
    title: "Hatch & Slack (1966) — Photosynthesis by Sugar-Cane Leaves",
    summary: candidateSummary,
    evidencePairs: [
      { suspectText: pair1Suspect, sourceText: pair1Source, score: 0.18 },
      { suspectText: pair2Suspect, sourceText: pair2Source, score: 0.14 },
      { suspectText: pair3Suspect, sourceText: pair3Source, score: 0.11 },
    ],
  },
});

console.log(`\n[scratch] completed in ${Date.now() - t0}ms\n`);
console.log(JSON.stringify(result, null, 2));
