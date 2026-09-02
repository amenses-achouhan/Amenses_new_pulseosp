'use client';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { fetchWithTimeout } from '../../../../../lib/fetchWithTimeout';

export default function ThemeSettings() {
  const router = useRouter();
  const { data: session, update } = useSession();
  const user = session?.user as any;

  const handleColorChange = async (field: string, value: string) => {
    const res = await fetchWithTimeout(`/api/organizations/settings/theme`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    if (res.ok) {
      update({ themeSettings: { ...(user?.themeSettings || {}), [field]: value } });
    }
  };

  return (
    <div>
      <h1>Theme Settings</h1>
      <div>
        <label>Primary Color</label>
        <input
          type="color"
          value={user?.themeSettings?.primaryColor || '#3B82F6'}
          onChange={(e) => handleColorChange('primaryColor', e.target.value)}
        />
      </div>
      {/* Repeat for sidebarBg, accentColor */}
    </div>
  );
}