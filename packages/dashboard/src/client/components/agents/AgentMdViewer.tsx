import Markdown from 'react-markdown';

function parseFrontmatter(content: string): { meta: Record<string, string> | null; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: null, body: content };
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return { meta, body: match[2] };
}

export function AgentMdViewer({ content }: { content: string }) {
  const { meta, body } = parseFrontmatter(content);

  return (
    <div className="pt-2 space-y-3">
      {meta && Object.keys(meta).length > 0 && (
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs bg-slate-800/50 rounded-md px-3 py-2">
          {Object.entries(meta).map(([k, v]) => (
            <div key={k} className="contents">
              <span className="text-slate-500 font-mono">{k}</span>
              <span className="text-slate-300 truncate">{v}</span>
            </div>
          ))}
        </div>
      )}
      {body.trim() && (
        <div className="prose prose-invert prose-sm max-w-none text-slate-300
          prose-headings:text-slate-200 prose-headings:text-sm prose-headings:font-medium
          prose-p:text-xs prose-p:leading-relaxed
          prose-code:text-amber-400 prose-code:text-xs prose-code:bg-slate-800 prose-code:px-1 prose-code:rounded
          prose-pre:bg-slate-800 prose-pre:rounded prose-pre:text-xs
          prose-strong:text-slate-200
          prose-a:text-amber-500
          prose-li:text-xs prose-li:leading-relaxed
          prose-hr:border-slate-800
        ">
          <Markdown>{body}</Markdown>
        </div>
      )}
    </div>
  );
}
