import { $ } from '../lib/dom';
import * as api from '../lib/api';
import { computeTotals, errorMessage, escapeHtml, findProducto, formatCurrency } from '../lib/posHelpers';
import type { Orden, Producto } from '../types/api';

const state = {
	productos: [] as Producto[],
	categorias: [] as string[],
	selectedCategory: 'Todos',
	ordenes: [] as Orden[],
	activeOrdenId: null as number | null,
	editingOrdenId: null as number | null,
	skipRenameCommit: false,
	pendingDeleteOrdenId: null as number | null,
	busy: false,
};

const el = {
	orderTabs: $<HTMLElement>('orderTabs'),
	newOrderBtn: $<HTMLButtonElement>('newOrderBtn'),
	dailySales: $<HTMLElement>('dailySales'),
	categoryFilters: $<HTMLElement>('categoryFilters'),
	productGrid: $<HTMLElement>('productGrid'),
	activeOrderName: $<HTMLElement>('activeOrderName'),
	clearOrderBtn: $<HTMLButtonElement>('clearOrderBtn'),
	cartItems: $<HTMLElement>('cartItems'),
	orderEmpty: $<HTMLElement>('orderEmpty'),
	subtotal: $<HTMLElement>('subtotal'),
	total: $<HTMLElement>('total'),
	chargeBtn: $<HTMLButtonElement>('chargeBtn'),
	modal: $<HTMLElement>('paymentModal'),
	modalOrderName: $<HTMLElement>('modalOrderName'),
	modalTotal: $<HTMLElement>('modalTotal'),
	cashReceived: $<HTMLInputElement>('cashReceived'),
	changeAmount: $<HTMLElement>('changeAmount'),
	cancelPaymentBtn: $<HTMLButtonElement>('cancelPaymentBtn'),
	confirmPaymentBtn: $<HTMLButtonElement>('confirmPaymentBtn'),
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

async function withBusy(fn: () => Promise<void>) {
	if (state.busy) return;
	state.busy = true;
	try {
		await fn();
	} catch (err) {
		console.error(err);
		showToast(errorMessage(err));
	} finally {
		state.busy = false;
	}
}

async function refreshOrdenes() {
	state.ordenes = await api.ordenes.listar();
}

async function refreshDailySales() {
	const resumen = await api.dashboard.resumen();
	el.dailySales.textContent = formatCurrency(resumen.ventasDelDia);
}

// --- Rendering ---

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
		tab.innerHTML = `
			<button class="order-tab-label" data-order-id="${orden.id}">${sentDot}${escapeHtml(orden.etiqueta)}${count > 0 ? `<span class="tab-count">(${count})</span>` : ''}</button>
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
	const productos =
		state.selectedCategory === 'Todos'
			? state.productos
			: state.productos.filter((p) => p.categoria === state.selectedCategory);

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
	if (!orden) return;

	el.activeOrderName.textContent = orden.etiqueta;
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

	renderOrderTabs();
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
			await api.ordenes.agregarItem(orden.id, productoId, 1);
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
			await api.ordenes.cambiarCantidad(orden.id, productoId, delta);
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
			await api.ordenes.quitarItem(orden.id, productoId);
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
			await api.ordenes.vaciar(orden.id);
			showToast(`${orden.etiqueta} vaciada`);
		} catch (err) {
			orden.items = previousItems;
			renderCart();
			throw err;
		}
	});
}

// --- Orders ---

function switchOrder(ordenId: number) {
	state.activeOrdenId = ordenId;
	renderCart();
}

function addNewOrder() {
	const nextTableNumber = state.ordenes.filter((o) => o.etiqueta.startsWith('Mesa')).length + 1;
	return withBusy(async () => {
		const orden = await api.ordenes.crear({ etiqueta: `Mesa ${nextTableNumber}` });
		state.ordenes.push(orden);
		switchOrder(orden.id);
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

	return withBusy(async () => {
		const updated = await api.ordenes.actualizar(ordenId, { etiqueta: trimmed });
		orden.etiqueta = updated.etiqueta;
		renderCart();
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
		await api.ordenes.eliminar(ordenId);
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
		const venta = await api.ventas.crear({ orden_id: orden.id, metodo_pago: 'efectivo' });
		await refreshOrdenes();
		await refreshDailySales();
		closePaymentModal();
		renderCart();
		showToast(`Pago de ${formatCurrency(venta.total)} confirmado — ${venta.orden_etiqueta}`);
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
	el.chargeBtn.addEventListener('click', openPaymentModal);
	el.cancelPaymentBtn.addEventListener('click', closePaymentModal);
	el.confirmPaymentBtn.addEventListener('click', confirmPayment);
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

// --- Init ---

async function init() {
	try {
		const [productos, ordenesData] = await Promise.all([api.productos.listar(true), api.ordenes.listar()]);
		state.productos = productos;
		state.categorias = [...new Set(productos.map((p) => p.categoria))];
		state.ordenes = ordenesData;
		state.activeOrdenId = ordenesData[0]?.id ?? null;

		renderCategoryFilters();
		renderProductGrid();
		renderCart();
		attachEvents();
		await refreshDailySales();
	} catch (err) {
		console.error(err);
		showToast(errorMessage(err));
	}
}

init();
