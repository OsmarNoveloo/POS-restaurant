import type { Venta } from '../../types/api';
import { buildTicket } from './escpos';

export function canPrintViaSerial(): boolean {
	return 'serial' in navigator && !!navigator.serial;
}

export function isAndroid(): boolean {
	return /Android/i.test(navigator.userAgent);
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

export async function printTicket(venta: Venta): Promise<void> {
	const bytes = buildTicket(venta);

	if (isAndroid()) {
		printViaRawBT(bytes);
		return;
	}

	if (canPrintViaSerial()) {
		await printViaSerial(bytes);
		return;
	}

	throw new Error('Impresión no soportada en este navegador. Usa Chrome/Edge en PC o Android con RawBT instalado.');
}
