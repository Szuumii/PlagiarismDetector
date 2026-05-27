import { trpc } from "@/trpc";

export function App() {
  const ping = trpc.health.ping.useQuery();

  return (
    <main>
      <h1>Plagiarism Detector</h1>
      <p>
        api health:{" "}
        {ping.data
          ? `ok (ts ${ping.data.ts})`
          : ping.isLoading
            ? "checking…"
            : "unavailable"}
      </p>
    </main>
  );
}
