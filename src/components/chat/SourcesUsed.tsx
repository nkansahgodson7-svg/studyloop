"use client";

import type { ChatSourceRef } from "@/lib/client/chat";

export default function SourcesUsed({ sources }: { sources: ChatSourceRef[] }) {
  if (sources.length === 0) {
    return null;
  }
  return (
    <details className="sources-used">
      <summary className="sources-used__summary">
        {sources.length === 1 ? "1 source used" : `${sources.length} sources used`}
      </summary>
      <ul className="sources-used__list">
        {sources.map((source) => (
          <li key={`${source.sourceId}-${source.ord}`}>
            <span className="sources-used__title">{source.sourceTitle}</span>
            {source.label ? <span className="sources-used__meta">{source.label}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
