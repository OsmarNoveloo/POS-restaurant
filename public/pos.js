import { readStore, writeStore, subscribeStore } from '/store.js';

const TAX_RATE = 0.16;

const state = {
	products: [],
	categories: [],
	selectedCategory: 'Todos',
	store: null,
	activeOrderId: null,
	editingOrderId: null,
	skipRenameCommit: false,
	pendingDeleteOrderId: null,
	paymentMethod: 'efectivo',
};

const el = {
	orderTabs: document.getElementById('orderTabs'),
	newOrderBtn: document.getElementById('newOrderBtn'),
	dailySales: document.getElementById('dailySales'),
	categoryFilters: document.getElementById('categoryFilters'),
	productGrid: document.getElementById('productGrid'),
	activeOrderName: document.getElementById('activeOrderName'),
	clearOrderBtn: document.getElementById('clearOrderBtn'),
	cartItems: document.getElementById('cartItems'),
	orderEmpty: document.getElementById('orderEmpty'),
	subtotal: document.getElementById('subtotal'),
	tax: document.getElementById('tax'),
	total: document.getElementById('total'),
	chargeBtn: document.getElementById('chargeBtn'),
	modal: document.getElementById('paymentModal'),
	modalOrderName: document.getElementById('modalOrderName'),
	modalTotal: document.getElementById('modalTotal'),
	paymentMethods: document.getElementById('paymentMethods'),
	cashFields: document.getElementById('cashFields'),
	cashReceived: document.getElementById('cashReceived'),
	changeAmount: document.getElementById('changeAmount'),
	cardNote: document.getElementById('cardNote'),
	cancelPaymentBtn: document.getElementById('cancelPaymentBtn'),
	confirmPaymentBtn: document.getElementById('confirmPaymentBtn'),
	confirmModal: document.getElementById('confirmModal'),
	confirmMessage: document.getElementById('confirmMessage'),
	confirmCancelBtn: document.getElementById('confirmCancelBtn'),
	confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),
	toast: document.getElementById('toast'),
};

function formatCurrency(amount) {
	return `$${amount.toFixed(2)}`;
}

function escapeHtml(text) {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

function findProduct(productId) {
	return state.products.find((p) => p.id === productId);
}

function persist() {
	writeStore(state.store);
}

function createOrder(label) {
	state.store.orderCounter += 1;
	return { id: state.store.orderCounter, label, items: [], status: null };
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

function orderStatusLabel(order) {
	if (order.items.length === 0) return null;
	return order.status === 'enviada' ? 'Enviada' : 'En preparación';
}

function showToast(message) {
	el.toast.textContent = message;
	el.toast.classList.add('show');
	setTimeout(() => el.toast.classList.remove('show'), 2200);
}

// --- Rendering ---

function renderOrderTabs() {
	el.orderTabs.innerHTML = '';
	for (const order of state.store.orders) {
		const tab = document.createElement('div');
		tab.className = 'order-tab' + (order.id === state.activeOrderId ? ' active' : '');

		if (order.id === state.editingOrderId) {
			tab.innerHTML = `<input class="order-tab-input" data-order-id="${order.id}" value="${escapeHtml(order.label)}" />`;
			el.orderTabs.appendChild(tab);
			continue;
		}

		const count = order.items.reduce((sum, item) => sum + item.qty, 0);
		const sentDot = order.status === 'enviada' ? '<span class="sent-dot" title="Enviada por mesero">●</span>' : '';
		tab.innerHTML = `
			<button class="order-tab-label" data-order-id="${order.id}">${sentDot}${escapeHtml(order.label)}${count > 0 ? `<span class="tab-count">(${count})</span>` : ''}</button>
			<button class="tab-edit" data-order-id="${order.id}" title="Renombrar orden">✎</button>
			${state.store.orders.length > 1 ? `<button class="tab-delete" data-order-id="${order.id}" title="Eliminar orden">×</button>` : ''}
		`;
		el.orderTabs.appendChild(tab);
	}

	if (state.editingOrderId !== null) {
		const input = el.orderTabs.querySelector('.order-tab-input');
		if (input) {
			input.focus();
			input.select();
		}
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

function renderCart() {
	const order = getActiveOrder();
	if (!order) return;

	el.activeOrderName.textContent = order.label;
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
	el.chargeBtn.disabled = order.items.length === 0;

	renderOrderTabs();
}

function renderDailySales() {
	el.dailySales.textContent = formatCurrency(state.store.dailySales);
}

// --- Cart mutations ---

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
	persist();
	renderCart();
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
	persist();
	renderCart();
}

function removeItem(productId) {
	const order = getActiveOrder();
	if (!order) return;
	order.items = order.items.filter((i) => i.productId !== productId);
	persist();
	renderCart();
}

function clearActiveOrder() {
	const order = getActiveOrder();
	if (!order || order.items.length === 0) return;
	order.items = [];
	order.status = null;
	persist();
	renderCart();
	showToast(`${order.label} vaciada`);
}

// --- Orders ---

function switchOrder(orderId) {
	state.activeOrderId = orderId;
	renderCart();
}

function addNewOrder() {
	const nextTableNumber = state.store.orders.filter((o) => o.label.startsWith('Mesa')).length + 1;
	const order = createOrder(`Mesa ${nextTableNumber}`);
	state.store.orders.push(order);
	persist();
	switchOrder(order.id);
}

function startRenameOrder(orderId) {
	state.editingOrderId = orderId;
	renderOrderTabs();
}

function commitRenameOrder(orderId, value) {
	const order = state.store.orders.find((o) => o.id === orderId);
	state.editingOrderId = null;
	if (!order) return;

	const trimmed = value.trim();
	if (!trimmed) {
		showToast('El nombre no puede estar vacío');
		renderOrderTabs();
		return;
	}
	order.label = trimmed;
	persist();
	renderCart();
}

function cancelRenameOrder() {
	state.editingOrderId = null;
	renderOrderTabs();
}

function deleteOrder(orderId) {
	if (state.store.orders.length <= 1) {
		showToast('Debe existir al menos una orden abierta');
		return;
	}

	const order = state.store.orders.find((o) => o.id === orderId);
	if (!order) return;

	if (order.items.length > 0) {
		state.pendingDeleteOrderId = orderId;
		el.confirmMessage.textContent = `"${order.label}" tiene productos sin cobrar. ¿Eliminar de todas formas?`;
		el.confirmModal.classList.add('open');
		return;
	}

	performDeleteOrder(orderId);
}

function performDeleteOrder(orderId) {
	const order = state.store.orders.find((o) => o.id === orderId);
	if (!order) return;

	state.store.orders = state.store.orders.filter((o) => o.id !== orderId);
	if (state.activeOrderId === orderId) {
		state.activeOrderId = state.store.orders[0].id;
	}
	persist();
	renderCart();
	showToast(`${order.label} eliminada`);
}

function closeConfirmModal() {
	state.pendingDeleteOrderId = null;
	el.confirmModal.classList.remove('open');
}

// --- Payment modal ---

function openPaymentModal() {
	const order = getActiveOrder();
	if (!order || order.items.length === 0) return;

	const { total } = computeTotals(order);
	el.modalOrderName.textContent = order.label;
	el.modalTotal.textContent = formatCurrency(total);
	el.cashReceived.value = '';
	el.changeAmount.textContent = formatCurrency(0);
	setPaymentMethod('efectivo');
	el.modal.classList.add('open');
}

function closePaymentModal() {
	el.modal.classList.remove('open');
}

function setPaymentMethod(method) {
	state.paymentMethod = method;
	for (const btn of el.paymentMethods.querySelectorAll('.method-btn')) {
		btn.classList.toggle('active', btn.dataset.method === method);
	}
	el.cashFields.style.display = method === 'efectivo' ? 'block' : 'none';
	el.cardNote.style.display = method === 'tarjeta' ? 'block' : 'none';
}

function updateChange() {
	const order = getActiveOrder();
	if (!order) return;
	const { total } = computeTotals(order);
	const received = parseFloat(el.cashReceived.value) || 0;
	const change = Math.max(0, received - total);
	el.changeAmount.textContent = formatCurrency(change);
}

function confirmPayment() {
	const order = getActiveOrder();
	if (!order) return;
	const { total } = computeTotals(order);

	if (state.paymentMethod === 'efectivo') {
		const received = parseFloat(el.cashReceived.value) || 0;
		if (received < total) {
			showToast('El monto recibido es menor al total');
			return;
		}
	}

	state.store.dailySales += total;
	state.store.salesLog.push({
		id: Date.now(),
		orderLabel: order.label,
		paymentMethod: state.paymentMethod,
		items: order.items.map((item) => {
			const product = findProduct(item.productId);
			return {
				name: product ? product.name : 'Producto',
				category: product ? product.category : 'Otros',
				qty: item.qty,
				price: product ? product.price : 0,
			};
		}),
		total,
		timestamp: new Date().toISOString(),
	});
	order.items = [];
	order.status = null;
	persist();
	renderDailySales();
	closePaymentModal();
	renderCart();
	showToast(`Pago de ${formatCurrency(total)} confirmado — ${order.label}`);
}

// --- Cross-tab sync ---

function handleExternalUpdate() {
	state.store = readStore();
	if (!state.store.orders.some((o) => o.id === state.activeOrderId)) {
		state.activeOrderId = state.store.orders[0]?.id ?? null;
	}
	renderCart();
	renderDailySales();
}

// --- Events ---

function attachEvents() {
	el.newOrderBtn.addEventListener('click', addNewOrder);

	el.orderTabs.addEventListener('click', (e) => {
		const editBtn = e.target.closest('.tab-edit');
		if (editBtn) {
			startRenameOrder(Number(editBtn.dataset.orderId));
			return;
		}
		const deleteBtn = e.target.closest('.tab-delete');
		if (deleteBtn) {
			deleteOrder(Number(deleteBtn.dataset.orderId));
			return;
		}
		const label = e.target.closest('.order-tab-label');
		if (label) switchOrder(Number(label.dataset.orderId));
	});

	el.orderTabs.addEventListener('keydown', (e) => {
		const input = e.target.closest('.order-tab-input');
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
		const input = e.target.closest('.order-tab-input');
		if (!input) return;
		if (state.skipRenameCommit) {
			state.skipRenameCommit = false;
			cancelRenameOrder();
			return;
		}
		commitRenameOrder(Number(input.dataset.orderId), input.value);
	});

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

	el.clearOrderBtn.addEventListener('click', clearActiveOrder);
	el.chargeBtn.addEventListener('click', openPaymentModal);
	el.cancelPaymentBtn.addEventListener('click', closePaymentModal);
	el.confirmPaymentBtn.addEventListener('click', confirmPayment);
	el.cashReceived.addEventListener('input', updateChange);

	el.paymentMethods.addEventListener('click', (e) => {
		const btn = e.target.closest('.method-btn');
		if (btn) setPaymentMethod(btn.dataset.method);
	});

	el.modal.addEventListener('click', (e) => {
		if (e.target === el.modal) closePaymentModal();
	});

	el.confirmCancelBtn.addEventListener('click', closeConfirmModal);
	el.confirmDeleteBtn.addEventListener('click', () => {
		const orderId = state.pendingDeleteOrderId;
		closeConfirmModal();
		if (orderId !== null) performDeleteOrder(orderId);
	});
	el.confirmModal.addEventListener('click', (e) => {
		if (e.target === el.confirmModal) closeConfirmModal();
	});

	subscribeStore(handleExternalUpdate);
}

// --- Init ---

async function init() {
	const response = await fetch('/products.json');
	state.products = await response.json();
	state.categories = [...new Set(state.products.map((p) => p.category))];

	state.store = readStore();
	state.activeOrderId = state.store.orders[0].id;

	renderCategoryFilters();
	renderProductGrid();
	renderCart();
	renderDailySales();
	attachEvents();
}

init();
