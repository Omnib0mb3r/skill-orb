export interface GraphNode {
  id: string;
  label?: string;
  type: string;
  stage?: string;
}

export interface GraphEdge {
  id?: string;
  source: string;
  target: string;
  weight: number;
  connection_type?: string;
}

export interface GraphResponse {
  nodes?: GraphNode[];
  edges: GraphEdge[];
  updated_at?: string;
}

export interface ApiClientConfig {
  apiUrl: string;
  timeoutMs: number;
}

export function buildApiConfig(): ApiClientConfig {
  if (process.env.DEVNEURAL_API_URL) {
    return { apiUrl: process.env.DEVNEURAL_API_URL, timeoutMs: 5000 };
  }
  return {
    apiUrl: `http://localhost:${process.env.DEVNEURAL_PORT ?? '3747'}`,
    timeoutMs: 5000,
  };
}

export async function fetchWithTimeout(
  url: string,
  timeoutMs = 5000,
): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
