/**
 * A filter kept in the address (`?status=LIVE`): it survives a visit to a card and the way back,
 * and a filtered list can be shared as a link. The default value leaves the address clean.
 */
export function useQueryFilter<T extends string>(
  name: string,
  fallback: T,
  allowed?: readonly T[],
) {
  const route = useRoute();
  const router = useRouter();
  return computed<T>({
    get() {
      const raw = route.query[name];
      const value = (Array.isArray(raw) ? raw[0] : raw) ?? '';
      if (!value) return fallback;
      return allowed && !allowed.includes(value as T) ? fallback : (value as T);
    },
    set(value) {
      const query = { ...route.query, [name]: value === fallback ? undefined : value };
      void router.replace({ query });
    },
  });
}
