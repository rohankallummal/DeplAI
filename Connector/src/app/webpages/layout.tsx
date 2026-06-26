'use client';

import { ScanProvider } from '@/lib/scan-context';
import { DeployProvider } from '@/lib/deploy-context';
import { CustomizeProvider } from '@/lib/customize-context';
import { PreviewProvider } from '@/lib/preview-context';
import { PopupProvider } from '@/components/toast-notification';
import { BackendMonitorProvider } from '@/lib/backend-monitor-context';
import { PageLoadingProvider, usePageLoadingContext } from '@/lib/page-loading-context';
import { LoadingScreen } from '@/components/loading-spinner';

function LayoutContent({ children }: { children: React.ReactNode }) {
  const { isLoading } = usePageLoadingContext();

  return (
    <>
      {isLoading && <LoadingScreen />}
      <div className={isLoading ? 'hidden' : undefined}>
        {children}
      </div>
    </>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <PopupProvider>
      <BackendMonitorProvider>
        <ScanProvider>
          <DeployProvider>
            <CustomizeProvider>
              <PreviewProvider>
                <PageLoadingProvider>
                  <LayoutContent>{children}</LayoutContent>
                </PageLoadingProvider>
              </PreviewProvider>
            </CustomizeProvider>
          </DeployProvider>
        </ScanProvider>
      </BackendMonitorProvider>
    </PopupProvider>
  );
}
