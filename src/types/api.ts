export interface Producto {
	id: number;
	nombre: string;
	precio: number;
	categoria: string;
	icono: string;
	activo: boolean;
	creado_en: string;
	actualizado_en: string | null;
}

export interface ProductoInput {
	nombre: string;
	precio: number;
	categoria: string;
	icono?: string;
	activo?: boolean;
}

export type ProductoUpdateInput = Partial<ProductoInput>;

export type EstadoOrden = 'enviada' | null;

export interface OrdenItem {
	producto_id: number;
	cantidad: number;
}

export interface Orden {
	id: number;
	etiqueta: string;
	estado: EstadoOrden;
	creado_en: string;
	direccion_entrega: string | null;
	detalle_entrega: string | null;
	items: OrdenItem[];
}

export interface OrdenInput {
	etiqueta: string;
	direccion_entrega?: string | null;
	detalle_entrega?: string | null;
}

export interface OrdenUpdateInput {
	etiqueta?: string;
	estado?: EstadoOrden;
	direccion_entrega?: string | null;
	detalle_entrega?: string | null;
}

export type MetodoPago = 'efectivo' | 'tarjeta';

export interface VentaDetalleItem {
	producto_nombre: string;
	categoria: string;
	cantidad: number;
	precio: number;
}

export interface Venta {
	id: number;
	orden_etiqueta: string;
	metodo_pago: MetodoPago;
	subtotal: number;
	impuesto: number;
	total: number;
	recibido: number | null;
	cambio: number | null;
	creado_en: string;
	direccion_entrega: string | null;
	detalle_entrega: string | null;
	// Consecutivo del pedido en el día ("Pedido #N"); se reinicia a diario.
	// null solo en ventas registradas sin conexión que aún no se sincronizan.
	folio: number | null;
	detalle: VentaDetalleItem[];
}

export interface VentaInput {
	orden_id: number;
	metodo_pago: MetodoPago;
	recibido?: number;
}

export interface ResumenDashboard {
	ventasDelDia: number;
	ordenesCobradas: number;
	ticketPromedio: number;
	mesasActivas: number;
	mesasTotal: number;
	ventasPorCategoria: Record<string, number>;
}
