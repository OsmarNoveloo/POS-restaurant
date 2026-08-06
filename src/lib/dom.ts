export function $<T extends HTMLElement = HTMLElement>(id: string): T {
	const el = document.getElementById(id);
	if (!el) throw new Error(`Elemento #${id} no encontrado`);
	return el as T;
}
