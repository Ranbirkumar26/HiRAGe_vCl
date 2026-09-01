"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { finaliseAdminUploads } from "@/lib/actions/uploads";
import type { ActionState } from "@/lib/actions/types";
import { uploadResumeFiles } from "@/lib/upload-client";
import { Button, Card, Field, FormMessage, Input, SectionTitle } from "../ui";

export function ResumeUploader({ jobId }: { jobId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ActionState>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = progress !== null;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const files = Array.from(inputRef.current?.files ?? []);
    if (!files.length) {
      setState({ error: "Choose at least one resume to upload." });
      return;
    }

    setState({});
    setProgress({ done: 0, total: files.length });

    try {
      // Bytes go straight to storage. Only the fingerprints and the outcome
      // travel through a Server Action.
      const result = await uploadResumeFiles(jobId, files, (done, total) =>
        setProgress({ done, total }),
      );

      if (result.error) {
        setState({ error: result.error });
        return;
      }

      if (!result.uploaded.length) {
        setState({
          error: result.rejected.length
            ? result.rejected.map((r) => `${r.name}: ${r.reason}`).slice(0, 3).join(" ")
            : "Nothing was uploaded.",
        });
        return;
      }

      const outcome = await finaliseAdminUploads(jobId, result.uploaded);

      if (result.rejected.length && outcome.success) {
        setState({
          error: `${outcome.success} ${result.rejected.length} file(s) rejected: ${result.rejected
            .map((r) => `${r.name}: ${r.reason}`)
            .slice(0, 3)
            .join(" ")}`,
        });
      } else {
        setState(outcome);
      }

      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setProgress(null);
    }
  }

  return (
    <Card>
      <SectionTitle
        title="Upload resumes"
        description="PDF or Word (.docx). Files go straight to storage, so pool size is not limited by the web tier. Uploading the same file twice costs nothing, it is recognised by content."
      />
      <form onSubmit={onSubmit} className="space-y-4">
        {state.error ? <FormMessage status="error">{state.error}</FormMessage> : null}
        {state.success ? (
          <FormMessage status="success">{state.success}</FormMessage>
        ) : null}

        <Field label="Resume files">
          <Input
            ref={inputRef}
            type="file"
            name="resumes"
            accept=".pdf,.docx"
            multiple
            required
            disabled={busy}
          />
        </Field>

        {progress ? (
          <div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted">
              Uploading {progress.done} of {progress.total}
            </p>
          </div>
        ) : null}

        <Button type="submit" disabled={busy}>
          {busy ? "Uploading..." : "Upload"}
        </Button>
      </form>
    </Card>
  );
}
