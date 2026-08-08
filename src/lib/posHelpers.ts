import type { Orden, OrdenItem, Producto } from '../types/api';
import { ApiError } from './api';
import { getSequence, setSequence } from './offline/storage';

export function formatCurrency(amount: number): string {
	return `$${amount.toFixed(2)}`;
}

export function formatTime(isoString: string): string {
	return new Date(isoString).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

export function escapeHtml(text: string): string {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

export function findProducto(productos: Producto[], productoId: number): Producto | undefined {
	return productos.find((p) => p.id === productoId);
}

// Quita acentos y mayúsculas para que buscar "limon" también encuentre "Limón".
export function normalizeSearch(text: string): string {
	return text
		.normalize('NFD')
		.replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
		.toLowerCase();
}

export function computeTotals(items: OrdenItem[], productos: Producto[]): { subtotal: number; total: number } {
	const subtotal = items.reduce((sum, item) => {
		const producto = findProducto(productos, item.producto_id);
		return sum + (producto ? producto.precio * item.cantidad : 0);
	}, 0);
	return { subtotal, total: subtotal };
}

export function ordenStatus(orden: Orden): { key: 'free' | 'sent' | 'draft'; label: string } {
	if (orden.items.length === 0) return { key: 'free', label: 'Libre' };
	if (orden.estado === 'enviada') return { key: 'sent', label: 'Enviada' };
	return { key: 'draft', label: 'En preparación' };
}

export function errorMessage(err: unknown): string {
	if (err instanceof ApiError) return err.message;
	return 'Error de conexión con el servidor';
}

function todayKey(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Contador que nunca repite un número dentro del mismo día, aunque la orden
// que lo usó se cobre o se elimine después (a diferencia de contar cuántas
// órdenes con ese prefijo siguen abiertas, que sí podía repetir el número
// una vez que la primera desaparecía de la lista). Se reinicia solo al
// cambiar de día, comparando contra la fecha local guardada.
export function nextDailySequence(key: string): number {
	const today = todayKey();
	const stored = getSequence(key);
	const next = stored && stored.date === today ? stored.next : 1;
	setSequence(key, { date: today, next: next + 1 });
	return next;
}
