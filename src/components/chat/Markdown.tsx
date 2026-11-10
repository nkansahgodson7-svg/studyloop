"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icons";

type Block =
  | { type: "p"; text: string }
  | { type: "h"; level: number; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; lang: string; code: string };

function inline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`)/g);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("_") && part.endsWith("_") && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function parse(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    const fence = /^```([\w-]*)\s*$/.exec(line.trim());
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

    const heading = /^(#{3,6})\s+(.*)$/.exec(line);
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

    if (line.trim().length === 0) {
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
        /^(#{3,6})\s+/.test(next) ||
        /^\s*[-*+]\s+/.test(next) ||
        /^\s*\d+[.)]\s+/.test(next)
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
 * lists, headings, inline code and fenced code. Nothing is injected as HTML, so
 * model output cannot introduce markup.
 */
export default function Markdown({ text }: { text: string }) {
  const blocks = parse(text);
  return (
    <div className="md">
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return <CodeBlock key={index} lang={block.lang} code={block.code} />;
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
