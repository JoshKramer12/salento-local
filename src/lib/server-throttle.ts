type ThrottleTaskState = {
  lastCompletedAtByKey: Map<string, number>;
  pendingByKey: Map<string, Promise<unknown>>;
};

type ThrottleRegistry = Map<string, ThrottleTaskState>;

const globalThrottleRegistry = globalThis as typeof globalThis & {
  __salentoServerThrottleRegistry?: ThrottleRegistry;
};

function getThrottleRegistry() {
  if (!globalThrottleRegistry.__salentoServerThrottleRegistry) {
    globalThrottleRegistry.__salentoServerThrottleRegistry = new Map();
  }

  return globalThrottleRegistry.__salentoServerThrottleRegistry;
}

function getTaskState(taskName: string) {
  const registry = getThrottleRegistry();
  const existing = registry.get(taskName);

  if (existing) {
    return existing;
  }

  const created: ThrottleTaskState = {
    lastCompletedAtByKey: new Map(),
    pendingByKey: new Map(),
  };

  registry.set(taskName, created);
  return created;
}

type RunThrottledServerTaskParams<T> = {
  force?: boolean;
  key: string;
  minIntervalMs: number;
  task: () => Promise<T>;
  taskName: string;
};

export async function runThrottledServerTask<T>({
  force = false,
  key,
  minIntervalMs,
  task,
  taskName,
}: RunThrottledServerTaskParams<T>) {
  const state = getTaskState(taskName);
  const pending = state.pendingByKey.get(key) as Promise<T> | undefined;

  if (pending) {
    return pending;
  }

  const lastCompletedAt = state.lastCompletedAtByKey.get(key) ?? 0;

  if (!force && Date.now() - lastCompletedAt < minIntervalMs) {
    return null;
  }

  const promise = task()
    .then((value) => {
      state.lastCompletedAtByKey.set(key, Date.now());
      return value;
    })
    .finally(() => {
      state.pendingByKey.delete(key);
    });

  state.pendingByKey.set(key, promise);
  return promise;
}
