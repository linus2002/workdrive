// Dependency-free signature helpers (imported by the store).
export const SIGNER_COLORS = ['#1686D9', '#D946EF', '#EA7A1A', '#16A34A', '#7C3AED', '#0E7490'];

/** Overall status from signer states. */
export function computeStatus(signers, current) {
  if (current === 'cancelled') return 'cancelled';
  if (signers.some((s) => s.status === 'declined')) return 'declined';
  if (signers.every((s) => s.status === 'signed')) return 'signed';
  if (signers.some((s) => s.status === 'viewed' || s.status === 'signed')) return 'viewed';
  return 'sent';
}

