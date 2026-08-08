import { $ } from '../lib/dom';
import * as api from '../lib/api';
import { computeTotals, errorMessage, findProducto, formatCurrency, normalizeSearch, ordenStatus } from '../lib/posHelpers';
import { cachedRead } from '../lib/offline/cache';
import { isOnline, onStatusChange } from '../lib/offline/network';
import { isPendingSync, onResolved, pendingCount, runOrEnqueue, startAutoSync } from '../lib/offline/queue';
import type { Orden, Producto } from '../types/api';

const state = {
	productos: [] as Producto[],
	categorias: [] as string[],
	selectedCategory: 'Todos',
	searchQuery: '',
	ordenes: [] as Orden[],
	activeOrdenId: null as number | null,
	busy: false,
};

const el = {
	tableBoard: $<HTMLElement>('tableBoard'),
	tableGrid: $<HTMLElement>('tableGrid'),
	orderBuilder: $<HTMLElement>('orderBuilder'),
	backToTablesBtn: $<HTMLButtonElement>('backToTablesBtn'),
	builderTableName: $<HTMLElement>('builderTableName'),
	builderStatusBadge: $<HTMLElement>('builderStatusBadge'),
	connectionStatus: $<HTMLElement>('connectionStatus'),
	productSearch: $<HTMLInputElement>('productSearch'),
	productSearchEmpty: $<HTMLElement>('productSearchEmpty'),
	categoryFilters: $<HTMLElement>('categoryFilters'),
	productGrid: $<HTMLElement>('productGrid'),
	clearOrderBtn: $<HTMLButtonElement>('clearOrderBtn'),
	cartItems: $<HTMLElement>('cartItems'),
	orderEmpty: $<HTMLElement>('orderEmpty'),
	subtotal: $<HTMLElement>('subtotal'),
	total: $<HTMLElement>('total'),
	sendOrderBtn: $<HTMLButtonElement>('sendOrderBtn'),
	toast: $<HTMLElement>('toast'),
};

function findOrden(ordenId: number): Orden | undefined {
	return state.ordenes.find((o) => o.id === ordenId);
}

function getActiveOrden(): Orden | undefined {
	return state.activeOrdenId === null ? undefined : findOrden(state.activeOrdenId);
}

function showToast(message: string) {
	el.toast.textContent = message;
	el.toast.classList.add('show');
	setTimeout(() => el.toast.classList.remove('show'), 2200);
}

let busyQueue: Promise<void> = Promise.resolve();

function withBusy(fn: () => Promise<void>): Promise<void> {
	const run = busyQueue.then(async () => {
		state.busy = true;
		try {
			await fn();
		} catch (err) {
			console.error(err);
			showToast(errorMessage(err));
		} finally {
			state.busy = false;
		}
	});
	busyQueue = run;
	return run;
}

async function refreshOrdenes() {
	const { data } = await cachedRead('ordenes', () => api.ordenes.listar());
	const pending = state.ordenes.filter((o) => isPendingSync(o.id));
	state.ordenes = [...data, ...pending];
}

// --- Rendering ---

function renderConnectionBadge() {
	const count = pendingCount();
	const online = isOnline();
	el.connectionStatus.hidden = online && count === 0;
	if (el.connectionStatus.hidden) return;
	el.connectionStatus.textContent = online
		? `🟡 Sincronizando · ${count} pendiente${count === 1 ? '' : 's'}`
		: `🔴 Sin conexión${count > 0 ? ` · ${count} pendiente${count === 1 ? '' : 's'}` : ''}`;
}

function renderTableBoard() {
	el.tableGrid.innerHTML = '';
	for (const orden of state.ordenes) {
		const status = ordenStatus(orden);
		const count = orden.items.reduce((sum, item) => sum + item.cantidad, 0);
		const { total } = computeTotals(orden.items, state.productos);

		const card = document.createElement('button');
		card.className = `table-card ${status.key}`;
		card.dataset.orderId = String(orden.id);
		card.innerHTML = `
			<span class="table-card-name">${orden.etiqueta}</span>
			<span class="table-card-status">${status.label}</span>
			${count > 0 ? `<span class="table-card-info">${count} producto${count === 1 ? '' : 's'} · ${formatCurrency(total)}</span>` : ''}
		`;
		el.tableGrid.appendChild(card);
	}
}

function renderCategoryFilters() {
	el.categoryFilters.innerHTML = '';
	const all = ['Todos', ...state.categorias];
	for (const category of all) {
		const chip = document.createElement('button');
		chip.className = 'category-chip' + (category === state.selectedCategory ? ' active' : '');
		chip.dataset.category = category;
		chip.textContent = category;
		el.categoryFilters.appendChild(chip);
	}
}

function renderProductGrid() {
	el.productGrid.innerHTML = '';
	const query = normalizeSearch(state.searchQuery.trim());
	const productos = state.productos
		.filter((p) => state.selectedCategory === 'Todos' || p.categoria === state.selectedCategory)
		.filter((p) => !query || normalizeSearch(p.nombre).includes(query) || normalizeSearch(p.categoria).includes(query));

	el.productSearchEmpty.hidden = productos.length > 0;

	for (const producto of productos) {
		const card = document.createElement('button');
		card.className = 'product-card';
		card.dataset.productId = String(producto.id);
		card.innerHTML = `
			<span class="product-icon">${producto.icono}</span>
			<span class="product-name">${producto.nombre}</span>
			<span class="product-price">${formatCurrency(producto.precio)}</span>
		`;
		el.productGrid.appendChild(card);
	}
}

function renderBuilder() {
	renderConnectionBadge();
	const orden = getActiveOrden();
	if (!orden) return;

	const status = ordenStatus(orden);
	el.builderTableName.textContent = orden.etiqueta;
	el.builderStatusBadge.textContent = status.label;
	el.builderStatusBadge.className = `status-badge ${status.key}`;

	el.cartItems.innerHTML = '';
	if (orden.items.length === 0) {
		el.orderEmpty.style.display = 'block';
	} else {
		el.orderEmpty.style.display = 'none';
		for (const item of orden.items) {
			const producto = findProducto(state.productos, item.producto_id);
			if (!producto) continue;
			const li = document.createElement('li');
			li.className = 'cart-item';
			li.dataset.productId = String(producto.id);
			li.innerHTML = `
				<span class="cart-item-icon">${producto.icono}</span>
				<div class="cart-item-info">
					<div class="cart-item-name">${producto.nombre}</div>
					<div class="cart-item-price">${formatCurrency(producto.precio)} c/u</div>
				</div>
				<div class="qty-controls">
					<button class="qty-btn" data-action="decrease">−</button>
					<span class="qty-value">${item.cantidad}</span>
					<button class="qty-btn" data-action="increase">+</button>
				</div>
				<button class="remove-btn" data-action="remove" title="Quitar">✕</button>
			`;
			el.cartItems.appendChild(li);
		}
	}

	const { subtotal, total } = computeTotals(orden.items, state.productos);
	el.subtotal.textContent = formatCurrency(subtotal);
	el.total.textContent = formatCurrency(total);
	el.sendOrderBtn.disabled = orden.items.length === 0 || sendingOrder;
	el.sendOrderBtn.textContent = status.key === 'sent' ? 'Orden enviada ✓' : 'Enviar orden a caja';
}

// --- Navigation ---

function openTable(ordenId: number) {
	state.activeOrdenId = ordenId;
	el.tableBoard.hidden = true;
	el.orderBuilder.hidden = false;
	renderBuilder();
}

function backToTables() {
	state.activeOrdenId = null;
	el.orderBuilder.hidden = true;
	el.tableBoard.hidden = false;
	renderTableBoard();
}

// --- Cart mutations ---

function addToCart(productoId: number) {
	const orden = getActiveOrden();
	if (!orden) return;

	const existing = orden.items.find((i) => i.producto_id === productoId);
	if (existing) existing.cantidad += 1;
	else orden.items.push({ producto_id: productoId, cantidad: 1 });
	renderBuilder();

	return withBusy(async () => {
		try {
			await runOrEnqueue(
				{ kind: 'agregar_item', payload: { ordenId: orden.id, productoId, cantidad: 1 } },
				() => api.ordenes.agregarItem(orden.id, productoId, 1),
				orden.id,
			);
		} catch (err) {
			if (existing) existing.cantidad -= 1;
			else orden.items = orden.items.filter((i) => i.producto_id !== productoId);
			renderBuilder();
			throw err;
		}
	});
}

function changeQty(productoId: number, delta: number) {
	const orden = getActiveOrden();
	if (!orden) return;
	const item = orden.items.find((i) => i.producto_id === productoId);
	if (!item) return;

	const previousCantidad = item.cantidad;
	item.cantidad += delta;
	if (item.cantidad <= 0) orden.items = orden.items.filter((i) => i.producto_id !== productoId);
	renderBuilder();

	return withBusy(async () => {
		try {
			await runOrEnqueue(
				{ kind: 'cambiar_cantidad', payload: { ordenId: orden.id, productoId, delta } },
				() => api.ordenes.cambiarCantidad(orden.id, productoId, delta),
				orden.id,
			);
		} catch (err) {
			if (previousCantidad + delta <= 0) orden.items.push({ producto_id: productoId, cantidad: previousCantidad });
			else item.cantidad = previousCantidad;
			renderBuilder();
			throw err;
		}
	});
}

function removeItem(productoId: number) {
	const orden = getActiveOrden();
	if (!orden) return;
	const index = orden.items.findIndex((i) => i.producto_id === productoId);
	if (index === -1) return;

	const [removed] = orden.items.splice(index, 1);
	renderBuilder();

	return withBusy(async () => {
		try {
			await runOrEnqueue(
				{ kind: 'quitar_item', payload: { ordenId: orden.id, productoId } },
				() => api.ordenes.quitarItem(orden.id, productoId),
				orden.id,
			);
		} catch (err) {
			orden.items.splice(index, 0, removed);
			renderBuilder();
			throw err;
		}
	});
}

function clearOrder() {
	const orden = getActiveOrden();
	if (!orden || orden.items.length === 0) return;

	const previousItems = orden.items;
	orden.items = [];
	renderBuilder();

	return withBusy(async () => {
		try {
			await runOrEnqueue(
				{ kind: 'vaciar_orden', payload: { ordenId: orden.id } },
				() => api.ordenes.vaciar(orden.id),
				orden.id,
			);
			showToast(`${orden.etiqueta} vaciada`);
		} catch (err) {
			orden.items = previousItems;
			renderBuilder();
			throw err;
		}
	});
}

// En pantalla táctil un doble tap en "Enviar orden" alcanzaba a mandar la
// orden dos veces antes de que la primera terminara (renderBuilder solo
// deshabilita el botón según items.length, no según si ya se está enviando).
let sendingOrder = false;

function sendOrder() {
	const orden = getActiveOrden();
	if (!orden || orden.items.length === 0 || sendingOrder) return;

	sendingOrder = true;
	return withBusy(async () => {
		const previousEstado = orden.estado;
		orden.estado = 'enviada';
		renderBuilder();
		try {
			await runOrEnqueue(
				{ kind: 'enviar_orden', payload: { ordenId: orden.id } },
				() => api.ordenes.enviar(orden.id),
				orden.id,
			);
			await refreshOrdenes();
			showToast(`Orden de ${orden.etiqueta} enviada a caja`);
			backToTables();
		} catch (err) {
			orden.estado = previousEstado;
			renderBuilder();
			throw err;
		} finally {
			sendingOrder = false;
		}
	});
}

// --- Events ---

function attachEvents() {
	el.tableGrid.addEventListener('click', (e) => {
		const card = (e.target as HTMLElement).closest<HTMLElement>('.table-card');
		if (card) openTable(Number(card.dataset.orderId));
	});

	el.backToTablesBtn.addEventListener('click', backToTables);

	el.categoryFilters.addEventListener('click', (e) => {
		const chip = (e.target as HTMLElement).closest<HTMLElement>('.category-chip');
		if (!chip || !chip.dataset.category) return;
		state.selectedCategory = chip.dataset.category;
		renderCategoryFilters();
		renderProductGrid();
	});

	el.productSearch.addEventListener('input', () => {
		state.searchQuery = el.productSearch.value;
		renderProductGrid();
	});

	el.productGrid.addEventListener('click', (e) => {
		const card = (e.target as HTMLElement).closest<HTMLElement>('.product-card');
		if (card) addToCart(Number(card.dataset.productId));
	});

	el.cartItems.addEventListener('click', (e) => {
		const target = e.target as HTMLElement;
		const row = target.closest<HTMLElement>('.cart-item');
		if (!row) return;
		const productId = Number(row.dataset.productId);
		const action = target.dataset.action;
		if (action === 'increase') changeQty(productId, 1);
		if (action === 'decrease') changeQty(productId, -1);
		if (action === 'remove') removeItem(productId);
	});

	el.clearOrderBtn.addEventListener('click', clearOrder);
	el.sendOrderBtn.addEventListener('click', sendOrder);
}

// --- Sincronización offline ---

function handleResolved(tempId: number, realId: number) {
	const orden = state.ordenes.find((o) => o.id === tempId);
	if (orden) orden.id = realId;
	if (state.activeOrdenId === tempId) state.activeOrdenId = realId;
	renderBuilder();
	renderTableBoard();
}

// --- Init ---

async function init() {
	try {
		const [productos, ordenesData] = await Promise.all([
			cachedRead('productos', () => api.productos.listar(true)),
			cachedRead('ordenes', () => api.ordenes.listar()),
		]);
		state.productos = productos.data;
		state.categorias = [...new Set(productos.data.map((p) => p.categoria))];
		state.ordenes = ordenesData.data;

		renderCategoryFilters();
		renderProductGrid();
		renderTableBoard();
		renderConnectionBadge();
		attachEvents();

		onStatusChange(() => {
			renderConnectionBadge();
			renderTableBoard();
		});
		onResolved(handleResolved);
		startAutoSync();
	} catch (err) {
		console.error(err);
		showToast(errorMessage(err));
	}
}

init();
