import type { Orden, OrdenItem, Producto } from '../types/api';
import { ApiError } from './api';

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
