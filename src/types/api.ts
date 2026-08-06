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
	items: OrdenItem[];
}

export interface OrdenInput {
	etiqueta: string;
}

export interface OrdenUpdateInput {
	etiqueta?: string;
	estado?: EstadoOrden;
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
	creado_en: string;
	detalle: VentaDetalleItem[];
}

export interface VentaInput {
	orden_id: number;
	metodo_pago: MetodoPago;
}

export interface ResumenDashboard {
	ventasDelDia: number;
	ordenesCobradas: number;
	ticketPromedio: number;
	mesasActivas: number;
	mesasTotal: number;
	ventasPorCategoria: Record<string, number>;
}
