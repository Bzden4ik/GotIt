import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiService from './api';

/**
 * Hook для получения списка отслеживаемых стримеров
 */
export function useTrackedStreamers(enabled = true) {
  return useQuery({
    queryKey: ['tracked-streamers'],
    queryFn: () => apiService.getTrackedStreamers(),
    enabled,
    select: (data) => data.streamers || [],
  });
}

/**
 * Hook для добавления стримера с оптимистичным обновлением
 */
export function useAddStreamer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (nickname) => apiService.addTrackedStreamer(nickname),
    
    // Оптимистичное обновление
    onMutate: async (nickname) => {
      // Отменяем текущие запросы
      await queryClient.cancelQueries({ queryKey: ['tracked-streamers'] });

      // Сохраняем предыдущее состояние
      const previousStreamers = queryClient.getQueryData(['tracked-streamers']);

      // Оптимистично добавляем стримера (UI обновится мгновенно)
      queryClient.setQueryData(['tracked-streamers'], (old) => {
        if (!old) return old;
        return {
          ...old,
          streamers: [
            ...(old.streamers || []),
            {
              id: Date.now(), // Временный ID
              nickname,
              name: nickname,
              itemsCount: 0,
              isOptimistic: true, // Маркер оптимистичного обновления
            },
          ],
        };
      });

      return { previousStreamers };
    },

    // При ошибке откатываем изменения
    onError: (err, nickname, context) => {
      if (context?.previousStreamers) {
        queryClient.setQueryData(['tracked-streamers'], context.previousStreamers);
      }
    },

    // При успехе обновляем реальными данными
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracked-streamers'] });
    },
  });
}

/**
 * Hook для удаления стримера с оптимистичным обновлением
 */
export function useRemoveStreamer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (streamerId) => apiService.removeTrackedStreamer(streamerId),
    
    // Оптимистичное удаление
    onMutate: async (streamerId) => {
      await queryClient.cancelQueries({ queryKey: ['tracked-streamers'] });

      const previousStreamers = queryClient.getQueryData(['tracked-streamers']);

      // Оптимистично удаляем стримера (UI обновится мгновенно)
      queryClient.setQueryData(['tracked-streamers'], (old) => {
        if (!old) return old;
        return {
          ...old,
          streamers: (old.streamers || []).filter((s) => s.id !== streamerId),
        };
      });

      return { previousStreamers };
    },

    onError: (err, streamerId, context) => {
      if (context?.previousStreamers) {
        queryClient.setQueryData(['tracked-streamers'], context.previousStreamers);
      }
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracked-streamers'] });
    },
  });
}

/**
 * Hook для поиска стримера
 */
export function useSearchStreamer(nickname, enabled = false) {
  return useQuery({
    queryKey: ['streamer-search', nickname],
    queryFn: () => apiService.searchStreamer(nickname),
    enabled: enabled && !!nickname,
    staleTime: 10 * 60 * 1000, // 10 минут (поиск редко меняется)
    select: (data) => data.streamer,
  });
}

/**
 * Hook для получения вишлиста стримера
 */
export function useWishlist(streamerId, enabled = true) {
  return useQuery({
    queryKey: ['wishlist', streamerId],
    queryFn: () => apiService.getWishlist(streamerId),
    enabled: enabled && !!streamerId,
    select: (data) => data.items || [],
  });
}

/**
 * Hook для проверки отслеживания стримера
 */
export function useCheckTracked(nickname, enabled = true) {
  return useQuery({
    queryKey: ['check-tracked', nickname],
    queryFn: () => apiService.checkIfTracked(nickname),
    enabled: enabled && !!nickname,
    staleTime: 30 * 1000, // 30 секунд
    select: (data) => data.isTracked,
  });
}
