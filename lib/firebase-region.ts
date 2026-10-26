/** Route by the configured backend, independently of UI presentation flags. */
export function firebaseFunctionsRegion(projectId?: string): string {
  return projectId === 'dispatch-customer-beta' ? 'northamerica-northeast1' : 'us-central1';
}
