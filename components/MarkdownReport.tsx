"use client";

import { Copy, Download } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState } from "react";

export function MarkdownReport({ content, title }: { content: string; title: string }) {
  const [copied, setCopied] = useState(false);

  async function copyReport() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function downloadReport() {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-consilium-report.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="border border-[var(--line)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-lg font-semibold">Final report</h2>
        <div className="flex gap-2">
          <button className="icon-button" type="button" onClick={copyReport} title="Copy report">
            <Copy size={16} aria-hidden="true" />
            <span className="sr-only">{copied ? "Copied" : "Copy report"}</span>
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={downloadReport}
            title="Download markdown"
          >
            <Download size={16} aria-hidden="true" />
            <span className="sr-only">Download markdown</span>
          </button>
        </div>
      </div>
      <article className="prose-consilium max-w-none px-5 py-5">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </article>
    </section>
  );
}
