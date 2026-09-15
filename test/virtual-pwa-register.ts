export interface RegisterSwOptions {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: unknown) => void;
}

let lastOptions: RegisterSwOptions | null = null;
let registerCalls = 0;
const updateCalls: boolean[] = [];

export function registerSW(options: RegisterSwOptions): (reloadPage?: boolean) => Promise<void> {
  lastOptions = options;
  registerCalls += 1;
  return async (reloadPage = false) => {
    updateCalls.push(reloadPage);
  };
}

export function pwaRegisterProbe(): {
  options: RegisterSwOptions | null;
  registerCalls: number;
  updateCalls: readonly boolean[];
} {
  return { options: lastOptions, registerCalls, updateCalls };
}

export function resetPwaRegisterProbe(): void {
  lastOptions = null;
  registerCalls = 0;
  updateCalls.length = 0;
}
