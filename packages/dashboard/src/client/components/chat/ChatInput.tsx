import { useState, useRef, useEffect } from 'react';

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
  rootName?: string;
}

export function ChatInput({ onSend, disabled, rootName = 'CEO' }: ChatInputProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (text.trim() && !disabled) {
        onSend(text.trim());
        setText('');
      }
    }
  };

  return (
    <div className="border-t border-slate-800 p-4">
      <div className="flex gap-3 items-end">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Type a message to ${rootName}...`}
          rows={1}
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-amber-500 transition-colors"
        />
        <button
          onClick={() => { if (text.trim()) { onSend(text.trim()); setText(''); } }}
          disabled={disabled || !text.trim()}
          className="px-4 py-2.5 bg-amber-500 text-slate-950 text-sm rounded-lg font-medium disabled:opacity-50 hover:bg-amber-400 transition-colors shrink-0"
        >
          Send
        </button>
      </div>
    </div>
  );
}
