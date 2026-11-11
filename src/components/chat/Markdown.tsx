"use client";

import { useState, type ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { Icon } from "@/components/ui/icons";

type Block =
  | { type: "p"; text: string }
  | { type: "h"; level: number; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; lang: string; code: string }
  | { type: "math"; tex: string }
  | { type: "table"; align: Align[]; head: string[]; rows: string[][] };

type Align = "left" | "center" | "right" | null;

/** The model sometimes repeats its control line mid-answer; never show it. */
function stripControlMarkers(text: string): string {
  return text
    .replace(/\[\s*\[\s*grounding\s*:[^\]]*\]\s*\]/gi, "")
    .replace(/\[\s*\[\s*used\s*:[^\]]*\]\s*\]/gi, "");
}

function renderTex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
      output: "html"
    });
  } catch {
    return tex;
  }
}

function MathSpan({ tex, display }: { tex: string; display: boolean }) {
  return (
    <span
      className={display ? "md-math md-math--display" : "md-math"}
      // KaTeX escapes its input and runs with `trust: false`, so this cannot
      // inject markup from model output.
      dangerouslySetInnerHTML={{ __html: renderTex(tex, display) }}
    />
  );
}

// Ordered so `**bold**` wins over `*em*`, code wins over everything, and maths
// is captured before emphasis so `_`/`*` inside TeX are left untouched.
const INLINE_RE =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$(?!\s)[^$\n]*?[^\s$]\$)/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(INLINE_RE);
  return parts.map((part, index) => {
    if (part.length === 0) return null;
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key}>{inline(part.slice(2, -2), `${key}-b`)}</strong>;
    }
    if (part.startsWith("\\(") && part.endsWith("\\)") && part.length > 4) {
      return <MathSpan key={key} tex={part.slice(2, -2)} display={false} />;
    }
    if (part.startsWith("\\[") && part.endsWith("\\]") && part.length > 4) {
      return <MathSpan key={key} tex={part.slice(2, -2)} display />;
    }
    if (part.startsWith("$$") && part.endsWith("$$") && part.length > 4) {
      return <MathSpan key={key} tex={part.slice(2, -2)} display />;
    }
    if (part.startsWith("$") && part.endsWith("$") && part.length > 2) {
      return <MathSpan key={key} tex={part.slice(1, -1)} display={false} />;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("_") && part.endsWith("_") && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)+\|?\s*$/;

function splitRow(row: string): string[] {
  const text = row.trim();
  const cells: string[] = [];
  let current = "";
  let closing = "";

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    const next = text[i + 1];

    if (closing) {
      // Inside maths, a pipe belongs to the expression (e.g. `\|v\|`).
      if (char === "\\" && (next === closing || next === "\\")) {
        current += char + next;
        if (next === closing) closing = "";
        i += 1;
      } else if (char === closing) {
        current += char;
        closing = "";
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\\" && (next === "(" || next === "[")) {
      closing = next === "(" ? ")" : "]";
      current += char + next;
      i += 1;
      continue;
    }
    if (char === "$") {
      closing = "$";
      current += char;
      continue;
    }
    if (char === "\\" && next === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());

  if (cells.length > 1 && cells[0] === "" && text.startsWith("|")) cells.shift();
  if (cells.length > 1 && cells[cells.length - 1] === "" && text.endsWith("|")) cells.pop();
  return cells;
}

function parseAlign(cell: string): Align {
  const trimmed = cell.trim();
  const left = trimmed.startsWith(":");
  const right = trimmed.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

function parse(text: string): Block[] {
  const lines = stripControlMarkers(text).replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    const fence = /^```([\w-]*)\s*$/.exec(trimmed);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test((lines[index] ?? "").trim())) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      index += 1; // closing fence (or end of a still-streaming block)
      blocks.push({ type: "code", lang: fence[1] ?? "", code: code.join("\n") });
      continue;
    }

    // Display maths: \[ ... \] or $$ ... $$, possibly spanning lines.
    if (trimmed.startsWith("\\[") || trimmed.startsWith("$$")) {
      const open = trimmed.startsWith("\\[") ? "\\[" : "$$";
      const close = open === "\\[" ? "\\]" : "$$";
      const collected: string[] = [];
      let rest = trimmed.slice(open.length);
      let closed = false;
      for (;;) {
        const end = rest.indexOf(close);
        if (end >= 0) {
          collected.push(rest.slice(0, end));
          rest = rest.slice(end + close.length);
          closed = true;
          break;
        }
        collected.push(rest);
        index += 1;
        if (index >= lines.length) break;
        rest = lines[index] ?? "";
      }
      index += 1;
      blocks.push({ type: "math", tex: collected.join("\n").trim() });
      if (!closed && rest.trim().length > 0) {
        blocks.push({ type: "p", text: rest.trim() });
      }
      continue;
    }

    // A pipe table needs a header row followed by an alignment/divider row.
    if (
      line.includes("|") &&
      index + 1 < lines.length &&
      TABLE_SEPARATOR.test(lines[index + 1] ?? "") &&
      splitRow(line).length > 1
    ) {
      const head = splitRow(line);
      const align = splitRow(lines[index + 1] ?? "").map(parseAlign);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length) {
        const row = lines[index] ?? "";
        if (row.trim().length === 0 || !row.includes("|")) break;
        rows.push(splitRow(row));
        index += 1;
      }
      blocks.push({ type: "table", align, head, rows });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "h", level: heading[1]!.length, text: heading[2]!.trim() });
      index += 1;
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^\s*[-*+]\s+(.*)$/.exec(lines[index] ?? "");
        if (!item) break;
        items.push(item[1]!);
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^\s*\d+[.)]\s+(.*)$/.exec(lines[index] ?? "");
        if (!item) break;
        items.push(item[1]!);
        index += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    if (trimmed.length === 0) {
      index += 1;
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (
        next.trim().length === 0 ||
        next.trim().startsWith("```") ||
        next.trim().startsWith("\\[") ||
        next.trim().startsWith("$$") ||
        /^#{1,6}\s+/.test(next) ||
        /^\s*[-*+]\s+/.test(next) ||
        /^\s*\d+[.)]\s+/.test(next) ||
        (next.includes("|") &&
          index + 1 < lines.length &&
          TABLE_SEPARATOR.test(lines[index + 1] ?? ""))
      ) {
        break;
      }
      paragraph.push(next);
      index += 1;
    }
    blocks.push({ type: "p", text: paragraph.join("\n") });
  }

  return blocks;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="md-code">
      <div className="md-code__head">
        <span>{lang || "code"}</span>
        <button
          type="button"
          className="md-code__copy"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(code)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              })
              .catch(() => undefined);
          }}
        >
          <Icon name={copied ? "check" : "copy"} size={13} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Renders the Markdown subset we allow in answers: paragraphs, emphasis,
 * lists, headings, tables, inline code, fenced code and LaTeX maths. Nothing is
 * injected as HTML except KaTeX's own escaped output, so model output cannot
 * introduce markup.
 */
export default function Markdown({ text }: { text: string }) {
  const blocks = parse(text);
  return (
    <div className="md">
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return <CodeBlock key={index} lang={block.lang} code={block.code} />;
        }
        if (block.type === "math") {
          return (
            <div key={index} className="md-math-block">
              <MathSpan tex={block.tex} display />
            </div>
          );
        }
        if (block.type === "table") {
          return (
            <div key={index} className="md-table-wrap">
              <table>
                <thead>
                  <tr>
                    {block.head.map((cell, cellIndex) => (
                      <th
                        key={cellIndex}
                        style={block.align[cellIndex] ? { textAlign: block.align[cellIndex]! } : undefined}
                      >
                        {inline(cell, `th${index}-${cellIndex}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {block.head.map((_, cellIndex) => (
                        <td
                          key={cellIndex}
                          style={
                            block.align[cellIndex]
                              ? { textAlign: block.align[cellIndex]! }
                              : undefined
                          }
                        >
                          {inline(row[cellIndex] ?? "", `td${index}-${rowIndex}-${cellIndex}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.type === "h") {
          return <p key={index} className="md-h">{inline(block.text, `h${index}`)}</p>;
        }
        if (block.type === "ul") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inline(item, `ul${index}-${itemIndex}`)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "ol") {
          return (
            <ol key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inline(item, `ol${index}-${itemIndex}`)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={index}>
            {block.text.split("\n").map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {inline(line, `p${index}-${lineIndex}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
