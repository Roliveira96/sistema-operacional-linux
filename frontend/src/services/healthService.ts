import { ApiProblemError, httpClient, type HttpClient } from "./httpClient";

export type HealthStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY";

export interface HealthComponent {
  name: string;
  status: "HEALTHY" | "UNHEALTHY";
  latencyMs: number;
}

export interface HealthReport {
  status: HealthStatus;
  version?: string;
  checkedAt?: string;
  components: HealthComponent[];
}

/**
 * Fetches the platform health. A 503 problem is still a valid report: it is
 * converted to UNHEALTHY with the components carried in the problem body.
 */
export async function fetchHealth(client: HttpClient = httpClient): Promise<HealthReport> {
  try {
    return await client.get<HealthReport>("/health", { cache: "no-store" });
  } catch (error) {
    if (error instanceof ApiProblemError && error.status === 503) {
      const components = Array.isArray(error.extensions.components)
        ? (error.extensions.components as HealthComponent[])
        : [];
      return { status: "UNHEALTHY", components };
    }
    throw error;
  }
}
