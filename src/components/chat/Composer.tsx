"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/ui/icons";
import { CHAT_QUESTION_MAX } from "@/lib/chat-limits";

export default function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  placeholder: string;
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const area = inputRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 144)}px`;
  }, [value]);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const canSend = value.trim().length > 0 && !disabled && !streaming;

  return (
    <form
      className="composer composer--chat"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) onSend();
      }}
    >
      <div className="composer__inner">
        <textarea
          ref={inputRef}
          rows={1}
          autoComplete="off"
          maxLength={CHAT_QUESTION_MAX}
          placeholder={placeholder}
          aria-label="Ask a question"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            if (event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (canSend) onSend();
          }}
        />
        {streaming ? (
          <button className="icon-btn composer__stop" type="button" onClick={onStop} aria-label="Stop generating">
            <Icon name="stop" size={16} />
          </button>
        ) : (
          <button className="icon-btn" type="submit" aria-label="Send question" disabled={!canSend}>
            <Icon name="send" size={18} />
          </button>
        )}
      </div>
      {value.length > CHAT_QUESTION_MAX - 200 ? (
        <p className="composer__count">
          {value.length}/{CHAT_QUESTION_MAX}
        </p>
      ) : null}
    </form>
  );
}
