// Envoltura delgada sobre localStorage para el caché de lecturas y la cola de
// mutaciones pendientes de sincronizar. Todo bajo un solo prefijo para no
// chocar con otras claves que llegue a usar la app.
const PREFIX = 'rincon:';

function read<T>(key: string): T | undefined {
	try {
		const raw = localStorage.getItem(PREFIX + key);
		return raw === null ? undefined : (JSON.parse(raw) as T);
	} catch {
		return undefined;
	}
}

function write(key: string, value: unknown): void {
	try {
		localStorage.setItem(PREFIX + key, JSON.stringify(value));
	} catch {
		// Almacenamiento lleno o no disponible (modo privado, etc.): se ignora,
		// la app sigue funcionando sin caché/cola persistente en ese caso.
	}
}

export function getCache<T>(key: string): T | undefined {
	return read<T>(`cache:${key}`);
}

export function setCache(key: string, value: unknown): void {
	write(`cache:${key}`, value);
}

export function getQueue<T>(): T[] {
	return read<T[]>('queue') ?? [];
}

export function setQueue<T>(queue: T[]): void {
	write('queue', queue);
}

export function getRemap(): Record<number, number> {
	return read<Record<number, number>>('remap') ?? {};
}

export function setRemap(remap: Record<number, number>): void {
	write('remap', remap);
}
