import { readStore, writeStore, subscribeStore } from '/store.js';

const TAX_RATE = 0.16;

const state = {
	products: [],
	categories: [],
	selectedCategory: 'Todos',
	store: null,
	activeOrderId: null,
};

const el = {
	tableBoard: document.getElementById('tableBoard'),
	tableGrid: document.getElementById('tableGrid'),
	orderBuilder: document.getElementById('orderBuilder'),
	backToTablesBtn: document.getElementById('backToTablesBtn'),
	builderTableName: document.getElementById('builderTableName'),
	builderStatusBadge: document.getElementById('builderStatusBadge'),
	categoryFilters: document.getElementById('categoryFilters'),
	productGrid: document.getElementById('productGrid'),
	clearOrderBtn: document.getElementById('clearOrderBtn'),
	cartItems: document.getElementById('cartItems'),
	orderEmpty: document.getElementById('orderEmpty'),
	subtotal: document.getElementById('subtotal'),
	tax: document.getElementById('tax'),
	total: document.getElementById('total'),
	sendOrderBtn: document.getElementById('sendOrderBtn'),
	toast: document.getElementById('toast'),
};

function formatCurrency(amount) {
	return `$${amount.toFixed(2)}`;
}

function findProduct(productId) {
	return state.products.find((p) => p.id === productId);
}

function persist() {
	writeStore(state.store);
}

function getActiveOrder() {
	return state.store.orders.find((order) => order.id === state.activeOrderId);
}

function computeTotals(order) {
	const subtotal = order.items.reduce((sum, item) => {
		const product = findProduct(item.productId);
		return sum + (product ? product.price * item.qty : 0);
	}, 0);
	const tax = subtotal * TAX_RATE;
	return { subtotal, tax, total: subtotal + tax };
}

function orderStatus(order) {
	if (order.items.length === 0) return { key: 'free', label: 'Libre' };
	if (order.status === 'enviada') return { key: 'sent', label: 'Enviada' };
	return { key: 'draft', label: 'En preparación' };
}

function showToast(message) {
	el.toast.textContent = message;
	el.toast.classList.add('show');
	setTimeout(() => el.toast.classList.remove('show'), 2200);
}

// --- Rendering ---

function renderTableBoard() {
	el.tableGrid.innerHTML = '';
	for (const order of state.store.orders) {
		const status = orderStatus(order);
		const count = order.items.reduce((sum, item) => sum + item.qty, 0);
		const { total } = computeTotals(order);

		const card = document.createElement('button');
		card.className = `table-card ${status.key}`;
		card.dataset.orderId = String(order.id);
		card.innerHTML = `
			<span class="table-card-name">${order.label}</span>
			<span class="table-card-status">${status.label}</span>
			${count > 0 ? `<span class="table-card-info">${count} producto${count === 1 ? '' : 's'} · ${formatCurrency(total)}</span>` : ''}
		`;
		el.tableGrid.appendChild(card);
	}
}

function renderCategoryFilters() {
	el.categoryFilters.innerHTML = '';
	const all = ['Todos', ...state.categories];
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
	const products =
		state.selectedCategory === 'Todos'
			? state.products
			: state.products.filter((p) => p.category === state.selectedCategory);

	for (const product of products) {
		const card = document.createElement('button');
		card.className = 'product-card';
		card.dataset.productId = String(product.id);
		card.innerHTML = `
			<span class="product-icon">${product.icon}</span>
			<span class="product-name">${product.name}</span>
			<span class="product-price">${formatCurrency(product.price)}</span>
		`;
		el.productGrid.appendChild(card);
	}
}

function renderBuilder() {
	const order = getActiveOrder();
	if (!order) return;

	const status = orderStatus(order);
	el.builderTableName.textContent = order.label;
	el.builderStatusBadge.textContent = status.label;
	el.builderStatusBadge.className = `status-badge ${status.key}`;

	el.cartItems.innerHTML = '';
	if (order.items.length === 0) {
		el.orderEmpty.style.display = 'block';
	} else {
		el.orderEmpty.style.display = 'none';
		for (const item of order.items) {
			const product = findProduct(item.productId);
			if (!product) continue;
			const li = document.createElement('li');
			li.className = 'cart-item';
			li.dataset.productId = String(product.id);
			li.innerHTML = `
				<span class="cart-item-icon">${product.icon}</span>
				<div class="cart-item-info">
					<div class="cart-item-name">${product.name}</div>
					<div class="cart-item-price">${formatCurrency(product.price)} c/u</div>
				</div>
				<div class="qty-controls">
					<button class="qty-btn" data-action="decrease">−</button>
					<span class="qty-value">${item.qty}</span>
					<button class="qty-btn" data-action="increase">+</button>
				</div>
				<button class="remove-btn" data-action="remove" title="Quitar">✕</button>
			`;
			el.cartItems.appendChild(li);
		}
	}

	const { subtotal, tax, total } = computeTotals(order);
	el.subtotal.textContent = formatCurrency(subtotal);
	el.tax.textContent = formatCurrency(tax);
	el.total.textContent = formatCurrency(total);
	el.sendOrderBtn.disabled = order.items.length === 0;
	el.sendOrderBtn.textContent = status.key === 'sent' ? 'Orden enviada ✓' : 'Enviar orden a caja';
}

// --- Navigation ---

function openTable(orderId) {
	state.activeOrderId = orderId;
	el.tableBoard.hidden = true;
	el.orderBuilder.hidden = false;
	renderBuilder();
}

function backToTables() {
	state.activeOrderId = null;
	el.orderBuilder.hidden = true;
	el.tableBoard.hidden = false;
	renderTableBoard();
}

// --- Cart mutations ---

function markAsDraft(order) {
	if (order.status === 'enviada') order.status = null;
}

function addToCart(productId) {
	const order = getActiveOrder();
	const product = findProduct(productId);
	if (!order || !product) return;

	const existing = order.items.find((item) => item.productId === productId);
	if (existing) {
		existing.qty += 1;
	} else {
		order.items.push({ productId, qty: 1 });
	}
	markAsDraft(order);
	persist();
	renderBuilder();
}

function changeQty(productId, delta) {
	const order = getActiveOrder();
	if (!order) return;
	const item = order.items.find((i) => i.productId === productId);
	if (!item) return;

	item.qty += delta;
	if (item.qty <= 0) {
		order.items = order.items.filter((i) => i.productId !== productId);
	}
	markAsDraft(order);
	persist();
	renderBuilder();
}

function removeItem(productId) {
	const order = getActiveOrder();
	if (!order) return;
	order.items = order.items.filter((i) => i.productId !== productId);
	markAsDraft(order);
	persist();
	renderBuilder();
}

function clearOrder() {
	const order = getActiveOrder();
	if (!order || order.items.length === 0) return;
	order.items = [];
	order.status = null;
	persist();
	renderBuilder();
	showToast(`${order.label} vaciada`);
}

function sendOrder() {
	const order = getActiveOrder();
	if (!order || order.items.length === 0) return;
	order.status = 'enviada';
	persist();
	showToast(`Orden de ${order.label} enviada a caja`);
	backToTables();
}

// --- Cross-tab sync ---

function handleExternalUpdate() {
	state.store = readStore();
	if (state.activeOrderId !== null && !state.store.orders.some((o) => o.id === state.activeOrderId)) {
		backToTables();
		return;
	}
	if (el.orderBuilder.hidden) {
		renderTableBoard();
	} else {
		renderBuilder();
	}
}

// --- Events ---

function attachEvents() {
	el.tableGrid.addEventListener('click', (e) => {
		const card = e.target.closest('.table-card');
		if (card) openTable(Number(card.dataset.orderId));
	});

	el.backToTablesBtn.addEventListener('click', backToTables);

	el.categoryFilters.addEventListener('click', (e) => {
		const chip = e.target.closest('.category-chip');
		if (!chip) return;
		state.selectedCategory = chip.dataset.category;
		renderCategoryFilters();
		renderProductGrid();
	});

	el.productGrid.addEventListener('click', (e) => {
		const card = e.target.closest('.product-card');
		if (card) addToCart(Number(card.dataset.productId));
	});

	el.cartItems.addEventListener('click', (e) => {
		const row = e.target.closest('.cart-item');
		if (!row) return;
		const productId = Number(row.dataset.productId);
		const action = e.target.dataset.action;
		if (action === 'increase') changeQty(productId, 1);
		if (action === 'decrease') changeQty(productId, -1);
		if (action === 'remove') removeItem(productId);
	});

	el.clearOrderBtn.addEventListener('click', clearOrder);
	el.sendOrderBtn.addEventListener('click', sendOrder);

	subscribeStore(handleExternalUpdate);
}

// --- Init ---

async function init() {
	const response = await fetch('/products.json');
	state.products = await response.json();
	state.categories = [...new Set(state.products.map((p) => p.category))];

	state.store = readStore();

	renderCategoryFilters();
	renderProductGrid();
	renderTableBoard();
	attachEvents();
}

init();
