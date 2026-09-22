/** Includes response-body reads so a stalled download cannot leave the preview locked. */
export async function request<T>(
  url: string, init: RequestInit, read: (response: Response) => Promise<T>, timeoutMs = 25_000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Connection timed out. Please try again.'));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([fetch(url, { ...init, signal: controller.signal }).then(read), timeout]);
  } finally { clearTimeout(timer!); }
}

export function createCloudRequest(enabled: boolean): typeof request {
  return (...args) => enabled ? request(...args) : Promise.reject(new Error('Cloud features are disabled in this build.'));
}
