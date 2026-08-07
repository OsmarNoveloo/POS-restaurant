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
		// writer.write() resuelve en cuanto el navegador entrega los bytes al
		// driver, no cuando el puerto termina de transmitirlos. Cerrar el
		// writable stream sí espera a que se vacíe por completo; sin esto,
		// port.close() corta la transmisión a medias en tickets largos.
		await writer.close();
	} finally {
		writer.releaseLock();
	}

	await port.close();
}

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function printViaRawBT(bytes: Uint8Array): void {
	window.location.href = `rawbt:base64,${toBase64(bytes)}`;
}

// La app propia rincon-mx-print-ios recibe los mismos bytes ESC/POS que RawBT,
// solo que embebidos en su propio esquema de deep link en vez de un intent Android.
function printViaCustomScheme(bytes: Uint8Array): void {
	window.location.href = `rinconprint://print?data=${encodeURIComponent(toBase64(bytes))}`;
}

export async function printTicket(venta: Venta): Promise<void> {
	const bytes = buildTicket(venta);

	if (isIOS()) {
		printViaCustomScheme(bytes);
		return;
	}

	if (isAndroid()) {
		printViaRawBT(bytes);
		return;
	}

	if (canPrintViaSerial()) {
		await printViaSerial(bytes);
		return;
	}

	throw new Error('Impresión no soportada en este navegador. Usa Chrome/Edge en PC, Android con RawBT o iPhone con la app Rincon Print instalados.');
}
