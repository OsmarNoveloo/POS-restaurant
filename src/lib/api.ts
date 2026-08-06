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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE_URL}${path}`, {
		headers: { 'Content-Type': 'application/json' },
		...init,
	});

	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new ApiError(body?.error ?? `Error ${res.status}`, res.status);
	}

	if (res.status === 204) return undefined as T;
	return res.json() as Promise<T>;
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
