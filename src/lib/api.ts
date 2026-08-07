import type {
	Orden,
	OrdenInput,
	OrdenUpdateInput,
	Producto,
	ProductoInput,
	ProductoUpdateInput,
	ResumenDashboard,
	Venta,
	VentaInput,
} from '../types/api';

const BASE_URL = import.meta.env.PUBLIC_API_URL;

export class ApiError extends Error {
	status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
	}
}

const REQUEST_TIMEOUT_MS = 8000;
const RETRY_DELAYS_MS = [500, 1500];

function isTransientStatus(status: number): boolean {
	return status === 502 || status === 503 || status === 504;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attempt<T>(path: string, init?: RequestInit): Promise<T> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	try {
		const res = await fetch(`${BASE_URL}${path}`, {
			headers: { 'Content-Type': 'application/json' },
			...init,
			signal: controller.signal,
		});

		if (!res.ok) {
			const body = await res.json().catch(() => null);
			throw new ApiError(body?.error ?? `Error ${res.status}`, res.status);
		}

		if (res.status === 204) return undefined as T;
		return (await res.json()) as T;
	} finally {
		clearTimeout(timeout);
	}
}

// Las lecturas (GET) son seguras de reintentar automáticamente: nunca
// duplican nada. Las escrituras (POST/PUT/PATCH/DELETE) sólo se intentan una
// vez aquí — reintentarlas a ciegas podría duplicar una orden o un producto
// agregado al carrito si el timeout ocurre después de que el servidor ya
// procesó la petición. Su resiliencia ante fallas de red viene de la cola
// offline (src/lib/offline/queue.ts), que reintenta exactamente una operación
// encolada en vez de repetir la petición original sin control.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const method = init?.method ?? 'GET';
	if (method !== 'GET') return attempt<T>(path, init);

	for (let retriesLeft = RETRY_DELAYS_MS.length; ; retriesLeft--) {
		try {
			return await attempt<T>(path, init);
		} catch (err) {
			const transient = !(err instanceof ApiError) || isTransientStatus(err.status);
			if (!transient || retriesLeft <= 0) throw err;
			await delay(RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - retriesLeft]);
		}
	}
}

function json(body: unknown): RequestInit {
	return { body: JSON.stringify(body) };
}

export const productos = {
	listar(activo?: boolean): Promise<Producto[]> {
		const query = activo === undefined ? '' : `?activo=${activo}`;
		return request(`/productos${query}`);
	},
	crear(input: ProductoInput): Promise<Producto> {
		return request('/productos', { method: 'POST', ...json(input) });
	},
	actualizar(id: number, input: ProductoUpdateInput): Promise<Producto> {
		return request(`/productos/${id}`, { method: 'PUT', ...json(input) });
	},
	eliminar(id: number): Promise<{ mode: 'deleted' | 'deactivated' }> {
		return request(`/productos/${id}`, { method: 'DELETE' });
	},
};

export const ordenes = {
	listar(): Promise<Orden[]> {
		return request('/ordenes');
	},
	crear(input: OrdenInput): Promise<Orden> {
		return request('/ordenes', { method: 'POST', ...json(input) });
	},
	actualizar(id: number, input: OrdenUpdateInput): Promise<Omit<Orden, 'items'>> {
		return request(`/ordenes/${id}`, { method: 'PUT', ...json(input) });
	},
	eliminar(id: number): Promise<{ ok: true }> {
		return request(`/ordenes/${id}`, { method: 'DELETE' });
	},
	agregarItem(id: number, productoId: number, cantidad?: number): Promise<{ ok: true }> {
		return request(`/ordenes/${id}/items`, {
			method: 'POST',
			...json({ producto_id: productoId, cantidad }),
		});
	},
	cambiarCantidad(id: number, productoId: number, delta: number): Promise<{ ok: true }> {
		return request(`/ordenes/${id}/items/${productoId}`, { method: 'PATCH', ...json({ delta }) });
	},
	quitarItem(id: number, productoId: number): Promise<{ ok: true }> {
		return request(`/ordenes/${id}/items/${productoId}`, { method: 'DELETE' });
	},
	vaciar(id: number): Promise<{ ok: true }> {
		return request(`/ordenes/${id}/vaciar`, { method: 'POST' });
	},
	enviar(id: number): Promise<Omit<Orden, 'items'>> {
		return request(`/ordenes/${id}/enviar`, { method: 'POST' });
	},
};

export const ventas = {
	listar(fecha?: string): Promise<Venta[]> {
		const query = fecha ? `?fecha=${fecha}` : '';
		return request(`/ventas${query}`);
	},
	crear(input: VentaInput): Promise<Venta> {
		return request('/ventas', { method: 'POST', ...json(input) });
	},
};

export const dashboard = {
	resumen(): Promise<ResumenDashboard> {
		return request('/dashboard/resumen');
	},
};
