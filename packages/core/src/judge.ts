import { callTool } from "@repo/llm-clients";
import { type Verdict, VerdictSchema } from "@repo/schemas";

const { $schema: _verdictSchemaDollarSchema, ...VERDICT_INPUT_SCHEMA } =
  VerdictSchema.toJSONSchema({ reused: "inline" });

export interface JudgeEvidencePair {
  suspectText: string;
  sourceText: string;
  score: number;
}

export interface JudgeCandidate {
  documentId: string;
  title: string;
  summary: string;
  evidencePairs: JudgeEvidencePair[];
}

export interface JudgeInput {
  suspectSummary: string;
  candidate: JudgeCandidate;
}

export async function judge(input: JudgeInput): Promise<Verdict> {
  console.log(
    `[judge] candidate=${input.candidate.documentId} pairs=${input.candidate.evidencePairs.length}`,
  );

  const result = await callTool({
    systemPrompt: JUDGE_SYSTEM_PROMPT,
    userMessage: buildJudgeUserMessage(input),
    toolName: "report_verdict",
    toolDescription:
      "Emit a verdict for whether the suspect document derives from the presented candidate library document.",
    toolInputSchema: VERDICT_INPUT_SCHEMA,
  });

  const parsed = VerdictSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(
      `judge: response failed validation. error=${parsed.error.message}`,
    );
  }
  return parsed.data;
}

function buildJudgeUserMessage(input: JudgeInput): string {
  const pairs = input.candidate.evidencePairs
    .map(
      (p, idx) => `<pair idx="${idx}" score="${p.score.toFixed(4)}">
<suspect_text>
${p.suspectText}
</suspect_text>
<source_text>
${p.sourceText}
</source_text>
</pair>`,
    )
    .join("\n\n");

  return `<suspect_summary>
${input.suspectSummary}
</suspect_summary>

<candidate doc_id="${input.candidate.documentId}" title="${input.candidate.title}">
<summary>
${input.candidate.summary}
</summary>

<evidence_pairs>
${pairs}
</evidence_pairs>
</candidate>

Emit your verdict for whether the suspect derives from this candidate document.`;
}

const JUDGE_SYSTEM_PROMPT = `You evaluate whether a suspect document contains plagiarized content from a single candidate library document. You receive: a summary of the suspect, a summary of the candidate, and a small set of retrieval-aligned evidence pairs (suspect passages alongside their matching library passages, with similarity scores).

Emit a single verdict for this candidate.

Verdict labels:
- "plagiarism": clear unauthorized reuse — verbatim copying or close paraphrase. Confidence 0.7 or higher.
- "paraphrase": semantic reuse with substantial rewording, OR verbatim content with mitigating context (properly cited quotations, standard boilerplate). Confidence calibrated to evidence strength.
- "no_match": only weak or coincidental signals — shared domain terminology without specific copied content.

Confidence calibration:
- 0.9+: strong evidence across one or more pairs of verbatim or near-verbatim copying.
- 0.5 to 0.7: clear paraphrase, or verbatim content with plausible alternative explanations.
- 0.3 to 0.5: weak signals across the pairs.
- Below 0.3: pair with "no_match".

Evidence selection:
- Include 1 to 5 evidence pairs in your response, quoting the suspect and source passages verbatim.
- Prefer pairs that most strongly support your verdict.
- Each pair's \`note\` field should briefly explain why it supports the verdict.

Guidelines:
- Shared domain terminology alone is not plagiarism. Most academic writing uses common technical vocabulary.
- Generic field statements are less suspicious than copied experimental details, specific phrasings, or unusual sentence structures.
- Multiple high-similarity pairs are a much stronger signal than a single isolated match.
- The retrieval similarity scores indicate textual overlap, not authorship. High scores warrant attention but do not by themselves prove plagiarism.

Respond via the \`report_verdict\` tool.`;
