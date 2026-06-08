import { useState } from "react";

import { trpc } from "@/trpc";

const PDF_CONTENT_TYPE = "application/pdf";

type Status = "idle" | "uploading" | "done" | "error";

export interface AnalysisUploadFormProps {
  onAnalysisStarted: (analysisJobId: string) => void;
}

export function AnalysisUploadForm({
  onAnalysisStarted,
}: AnalysisUploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const create = trpc.analyses.create.useMutation();
  const confirm = trpc.analyses.confirmUpload.useMutation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setStatus("uploading");
    setError(null);

    try {
      const { suspectId, uploadUrl } = await create.mutateAsync({
        filename: file.name,
      });

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": PDF_CONTENT_TYPE },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`S3 PUT failed: ${putRes.status} ${putRes.statusText}`);
      }

      const { analysisJobId } = await confirm.mutateAsync({ suspectId });

      setStatus("done");
      setFile(null);
      (e.target as HTMLFormElement).reset();
      onAnalysisStarted(analysisJobId);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Suspect PDF
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={status === "uploading"}
          required
        />
      </label>
      <button type="submit" disabled={status === "uploading" || !file}>
        {status === "uploading" ? "Uploading…" : "Analyze suspect"}
      </button>
      {status === "error" && <p className="error">{error}</p>}
    </form>
  );
}
