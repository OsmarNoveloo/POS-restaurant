import { $ } from '../lib/dom';
import * as api from '../lib/api';
import { computeTotals, errorMessage, formatCurrency, formatTime, ordenStatus } from '../lib/posHelpers';
import { printTicket } from '../lib/print/transport';
import type { Orden, Producto, ResumenDashboard, Venta } from '../types/api';

const REFRESH_INTERVAL_MS = 15000;

const state = {
	productos: [] as Producto[],
	ordenes: [] as Orden[],
	ventas: [] as Venta[],
	resumen: null as ResumenDashboard | null,
};

const el = {
	statDailySales: $<HTMLElement>('statDailySales'),
	statOrderCount: $<HTMLElement>('statOrderCount'),
	statAvgTicket: $<HTMLElement>('statAvgTicket'),
	statActiveTables: $<HTMLElement>('statActiveTables'),
	categoryChart: $<HTMLElement>('categoryChart'),
	categoryChartEmpty: $<HTMLElement>('categoryChartEmpty'),
	liveTables: $<HTMLElement>('liveTables'),
	salesTableWrap: $<HTMLElement>('salesTableWrap'),
	salesLogBody: $<HTMLElement>('salesLogBody'),
	salesLogEmpty: $<HTMLElement>('salesLogEmpty'),
};

const PALETTE = ['var(--chart-series-1)', 'var(--chart-series-2)', 'var(--chart-series-3)', 'var(--chart-series-4)'];

const KNOWN_CATEGORY_COLORS: Record<string, string> = {
	Entradas: PALETTE[0],
	'Platos Fuertes': PALETTE[1],
	Bebidas: PALETTE[2],
	Postres: PALETTE[3],
};

function colorForCategory(category: string): string {
	if (KNOWN_CATEGORY_COLORS[category]) return KNOWN_CATEGORY_COLORS[category];
	let hash = 0;
	for (let i = 0; i < category.length; i += 1) hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
	return PALETTE[hash % PALETTE.length];
}

// --- Rendering ---

function renderStats() {
	const resumen = state.resumen;
	if (!resumen) return;

	el.statDailySales.textContent = formatCurrency(resumen.ventasDelDia);
	el.statOrderCount.textContent = String(resumen.ordenesCobradas);
	el.statAvgTicket.textContent = formatCurrency(resumen.ticketPromedio);
	el.statActiveTables.textContent = `${resumen.mesasActivas} / ${resumen.mesasTotal}`;
}

function renderCategoryChart() {
	const resumen = state.resumen;
	if (!resumen) return;

	const categorias = new Set([
		...Object.keys(resumen.ventasPorCategoria),
		...state.productos.map((p) => p.categoria),
	]);
	const rows = [...categorias]
		.sort((a, b) => a.localeCompare(b))
		.map((categoria) => ({ categoria, value: resumen.ventasPorCategoria[categoria] ?? 0 }));

	const maxValue = Math.max(1, ...rows.map((r) => r.value));
	const hasData = rows.some((r) => r.value > 0);

	el.categoryChartEmpty.style.display = hasData ? 'none' : 'block';
	el.categoryChart.style.display = hasData ? 'flex' : 'none';
	el.categoryChart.innerHTML = '';

	for (const { categoria, value } of rows) {
		const widthPct = (value / maxValue) * 100;

		const row = document.createElement('div');
		row.className = 'bar-row';
		row.title = `${categoria}: ${formatCurrency(value)}`;
		row.innerHTML = `
			<span class="bar-label">${categoria}</span>
			<div class="bar-track">
				<div class="bar-fill" style="width: ${widthPct}%; background: ${colorForCategory(categoria)}"></div>
			</div>
			<span class="bar-value">${formatCurrency(value)}</span>
		`;
		el.categoryChart.appendChild(row);
	}
}

function renderLiveTables() {
	el.liveTables.innerHTML = '';
	for (const orden of state.ordenes) {
		const status = ordenStatus(orden);
		const count = orden.items.reduce((sum, item) => sum + item.cantidad, 0);
		const { total } = computeTotals(orden.items, state.productos);

		const card = document.createElement('div');
		card.className = `table-card compact ${status.key}`;
		card.innerHTML = `
			<span class="table-card-name">${orden.etiqueta}</span>
			<span class="table-card-status">${status.label}</span>
			${count > 0 ? `<span class="table-card-info">${count} producto${count === 1 ? '' : 's'} · ${formatCurrency(total)}</span>` : ''}
		`;
		el.liveTables.appendChild(card);
	}
}

function renderSalesLog() {
	el.salesLogBody.innerHTML = '';
	el.salesLogEmpty.style.display = state.ventas.length ? 'none' : 'block';
	el.salesTableWrap.style.display = state.ventas.length ? 'block' : 'none';

	for (const venta of state.ventas) {
		const itemCount = venta.detalle.reduce((sum, item) => sum + item.cantidad, 0);
		const tr = document.createElement('tr');

		const timeTd = document.createElement('td');
		timeTd.textContent = formatTime(venta.creado_en);
		const tableTd = document.createElement('td');
		tableTd.textContent = venta.orden_etiqueta;
		const itemsTd = document.createElement('td');
		itemsTd.textContent = `${itemCount} producto${itemCount === 1 ? '' : 's'}`;
		const paymentTd = document.createElement('td');
		paymentTd.textContent = venta.metodo_pago === 'efectivo' ? '💵 Efectivo' : '💳 Tarjeta';
		const totalTd = document.createElement('td');
		totalTd.className = 'align-right';
		totalTd.textContent = formatCurrency(venta.total);

		const printTd = document.createElement('td');
		printTd.className = 'align-right';
		printTd.innerHTML = `<button class="print-btn" data-venta-id="${venta.id}" title="Imprimir ticket">🖨️</button>`;

		tr.append(timeTd, tableTd, itemsTd, paymentTd, totalTd, printTd);
		el.salesLogBody.appendChild(tr);
	}
}

function reprintVenta(btn: HTMLButtonElement, ventaId: number) {
	const venta = state.ventas.find((v) => v.id === ventaId);
	if (!venta || btn.disabled) return;
	btn.disabled = true;
	printTicket(venta)
		.catch((err) => {
			console.error(err);
			window.alert(errorMessage(err));
		})
		.finally(() => {
			btn.disabled = false;
		});
}

function renderAll() {
	renderStats();
	renderCategoryChart();
	renderLiveTables();
	renderSalesLog();
}

// --- Init ---

async function loadData() {
	const [resumen, ventas, ordenes, productos] = await Promise.all([
		api.dashboard.resumen(),
		api.ventas.listar(),
		api.ordenes.listar(),
		api.productos.listar(true),
	]);
	state.resumen = resumen;
	state.ventas = ventas;
	state.ordenes = ordenes;
	state.productos = productos;
}

function attachEvents() {
	el.salesLogBody.addEventListener('click', (e) => {
		const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.print-btn');
		if (!btn?.dataset.ventaId) return;
		reprintVenta(btn, Number(btn.dataset.ventaId));
	});
}

async function init() {
	attachEvents();
	try {
		await loadData();
		renderAll();
	} catch (err) {
		console.error(err);
		el.categoryChartEmpty.textContent = errorMessage(err);
		el.categoryChartEmpty.style.display = 'block';
		return;
	}

	setInterval(async () => {
		try {
			await loadData();
			renderAll();
		} catch (err) {
			console.error(err);
		}
	}, REFRESH_INTERVAL_MS);
}

init();
