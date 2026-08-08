import { $ } from '../lib/dom';
import * as api from '../lib/api';
import { computeTotals, errorMessage, escapeHtml, findProducto, formatCurrency, normalizeSearch } from '../lib/posHelpers';
import { printComanda, printTicket } from '../lib/print/transport';
import { cachedRead } from '../lib/offline/cache';
import { isOnline, onStatusChange } from '../lib/offline/network';
import {
	cancelPendingOrder,
	isPendingSync,
	nextTempId,
	onResolved,
	pendingCount,
	pendingSalesTotal,
	runOrEnqueue,
	startAutoSync,
} from '../lib/offline/queue';
import type { Orden, Producto, Venta } from '../types/api';

const state = {
	productos: [] as Producto[],
	categorias: [] as string[],
	selectedCategory: 'Todos',
	searchQuery: '',
	ordenes: [] as Orden[],
	activeOrdenId: null as number | null,
	editingOrdenId: null as number | null,
	skipRenameCommit: false,
	pendingDeleteOrdenId: null as number | null,
	busy: false,
	lastVenta: null as Venta | null,
};

const el = {
	orderTabs: $<HTMLElement>('orderTabs'),
	newOrderBtn: $<HTMLButtonElement>('newOrderBtn'),
	dailySales: $<HTMLElement>('dailySales'),
	connectionStatus: $<HTMLElement>('connectionStatus'),
	productSearch: $<HTMLInputElement>('productSearch'),
	productSearchEmpty: $<HTMLElement>('productSearchEmpty'),
	categoryFilters: $<HTMLElement>('categoryFilters'),
	productGrid: $<HTMLElement>('productGrid'),
	activeOrderName: $<HTMLElement>('activeOrderName'),
	clearOrderBtn: $<HTMLButtonElement>('clearOrderBtn'),
	printComandaBtn: $<HTMLButtonElement>('printComandaBtn'),
	deliveryAddress: $<HTMLInputElement>('deliveryAddress'),
	deliveryDetail: $<HTMLInputElement>('deliveryDetail'),
	cartItems: $<HTMLElement>('cartItems'),
	orderEmpty: $<HTMLElement>('orderEmpty'),
	subtotal: $<HTMLElement>('subtotal'),
	total: $<HTMLElement>('total'),
	chargeBtn: $<HTMLButtonElement>('chargeBtn'),
	modal: $<HTMLElement>('paymentModal'),
	modalOrderName: $<HTMLElement>('modalOrderName'),
	modalTotal: $<HTMLElement>('modalTotal'),
	cashFields: $<HTMLElement>('cashFields'),
	cashReceived: $<HTMLInputElement>('cashReceived'),
	changeAmount: $<HTMLElement>('changeAmount'),
	cancelPaymentBtn: $<HTMLButtonElement>('cancelPaymentBtn'),
	confirmPaymentBtn: $<HTMLButtonElement>('confirmPaymentBtn'),
	printTicketBtn: $<HTMLButtonElement>('printTicketBtn'),
	confirmModal: $<HTMLElement>('confirmModal'),
	confirmMessage: $<HTMLElement>('confirmMessage'),
	confirmCancelBtn: $<HTMLButtonElement>('confirmCancelBtn'),
	confirmDeleteBtn: $<HTMLButtonElement>('confirmDeleteBtn'),
	toast: $<HTMLElement>('toast'),
};

function getActiveOrden(): Orden | undefined {
	return state.ordenes.find((o) => o.id === state.activeOrdenId);
}

function showToast(message: string) {
	el.toast.textContent = message;
	el.toast.classList.add('show');
	setTimeout(() => el.toast.classList.remove('show'), 2200);
}

// Encola las acciones en vez de descartarlas cuando ya hay una en curso: con
// state.busy como simple bandera, tocar varios productos rápido hacía que
// las peticiones de las siguientes se perdieran en silencio (el carrito local
// ya mostraba el producto, pero nunca se mandaba al backend).
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
	// Las mesas creadas offline que todavía no se sincronizan no existen en el
	// servidor todavía: se conservan aparte para no perderlas al refrescar.
	const pending = state.ordenes.filter((o) => isPendingSync(o.id));
	state.ordenes = [...data, ...pending];
}

async function refreshDailySales() {
	const { data } = await cachedRead('resumen', () => api.dashboard.resumen());
	el.dailySales.textContent = formatCurrency(data.ventasDelDia + pendingSalesTotal());
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

function renderOrderTabs() {
	el.orderTabs.innerHTML = '';
	for (const orden of state.ordenes) {
		const tab = document.createElement('div');
		tab.className = 'order-tab' + (orden.id === state.activeOrdenId ? ' active' : '');

		if (orden.id === state.editingOrdenId) {
			tab.innerHTML = `<input class="order-tab-input" data-order-id="${orden.id}" value="${escapeHtml(orden.etiqueta)}" />`;
			el.orderTabs.appendChild(tab);
			continue;
		}

		const count = orden.items.reduce((sum, item) => sum + item.cantidad, 0);
		const sentDot = orden.estado === 'enviada' ? '<span class="sent-dot" title="Enviada por mesero">●</span>' : '';
		const pendingDot = isPendingSync(orden.id) ? '<span class="sent-dot" title="Sin sincronizar">🔴</span>' : '';
		tab.innerHTML = `
			<button class="order-tab-label" data-order-id="${orden.id}">${sentDot}${pendingDot}${escapeHtml(orden.etiqueta)}${count > 0 ? `<span class="tab-count">(${count})</span>` : ''}</button>
			<button class="tab-edit" data-order-id="${orden.id}" title="Renombrar orden">✎</button>
			${state.ordenes.length > 1 ? `<button class="tab-delete" data-order-id="${orden.id}" title="Eliminar orden">×</button>` : ''}
		`;
		el.orderTabs.appendChild(tab);
	}

	if (state.editingOrdenId !== null) {
		const input = el.orderTabs.querySelector<HTMLInputElement>('.order-tab-input');
		if (input) {
			input.focus();
			input.select();
		}
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

function renderCart() {
	const orden = getActiveOrden();
	renderConnectionBadge();
	if (!orden) return;

	el.activeOrderName.textContent = orden.etiqueta;
	syncDeliveryInputs(orden);
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
	el.chargeBtn.disabled = orden.items.length === 0;
	el.printComandaBtn.disabled = orden.items.length === 0;

	renderOrderTabs();
}

// No se pisa el valor mientras el usuario está escribiendo: renderCart se
// dispara en cada cambio del carrito (agregar producto, etc.), no solo al
// cambiar de orden.
function syncDeliveryInputs(orden: Orden) {
	if (document.activeElement !== el.deliveryAddress) el.deliveryAddress.value = orden.direccion_entrega ?? '';
	if (document.activeElement !== el.deliveryDetail) el.deliveryDetail.value = orden.detalle_entrega ?? '';
}

// --- Cart mutations ---

function addToCart(productoId: number) {
	const orden = getActiveOrden();
	if (!orden) return;

	const existing = orden.items.find((i) => i.producto_id === productoId);
	if (existing) existing.cantidad += 1;
	else orden.items.push({ producto_id: productoId, cantidad: 1 });
	renderCart();

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
			renderCart();
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
	renderCart();

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
			renderCart();
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
	renderCart();

	return withBusy(async () => {
		try {
			await runOrEnqueue(
				{ kind: 'quitar_item', payload: { ordenId: orden.id, productoId } },
				() => api.ordenes.quitarItem(orden.id, productoId),
				orden.id,
			);
		} catch (err) {
			orden.items.splice(index, 0, removed);
			renderCart();
			throw err;
		}
	});
}

function clearActiveOrder() {
	const orden = getActiveOrden();
	if (!orden || orden.items.length === 0) return;

	const previousItems = orden.items;
	orden.items = [];
	renderCart();

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
			renderCart();
			throw err;
		}
	});
}

function commitDeliveryInfo() {
	const orden = getActiveOrden();
	if (!orden) return;

	const direccion = el.deliveryAddress.value.trim() || null;
	const detalle = el.deliveryDetail.value.trim() || null;
	if (orden.direccion_entrega === direccion && orden.detalle_entrega === detalle) return;

	const previous = { direccion: orden.direccion_entrega, detalle: orden.detalle_entrega };
	orden.direccion_entrega = direccion;
	orden.detalle_entrega = detalle;

	return withBusy(async () => {
		try {
			await runOrEnqueue(
				{ kind: 'actualizar_orden', payload: { ordenId: orden.id, direccion_entrega: direccion, detalle_entrega: detalle } },
				() => api.ordenes.actualizar(orden.id, { direccion_entrega: direccion, detalle_entrega: detalle }),
				orden.id,
			);
		} catch (err) {
			orden.direccion_entrega = previous.direccion;
			orden.detalle_entrega = previous.detalle;
			syncDeliveryInputs(orden);
			throw err;
		}
	});
}

function printComandaTicket() {
	const orden = getActiveOrden();
	if (!orden || orden.items.length === 0) return;

	return withBusy(async () => {
		await printComanda(orden, state.productos);
		showToast('Comanda enviada a la impresora');
	});
}

// --- Orders ---

function switchOrder(ordenId: number) {
	state.activeOrdenId = ordenId;
	renderCart();
}

// "Mesa N" queda reservado para las órdenes que llegan del Mesero (mesas
// físicas). Las que se abren directamente en Caja son pedidos sueltos
// (para llevar, a domicilio, teléfono...), así que se numeran aparte.
function addNewOrder() {
	const nextOrderNumber = state.ordenes.filter((o) => o.etiqueta.startsWith('Pedido')).length + 1;
	const etiqueta = `Pedido ${nextOrderNumber}`;
	const tempId = nextTempId();
	const orden: Orden = {
		id: tempId,
		etiqueta,
		estado: null,
		creado_en: new Date().toISOString(),
		direccion_entrega: null,
		detalle_entrega: null,
		items: [],
	};
	state.ordenes.push(orden);
	switchOrder(tempId);

	return withBusy(async () => {
		const created = await runOrEnqueue(
			{ kind: 'crear_orden', payload: { tempId, etiqueta } },
			() => api.ordenes.crear({ etiqueta }),
		);
		if (created) {
			orden.id = created.id;
			orden.creado_en = created.creado_en;
			if (state.activeOrdenId === tempId) state.activeOrdenId = created.id;
			renderCart();
		}
	});
}

function startRenameOrder(ordenId: number) {
	state.editingOrdenId = ordenId;
	renderOrderTabs();
}

function commitRenameOrder(ordenId: number, value: string) {
	const orden = state.ordenes.find((o) => o.id === ordenId);
	state.editingOrdenId = null;
	if (!orden) return;

	const trimmed = value.trim();
	if (!trimmed) {
		showToast('El nombre no puede estar vacío');
		renderOrderTabs();
		return;
	}
	if (trimmed === orden.etiqueta) {
		renderOrderTabs();
		return;
	}

	const previous = orden.etiqueta;
	orden.etiqueta = trimmed;
	renderCart();

	return withBusy(async () => {
		try {
			await runOrEnqueue(
				{ kind: 'actualizar_orden', payload: { ordenId, etiqueta: trimmed } },
				() => api.ordenes.actualizar(ordenId, { etiqueta: trimmed }),
				ordenId,
			);
		} catch (err) {
			orden.etiqueta = previous;
			renderCart();
			throw err;
		}
	});
}

function cancelRenameOrder() {
	state.editingOrdenId = null;
	renderOrderTabs();
}

function deleteOrder(ordenId: number) {
	if (state.ordenes.length <= 1) {
		showToast('Debe existir al menos una orden abierta');
		return;
	}

	const orden = state.ordenes.find((o) => o.id === ordenId);
	if (!orden) return;

	if (orden.items.length > 0) {
		state.pendingDeleteOrdenId = ordenId;
		el.confirmMessage.textContent = `"${orden.etiqueta}" tiene productos sin cobrar. ¿Eliminar de todas formas?`;
		el.confirmModal.classList.add('open');
		return;
	}

	performDeleteOrder(ordenId);
}

function performDeleteOrder(ordenId: number) {
	const orden = state.ordenes.find((o) => o.id === ordenId);
	if (!orden) return;

	return withBusy(async () => {
		if (isPendingSync(ordenId)) {
			// Nunca llegó a existir en el servidor: no hay nada que eliminar ahí.
			cancelPendingOrder(ordenId);
		} else {
			await runOrEnqueue({ kind: 'eliminar_orden', payload: { ordenId } }, () => api.ordenes.eliminar(ordenId), ordenId);
		}
		state.ordenes = state.ordenes.filter((o) => o.id !== ordenId);
		if (state.activeOrdenId === ordenId) {
			state.activeOrdenId = state.ordenes[0]?.id ?? null;
		}
		renderCart();
		showToast(`${orden.etiqueta} eliminada`);
	});
}

function closeConfirmModal() {
	state.pendingDeleteOrdenId = null;
	el.confirmModal.classList.remove('open');
}

// --- Payment modal ---

function openPaymentModal() {
	const orden = getActiveOrden();
	if (!orden || orden.items.length === 0) return;

	const { total } = computeTotals(orden.items, state.productos);
	el.modalOrderName.textContent = orden.etiqueta;
	el.modalTotal.textContent = formatCurrency(total);
	el.cashReceived.value = '';
	el.changeAmount.textContent = formatCurrency(0);
	el.modal.classList.add('open');
}

function closePaymentModal() {
	el.modal.classList.remove('open');
	el.cashFields.style.display = '';
	el.confirmPaymentBtn.style.display = '';
	el.printTicketBtn.style.display = 'none';
	el.cancelPaymentBtn.textContent = 'Cancelar';
}

function updateChange() {
	const orden = getActiveOrden();
	if (!orden) return;
	const { total } = computeTotals(orden.items, state.productos);
	const received = parseFloat(el.cashReceived.value) || 0;
	const change = Math.max(0, received - total);
	el.changeAmount.textContent = formatCurrency(change);
}

function confirmPayment() {
	const orden = getActiveOrden();
	if (!orden) return;
	const { total } = computeTotals(orden.items, state.productos);

	const received = parseFloat(el.cashReceived.value) || 0;
	if (received < total) {
		showToast('El monto recibido es menor al total');
		return;
	}

	return withBusy(async () => {
		const tempId = nextTempId();
		const detalle = orden.items.map((item) => {
			const producto = findProducto(state.productos, item.producto_id);
			return {
				producto_nombre: producto?.nombre ?? 'Producto',
				categoria: producto?.categoria ?? '',
				cantidad: item.cantidad,
				precio: producto?.precio ?? 0,
			};
		});

		const venta = await runOrEnqueue(
			{
				kind: 'crear_venta',
				payload: { tempId, ordenId: orden.id, metodoPago: 'efectivo', recibido: received, total },
			},
			() => api.ventas.crear({ orden_id: orden.id, metodo_pago: 'efectivo', recibido: received }),
			orden.id,
		);

		if (venta) {
			state.lastVenta = venta;
			await refreshOrdenes();
			await refreshDailySales();
			showToast(`Pago de ${formatCurrency(venta.total)} confirmado — ${venta.orden_etiqueta}`);
		} else {
			// Sin conexión: el total ya lo calcula el navegador (computeTotals), así
			// que el ticket se puede imprimir de inmediato con estos datos locales;
			// la venta real se manda al servidor cuando vuelva la señal.
			state.lastVenta = {
				id: tempId,
				orden_etiqueta: orden.etiqueta,
				metodo_pago: 'efectivo',
				subtotal: total,
				impuesto: 0,
				total,
				recibido: received,
				cambio: Math.max(0, received - total),
				creado_en: new Date().toISOString(),
				direccion_entrega: orden.direccion_entrega,
				detalle_entrega: orden.detalle_entrega,
				// El folio del día lo asigna el servidor; se desconoce hasta sincronizar.
				folio: null,
				detalle,
			};
			orden.items = [];
			refreshDailySales().catch(() => {});
			showToast('Pago registrado sin conexión — se sincronizará al volver la señal');
		}

		renderCart();
		el.cashFields.style.display = 'none';
		el.confirmPaymentBtn.style.display = 'none';
		el.printTicketBtn.style.display = '';
		el.cancelPaymentBtn.textContent = 'Cerrar';
	});
}

function printLastTicket() {
	if (!state.lastVenta) return;
	return withBusy(async () => {
		await printTicket(state.lastVenta!);
		showToast('Ticket enviado a la impresora');
	});
}

// --- Events ---

function attachEvents() {
	el.newOrderBtn.addEventListener('click', addNewOrder);

	el.orderTabs.addEventListener('click', (e) => {
		const target = e.target as HTMLElement;
		const editBtn = target.closest<HTMLElement>('.tab-edit');
		if (editBtn) {
			startRenameOrder(Number(editBtn.dataset.orderId));
			return;
		}
		const deleteBtn = target.closest<HTMLElement>('.tab-delete');
		if (deleteBtn) {
			deleteOrder(Number(deleteBtn.dataset.orderId));
			return;
		}
		const label = target.closest<HTMLElement>('.order-tab-label');
		if (label) switchOrder(Number(label.dataset.orderId));
	});

	el.orderTabs.addEventListener('keydown', (e) => {
		const input = (e.target as HTMLElement).closest<HTMLInputElement>('.order-tab-input');
		if (!input) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			input.blur();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			state.skipRenameCommit = true;
			input.blur();
		}
	});

	el.orderTabs.addEventListener('focusout', (e) => {
		const input = (e.target as HTMLElement).closest<HTMLInputElement>('.order-tab-input');
		if (!input) return;
		if (state.skipRenameCommit) {
			state.skipRenameCommit = false;
			cancelRenameOrder();
			return;
		}
		commitRenameOrder(Number(input.dataset.orderId), input.value);
	});

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

	el.clearOrderBtn.addEventListener('click', clearActiveOrder);
	el.printComandaBtn.addEventListener('click', printComandaTicket);
	el.deliveryAddress.addEventListener('change', commitDeliveryInfo);
	el.deliveryDetail.addEventListener('change', commitDeliveryInfo);
	el.chargeBtn.addEventListener('click', openPaymentModal);
	el.cancelPaymentBtn.addEventListener('click', closePaymentModal);
	el.confirmPaymentBtn.addEventListener('click', confirmPayment);
	el.printTicketBtn.addEventListener('click', printLastTicket);
	el.cashReceived.addEventListener('input', updateChange);

	el.modal.addEventListener('click', (e) => {
		if (e.target === el.modal) closePaymentModal();
	});

	el.confirmCancelBtn.addEventListener('click', closeConfirmModal);
	el.confirmDeleteBtn.addEventListener('click', () => {
		const ordenId = state.pendingDeleteOrdenId;
		closeConfirmModal();
		if (ordenId !== null) performDeleteOrder(ordenId);
	});
	el.confirmModal.addEventListener('click', (e) => {
		if (e.target === el.confirmModal) closeConfirmModal();
	});
}

// --- Sincronización offline ---

function handleResolved(tempId: number, realId: number) {
	const orden = state.ordenes.find((o) => o.id === tempId);
	if (orden) orden.id = realId;
	if (state.activeOrdenId === tempId) state.activeOrdenId = realId;
	if (state.lastVenta?.id === tempId) state.lastVenta.id = realId;
	renderCart();
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
		state.activeOrdenId = ordenesData.data[0]?.id ?? null;

		renderCategoryFilters();
		renderProductGrid();
		renderCart();
		attachEvents();

		onStatusChange(renderConnectionBadge);
		onResolved(handleResolved);
		startAutoSync();

		await refreshDailySales();
	} catch (err) {
		console.error(err);
		showToast(errorMessage(err));
	}
}

init();
