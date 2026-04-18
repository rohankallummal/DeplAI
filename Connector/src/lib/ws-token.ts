export async function fetchWsToken(service: 'scan' | 'deploy' | 'customize'): Promise<string> {
  try {
    const res = await fetch(`/api/${service}/ws-token`);
    if (!res.ok) return '';
    const data = await res.json();
    return data.token || '';
  } catch {
    return '';
  }
}
