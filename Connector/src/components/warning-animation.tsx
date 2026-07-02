'use client';

import Lottie from 'lottie-react';
import warningAnimation from '@/components/animation/warning.json';

// Isolated so the large warning.json (~216KB) lives in its own chunk and is only
// fetched when a consumer lazy-loads this component (e.g. the suspended panel).
export default function WarningAnimation() {
  return <Lottie animationData={warningAnimation} loop={false} />;
}
