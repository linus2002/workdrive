// Offboarding: everything a departing person owns, holds or is part of, so it can be handed over cleanly.

/** Items they own whose parent folder they don't also own (what a transfer moves as a unit). */
const topLevel = (state, owned) => {
  const ids = new Set(owned.map((i) => i.id));
  return owned.filter((i) => !i.parentId || !ids.has(i.parentId));
};

export function offboardSummary(state, userId) {
  const items = Object.values(state.items);
  const owned = items.filter((i) => i.ownerId === userId);
  const ownedFiles = owned.filter((i) => i.type === 'file');
  const teams = state.teams.map((t) => {
    const m = t.members.find((x) => x.userId === userId);
    if (!m) return null;
    const admins = t.members.filter((x) => x.role === 'Admin');
    return { team: t, role: m.role, soleAdmin: m.role === 'Admin' && admins.length === 1 };
  }).filter(Boolean);
  return {
    owned,
    ownedTop: topLevel(state, owned),
    ownedFiles,
    ownedSize: ownedFiles.reduce((s, i) => s + (i.size || 0), 0),
    personal: owned.filter((i) => !i.space.startsWith('t')), // their own space (not team folders)
    sharedWithThem: items.filter((i) => (i.sharedWith || []).some((s) => s.userId === userId)),
    teams,
    tasks: (state.tasks || []).filter((t) => t.assigneeId === userId && t.status === 'open'),
    approving: (state.approvals || []).filter((a) => a.status === 'pending' && a.approvers.some((p) => p.userId === userId && p.decision === 'pending')),
    requested: (state.approvals || []).filter((a) => a.status === 'pending' && a.requestedBy === userId),
    locks: items.filter((i) => i.lock?.by === userId),
    fileRequests: (state.fileRequests || []).filter((r) => r.createdBy === userId),
    sessions: (state.sessions || []).filter((s) => s.userId === userId && !s.endedAt),
  };
}

export const DEFAULT_OFFBOARD = {
  transferFiles: true, reassignTasks: true, replaceApprover: true, handoverApprovals: true, releaseLocks: true,
  transferRequests: true, removeShares: true, leaveTeams: true, account: 'deactivate',
};

/** People who can receive a hand-over: active or invited, not the person leaving. */
export const transferCandidates = (state, userId) => state.users.filter((u) => u.id !== userId && u.status !== 'disabled');
