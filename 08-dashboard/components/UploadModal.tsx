"use client";

import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { uploadReference } from "@/lib/daemon-client";
import { Icon } from "./Icon";

interface Props {
  onClose: () => void;
  onUploaded?: () => void;
}

export function UploadModal({ onClose, onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [projectId, setProjectId] = useState("global");
  const [tags, setTags] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const m = useMutation({
    mutationFn: () =>
      uploadReference(file!, {
        project_id: projectId,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      }),
    onSuccess: (r) => {
      if (r.ok) {
        onUploaded?.();
        onClose();
      }
    },
  });

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center px-6"
      style={{ background: "var(--c-bg-overlay)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-panel bg-surface1 hairline p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-base font-emphasized">Upload reference</h2>
          <button
            onClick={onClose}
            aria-label="Close upload modal"
            className="text-txt3 hover:text-txt1"
          >
            <Icon name="X" size={18} />
          </button>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`rounded-card border-2 border-dashed p-6 text-center cursor-pointer transition ${
            dragActive ? "border-brand bg-brand/5" : "border-border1 bg-surface2"
          }`}
        >
          <Icon name="UploadCloud" className="text-brandSoft mx-auto mb-2" size={24} />
          {file ? (
            <div>
              <div className="text-sm text-txt1 font-emphasized">{file.name}</div>
              <div className="text-nano text-txt3 mt-0.5">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </div>
            </div>
          ) : (
            <div>
              <div className="text-sm text-txt1">Drop a file or click to choose</div>
              <div className="text-nano text-txt3 mt-1">
                PDF, image, markdown, docx — 100 MB max
              </div>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="upload-project" className="text-nano text-txt3 block mb-1">
              Project
            </label>
            <input
              id="upload-project"
              name="upload-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="warehouse-sim, autolisp-skill, or 'global'"
              className="w-full h-9 px-3 rounded-input bg-surface2 hairline text-txt1 outline-none focus:ring-1 focus:ring-brand/60 text-sm font-mono"
            />
          </div>
          <div>
            <label htmlFor="upload-tags" className="text-nano text-txt3 block mb-1">
              Tags (comma-separated)
            </label>
            <input
              id="upload-tags"
              name="upload-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="manual, conveyor, spec"
              className="w-full h-9 px-3 rounded-input bg-surface2 hairline text-txt1 outline-none focus:ring-1 focus:ring-brand/60 text-sm font-mono"
            />
          </div>
        </div>

        {m.isError && (
          <div className="mt-3 text-xs text-err font-mono">
            Upload failed: {(m.error as Error).message}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-input text-txt3 hover:text-txt1 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={() => m.mutate()}
            disabled={!file || m.isPending}
            className="h-9 px-4 rounded-input bg-brand hover:bg-brand/90 text-base text-sm font-emphasized disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {m.isPending ? "uploading…" : "upload + ingest"}
          </button>
        </div>
      </div>
    </div>
  );
}
