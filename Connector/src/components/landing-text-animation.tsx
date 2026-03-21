'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { gsap } from 'gsap';
import { SplitText as GSAPSplitText } from 'gsap/SplitText';
import { EnterIcon } from '@/components/log-in-out';
import Link from 'next/link';

gsap.registerPlugin(GSAPSplitText);

type AnimState = 'idle' | 'entering' | 'active' | 'exiting' | 'loading';

interface LandingTextAnimationProps {
  href: string;
  className?: string;
}

const LandingTextAnimation: React.FC<LandingTextAnimationProps> = ({
  href,
  className = '',
}) => {
  const [, forceRender] = useState(0);
  const stateRef = useRef<AnimState>('idle');
  const textRef = useRef<HTMLSpanElement>(null);
  const isHoveredRef = useRef(false);

  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const shinyTweenRef = useRef<gsap.core.Tween | null>(null);
  const splitRef = useRef<GSAPSplitText | null>(null);

  const setAnimState = useCallback((s: AnimState) => {
    stateRef.current = s;
    forceRender(n => n + 1);
  }, []);

  const cleanup = useCallback(() => {
    timelineRef.current?.kill();
    timelineRef.current = null;
    shinyTweenRef.current?.kill();
    shinyTweenRef.current = null;
    try { splitRef.current?.revert(); } catch (_) {}
    splitRef.current = null;
  }, []);

  const resetToIdle = useCallback(() => {
    cleanup();
    const el = textRef.current;
    if (el) {
      el.style.cssText = '';
      el.style.display = 'none';
    }
    stateRef.current = 'idle';
    isHoveredRef.current = false;
    forceRender(n => n + 1);
  }, [cleanup]);

  const applyShiny = useCallback(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.backgroundImage =
      'linear-gradient(120deg, #b5b5b5 0%, #b5b5b5 35%, #ffffff 50%, #b5b5b5 65%, #b5b5b5 100%)';
    el.style.backgroundSize = '200% auto';
    el.style.webkitBackgroundClip = 'text';
    el.style.backgroundClip = 'text';
    (el.style as any).webkitTextFillColor = 'transparent';
    shinyTweenRef.current = gsap.fromTo(
      el,
      { backgroundPosition: '150% center' },
      { backgroundPosition: '-50% center', duration: 2, ease: 'none', repeat: -1 }
    );
  }, []);

  const buildTimeline = useCallback(() => {
    const el = textRef.current;
    if (!el) return null;

    cleanup();

    el.style.display = 'inline-block';

    splitRef.current = new GSAPSplitText(el, {
      type: 'chars',
      charsClass: 'split-char',
    });

    const tl = gsap.timeline({
      paused: true,
      onComplete: () => {
        if (isHoveredRef.current) {
          setAnimState('active');
        } else {
          tl.reverse();
          setAnimState('exiting');
        }
      },
      onReverseComplete: () => {
        try { splitRef.current?.revert(); } catch (_) {}
        splitRef.current = null;
        timelineRef.current = null;
        el.style.display = 'none';
        setAnimState('idle');
      },
    });

    tl.fromTo(
      splitRef.current.chars,
      { opacity: 0, y: 20 },
      {
        opacity: 1,
        y: 0,
        duration: 0.4,
        ease: 'power3.out',
        stagger: 0.03,
        force3D: true,
      }
    );

    timelineRef.current = tl;
    return tl;
  }, [cleanup, setAnimState]);

  const handleMouseEnter = useCallback(() => {
    isHoveredRef.current = true;
    const s = stateRef.current;

    if (s === 'idle') {
      const tl = buildTimeline();
      if (tl) {
        setAnimState('entering');
        tl.play();
      }
    } else if (s === 'exiting' && timelineRef.current) {
      setAnimState('entering');
      timelineRef.current.play();
    }
  }, [buildTimeline, setAnimState]);

  const handleMouseLeave = useCallback(() => {
    isHoveredRef.current = false;
    const s = stateRef.current;

    if (s === 'active' && timelineRef.current) {
      setAnimState('exiting');
      timelineRef.current.reverse();
    } else if (s === 'entering' && timelineRef.current) {
    }
  }, [setAnimState]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (stateRef.current !== 'active') {
      e.preventDefault();
      return;
    }

    timelineRef.current?.kill();
    timelineRef.current = null;
    try { splitRef.current?.revert(); } catch (_) {}
    splitRef.current = null;

    applyShiny();
    setAnimState('loading');

  }, [applyShiny, setAnimState]);

  useEffect(() => {
    resetToIdle();

    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) resetToIdle();
    };
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      window.removeEventListener('pageshow', handlePageShow);
      cleanup();
    };
  }, [resetToIdle, cleanup]);

  const state = stateRef.current;

  return (
    <div
      className={`inline-flex items-center justify-center ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Link
        href={href}
        onClick={handleClick}
        className="inline-flex items-center justify-center"
        style={{ cursor: state === 'active' ? 'pointer' : 'default' }}
      >
        {state === 'idle' && <EnterIcon />}
        <span
          ref={textRef}
          className="text-white text-lg font-bold whitespace-nowrap"
          style={{ display: state === 'idle' ? 'none' : 'inline-block' }}
        >
          Continue with GitHub
        </span>
      </Link>
    </div>
  );
};

export default LandingTextAnimation;
