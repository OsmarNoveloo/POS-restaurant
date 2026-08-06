import { $ } from '../lib/dom';
import * as api from '../lib/api';
import { errorMessage, formatCurrency } from '../lib/posHelpers';
import type { Producto, ProductoInput } from '../types/api';

type Filtro = 'todos' | 'activos' | 'inactivos';

const EMOJI_OPTIONS = [
	'🌮', '🌯', '🫔', '🥙', '🍔', '🌭', '🍕', '🍗', '🍖', '🥩',
	'🍳', '🥗', '🍲', '🍜', '🍛', '🍱', '🍣', '🍤', '🥟', '🌽',
	'🧀', '🥑', '🍞', '🥐', '🍰', '🧁', '🍩', '🍪', '🍫', '🍦',
	'🍨', '🥤', '🧃', '☕', '🍺', '🍷', '🍹', '🥃', '🍽️', '🍴',
	'🥄', '🔥', '🧂',
];

const state = {
	productos: [] as Producto[],
	filtro: 'todos' as Filtro,
	editingId: null as number | null,
	pendingDeleteId: null as number | null,
	busy: false,
};

const el = {
	formTitle: $<HTMLElement>('formTitle'),
	form: $<HTMLFormElement>('productoForm'),
	nombre: $<HTMLInputElement>('nombre'),
	precio: $<HTMLInputElement>('precio'),
	categoria: $<HTMLInputElement>('categoria'),
	categoriaSelect: $<HTMLElement>('categoriaSelect'),
	categoriaDropdown: $<HTMLElement>('categoriaDropdown'),
	icono: $<HTMLInputElement>('icono'),
	emojiSelect: $<HTMLDetailsElement>('emojiSelect'),
	emojiPreview: $<HTMLElement>('emojiPreview'),
	emojiPicker: $<HTMLElement>('emojiPicker'),
	activo: $<HTMLInputElement>('activo'),
	submitBtn: $<HTMLButtonElement>('submitProductoBtn'),
	cancelEditBtn: $<HTMLButtonElement>('cancelEditBtn'),
	activoFilters: $<HTMLElement>('activoFilters'),
	productosBody: $<HTMLElement>('productosBody'),
	productosEmpty: $<HTMLElement>('productosEmpty'),
	confirmModal: $<HTMLElement>('confirmModal'),
	confirmMessage: $<HTMLElement>('confirmMessage'),
	confirmCancelBtn: $<HTMLButtonElement>('confirmCancelBtn'),
	confirmDeleteBtn: $<HTMLButtonElement>('confirmDeleteBtn'),
	toast: $<HTMLElement>('toast'),
};

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

async function refreshProductos() {
	state.productos = await api.productos.listar();
}

// --- Rendering ---

function renderCategoriaDropdown() {
	const categorias = [...new Set(state.productos.map((p) => p.categoria))].sort((a, b) => a.localeCompare(b));
	el.categoriaDropdown.innerHTML = categorias
		.map((c) => `<button type="button" class="combo-option" data-categoria="${c}">${c}</button>`)
		.join('');
}

function openCategoriaDropdown() {
	if (!el.categoriaDropdown.children.length) return;
	el.categoriaSelect.classList.add('open');
}

function closeCategoriaDropdown() {
	el.categoriaSelect.classList.remove('open');
}

function renderEmojiPicker() {
	const clearBtn = `<button type="button" class="emoji-option emoji-clear" data-emoji="" title="Quitar ícono">✕</button>`;
	const optionButtons = EMOJI_OPTIONS.map(
		(emoji) => `<button type="button" class="emoji-option" data-emoji="${emoji}">${emoji}</button>`,
	).join('');
	el.emojiPicker.innerHTML = clearBtn + optionButtons;
	updateEmojiUI();
}

function updateEmojiUI() {
	const value = el.icono.value;
	el.emojiPreview.textContent = value || '🍽️';
	el.emojiPreview.classList.toggle('empty', !value);
	for (const btn of el.emojiPicker.querySelectorAll<HTMLButtonElement>('.emoji-option')) {
		btn.classList.toggle('active', (btn.dataset.emoji ?? '') === value);
	}
}

function selectEmoji(emoji: string) {
	el.icono.value = emoji;
	updateEmojiUI();
	el.emojiSelect.open = false;
}

function filteredProductos(): Producto[] {
	if (state.filtro === 'activos') return state.productos.filter((p) => p.activo);
	if (state.filtro === 'inactivos') return state.productos.filter((p) => !p.activo);
	return state.productos;
}

function renderTable() {
	const productos = filteredProductos();
	el.productosBody.innerHTML = '';
	el.productosEmpty.hidden = productos.length > 0;

	for (const producto of productos) {
		const tr = document.createElement('tr');
		tr.innerHTML = `
			<td class="producto-icon-cell">${producto.icono}</td>
			<td>${producto.nombre}</td>
			<td>${producto.categoria}</td>
			<td class="align-right">${formatCurrency(producto.precio)}</td>
			<td><span class="status-badge ${producto.activo ? 'active' : 'inactive'}">${producto.activo ? 'Activo' : 'Inactivo'}</span></td>
			<td>
				<div class="row-actions">
					<button type="button" class="row-action-btn" data-action="edit" data-id="${producto.id}" title="Editar">✎</button>
					<button type="button" class="row-action-btn danger" data-action="delete" data-id="${producto.id}" title="Eliminar">×</button>
				</div>
			</td>
		`;
		el.productosBody.appendChild(tr);
	}
}

function renderAll() {
	renderCategoriaDropdown();
	renderTable();
}

// --- Form ---

function resetForm() {
	state.editingId = null;
	el.form.reset();
	el.activo.checked = true;
	el.formTitle.textContent = 'Nuevo producto';
	el.submitBtn.textContent = 'Agregar producto';
	el.cancelEditBtn.hidden = true;
	el.icono.value = '';
	updateEmojiUI();
}

function startEdit(id: number) {
	const producto = state.productos.find((p) => p.id === id);
	if (!producto) return;

	state.editingId = id;
	el.nombre.value = producto.nombre;
	el.precio.value = String(producto.precio);
	el.categoria.value = producto.categoria;
	el.icono.value = producto.icono;
	el.activo.checked = producto.activo;
	el.formTitle.textContent = `Editar "${producto.nombre}"`;
	el.submitBtn.textContent = 'Guardar cambios';
	el.cancelEditBtn.hidden = false;
	el.nombre.focus();
	updateEmojiUI();
}

function handleSubmit(e: SubmitEvent) {
	e.preventDefault();

	const nombre = el.nombre.value.trim();
	const precio = parseFloat(el.precio.value);
	const categoria = el.categoria.value.trim();
	const icono = el.icono.value.trim();
	const activo = el.activo.checked;

	if (!nombre || !categoria || !Number.isFinite(precio) || precio <= 0) {
		showToast('Revisa los campos requeridos');
		return;
	}

	const input: ProductoInput = { nombre, precio, categoria, activo, ...(icono ? { icono } : {}) };
	const editingId = state.editingId;

	return withBusy(async () => {
		if (editingId !== null) {
			await api.productos.actualizar(editingId, input);
			showToast(`${nombre} actualizado`);
		} else {
			await api.productos.crear(input);
			showToast(`${nombre} agregado`);
		}
		await refreshProductos();
		renderAll();
		resetForm();
	});
}

// --- Delete ---

function requestDelete(id: number) {
	const producto = state.productos.find((p) => p.id === id);
	if (!producto) return;

	state.pendingDeleteId = id;
	el.confirmMessage.textContent = `¿Eliminar "${producto.nombre}"?`;
	el.confirmModal.classList.add('open');
}

function closeConfirmModal() {
	state.pendingDeleteId = null;
	el.confirmModal.classList.remove('open');
}

function performDelete(id: number) {
	return withBusy(async () => {
		const result = await api.productos.eliminar(id);
		await refreshProductos();
		renderAll();
		if (state.editingId === id) resetForm();
		showToast(
			result.mode === 'deactivated'
				? 'Ese producto ya está en órdenes existentes: se desactivó en vez de eliminarse'
				: 'Producto eliminado',
		);
	});
}

// --- Events ---

function attachEvents() {
	el.form.addEventListener('submit', handleSubmit);
	el.cancelEditBtn.addEventListener('click', resetForm);

	el.emojiPicker.addEventListener('click', (e) => {
		const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.emoji-option');
		if (!btn) return;
		selectEmoji(btn.dataset.emoji ?? '');
	});

	el.categoria.addEventListener('focus', openCategoriaDropdown);
	el.categoria.addEventListener('click', openCategoriaDropdown);

	el.categoriaDropdown.addEventListener('click', (e) => {
		const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.combo-option');
		if (!btn || !btn.dataset.categoria) return;
		el.categoria.value = btn.dataset.categoria;
		closeCategoriaDropdown();
	});

	document.addEventListener('click', (e) => {
		if (el.emojiSelect.open && !el.emojiSelect.contains(e.target as Node)) el.emojiSelect.open = false;
		if (!el.categoriaSelect.contains(e.target as Node)) closeCategoriaDropdown();
	});

	el.activoFilters.addEventListener('click', (e) => {
		const chip = (e.target as HTMLElement).closest<HTMLElement>('.category-chip');
		if (!chip || !chip.dataset.filter) return;
		state.filtro = chip.dataset.filter as Filtro;
		for (const c of el.activoFilters.querySelectorAll('.category-chip')) c.classList.toggle('active', c === chip);
		renderTable();
	});

	el.productosBody.addEventListener('click', (e) => {
		const btn = (e.target as HTMLElement).closest<HTMLElement>('.row-action-btn');
		if (!btn || !btn.dataset.id) return;
		const id = Number(btn.dataset.id);
		if (btn.dataset.action === 'edit') startEdit(id);
		if (btn.dataset.action === 'delete') requestDelete(id);
	});

	el.confirmCancelBtn.addEventListener('click', closeConfirmModal);
	el.confirmDeleteBtn.addEventListener('click', () => {
		const id = state.pendingDeleteId;
		closeConfirmModal();
		if (id !== null) performDelete(id);
	});
	el.confirmModal.addEventListener('click', (e) => {
		if (e.target === el.confirmModal) closeConfirmModal();
	});
}

// --- Init ---

async function init() {
	try {
		await refreshProductos();
		renderAll();
		renderEmojiPicker();
		attachEvents();
	} catch (err) {
		console.error(err);
		showToast(errorMessage(err));
	}
}

init();
