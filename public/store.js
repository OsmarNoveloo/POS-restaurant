const STORAGE_KEY = 'la-cocina-pos-store';

function defaultStore() {
	return {
		orderCounter: 3,
		dailySales: 0,
		orders: [
			{ id: 1, label: 'Mesa 1', items: [], status: null },
			{ id: 2, label: 'Mesa 2', items: [], status: null },
			{ id: 3, label: 'Para llevar', items: [], status: null },
		],
		salesLog: [],
	};
}

export function readStore() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			const initial = defaultStore();
			localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
			return initial;
		}
		const store = JSON.parse(raw);
		if (!store.salesLog) store.salesLog = [];
		return store;
	} catch {
		return defaultStore();
	}
}

export function writeStore(store) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function subscribeStore(callback) {
	window.addEventListener('storage', (e) => {
		if (e.key === STORAGE_KEY) callback();
	});
}
