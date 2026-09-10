import { useQuery, useMutation, type UseQueryOptions, type UseMutationOptions } from '@tanstack/react-query';
import {
  PunishmentRecordSchema,
  AppealRecordSchema,
  TicketRecordSchema,
  SettingsSchema,
  DashboardSummarySchema,
  type PunishmentRecord,
  type AppealRecord,
  type TicketRecord,
  type Settings,
  type DashboardSummary,
  type PunishmentInput,
  type AppealInput,
  type AppealDecisionInput,
  type SettingsUpdateInput,
  type ExecutePunishmentInput,
} from '@workspace/api-zod';

const API_BASE = process.env.REACT_APP_API_URL || '/api';

// ============================================================================
// QUERY KEYS
// ============================================================================

export const getGetDashboardQueryKey = () => ['dashboard'];
export const getGetSettingsQueryKey = () => ['settings'];
export const getListPunishmentsQueryKey = (params?: { search?: string; limit?: number }) => [
  'punishments',
  params,
];
export const getGetPunishmentsByUserQueryKey = (userId: string) => ['punishments', userId];
export const getListAppealsQueryKey = () => ['appeals'];
export const getListTicketsQueryKey = () => ['tickets'];

// ============================================================================
// FETCH FUNCTIONS
// ============================================================================

const fetchJson = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.statusText}`);
  }

  return response.json();
};

// ============================================================================
// DASHBOARD
// ============================================================================

export const useGetDashboard = (options?: { query?: UseQueryOptions<DashboardSummary> }) => {
  return useQuery<DashboardSummary>({
    ...options?.query,
    queryKey: getGetDashboardQueryKey(),
    queryFn: () => fetchJson('/dashboard'),
  });
};

// ============================================================================
// SETTINGS
// ============================================================================

export const useGetSettings = (options?: { query?: UseQueryOptions<Settings> }) => {
  return useQuery<Settings>({
    ...options?.query,
    queryKey: getGetSettingsQueryKey(),
    queryFn: () => fetchJson('/settings'),
  });
};

export const useUpdateSettings = (
  options?: { mutation?: UseMutationOptions<Settings, Error, { data: SettingsUpdateInput }> }
) => {
  return useMutation<Settings, Error, { data: SettingsUpdateInput }>({
    ...options?.mutation,
    mutationFn: ({ data }) =>
      fetchJson('/settings', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
};

// ============================================================================
// PUNISHMENTS / CASES
// ============================================================================

export const useListPunishments = (
  params?: { search?: string; limit?: number },
  options?: { query?: UseQueryOptions<PunishmentRecord[]> }
) => {
  const searchParams = new URLSearchParams();
  if (params?.search) searchParams.append('search', params.search);
  if (params?.limit) searchParams.append('limit', params.limit.toString());

  return useQuery<PunishmentRecord[]>({
    ...options?.query,
    queryKey: getListPunishmentsQueryKey(params),
    queryFn: () =>
      fetchJson(
        `/punishments${searchParams.toString() ? `?${searchParams.toString()}` : ''}`
      ),
  });
};

export const useGetPunishmentsByUser = (
  userId: string,
  options?: { query?: UseQueryOptions<PunishmentRecord[]> }
) => {
  return useQuery<PunishmentRecord[]>({
    ...options?.query,
    queryKey: getGetPunishmentsByUserQueryKey(userId),
    queryFn: () => fetchJson(`/punishments/user/${userId}`),
  });
};

export const useCreatePunishment = (
  options?: { mutation?: UseMutationOptions<PunishmentRecord, Error, { data: PunishmentInput }> }
) => {
  return useMutation<PunishmentRecord, Error, { data: PunishmentInput }>({
    ...options?.mutation,
    mutationFn: ({ data }) =>
      fetchJson('/punishments', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
};

export const useExecutePunishment = (
  options?: {
    mutation?: UseMutationOptions<
      PunishmentRecord,
      Error,
      { id: string; data: { ticketChannelId: string; loggedBy?: string } }
    >;
  }
) => {
  return useMutation<
    PunishmentRecord,
    Error,
    { id: string; data: { ticketChannelId: string; loggedBy?: string } }
  >({
    ...options?.mutation,
    mutationFn: ({ id, data }) =>
      fetchJson(`/punishments/${id}/execute`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
};

// ============================================================================
// APPEALS
// ============================================================================

export const useListAppeals = (options?: { query?: UseQueryOptions<AppealRecord[]> }) => {
  return useQuery<AppealRecord[]>({
    ...options?.query,
    queryKey: getListAppealsQueryKey(),
    queryFn: () => fetchJson('/appeals'),
  });
};

export const useCreateAppeal = (
  options?: { mutation?: UseMutationOptions<AppealRecord, Error, { data: AppealInput }> }
) => {
  return useMutation<AppealRecord, Error, { data: AppealInput }>({
    ...options?.mutation,
    mutationFn: ({ data }) =>
      fetchJson('/appeals', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
};

export const useDecideAppeal = (
  options?: {
    mutation?: UseMutationOptions<
      AppealRecord,
      Error,
      { id: string; data: AppealDecisionInput }
    >;
  }
) => {
  return useMutation<AppealRecord, Error, { id: string; data: AppealDecisionInput }>({
    ...options?.mutation,
    mutationFn: ({ id, data }) =>
      fetchJson(`/appeals/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
};

// ============================================================================
// TICKETS
// ============================================================================

export const useListTickets = (options?: { query?: UseQueryOptions<TicketRecord[]> }) => {
  return useQuery<TicketRecord[]>({
    ...options?.query,
    queryKey: getListTicketsQueryKey(),
    queryFn: () => fetchJson('/tickets'),
  });
};

// Re-export types and enums for use in dashboard
export * from '@workspace/api-zod';
