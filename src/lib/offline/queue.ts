import * as api from '../api';
import type { EstadoOrden, MetodoPago } from '../../types/api';
import { getQueue, setQueue, getRemap, setRemap } from './storage';
import { isNetworkError, markOffline, markOnline, onStatusChange } from './network';

// Se lanza cuando una operación depende de un ID temporal (p. ej. una mesa
// creada offline) que todavía no se resolvió a un ID real del servidor. Se
// trata igual que un error de red: se detiene el flush y se reintenta luego,
// en vez de mandar la petición con un ID que el servidor no reconoce.
class NotReadyError extends Error {}

type QueueOp =
	| { id: number; kind: 'crear_orden'; payload: { tempId: number; etiqueta: string }; createdAt: number }
	| { id: number; kind: 'agregar_item'; payload: { ordenId: number; productoId: number; cantidad: number }; createdAt: number }
	| {
			id: number;
			kind: 'cambiar_cantidad';
			payload: { ordenId: number; productoId: number; delta: number };
			createdAt: number;
	  }
	| { id: number; kind: 'quitar_item'; payload: { ordenId: number; productoId: number }; createdAt: number }
	| { id: number; kind: 'vaciar_orden'; payload: { ordenId: number }; createdAt: number }
	| { id: number; kind: 'enviar_orden'; payload: { ordenId: number }; createdAt: number }
	| {
			id: number;
			kind: 'actualizar_orden';
			payload: {
				ordenId: number;
				etiqueta?: string;
				estado?: EstadoOrden;
				direccion_entrega?: string | null;
				detalle_entrega?: string | null;
			};
			createdAt: number;
	  }
	| { id: number; kind: 'eliminar_orden'; payload: { ordenId: number }; createdAt: number }
	| {
			id: number;
			kind: 'crear_venta';
			payload: { tempId: number; ordenId: number; metodoPago: MetodoPago; recibido?: number; total: number };
			createdAt: number;
	  };

type NewQueueOp = Omit<QueueOp, 'id' | 'createdAt'>;

let counter = 0;
function nextSeq(): number {
	return Date.now() * 1000 + (counter++ % 1000);
}

// Los IDs reales del servidor son enteros positivos; un ID negativo marca de
// forma barata "esto todavía no existe en el servidor" sin tener que tocar
// los tipos de Orden/Venta.
export function nextTempId(): number {
	return -nextSeq();
}

function resolveId(id: number): number {
	if (id >= 0) return id;
	return getRemap()[id] ?? id;
}

export function isPendingSync(id: number): boolean {
	return id < 0 && getRemap()[id] === undefined;
}

const resolvedListeners = new Set<(tempId: number, realId: number) => void>();

export function onResolved(cb: (tempId: number, realId: number) => void): () => void {
	resolvedListeners.add(cb);
	return () => resolvedListeners.delete(cb);
}

function markResolved(tempId: number, realId: number): void {
	const remap = getRemap();
	remap[tempId] = realId;
	setRemap(remap);
	for (const cb of resolvedListeners) cb(tempId, realId);
}

function enqueue(op: NewQueueOp): void {
	const queue = getQueue<QueueOp>();
	queue.push({ ...op, id: nextSeq(), createdAt: Date.now() } as QueueOp);
	setQueue(queue);
}

export function pendingCount(): number {
	return getQueue<QueueOp>().length;
}

export function pendingSalesTotal(): number {
	return getQueue<QueueOp>()
		.filter((op): op is Extract<QueueOp, { kind: 'crear_venta' }> => op.kind === 'crear_venta')
		.reduce((sum, op) => sum + op.payload.total, 0);
}

// Quita de la cola una mesa creada offline que se elimina/vacía antes de
// sincronizarse: nunca llegó a existir en el servidor, así que no hay nada
// que mandarle — se descartan su "crear_orden" y todas las operaciones que
// dependían de ella.
export function cancelPendingOrder(tempId: number): void {
	const queue = getQueue<QueueOp>().filter((op) => {
		if (op.kind === 'crear_orden') return op.payload.tempId !== tempId;
		if ('ordenId' in op.payload) return op.payload.ordenId !== tempId;
		return true;
	});
	setQueue(queue);
}

// Ejecuta la mutación real; si falla por conexión (o depende de una mesa que
// todavía no se sincroniza), la deja en la cola para reintentar después y NO
// relanza el error — el llamador debe mantener su actualización optimista.
// Si falla por un error real de la API, sí relanza para que el llamador
// revierta como hacía antes.
export async function runOrEnqueue<T>(
	op: NewQueueOp,
	exec: () => Promise<T>,
	dependsOnOrdenId?: number,
): Promise<T | undefined> {
	if (dependsOnOrdenId !== undefined && isPendingSync(dependsOnOrdenId)) {
		enqueue(op);
		scheduleFlush();
		return undefined;
	}

	try {
		return await exec();
	} catch (err) {
		if (isNetworkError(err)) {
			enqueue(op);
			scheduleFlush();
			return undefined;
		}
		throw err;
	}
}

async function applyOp(op: QueueOp): Promise<void> {
	switch (op.kind) {
		case 'crear_orden': {
			const orden = await api.ordenes.crear({ etiqueta: op.payload.etiqueta });
			markResolved(op.payload.tempId, orden.id);
			return;
		}
		case 'agregar_item': {
			const ordenId = resolveId(op.payload.ordenId);
			if (ordenId < 0) throw new NotReadyError();
			await api.ordenes.agregarItem(ordenId, op.payload.productoId, op.payload.cantidad);
			return;
		}
		case 'cambiar_cantidad': {
			const ordenId = resolveId(op.payload.ordenId);
			if (ordenId < 0) throw new NotReadyError();
			await api.ordenes.cambiarCantidad(ordenId, op.payload.productoId, op.payload.delta);
			return;
		}
		case 'quitar_item': {
			const ordenId = resolveId(op.payload.ordenId);
			if (ordenId < 0) throw new NotReadyError();
			await api.ordenes.quitarItem(ordenId, op.payload.productoId);
			return;
		}
		case 'vaciar_orden': {
			const ordenId = resolveId(op.payload.ordenId);
			if (ordenId < 0) throw new NotReadyError();
			await api.ordenes.vaciar(ordenId);
			return;
		}
		case 'enviar_orden': {
			const ordenId = resolveId(op.payload.ordenId);
			if (ordenId < 0) throw new NotReadyError();
			await api.ordenes.enviar(ordenId);
			return;
		}
		case 'actualizar_orden': {
			const ordenId = resolveId(op.payload.ordenId);
			if (ordenId < 0) throw new NotReadyError();
			await api.ordenes.actualizar(ordenId, {
				etiqueta: op.payload.etiqueta,
				estado: op.payload.estado,
				direccion_entrega: op.payload.direccion_entrega,
				detalle_entrega: op.payload.detalle_entrega,
			});
			return;
		}
		case 'eliminar_orden': {
			const ordenId = resolveId(op.payload.ordenId);
			if (ordenId < 0) throw new NotReadyError();
			await api.ordenes.eliminar(ordenId);
			return;
		}
		case 'crear_venta': {
			const ordenId = resolveId(op.payload.ordenId);
			if (ordenId < 0) throw new NotReadyError();
			const venta = await api.ventas.crear({
				orden_id: ordenId,
				metodo_pago: op.payload.metodoPago,
				recibido: op.payload.recibido,
			});
			markResolved(op.payload.tempId, venta.id);
			return;
		}
	}
}

let flushing = false;

export async function flush(): Promise<void> {
	if (flushing) return;
	flushing = true;
	try {
		let queue = getQueue<QueueOp>();
		for (const op of queue) {
			try {
				await applyOp(op);
				queue = queue.filter((o) => o.id !== op.id);
				setQueue(queue);
			} catch (err) {
				if (isNetworkError(err) || err instanceof NotReadyError) {
					markOffline();
					return;
				}
				console.error('Se descarta una operación pendiente inválida', op, err);
				queue = queue.filter((o) => o.id !== op.id);
				setQueue(queue);
			}
		}
		markOnline();
	} finally {
		flushing = false;
	}
}

function scheduleFlush(): void {
	void flush();
}

let started = false;

// Reintenta la cola al recuperar conexión, y además cada 20s como respaldo
// porque el evento "online" del navegador no siempre dispara en redes
// móviles/wifi inestable.
export function startAutoSync(): void {
	if (started) return;
	started = true;
	onStatusChange((online) => {
		if (online) void flush();
	});
	setInterval(() => void flush(), 20000);
	void flush();
}
