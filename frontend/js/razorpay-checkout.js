/**
 * JOD Events — Razorpay Checkout
 * Creates an order, opens Checkout, then verifies HMAC signature on the server
 * before the ticket booking is saved.
 */
(function (global) {
	"use strict";

	const THEME_COLOR = global.JOD_RAZORPAY_THEME || "#f59e0b";

	function apiBase() {
		if (global.JOD_API_BASE) return String(global.JOD_API_BASE).replace(/\/$/, "");
		if (global.JodAuth && global.JodAuth.API_BASE) return global.JodAuth.API_BASE;
		const host = (global.location && global.location.hostname && global.location.hostname !== "localhost")
			? global.location.hostname : "127.0.0.1";
		return `http://${host}:8001`;
	}

	function authHeaders() {
		const token = global.JodAuth && global.JodAuth.getToken ? global.JodAuth.getToken() : null;
		const headers = { "Content-Type": "application/json", "Accept": "application/json" };
		if (token) headers.Authorization = "Bearer " + token;
		return headers;
	}

	function loadCheckoutScript() {
		return new Promise((resolve, reject) => {
			if (global.Razorpay) {
				resolve(global.Razorpay);
				return;
			}
			const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
			if (existing) {
				existing.addEventListener("load", () => resolve(global.Razorpay));
				existing.addEventListener("error", () => reject(new Error("Could not load Razorpay Checkout.")));
				return;
			}
			const script = document.createElement("script");
			script.src = "https://checkout.razorpay.com/v1/checkout.js";
			script.async = true;
			script.onload = () => resolve(global.Razorpay);
			script.onerror = () => reject(new Error("Could not load Razorpay Checkout."));
			document.head.appendChild(script);
		});
	}

	async function createOrder(payload) {
		const res = await fetch(apiBase() + "/create_order/", {
			method: "POST",
			headers: authHeaders(),
			body: JSON.stringify(payload)
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			const detail = data.detail || data.message || "Could not create payment order.";
			const err = new Error(typeof detail === "string" ? detail : "Could not create payment order.");
			err.status = res.status;
			err.body = data;
			throw err;
		}
		return data;
	}

	async function verifyPayment(orderId, paymentId, signature) {
		const res = await fetch(apiBase() + "/verify_payment/", {
			method: "POST",
			headers: authHeaders(),
			body: JSON.stringify({
				order_id: orderId,
				payment_id: paymentId,
				signature: signature
			})
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw new Error(data.detail || "Payment verification failed.");
		}
		return data;
	}

	function openCheckout(order, user, onVerified, onDismissed) {
		const RazorpayCtor = global.Razorpay;
		if (!RazorpayCtor) {
			return Promise.reject(new Error("Razorpay Checkout is not available."));
		}
		const prefill = Object.assign({}, order.prefill || {}, {
			name: (user && (user.full_name || user.username)) || (order.prefill && order.prefill.name) || "",
			email: (user && user.email) || (order.prefill && order.prefill.email) || "",
			contact: (user && (user.phone || user.contact)) || (order.prefill && order.prefill.contact) || ""
		});
		return new Promise((resolve, reject) => {
			const rzp = new RazorpayCtor({
				key: order.key || global.JOD_RAZORPAY_KEY,
				amount: order.amount,
				currency: order.currency || "INR",
				name: "JOD Events",
				description: order.event_title || "Event ticket",
				order_id: order.order_id,
				prefill: prefill,
				theme: { color: THEME_COLOR },
				handler: async function (response) {
					try {
						const verified = await verifyPayment(
							response.razorpay_order_id,
							response.razorpay_payment_id,
							response.razorpay_signature
						);
						if (verified.status !== "Payment Verified") {
							throw new Error("Verification Failed");
						}
						if (typeof onVerified === "function") onVerified(verified);
						resolve(verified);
					} catch (err) {
						reject(err);
					}
				},
				modal: {
					ondismiss: function () {
						if (typeof onDismissed === "function") onDismissed();
						reject(new Error("Payment cancelled."));
					}
				}
			});
			rzp.on("payment.failed", function (resp) {
				const msg = (resp && resp.error && resp.error.description) || "Payment failed.";
				reject(new Error(msg));
			});
			rzp.open();
		});
	}

	async function payForEvent({ eventId, ticketType, quantity, user, onVerified, onDismissed }) {
		await loadCheckoutScript();
		const order = await createOrder({
			event_id: eventId,
			ticket_type: ticketType || "General Admission",
			quantity: quantity || 1
		});
		return openCheckout(order, user || {}, onVerified, onDismissed);
	}

	global.JodRazorpay = {
		apiBase,
		loadCheckoutScript,
		createOrder,
		verifyPayment,
		openCheckout,
		payForEvent
	};
})(window);
