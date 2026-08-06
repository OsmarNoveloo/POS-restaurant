import { $ } from '../lib/dom';
import * as api from '../lib/api';
import { computeTotals, errorMessage, findProducto, formatCurrency, ordenStatus } from '../lib/posHelpers';
import type { Orden, Producto } from '../types/api';

const state = {
	productos: [] as Producto[],
	categorias: [] as string[],
	selectedCategory: 'Todos',
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

// --- Rendering ---

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

function renderBuilder() {
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
	el.sendOrderBtn.disabled = orden.items.length === 0;
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
			await api.ordenes.agregarItem(orden.id, productoId, 1);
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
			await api.ordenes.cambiarCantidad(orden.id, productoId, delta);
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
			await api.ordenes.quitarItem(orden.id, productoId);
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
			await api.ordenes.vaciar(orden.id);
			showToast(`${orden.etiqueta} vaciada`);
		} catch (err) {
			orden.items = previousItems;
			renderBuilder();
			throw err;
		}
	});
}

function sendOrder() {
	const orden = getActiveOrden();
	if (!orden || orden.items.length === 0) return;
	return withBusy(async () => {
		await api.ordenes.enviar(orden.id);
		await refreshOrdenes();
		showToast(`Orden de ${orden.etiqueta} enviada a caja`);
		backToTables();
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

// --- Init ---

async function init() {
	try {
		const [productos, ordenesData] = await Promise.all([api.productos.listar(true), api.ordenes.listar()]);
		state.productos = productos;
		state.categorias = [...new Set(productos.map((p) => p.categoria))];
		state.ordenes = ordenesData;

		renderCategoryFilters();
		renderProductGrid();
		renderTableBoard();
		attachEvents();
	} catch (err) {
		console.error(err);
		showToast(errorMessage(err));
	}
}

init();
