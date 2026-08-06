import type { Venta } from '../../types/api';
import { buildTicket } from './escpos';

export function canPrintViaSerial(): boolean {
	return 'serial' in navigator && !!navigator.serial;
}

export function isAndroid(): boolean {
	return /Android/i.test(navigator.userAgent);
}

export function isIOS(): boolean {
	// iPadOS se anuncia como Macintosh pero expone soporte táctil, a diferencia de un Mac real.
	return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function openKnownPort(): Promise<SerialPort | null> {
	const known = await navigator.serial!.getPorts();

	// Windows puede acumular varias instancias del mismo puerto físico (p. ej.
	// tras reconectar el cable o reinstalar el driver), y no todas son válidas
	// para abrir. Se intenta cada una hasta encontrar la que sigue conectada.
	for (const port of known) {
		try {
			await port.open({ baudRate: 9600 });
			return port;
		} catch {
			// Puerto obsoleto/desconectado: se prueba el siguiente.
		}
	}
	return null;
}

async function getOpenSerialPort(): Promise<SerialPort> {
	const serial = navigator.serial;
	if (!serial) throw new Error('Este navegador no soporta Web Serial');

	const opened = await openKnownPort();
	if (opened) return opened;

	const port = await serial.requestPort();
	await port.open({ baudRate: 9600 });
	return port;
}

async function printViaSerial(bytes: Uint8Array): Promise<void> {
	const port = await getOpenSerialPort();

	const writer = port.writable?.getWriter();
	if (!writer) throw new Error('No se pudo abrir el puerto de la impresora');

	try {
		await writer.write(bytes);
	} finally {
		writer.releaseLock();
		await port.close();
	}
}

function printViaRawBT(bytes: Uint8Array): void {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	const base64 = btoa(binary);
	window.location.href = `rawbt:base64,${base64}`;
}

// La app Bluetooth Print (Thermer) en iOS no acepta bytes ESC/POS embebidos en la
// URL: al abrir `bprint://<RESPONSEURL>` es la propia app la que hace un GET a esa
// URL y espera un arreglo JSON de entradas (texto/imagen/barcode/QR). Por eso aquí
// solo se le indica al backend qué venta imprimir; el ticket se arma del lado del
// servidor en /ventas/:id/ticket-thermer. Requiere haber activado "Browser Print"
// en los ajustes de la app y que PUBLIC_API_URL sea accesible desde el celular
// (no funciona contra localhost salvo que esté en la misma red).
function printViaBrowserPrint(ventaId: number): void {
	const base = import.meta.env.PUBLIC_API_URL;
	window.location.href = `bprint://${base}/ventas/${ventaId}/ticket-thermer`;
}

export async function printTicket(venta: Venta): Promise<void> {
	if (isIOS()) {
		printViaBrowserPrint(venta.id);
		return;
	}

	const bytes = buildTicket(venta);

	if (isAndroid()) {
		printViaRawBT(bytes);
		return;
	}

	if (canPrintViaSerial()) {
		await printViaSerial(bytes);
		return;
	}

	throw new Error('Impresión no soportada en este navegador. Usa Chrome/Edge en PC, Android con RawBT o iPhone con Bluetooth Print (Thermer) instalados.');
}
