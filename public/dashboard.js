import { readStore, subscribeStore } from '/store.js';

const state = {
	products: [],
	store: null,
};

const el = {
	statDailySales: document.getElementById('statDailySales'),
	statOrderCount: document.getElementById('statOrderCount'),
	statAvgTicket: document.getElementById('statAvgTicket'),
	statActiveTables: document.getElementById('statActiveTables'),
	categoryChart: document.getElementById('categoryChart'),
	categoryChartEmpty: document.getElementById('categoryChartEmpty'),
	liveTables: document.getElementById('liveTables'),
	salesTableWrap: document.getElementById('salesTableWrap'),
	salesLogBody: document.getElementById('salesLogBody'),
	salesLogEmpty: document.getElementById('salesLogEmpty'),
};

// Fixed categorical order — never reassigned by rank, so a category always
// keeps the same color across renders.
const CATEGORY_COLORS = {
	Entradas: 'var(--chart-series-1)',
	'Platos Fuertes': 'var(--chart-series-2)',
	Bebidas: 'var(--chart-series-3)',
	Postres: 'var(--chart-series-4)',
};
const CATEGORY_ORDER = ['Entradas', 'Platos Fuertes', 'Bebidas', 'Postres'];

function formatCurrency(amount) {
	return `$${amount.toFixed(2)}`;
}

function formatTime(isoString) {
	const date = new Date(isoString);
	return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function findProduct(productId) {
	return state.products.find((p) => p.id === productId);
}

function computeTotals(order) {
	const subtotal = order.items.reduce((sum, item) => {
		const product = findProduct(item.productId);
		return sum + (product ? product.price * item.qty : 0);
	}, 0);
	return { subtotal, total: subtotal * 1.16 };
}

function orderStatus(order) {
	if (order.items.length === 0) return { key: 'free', label: 'Libre' };
	if (order.status === 'enviada') return { key: 'sent', label: 'Enviada' };
	return { key: 'draft', label: 'En preparación' };
}

// --- Rendering ---

function renderStats() {
	const { salesLog, dailySales, orders } = state.store;
	el.statDailySales.textContent = formatCurrency(dailySales);
	el.statOrderCount.textContent = String(salesLog.length);
	el.statAvgTicket.textContent = formatCurrency(salesLog.length ? dailySales / salesLog.length : 0);

	const activeTables = orders.filter((o) => o.items.length > 0).length;
	el.statActiveTables.textContent = `${activeTables} / ${orders.length}`;
}

function renderCategoryChart() {
	const totalsByCategory = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0]));

	for (const sale of state.store.salesLog) {
		for (const item of sale.items) {
			if (totalsByCategory[item.category] === undefined) continue;
			totalsByCategory[item.category] += item.price * item.qty;
		}
	}

	const maxValue = Math.max(1, ...Object.values(totalsByCategory));
	const hasData = Object.values(totalsByCategory).some((v) => v > 0);

	el.categoryChartEmpty.style.display = hasData ? 'none' : 'block';
	el.categoryChart.style.display = hasData ? 'flex' : 'none';
	el.categoryChart.innerHTML = '';

	for (const category of CATEGORY_ORDER) {
		const value = totalsByCategory[category];
		const widthPct = (value / maxValue) * 100;

		const row = document.createElement('div');
		row.className = 'bar-row';
		row.title = `${category}: ${formatCurrency(value)}`;
		row.innerHTML = `
			<span class="bar-label">${category}</span>
			<div class="bar-track">
				<div class="bar-fill" style="width: ${widthPct}%; background: ${CATEGORY_COLORS[category]}"></div>
			</div>
			<span class="bar-value">${formatCurrency(value)}</span>
		`;
		el.categoryChart.appendChild(row);
	}
}

function renderLiveTables() {
	el.liveTables.innerHTML = '';
	for (const order of state.store.orders) {
		const status = orderStatus(order);
		const count = order.items.reduce((sum, item) => sum + item.qty, 0);
		const { total } = computeTotals(order);

		const card = document.createElement('div');
		card.className = `table-card compact ${status.key}`;
		card.innerHTML = `
			<span class="table-card-name">${order.label}</span>
			<span class="table-card-status">${status.label}</span>
			${count > 0 ? `<span class="table-card-info">${count} producto${count === 1 ? '' : 's'} · ${formatCurrency(total)}</span>` : ''}
		`;
		el.liveTables.appendChild(card);
	}
}

function renderSalesLog() {
	const sales = [...state.store.salesLog].reverse();
	el.salesLogBody.innerHTML = '';
	el.salesLogEmpty.style.display = sales.length ? 'none' : 'block';
	el.salesTableWrap.style.display = sales.length ? 'block' : 'none';

	for (const sale of sales) {
		const itemCount = sale.items.reduce((sum, item) => sum + item.qty, 0);
		const tr = document.createElement('tr');

		const timeTd = document.createElement('td');
		timeTd.textContent = formatTime(sale.timestamp);
		const tableTd = document.createElement('td');
		tableTd.textContent = sale.orderLabel;
		const itemsTd = document.createElement('td');
		itemsTd.textContent = `${itemCount} producto${itemCount === 1 ? '' : 's'}`;
		const paymentTd = document.createElement('td');
		paymentTd.textContent = sale.paymentMethod === 'efectivo' ? '💵 Efectivo' : '💳 Tarjeta';
		const totalTd = document.createElement('td');
		totalTd.className = 'align-right';
		totalTd.textContent = formatCurrency(sale.total);

		tr.append(timeTd, tableTd, itemsTd, paymentTd, totalTd);
		el.salesLogBody.appendChild(tr);
	}
}

function renderAll() {
	renderStats();
	renderCategoryChart();
	renderLiveTables();
	renderSalesLog();
}

// --- Init ---

async function init() {
	const response = await fetch('/products.json');
	state.products = await response.json();
	state.store = readStore();

	renderAll();

	subscribeStore(() => {
		state.store = readStore();
		renderAll();
	});
}

init();
