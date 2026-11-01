export interface Toast {
	id: number;
	message: string;
	action?: { label: string; run: () => void };
}

let nextId = 1;
export const toasts = $state<Toast[]>([]);

export function dismissToast(id: number) {
	const i = toasts.findIndex((t) => t.id === id);
	if (i >= 0) toasts.splice(i, 1);
}

export function toast(message: string, action?: Toast['action'], ms = 4500) {
	const id = nextId++;
	toasts.push({ id, message, action });
	setTimeout(() => dismissToast(id), ms);
}
