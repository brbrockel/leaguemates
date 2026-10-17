import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setCsrfToken, type Me } from '@/lib/api';

export const ME_KEY = ['me'] as const;

/** The signed-in user, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<Me | null> => {
      try {
        const me = await api<Me>('/auth/me');
        setCsrfToken(me.csrfToken);
        return me;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setCsrfToken(null);
          return null;
        }
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

/** Looking around without an account: read-only, nicknames only. */
export function useIsGuest(): boolean {
  return useMe().data?.user.isGuest ?? false;
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      setCsrfToken(null);
      qc.clear();
      qc.setQueryData(ME_KEY, null);
    },
  });
}
