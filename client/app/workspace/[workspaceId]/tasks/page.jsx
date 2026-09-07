'use client';

import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import JiraTaskList from '../../../_components/JiraTaskList';

export default function TasksPage() {
  const params = useParams();
  const { data: session } = useSession();
  const workspaceId = params?.workspaceId || session?.user?.activeOrganizationId;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-[#E9E9E7]">Tasks</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-[#9B9B9B]">
          Real-time Jira issue list and task tracking for your workspace.
        </p>
      </div>

      <JiraTaskList workspaceId={workspaceId} />
    </div>
  );
}
