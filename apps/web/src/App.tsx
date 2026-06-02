import { useState } from "react";

import "@/App.css";
import { AnalysisResults } from "@/components/AnalysisResults";
import { AnalysisUploadForm } from "@/components/AnalysisUploadForm";
import { LibraryUploadForm } from "@/components/LibraryUploadForm";

export function App() {
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);

  return (
    <main>
      <h1>Plagiarism Detector</h1>

      <section>
        <h2>Library</h2>
        <p>
          Add a reference document to the shared library. It'll be indexed
          asynchronously.
        </p>
        <LibraryUploadForm />
      </section>

      <section>
        <h2>Analyze</h2>
        <p>Upload a suspect PDF and see verdicts against the library.</p>
        <AnalysisUploadForm onAnalysisStarted={setAnalysisJobId} />
        {analysisJobId && <AnalysisResults analysisJobId={analysisJobId} />}
      </section>
    </main>
  );
}
