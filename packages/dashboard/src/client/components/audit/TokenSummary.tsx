interface TokenSummaryProps {
  totals: { totalIn: number; totalOut: number } | null;
  invocationCount: number;
}

export function TokenSummary({ totals, invocationCount }: TokenSummaryProps) {
  if (!totals) return null;

  const estCost = ((totals.totalIn * 0.003 + totals.totalOut * 0.015) / 1000).toFixed(3);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard label="Tokens In" value={totals.totalIn.toLocaleString()} />
      <StatCard label="Tokens Out" value={totals.totalOut.toLocaleString()} />
      <StatCard label="Invocations" value={String(invocationCount)} />
      <StatCard label="Est. Cost" value={`$${estCost}`} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <p className="text-2xl font-bold text-slate-200">{value}</p>
      <p className="text-xs text-slate-500 mt-1">{label}</p>
    </div>
  );
}
