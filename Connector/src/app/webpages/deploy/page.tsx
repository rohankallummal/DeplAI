'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Lottie from 'lottie-react';
import { LoadingScreen } from '@/components/loading-spinner';
import ThemeToggle from '@/components/theme-toggle';
import { usePageLoading } from '@/lib/page-loading-context';
import { CostEstimation } from '@/components/cost-estimation';
import { PostDeploymentDashboard } from '@/components/post-deployment-dashboard';
import { useDeploy, type CostData } from '@/lib/deploy-context';
import DeployQACard from '@/components/deploy-qa-card';
import loading3dAnimation from '@/components/animation/loading-3d.json';
import loading3d2Animation from '@/components/animation/loading-3d-2.json';
import loading3d3Animation from '@/components/animation/loading-3d-3.json';
import tickAnimation from '@/components/animation/tick.json';

export default function DeployPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <DeployPageContent />
    </Suspense>
  );
}

function DeployPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get('project_id');

  const [loading, setLoading] = useState(true);
  const [projectInfo, setProjectInfo] = useState<{
    name: string;
    type: string;
    owner?: string;
    repo?: string;
    installationId?: string;
  } | null>(null);

  const {
    startDeploy,
    getDeployState,
    sendAnswer,
    submitAllAnswers,
    confirmDeploy,
  } = useDeploy();

  const deployState = projectId ? getDeployState(projectId) : null;
  const phase = deployState?.phase || 'idle';
  const hasStarted = useRef(false);

  usePageLoading(loading || phase === 'idle');

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (!loading && projectId && projectInfo && !hasStarted.current) {
      hasStarted.current = true;

      const existing = getDeployState(projectId);
      if (existing.phase !== 'idle') {
        return;
      }

      initiateDeploy();
    }
  }, [loading, projectId, projectInfo]);

  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/session');
      const session = await res.json();

      if (!session.isLoggedIn) {
        router.push('/');
        return;
      }

      const healthRes = await fetch('/api/deploy/health');
      if (!healthRes.ok) {
        router.push('/');
        return;
      }

      if (projectId) {
        const projectRes = await fetch(`/api/projects/${projectId}`);
        if (projectRes.ok) {
          const data = await projectRes.json();
          const project = data.project || data;
          setProjectInfo({
            name: project.type === 'local' ? project.name : project.repo,
            type: project.type,
            ...(project.type === 'github' ? { owner: project.owner, repo: project.repo, installationId: project.installationId } : {}),
          });
        } else {
          router.push('/');
          return;
        }
      }

      setLoading(false);
    } catch (err) {
      router.push('/');
    }
  }

  async function initiateDeploy() {
    if (!projectId || !projectInfo) return;

    try {
      const res = await fetch('/api/deploy/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          project_name: projectInfo.name,
          project_type: projectInfo.type,
          ...(projectInfo.type === 'github' ? {
            owner: projectInfo.owner,
            repo: projectInfo.repo,
            installation_id: projectInfo.installationId,
          } : {}),
        }),
      });

      if (!res.ok) return;

      await startDeploy(projectId, projectInfo.name);
    } catch (err) {
      console.error('Deploy initiation failed:', err);
    }
  }

  if (loading || phase === 'idle') return null;

  if (!projectId) {
    return (
      <div className="min-h-screen bg-header flex items-center justify-center">
        <p className="text-muted">No project selected</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-header">
      <header className="bg-header border-b border-border sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-end">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8">
        {phase === 'analyzing' && (
          <PhaseLoadingState title="Analyzing Repository" messages={deployState?.messages || []} animationData={loading3d3Animation} />
        )}

        {phase === 'clarifying' && projectId && deployState && (
          <DeployQACard
            projectId={projectId}
            questions={deployState.questions}
            currentQuestionIndex={deployState.currentQuestionIndex}
            onSendAnswer={sendAnswer}
            onSubmitAll={submitAllAnswers}
          />
        )}

        {phase === 'architecting' && (
          <PhaseLoadingState
            title="Architecting Deployment"
            subtitle="Mapping components to AWS services and generating deployment profile..."
            messages={deployState?.messages || []}
          />
        )}

        {phase === 'terraforming' && (
          <PhaseLoadingState
            title="Provisioning Infrastructure"
            subtitle="Applying Terraform configuration to AWS and provisioning resources..."
            messages={deployState?.messages || []}
            animationData={loading3d2Animation}
          />
        )}

        {phase === 'costing' && deployState?.costData && projectId && (
          <CostingState
            projectId={projectId}
            costData={deployState.costData}
            onDeploy={confirmDeploy}
          />
        )}

        {phase === 'completed' && projectId && (
          <CompletedState
            projectId={projectId}
            projectName={projectInfo?.name || ''}
            costData={deployState?.costData || null}
          />
        )}

        {phase === 'error' && (
          <ErrorState
            messages={deployState?.messages || []}
            onRetry={() => {
              hasStarted.current = false;
              initiateDeploy();
            }}
          />
        )}
      </div>
    </div>
  );
}

function PhaseLoadingState({
  title,
  subtitle,
  messages,
  animationData = loading3dAnimation,
}: {
  title: string;
  subtitle?: string;
  messages: { type: string; content: string }[];
  animationData?: unknown;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <Lottie
        animationData={animationData}
        loop
        className="w-48 h-48"
      />
      <p className="text-xl font-semibold mt-4 text-foreground">{title}</p>
      {subtitle && <p className="text-muted text-sm mt-2">{subtitle}</p>}

      {messages.length > 0 && (
        <div className="mt-8 w-full max-w-lg">
          <div className="bg-surface border border-border rounded-lg p-4 max-h-48 overflow-y-auto">
            {messages.map((msg, i) => (
              <div key={i} className="flex items-start gap-2 py-1">
                <span className="text-xs font-mono flex-shrink-0 text-red-500">
                  [!]
                </span>
                <span className="text-sm text-foreground">{msg.content}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CompletedState({
  projectId,
  projectName,
  costData,
}: {
  projectId: string;
  projectName: string;
  costData: CostData | null;
}) {
  const router = useRouter();

  return (
    <div className="py-8">
      <div className="flex flex-col items-center mb-12">
        <Lottie
          animationData={tickAnimation}
          loop={false}
          className="w-32 h-32"
        />
        <h2 className="text-2xl font-bold text-foreground mt-4">
          Deployment Complete
        </h2>
        <p className="text-muted text-sm mt-2 text-center max-w-md">
          Your infrastructure for <span className="font-medium text-foreground">{projectName}</span> has been successfully deployed.
        </p>
      </div>

      <PostDeploymentDashboard
        projectId={projectId}
        projectName={projectName}
        costData={costData}
      />
    </div>
  );
}

function CostingState({
  projectId,
  costData,
  onDeploy,
}: {
  projectId: string;
  costData: CostData;
  onDeploy: (projectId: string, confirmed: boolean) => void;
}) {
  const [isLoading, setIsLoading] = useState(false);

  const handleDeploy = () => {
    setIsLoading(true);
    onDeploy(projectId, true);
  };

  const handleCancel = () => {
    setIsLoading(true);
    onDeploy(projectId, false);
  };

  return (
    <div className="py-8">
      <CostEstimation
        costData={costData}
        onDeploy={handleDeploy}
        onCancel={handleCancel}
        isLoading={isLoading}
      />
    </div>
  );
}

function ErrorState({
  messages,
  onRetry,
}: {
  messages: { type: string; content: string }[];
  onRetry: () => void;
}) {
  const lastError = [...messages].reverse().find(m => m.type === 'error');

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
        <svg className="w-9 h-9 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-foreground">Deployment Failed</h2>
      {lastError && (
        <p className="text-sm text-red-500 mt-2 text-center max-w-md">{lastError.content}</p>
      )}
      <button
        onClick={onRetry}
        className="mt-6 px-6 py-3 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition"
      >
        Retry
      </button>
    </div>
  );
}
