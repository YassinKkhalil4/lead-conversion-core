import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '@/api/endpoints';
import type { Role } from '@/api/types';

export const manageKeys = {
  salespeople: ['manage', 'salespeople'] as const,
  projects: ['manage', 'projects'] as const,
  users: ['manage', 'users'] as const,
  summary: ['manage', 'summary'] as const,
  notifications: ['notifications'] as const,
};

export function useSalespeople() {
  return useQuery({ queryKey: manageKeys.salespeople, queryFn: () => api.listSalespeople(true) });
}

export function useProjects() {
  return useQuery({ queryKey: manageKeys.projects, queryFn: () => api.listProjects(true) });
}

export function useUsers() {
  return useQuery({ queryKey: manageKeys.users, queryFn: () => api.listUsers() });
}

export function useSummary() {
  return useQuery({
    queryKey: manageKeys.summary,
    queryFn: () => api.getSummary(),
    refetchInterval: 60_000,
  });
}

export function useSaveSalesperson() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { salespersonId?: string; values: api.SalespersonInput }) =>
      input.salespersonId
        ? api.updateSalesperson(input.salespersonId, input.values)
        : api.createSalesperson(input.values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: manageKeys.salespeople });
    },
  });
}

export function useSaveProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId?: string; values: api.ProjectInput }) =>
      input.projectId ? api.updateProject(input.projectId, input.values) : api.createProject(input.values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: manageKeys.projects });
    },
  });
}

export function useSetProjectSalespeople() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { projectId: string; salespersonIds: string[] }) =>
      api.setProjectSalespeople(input.projectId, input.salespersonIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: manageKeys.projects });
    },
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      email: string;
      password: string;
      name: string;
      role: Role;
      salespersonId: string | null;
    }) => api.createUser(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: manageKeys.users });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; values: { active?: boolean; role?: Role; name?: string } }) =>
      api.updateUser(input.userId, input.values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: manageKeys.users });
    },
  });
}

export function useNotifications() {
  return useQuery({ queryKey: manageKeys.notifications, queryFn: () => api.listNotifications(false) });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => api.markNotificationRead(notificationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: manageKeys.notifications });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: manageKeys.notifications });
    },
  });
}
