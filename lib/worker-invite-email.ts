export type WorkerInviteEmailDocumentParams = {
  email: string;
  teamName?: string | null;
  appLink: string;
  inviteId: string;
  managerId: string;
  teamId?: string | null;
};

export function buildWorkerInviteEmailDocument(params: WorkerInviteEmailDocumentParams) {
  const teamName = params.teamName?.trim() || (params.teamId ? 'Dispatch Team' : 'Solo worker');

  return {
    to: [params.email],
    message: {
      subject: `You are invited to join ${teamName} on Dispatch`,
      text: `You have been invited to join ${teamName} on Dispatch. If you do not have the app yet, download Dispatch from the Apple App Store or Google Play, then sign in with this email to review and accept the invite: ${params.appLink}`,
      html: `<p>You have been invited to join <strong>${teamName}</strong> on Dispatch.</p><p>If you do not have the app yet, download Dispatch from the Apple App Store or Google Play.</p><p><a href="${params.appLink}">Open Dispatch download and sign-in link</a> to review and accept the invite with <strong>${params.email}</strong>.</p>`,
    },
    dispatchInvite: {
      inviteId: params.inviteId,
      managerId: params.managerId,
      teamId: params.teamId || null,
      teamName,
      appLink: params.appLink,
      email: params.email,
    },
  };
}
