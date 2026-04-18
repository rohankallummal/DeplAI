'use client';

import React, { useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { motion, useMotionValue, useAnimationFrame, useTransform } from 'motion/react';
import { gsap } from 'gsap';
import { SplitText as GSAPSplitText } from 'gsap/SplitText';
import { EnterIcon } from '@/components/log-in-out';
import Link from 'next/link';

gsap.registerPlugin(GSAPSplitText);

interface GradientTextProps {
  children: ReactNode;
  className?: string;
  colors?: string[];
  animationSpeed?: number;
  showBorder?: boolean;
  direction?: 'horizontal' | 'vertical' | 'diagonal';
  pauseOnHover?: boolean;
  yoyo?: boolean;
}

export function GradientText({
  children,
  className = '',
  colors = ['#5227FF', '#FF9FFC', '#B19EEF'],
  animationSpeed = 8,
  showBorder = false,
  direction = 'horizontal',
  pauseOnHover = false,
  yoyo = true
}: GradientTextProps) {
  const [isPaused, setIsPaused] = useState(false);
  const progress = useMotionValue(0);
  const elapsedRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);

  const animationDuration = animationSpeed * 1000;

  useAnimationFrame(time => {
    if (isPaused) {
      lastTimeRef.current = null;
      return;
    }

    if (lastTimeRef.current === null) {
      lastTimeRef.current = time;
      return;
    }

    const deltaTime = time - lastTimeRef.current;
    lastTimeRef.current = time;
    elapsedRef.current += deltaTime;

    if (yoyo) {
      const fullCycle = animationDuration * 2;
      const cycleTime = elapsedRef.current % fullCycle;

      if (cycleTime < animationDuration) {
        progress.set((cycleTime / animationDuration) * 100);
      } else {
        progress.set(100 - ((cycleTime - animationDuration) / animationDuration) * 100);
      }
    } else {
      progress.set((elapsedRef.current / animationDuration) * 100);
    }
  });

  useEffect(() => {
    elapsedRef.current = 0;
    progress.set(0);
  }, [animationSpeed, yoyo]);

  const backgroundPosition = useTransform(progress, p =>
    direction === 'vertical' ? `50% ${p}%` : `${p}% 50%`
  );

  const handleMouseEnter = useCallback(() => {
    if (pauseOnHover) setIsPaused(true);
  }, [pauseOnHover]);

  const handleMouseLeave = useCallback(() => {
    if (pauseOnHover) setIsPaused(false);
  }, [pauseOnHover]);

  const gradientAngle =
    direction === 'horizontal' ? 'to right' : direction === 'vertical' ? 'to bottom' : 'to bottom right';
  const gradientColors = [...colors, colors[0]].join(', ');

  const gradientStyle = {
    backgroundImage: `linear-gradient(${gradientAngle}, ${gradientColors})`,
    backgroundSize: direction === 'horizontal' ? '300% 100%' : direction === 'vertical' ? '100% 300%' : '300% 300%',
    backgroundRepeat: 'repeat'
  };

  return (
    <motion.div
      className={`relative mx-auto flex max-w-fit flex-row items-center justify-center rounded-[1.25rem] font-medium backdrop-blur transition-shadow duration-500 overflow-hidden cursor-pointer ${showBorder ? 'py-1 px-2' : ''} ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {showBorder && (
        <motion.div
          className="absolute inset-0 z-0 pointer-events-none rounded-[1.25rem]"
          style={{ ...gradientStyle, backgroundPosition }}
        >
          <div
            className="absolute bg-black rounded-[1.25rem] z-[-1]"
            style={{
              width: 'calc(100% - 2px)',
              height: 'calc(100% - 2px)',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)'
            }}
          />
        </motion.div>
      )}
      <motion.div
        className="inline-block relative z-2 text-transparent bg-clip-text"
        style={{ ...gradientStyle, backgroundPosition, WebkitBackgroundClip: 'text' }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

type AnimState = 'idle' | 'entering' | 'active' | 'exiting' | 'loading';

interface LandingTextAnimationProps {
  href: string;
  className?: string;
}

interface TextTypeProps {
  texts: string[];
  typingSpeed?: number;
  deletingSpeed?: number;
  pauseDuration?: number;
  showCursor?: boolean;
  cursorCharacter?: string;
  cursorBlinkDuration?: number;
  className?: string;
  onCycleComplete?: () => void;
}

export function TextType({
  texts,
  typingSpeed = 75,
  deletingSpeed = 50,
  pauseDuration = 1500,
  showCursor = true,
  cursorCharacter = '_',
  cursorBlinkDuration = 0.5,
  className = '',
  onCycleComplete,
}: TextTypeProps) {
  const [displayText, setDisplayText] = useState('');
  const [textIndex, setTextIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const onCycleCompleteRef = useRef(onCycleComplete);

  useEffect(() => {
    onCycleCompleteRef.current = onCycleComplete;
  }, [onCycleComplete]);

  useEffect(() => {
    if (texts.length === 0) return;

    const currentFullText = texts[textIndex];

    if (!isDeleting) {
      if (displayText.length < currentFullText.length) {
        const timeout = setTimeout(() => {
          setDisplayText(currentFullText.slice(0, displayText.length + 1));
        }, typingSpeed);
        return () => clearTimeout(timeout);
      } else {
        const timeout = setTimeout(() => {
          setIsDeleting(true);
        }, pauseDuration);
        return () => clearTimeout(timeout);
      }
    } else {
      if (displayText.length > 0) {
        const timeout = setTimeout(() => {
          setDisplayText(displayText.slice(0, -1));
        }, deletingSpeed);
        return () => clearTimeout(timeout);
      } else {
        setIsDeleting(false);
        const nextIndex = (textIndex + 1) % texts.length;
        setTextIndex(nextIndex);
        if (nextIndex === 0) {
          onCycleCompleteRef.current?.();
        }
      }
    }
  }, [displayText, isDeleting, textIndex, texts, typingSpeed, deletingSpeed, pauseDuration]);

  return (
    <span className={className}>
      {displayText}
      {showCursor && (
        <motion.span
          animate={{ opacity: [1, 0] }}
          transition={{ duration: cursorBlinkDuration, repeat: Infinity, repeatType: 'reverse', ease: 'linear' }}
        >
          {cursorCharacter}
        </motion.span>
      )}
    </span>
  );
}

export const LandingTextAnimation: React.FC<LandingTextAnimationProps> = ({
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
    try { splitRef.current?.revert(); } catch {}
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
        try { splitRef.current?.revert(); } catch {}
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

    if (stateRef.current === 'active' && timelineRef.current) {
      setAnimState('exiting');
      timelineRef.current.reverse();
    }
  }, [setAnimState]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (stateRef.current !== 'active') {
      e.preventDefault();
      return;
    }

    timelineRef.current?.kill();
    timelineRef.current = null;
    try { splitRef.current?.revert(); } catch {}
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
