import { ApiError } from '../api';

// navigator.onLine da falsos positivos (marca "en línea" con wifi conectado
// pero sin salida real a internet), así que la verdad de este módulo la
// marcan los resultados reales de las peticiones (ver markOnline/markOffline),
// no el navegador. Los eventos online/offline del navegador sólo se usan como
// pista para intentar sincronizar antes.
export function isNetworkError(err: unknown): boolean {
	return !(err instanceof ApiError);
}

let online = true;
const listeners = new Set<(online: boolean) => void>();

function setStatus(next: boolean): void {
	if (next === online) return;
	online = next;
	for (const listener of listeners) listener(online);
}

export function markOnline(): void {
	setStatus(true);
}

export function markOffline(): void {
	setStatus(false);
}

export function isOnline(): boolean {
	return online;
}

export function onStatusChange(cb: (online: boolean) => void): () => void {
	listeners.add(cb);
	return () => listeners.delete(cb);
}

if (typeof window !== 'undefined') {
	window.addEventListener('online', () => setStatus(true));
	window.addEventListener('offline', () => setStatus(false));
}
