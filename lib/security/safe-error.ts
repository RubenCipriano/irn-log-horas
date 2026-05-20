// Build a non-leaking error message from an upstream (OpenProject / GitLab)
// response. We deliberately DO NOT echo the raw upstream body to the client:
// it can contain the token (in auth errors), internal paths, or other users'
// data. Callers may log the full body server-side via their own logger if
// needed — just never return it.

export function genericUpstreamError(service: string, status: number): string {
  switch (status) {
    case 401:
      return `${service}: credenciais invalidas ou expiradas.`;
    case 403:
      return `${service}: sem permissoes para esta operacao.`;
    case 404:
      return `${service}: recurso nao encontrado.`;
    case 409:
      return `${service}: conflito (a entrada foi alterada entretanto).`;
    case 422:
      return `${service}: pedido rejeitado pelo workflow.`;
    case 429:
      return `${service}: limite de pedidos atingido.`;
    default:
      if (status >= 500) return `${service}: servico indisponivel (${status}).`;
      return `${service}: erro ${status}.`;
  }
}
