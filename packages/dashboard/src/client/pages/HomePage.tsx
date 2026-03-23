import { OrgSummaryCard } from '../components/home/OrgSummaryCard';
import { RecentChatCard } from '../components/home/RecentChatCard';
import { ChannelActivityCard } from '../components/home/ChannelActivityCard';
import { AuditSnapshotCard } from '../components/home/AuditSnapshotCard';
import { OrchestratorStatusCard } from '../components/home/OrchestratorStatusCard';

export function HomePage() {
  return (
    <div className="space-y-6">
      <OrchestratorStatusCard />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <OrgSummaryCard />
        <RecentChatCard />
        <ChannelActivityCard />
        <AuditSnapshotCard />
      </div>
    </div>
  );
}
