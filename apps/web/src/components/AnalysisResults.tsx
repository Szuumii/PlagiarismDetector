import { trpc } from "@/trpc";

export interface AnalysisResultsProps {
  analysisJobId: string;
}

export function AnalysisResults({ analysisJobId }: AnalysisResultsProps) {
  const query = trpc.analyses.get.useQuery(
    { analysisJobId },
    {
      refetchInterval: (q) => {
        const status = q.state.data?.status;
        if (status === "done" || status === "failed") return false;
        return 1500;
      },
    },
  );

  if (query.isLoading) {
    return <p>Loading analysis…</p>;
  }
  if (query.error) {
    return <p className="error">Failed to load: {query.error.message}</p>;
  }
  if (!query.data) {
    return null;
  }

  const { status, error, startedAt, completedAt, verdicts } = query.data;

  return (
    <div>
      <p>
        <strong>Analysis</strong>{" "}
        <code>{analysisJobId.slice(0, 8)}…</code> — status:{" "}
        <span className={status === "failed" ? "error" : "status-done"}>
          {status}
        </span>
      </p>
      {error && <p className="error">{error}</p>}
      <p>
        started: {startedAt ?? "—"} / completed: {completedAt ?? "—"}
      </p>

      <h3>Verdicts ({verdicts.length})</h3>
      {verdicts.length === 0 ? (
        <p>
          <em>No verdicts yet.</em>
        </p>
      ) : (
        verdicts.map((v) => (
          <div key={v.id} className="verdict">
            <p>
              <strong>{v.label}</strong> · confidence {v.confidence.toFixed(2)} ·
              searchScore {v.searchScore.toFixed(2)}
            </p>
            <p>
              against doc <code>{v.candidateDocId.slice(0, 8)}…</code>
            </p>
            <p>{v.reasoning}</p>
            {v.evidence.length === 0 ? (
              <p className="evidence">
                <em>(no evidence)</em>
              </p>
            ) : (
              v.evidence.map((e) => (
                <div key={e.pairIndex} className="evidence">
                  <p>
                    <strong>Suspect:</strong> {e.suspectText}
                  </p>
                  <p>
                    <strong>Source:</strong> {e.sourceText}
                  </p>
                  <p>
                    <em>{e.note}</em>
                  </p>
                </div>
              ))
            )}
          </div>
        ))
      )}
    </div>
  );
}
