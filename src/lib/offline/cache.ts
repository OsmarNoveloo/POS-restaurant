import { getCache, setCache } from './storage';
import { markOffline, markOnline } from './network';

export interface CachedReadResult<T> {
	data: T;
	stale: boolean;
}

// Intenta la lectura real; si falla (red o servidor), regresa el último valor
// bueno conocido en vez de dejar la pantalla en blanco. Si nunca hubo un
// valor cacheado (primera carga sin internet), relanza el error original.
export async function cachedRead<T>(key: string, fetcher: () => Promise<T>): Promise<CachedReadResult<T>> {
	try {
		const data = await fetcher();
		setCache(key, data);
		markOnline();
		return { data, stale: false };
	} catch (err) {
		const cached = getCache<T>(key);
		if (cached !== undefined) {
			markOffline();
			return { data: cached, stale: true };
		}
		throw err;
	}
}
