export const isSentryEnabled = false;

export const Sentry = {
  wrap<T>(component: T): T {
    return component;
  },
};

export function markStartup(step: string, data?: Record<string, unknown>) {
  if (__DEV__) {
    console.info('[dispatch.startup]', step, data || {});
  }
}

export function captureStartupIssue(message: string, data?: Record<string, unknown>) {
  if (__DEV__) {
    console.info('[dispatch.startup]', message, data || {});
  }
}
