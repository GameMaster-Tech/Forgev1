import { create } from "zustand";
import {
  createTeam as fbCreateTeam,
  getUserTeams,
  getTeam as fbGetTeam,
  updateTeam as fbUpdateTeam,
  deleteTeam as fbDeleteTeam,
  getTeamMembers,
  updateTeamMemberRole,
  removeTeamMember,
  createTeamInvite,
  getTeamInvites,
  revokeTeamInvite,
  acceptTeamInvite as fbAcceptTeamInvite,
  getTeamProjects,
  type FirestoreTeam,
  type FirestoreTeamMember,
  type FirestoreTeamInvite,
  type FirestoreProject,
  type TeamRole,
} from "@/lib/firebase/firestore";

interface TeamsState {
  teams: FirestoreTeam[];
  loading: boolean;
  activeTeam: FirestoreTeam | null;
  members: FirestoreTeamMember[];
  invites: FirestoreTeamInvite[];
  teamProjects: FirestoreProject[];

  fetchTeams: (userId: string) => Promise<void>;
  createTeam: (
    owner: { uid: string; displayName: string; email: string },
    data: { name: string; description: string }
  ) => Promise<string>;
  loadTeam: (teamId: string) => Promise<void>;
  updateTeam: (
    teamId: string,
    data: { name?: string; description?: string }
  ) => Promise<void>;
  deleteTeam: (teamId: string) => Promise<void>;

  inviteMember: (data: {
    teamId: string;
    teamName: string;
    inviterId: string;
    inviterName: string;
    email: string;
    role: TeamRole;
  }) => Promise<void>;
  revokeInvite: (inviteId: string) => Promise<void>;
  changeRole: (teamId: string, userId: string, role: TeamRole) => Promise<void>;
  removeMember: (teamId: string, userId: string) => Promise<void>;
  acceptInvite: (
    inviteId: string,
    user: { uid: string; email: string; displayName: string }
  ) => Promise<string>;
}

export const useTeamsStore = create<TeamsState>((set, get) => ({
  teams: [],
  loading: false,
  activeTeam: null,
  members: [],
  invites: [],
  teamProjects: [],

  fetchTeams: async (userId) => {
    set({ loading: true });
    try {
      const teams = await getUserTeams(userId);
      set({ teams, loading: false });
    } catch (err) {
      console.error("Failed to load teams:", err);
      set({ loading: false });
    }
  },

  createTeam: async (owner, data) => {
    const id = await fbCreateTeam(owner, data);
    await get().fetchTeams(owner.uid);
    return id;
  },

  loadTeam: async (teamId) => {
    set({ loading: true });
    try {
      const [team, members, invites, teamProjects] = await Promise.all([
        fbGetTeam(teamId),
        getTeamMembers(teamId),
        getTeamInvites(teamId),
        getTeamProjects(teamId),
      ]);
      set({
        activeTeam: team,
        members,
        invites,
        teamProjects,
        loading: false,
      });
    } catch (err) {
      console.error("Failed to load team:", err);
      set({ loading: false });
    }
  },

  updateTeam: async (teamId, data) => {
    await fbUpdateTeam(teamId, data);
    await get().loadTeam(teamId);
  },

  deleteTeam: async (teamId) => {
    await fbDeleteTeam(teamId);
    set({
      activeTeam: null,
      members: [],
      invites: [],
      teamProjects: [],
      teams: get().teams.filter((t) => t.id !== teamId),
    });
  },

  inviteMember: async (data) => {
    await createTeamInvite(data);
    const invites = await getTeamInvites(data.teamId);
    set({ invites });
  },

  revokeInvite: async (inviteId) => {
    await revokeTeamInvite(inviteId);
    set({ invites: get().invites.filter((i) => i.id !== inviteId) });
  },

  changeRole: async (teamId, userId, role) => {
    await updateTeamMemberRole(teamId, userId, role);
    set({
      members: get().members.map((m) =>
        m.userId === userId ? { ...m, role } : m
      ),
    });
  },

  removeMember: async (teamId, userId) => {
    await removeTeamMember(teamId, userId);
    set({ members: get().members.filter((m) => m.userId !== userId) });
  },

  acceptInvite: async (inviteId, user) => {
    return await fbAcceptTeamInvite(inviteId, user);
  },
}));
