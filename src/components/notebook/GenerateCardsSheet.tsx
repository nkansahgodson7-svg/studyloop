"use client";

import { useState } from "react";
import { SheetFrame } from "@/components/ui/Sheet";
import type { NotebookSource } from "@/lib/client/notebook-data";

export default function GenerateCardsSheetContent({
  sources,
  onConfirm
}: {
  sources: NotebookSource[];
  onConfirm: (sourceIds: number[]) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(sources.map((source) => source.id)));

  function toggle(id: number, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <SheetFrame
      title="Generate cards"
      sub="Choose sources to draw from."
      formId="generateSourceForm"
      onSubmit={() => void onConfirm([...selected])}
      body={
        <div className="stack gap-2">
          {sources.map((source) => (
            <label key={source.id} className="field">
              <input
                type="checkbox"
                className="check"
                data-source-id={source.id}
                checked={selected.has(source.id)}
                onChange={(event) => toggle(source.id, event.target.checked)}
              />
              <span>{source.title}</span>
            </label>
          ))}
        </div>
      }
      foot={
        <button className="btn btn--primary btn--block" type="submit" form="generateSourceForm">
          Generate
        </button>
      }
    />
  );
}
