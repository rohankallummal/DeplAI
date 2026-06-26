'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Lottie from 'lottie-react';
import { LoadingScreen } from '@/components/loading-spinner';
import ThemeToggle from '@/components/theme-toggle';
import { usePageLoading } from '@/lib/page-loading-context';
import { CostEstimation } from '@/components/cost-estimation';
import { PostDeploymentDashboard } from '@/components/post-deployment-dashboard';
import { useDeploy, type CostData, ACTIVE_PHASES } from '@/lib/deploy-context';
import { useBackendWatch } from '@/lib/backend-monitor-context';
import DeployQACard from '@/components/deploy-qa-card';
import loading3d1Animation from '@/components/animation/loading-3d-1.json';
import loading3d2Animation from '@/components/animation/loading-3d-2.json';
import loading3d3Animation from '@/components/animation/loading-3d-3.json';
import costAnimation from '@/components/animation/cost.json';
import tickAnimation from '@/components/animation/tick.json';
import alertAnimation from '@/components/animation/alert.json';

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
    resetDeploy,
  } = useDeploy();

  const deployState = projectId ? getDeployState(projectId) : null;
  const phase = deployState?.phase || 'idle';
  const hasStarted = useRef(false);

  // Watch the Deploy backend while a deployment is in flight. On outage, reset
  // this deploy and return Home.
  // Include 'error': deploy-context flips to 'error' on a dropped socket, so
  // excluding it would tear the watch down before the health re-check runs. The
  // health check decides the modal — a real deploy error with a live backend
  // shows the ErrorState/Retry UI, not the modal.
  useBackendWatch({
    active: !!projectId && (ACTIVE_PHASES.includes(phase) || phase === 'error'),
    service: 'deploy',
    recheckSignal: phase === 'error',
    onRecover: () => {
      if (projectId) resetDeploy(projectId);
      router.push('/');
    },
  });

  usePageLoading(loading || phase === 'idle');

  useEffect(() => {

    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  useEffect(() => {
    if (phase === 'cancelled' && projectId) {
      resetDeploy(projectId);
      router.push('/');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react only to phase transitions; projectId/resetDeploy/router are stable
  }, [phase]);

  useEffect(() => {
    if (!loading && projectId && projectInfo && !hasStarted.current) {
      hasStarted.current = true;

      const existing = getDeployState(projectId);
      if (existing.phase !== 'idle') {
        return;
      }


      initiateDeploy();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start once when loading/projectInfo first ready (guarded by hasStarted)
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
    } catch {
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
          <PhaseLoadingState title="Analyzing Repository" messages={deployState?.messages || []} animationData={loading3d1Animation} />
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

        {phase === 'terraforming' && (
          <PhaseLoadingState
            title="Provisioning Infrastructure"
            messages={deployState?.messages || []}
            animationData={loading3d2Animation}
          />
        )}

        {phase === 'costing' && !deployState?.costData && (
          <PhaseLoadingState title="Estimating Cost" messages={[]} animationData={costAnimation} animationClassName="w-96 h-96" />
        )}

        {phase === 'costing' && deployState?.costData && projectId && (
          <CostingState
            projectId={projectId}
            costData={deployState.costData}
            onDeploy={confirmDeploy}
          />
        )}

        {phase === 'deploying' && (
          <PhaseLoadingState
            title="Deploying Application"
            messages={deployState?.messages || []}
            animationData={loading3d3Animation}
          />
        )}

        {phase === 'completed' && projectId && (
          <CompletedState
            projectId={projectId}
            projectName={projectInfo?.name || ''}
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
  animationData = loading3d1Animation,
  animationClassName = "w-48 h-48",
}: {
  title: string;
  subtitle?: string;
  messages: { type: string; content: string }[];
  animationData?: unknown;
  animationClassName?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <Lottie
        animationData={animationData}
        loop
        className={animationClassName}
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
}: {
  projectId: string;
  projectName: string;
}) {
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
        projectId={projectId}
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
      <div className="w-28 h-28 mb-4">
        <Lottie animationData={alertAnimation} loop />
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
