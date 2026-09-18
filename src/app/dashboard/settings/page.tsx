import { redirect } from 'next/navigation';
import { getCurrentProject } from '@/lib/project';
import { SettingsClient } from './settings-client';

export default async function SettingsPage() {
  const ctx = await getCurrentProject();
  if (!ctx) redirect('/onboarding');

  return (
    <SettingsClient
      project={ctx.project}
      projectId={ctx.project.id}
      expiryDaysLeft={ctx.subscriptionDaysLeft}
    />
  );
}
