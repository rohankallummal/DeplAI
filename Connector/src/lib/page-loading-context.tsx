'use client';

import { createContext, useContext, useState, useEffect } from 'react';

interface PageLoadingContextType {
  isLoading: boolean;
  setPageLoading: (loading: boolean) => void;
}

const PageLoadingContext = createContext<PageLoadingContextType>({
  isLoading: true,
  setPageLoading: () => {},
});

export function PageLoadingProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <PageLoadingContext.Provider value={{ isLoading, setPageLoading: setIsLoading }}>
      {children}
    </PageLoadingContext.Provider>
  );
}

export function usePageLoading(loading: boolean) {
  const { setPageLoading } = useContext(PageLoadingContext);

  useEffect(() => {
    setPageLoading(loading);
  }, [loading, setPageLoading]);
}

export function usePageLoadingContext() {
  return useContext(PageLoadingContext);
}
