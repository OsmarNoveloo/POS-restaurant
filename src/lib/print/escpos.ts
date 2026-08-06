import { formatCurrency } from '../posHelpers';
import type { Venta, VentaDetalleItem } from '../../types/api';
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
	w.raw(0x1b, 0x61, 0x01); // center align
	w.raw(0x1b, 0x45, 0x01); // bold on
	w.line(center(businessName, columns));
	w.raw(0x1b, 0x45, 0x00); // bold off
	w.line(venta.orden_etiqueta);
	w.line(formatTicketDate(venta.creado_en));
	w.raw(0x1b, 0x61, 0x00); // left align
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
	w.line();
	w.raw(0x1b, 0x61, 0x01);
	w.line('Gracias por su visita');
	w.raw(0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a);
	w.raw(0x1d, 0x56, 0x00); // corte de papel

	return w.toBytes();
}
