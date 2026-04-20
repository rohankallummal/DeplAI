'use client';

import { useEffect, useRef } from 'react';
import { animate, useInView, useMotionValue } from 'motion/react';

interface CountUpProps {
  to: number;
  from?: number;
  direction?: 'up' | 'down';
  delay?: number;
  duration?: number;
  className?: string;
  startWhen?: boolean;
  separator?: string;
  onStart?: () => void;
  onEnd?: () => void;
}

export default function CountUp({
  to,
  from = 0,
  direction = 'up',
  delay = 0,
  duration = 2,
  className = '',
  startWhen = true,
  separator = '',
  onStart,
  onEnd,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const startValue = direction === 'down' ? to : from;
  const endValue = direction === 'down' ? from : to;
  const motionValue = useMotionValue(startValue);
  const isInView = useInView(ref, { once: true, margin: '0px' });

  useEffect(() => {
    if (ref.current) {
      ref.current.textContent = String(startValue);
    }
    const unsubscribe = motionValue.on('change', (latest) => {
      if (!ref.current) return;
      const rounded = Math.round(latest);
      const formatted = Intl.NumberFormat('en-US', {
        useGrouping: !!separator,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(rounded);
      ref.current.textContent = separator ? formatted.replace(/,/g, separator) : formatted;
    });
    return () => unsubscribe();
  }, [motionValue, separator, startValue]);

  useEffect(() => {
    if (!isInView || !startWhen) return;

    onStart?.();

    let controls: ReturnType<typeof animate> | undefined;

    const startTimeout = setTimeout(() => {
      controls = animate(motionValue, endValue, {
        duration,
        ease: 'easeOut',
        onComplete: () => {
          motionValue.set(endValue);
          onEnd?.();
        },
      });
    }, delay * 1000);

    return () => {
      clearTimeout(startTimeout);
      controls?.stop();
    };
  }, [isInView, startWhen, motionValue, endValue, delay, duration, onStart, onEnd]);

  return <span ref={ref} className={className} />;
}
