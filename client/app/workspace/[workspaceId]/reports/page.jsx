'use client';

import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AISummaryPanel from '../../../_components/AISummaryPanel';

export default function ReportsPage() {
  const params = useParams();
  const { data: session } = useSession();
  const organizationId = params?.workspaceId || session?.user?.activeOrganizationId || null;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-[#E9E9E7]">Engineering Health Reports</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-[#9B9B9B]">
          AI-generated engineering health summaries analyzing workspace activity across Jira, GitHub, and Slack.
        </p>
      </div>

      {/* Primary AI Engineering Health Report */}
      <div className="mt-6">
        <AISummaryPanel organizationId={organizationId} />
      </div>
    </div>
  );
}