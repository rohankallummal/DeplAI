'use client';

import React, { createContext, useContext, useState } from 'react';

interface StepperContextValue {
  currentStep: number;
  totalSteps: number;
  next: () => void;
}

const StepperContext = createContext<StepperContextValue | null>(null);

export function useStepper() {
  const ctx = useContext(StepperContext);
  if (!ctx) throw new Error('useStepper must be used within a Stepper');
  return ctx;
}

export function Step({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

interface StepperProps {
  children: React.ReactNode;
  onComplete?: () => void;
}

export default function Stepper({ children, onComplete }: StepperProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const steps = React.Children.toArray(children);
  const totalSteps = steps.length;

  const next = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      onComplete?.();
    }
  };

  return (
    <StepperContext.Provider value={{ currentStep, totalSteps, next }}>
      {totalSteps > 1 && (
        <div className="flex gap-2 mb-8">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                i <= currentStep ? 'bg-foreground' : 'bg-border'
              }`}
            />
          ))}
        </div>
      )}
      {steps[currentStep]}
    </StepperContext.Provider>
  );
}
