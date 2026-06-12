import React, { Component, ErrorInfo } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.logError(error, info.componentStack ?? undefined);
  }

  async logError(error: Error, componentStack?: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // Try to get org id from profile
      let orgId: string | null = null;
      const email: string | null = session?.user?.email ?? null;
      if (session?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('organization_id')
          .eq('id', session.user.id)
          .maybeSingle();
        orgId = profile?.organization_id ?? null;
      }

      await supabase.from('client_errors').insert({
        organization_id: orgId,
        user_id: session?.user?.id ?? null,
        user_email: email,
        error_message: error.message,
        stack_trace: error.stack ?? null,
        component_stack: componentStack ?? null,
        url: window.location.href,
        user_agent: navigator.userAgent,
      });
    } catch {
      // Silently fail - don't create error loops
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="rounded-lg bg-card p-8 shadow-sm text-center max-w-md">
            <h2 className="text-lg font-semibold mb-2 text-foreground">Er ging iets mis</h2>
            <p className="text-muted-foreground text-sm mb-4">
              Er is een onverwachte fout opgetreden. Probeer de pagina te vernieuwen.
            </p>
            <p className="text-xs text-destructive font-mono mb-4">{this.state.error?.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="text-sm hover:underline"
            >
              Pagina vernieuwen
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

// Global unhandled error/rejection logger
export function initGlobalErrorLogging() {
  window.addEventListener('error', (event) => {
    logClientError(event.error || new Error(event.message));
  });

  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    logClientError(error);
  });
}

async function logClientError(error: Error) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    let orgId: string | null = null;
    if (session?.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', session.user.id)
        .maybeSingle();
      orgId = profile?.organization_id ?? null;
    }
    await supabase.from('client_errors').insert({
      organization_id: orgId,
      user_id: session?.user?.id ?? null,
      user_email: session?.user?.email ?? null,
      error_message: error.message,
      stack_trace: error.stack ?? null,
      url: window.location.href,
      user_agent: navigator.userAgent,
    });
  } catch {
    // silent
  }
}
