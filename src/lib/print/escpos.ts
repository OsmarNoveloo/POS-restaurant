import { findProducto, formatCurrency } from '../posHelpers';
import type { Orden, Producto, Venta, VentaDetalleItem } from '../../types/api';
import { RECEIPT_CONFIG } from './config';

// La MP210 no garantiza soporte de UTF-8/codepage con acentos, así que el
// texto se normaliza a ASCII plano antes de enviarse (evita caracteres corruptos).
function toPrinterAscii(text: string): string {
	return text
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/ñ/g, 'n')
		.replace(/Ñ/g, 'N')
		.replace(/[^\x00-\x7e]/g, '?');
}

class TicketWriter {
	private bytes: number[] = [];

	raw(...codes: number[]): this {
		this.bytes.push(...codes);
		return this;
	}

	text(str: string): this {
		for (const ch of toPrinterAscii(str)) this.bytes.push(ch.charCodeAt(0) & 0xff);
		return this;
	}

	line(str = ''): this {
		return this.text(str).raw(0x0a);
	}

	toBytes(): Uint8Array {
		return new Uint8Array(this.bytes);
	}
}

function padLine(left: string, right: string, columns: number): string {
	const space = Math.max(1, columns - left.length - right.length);
	return left + ' '.repeat(space) + right;
}

function center(text: string, columns: number): string {
	const pad = Math.max(0, Math.floor((columns - text.length) / 2));
	return ' '.repeat(pad) + text;
}

function divider(columns: number): string {
	return '-'.repeat(columns);
}

// Las direcciones/detalles pueden exceder el ancho del rollo (32 columnas);
// se parten por palabra para no cortar texto a la mitad.
function wrapText(text: string, columns: number): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let current = '';

	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (candidate.length > columns) {
			if (current) lines.push(current);
			current = word.length > columns ? word.slice(0, columns) : word;
		} else {
			current = candidate;
		}
	}
	if (current) lines.push(current);

	return lines;
}

function itemLines(item: VentaDetalleItem, columns: number): string[] {
	const left = `${item.cantidad}x ${item.producto_nombre}`;
	const right = formatCurrency(item.precio * item.cantidad);

	if (left.length + 1 + right.length <= columns) {
		return [padLine(left, right, columns)];
	}

	const truncated = left.length > columns ? `${left.slice(0, columns - 1)}…` : left;
	return [truncated, padLine('', right, columns)];
}

function formatTicketDate(iso: string): string {
	return new Date(iso).toLocaleString('es-MX', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

export function buildTicket(venta: Venta): Uint8Array {
	const { columns, businessName } = RECEIPT_CONFIG;
	const w = new TicketWriter();

	w.raw(0x1b, 0x40); // init
	// La MP210 no siempre respeta el comando de alineación (ESC a); se centra
	// el encabezado a mano rellenando con espacios para que salga centrado sin
	// depender de que la impresora lo soporte.
	w.raw(0x1b, 0x45, 0x01); // bold on
	w.line(center(businessName, columns));
	if (venta.folio != null) w.line(center(`Pedido #${venta.folio}`, columns));
	w.raw(0x1b, 0x45, 0x00); // bold off
	w.line(center(venta.orden_etiqueta, columns));
	w.line(center(formatTicketDate(venta.creado_en), columns));
	if (venta.direccion_entrega) {
		for (const line of wrapText(`Entrega: ${venta.direccion_entrega}`, columns)) w.line(line);
	}
	if (venta.detalle_entrega) {
		for (const line of wrapText(`Detalle: ${venta.detalle_entrega}`, columns)) w.line(line);
	}
	w.line(divider(columns));

	for (const item of venta.detalle) {
		for (const line of itemLines(item, columns)) w.line(line);
	}

	w.line(divider(columns));
	w.line(padLine('Subtotal', formatCurrency(venta.subtotal), columns));
	if (venta.impuesto > 0) w.line(padLine('Impuesto', formatCurrency(venta.impuesto), columns));

	w.raw(0x1b, 0x45, 0x01);
	w.line(padLine('Total', formatCurrency(venta.total), columns));
	w.raw(0x1b, 0x45, 0x00);

	w.line(`Pago: ${venta.metodo_pago === 'efectivo' ? 'Efectivo' : 'Tarjeta'}`);
	if (venta.metodo_pago === 'efectivo' && venta.recibido != null) {
		w.line(padLine('Recibido', formatCurrency(venta.recibido), columns));
		if (venta.cambio) w.line(padLine('Cambio', formatCurrency(venta.cambio), columns));
	}
	w.line();
	w.line(center('Gracias por su compra ...!', columns));
	// La MP210 no tiene cuchilla; mandarle el comando de corte (GS V) puede hacer
	// que truene el buzzer de error y tire la conexión. En vez de cortar, se deja
	// bastante espacio en blanco para arrancar el ticket a mano sin perder texto.
	w.raw(0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a);

	return w.toBytes();
}

// Comanda para cocina: solo productos, sin precios ni totales, para mandar la
// orden a preparar antes de cobrar.
export function buildComandaTicket(orden: Orden, productos: Producto[]): Uint8Array {
	const { columns, businessName } = RECEIPT_CONFIG;
	const w = new TicketWriter();

	w.raw(0x1b, 0x40); // init
	w.raw(0x1b, 0x45, 0x01); // bold on
	w.line(center(businessName, columns));
	w.line(center('COMANDA (SIN COBRAR)', columns));
	w.raw(0x1b, 0x45, 0x00); // bold off
	w.line(center(orden.etiqueta, columns));
	w.line(center(formatTicketDate(orden.creado_en), columns));
	if (orden.direccion_entrega) {
		for (const line of wrapText(`Entrega: ${orden.direccion_entrega}`, columns)) w.line(line);
	}
	if (orden.detalle_entrega) {
		for (const line of wrapText(`Detalle: ${orden.detalle_entrega}`, columns)) w.line(line);
	}
	w.line(divider(columns));

	for (const item of orden.items) {
		const producto = findProducto(productos, item.producto_id);
		w.line(`${item.cantidad}x ${producto?.nombre ?? 'Producto'}`);
	}

	w.line(divider(columns));
	w.line();
	w.raw(0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a);

	return w.toBytes();
}
