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

// Sugerencias de "recibí esto": el total exacto y hasta 3 redondeos hacia
// arriba (billetes típicos), sin duplicados ni montos absurdamente más
// grandes que el total.
export function quickCashAmounts(total: number): number[] {
	if (total <= 0) return [];
	const steps = [50, 100, 200, 500];
	const roundups = steps.map((step) => Math.ceil(total / step) * step).filter((amount) => amount > total);
	return [total, ...new Set(roundups)].slice(0, 4);
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

// Siguiente número "candidato" del día para este contador, sin consumirlo
// todavía (a diferencia de un contador que avanza en cada lectura). Quien
// llama decide si ese número se queda reservado o no llamando (o no) a
// commitDailySequence — así, crear una orden y borrarla sin cobrarla no
// desperdicia el número. Se reinicia solo al cambiar de día.
export function peekDailySequence(key: string): number {
	const today = todayKey();
	const stored = getSequence(key);
	return stored && stored.date === today ? stored.next : 1;
}

// Reserva "used" (y todo lo anterior) para que nunca vuelva a salir de
// peekDailySequence, aunque la orden que lo mostraba se borre después. Se
// llama solo cuando el número realmente se usó para algo permanente (una
// venta cobrada), no con solo crear una orden.
export function commitDailySequence(key: string, used: number): void {
	const today = todayKey();
	const stored = getSequence(key);
	const currentNext = stored && stored.date === today ? stored.next : 1;
	if (used >= currentNext) setSequence(key, { date: today, next: used + 1 });
}
