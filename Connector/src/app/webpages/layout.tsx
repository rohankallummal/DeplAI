'use client';

import { ScanProvider } from '@/lib/scan-context';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ScanProvider>
      {children}
    </ScanProvider>
  );
}
