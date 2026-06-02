import { useState } from "react";

import { trpc } from "@/trpc";

// Must match the ContentType pinned in the api's presignUploadUrl. Mismatch → S3 403.
const PDF_CONTENT_TYPE = "application/pdf";

type Status = "idle" | "uploading" | "done" | "error";

export function LibraryUploadForm() {
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const create = trpc.library.documents.create.useMutation();
  const confirm = trpc.library.documents.confirmUpload.useMutation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title.trim()) return;

    setStatus("uploading");
    setError(null);

    try {
      const { documentId, uploadUrl } = await create.mutateAsync({
        title: title.trim(),
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

      await confirm.mutateAsync({ documentId });

      setStatus("done");
      setTitle("");
      setFile(null);
      (e.target as HTMLFormElement).reset();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Title
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={status === "uploading"}
          required
        />
      </label>
      <label>
        PDF
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={status === "uploading"}
          required
        />
      </label>
      <button
        type="submit"
        disabled={status === "uploading" || !file || !title.trim()}
      >
        {status === "uploading" ? "Uploading…" : "Upload library doc"}
      </button>
      {status === "done" && (
        <p className="status-done">
          Uploaded. The indexer will process it shortly.
        </p>
      )}
      {status === "error" && <p className="error">{error}</p>}
    </form>
  );
}
