export function summarize(lines, costs) {
    const sales = lines.reduce((sum, line) => sum + line.quantity * line.price, 0);
    const cost = lines.reduce((sum, line) => sum + line.quantity * line.cost, 0);
    const overhead = costs.postage + costs.packaging;
    const gross = sales + costs.shipping;
    const fees = costs.fees ?? (costs.flat + Math.round(gross * costs.rate / 10000));
    const breakEven = costs.fees === undefined
        ? Math.max(0, Math.ceil((cost + overhead + costs.flat) * 10000 / (10000 - costs.rate)) - costs.shipping)
        : null;
    return {sales, cost, overhead, shipping: costs.shipping, fees, breakEven, profit: gross - cost - overhead - fees};
}

export function record(state, order) {
    if (state.orders.some(saved => saved.number === order.number)) {
        throw new Error("This order has already been recorded.");
    }
    const requested = new Map();
    for (const line of order.lines) {
        if (requested.has(line.id)) throw new Error("Combine quantities for the same batch on one line.");
        requested.set(line.id, line.quantity);
        const batch = state.batches.find(item => item.id === line.id);
        if (!batch || batch.quantity < line.quantity) {
            throw new Error("Stock changed. Review the current quantities before recording.");
        }
    }
    return {
        ...state,
        batches: state.batches.map(batch => ({
            ...batch, quantity: batch.quantity - (requested.get(batch.id) ?? 0),
        })),
        orders: [order, ...state.orders],
    };
}

export function correctBatch(state, batch, reason, created) {
    const previous = state.batches.find(item => item.id === batch.id);
    if (!previous) throw new Error("This batch is unavailable.");
    if (!reason.trim()) throw new Error("Enter a reason for the correction.");
    return {
        ...state,
        batches: state.batches.map(item => item.id === batch.id ? batch : item),
        adjustments: [{batchId: batch.id, before: previous, after: batch, reason, created}, ...(state.adjustments ?? [])],
    };
}

export function reverseSale(state, id, reason, restock, created) {
    const order = state.orders.find(item => item.id === id);
    if (!order || order.reversal) throw new Error("This sale is unavailable or already reversed.");
    if (!reason.trim()) throw new Error("Enter a reason for the reversal.");
    const returned = new Map(order.lines.map(line => [line.id, line.quantity]));
    if (restock && order.lines.some(line => !state.batches.some(batch => batch.id === line.id))) {
        throw new Error("An original batch is missing.");
    }
    return {
        ...state,
        batches: restock ? state.batches.map(batch => ({
            ...batch, quantity: batch.quantity + (returned.get(batch.id) ?? 0),
        })) : state.batches,
        orders: state.orders.map(item => item.id === id
            ? {...item, reversal: {reason, restock, created}} : item),
    };
}

export function validateBackup(state) {
    const integer = value => Number.isSafeInteger(value) && value >= 0;
    const string = value => typeof value === "string" && value.trim().length > 0;
    const id = value => typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
    const date = value => string(value) && Number.isFinite(Date.parse(value));
    const unique = values => new Set(values).size === values.length;
    const batch = value => value && id(value.id) && integer(value.quantity) && integer(value.cost)
        && ["name","setCode","edition","variant","language","condition","bin"].every(key => string(value[key]));
    const cost = value => value && ["shipping","postage","packaging","fees"].every(key => integer(value[key]));
    const reversal = value => value && string(value.reason) && typeof value.restock === "boolean" && date(value.created);
    if (!state || !Array.isArray(state.batches) || !Array.isArray(state.orders) ||
        !state.batches.every(batch) || !unique(state.batches.map(item => item.id))) {
        throw new Error("Choose a valid Duelstock backup.");
    }
    const ids = new Set(state.batches.map(item => item.id));
    const line = value => value && ids.has(value.id) && integer(value.quantity) && value.quantity > 0
        && integer(value.price) && integer(value.cost) && string(value.card) && string(value.bin);
    const order = value => value && id(value.id) && string(value.number) && date(value.created) && cost(value.costs)
        && Array.isArray(value.lines) && value.lines.length > 0 && value.lines.every(line)
        && unique(value.lines.map(item => item.id)) && (value.reversal === undefined || reversal(value.reversal));
    const adjustments = state.adjustments ?? [];
    if (!state.orders.every(order) || !unique(state.orders.map(item => item.id))
        || !unique(state.orders.map(item => item.number))
        || !Array.isArray(adjustments)
        || !adjustments.every(item => item && ids.has(item.batchId) && batch(item.before) && batch(item.after)
            && item.batchId === item.before.id && item.batchId === item.after.id && string(item.reason) && date(item.created))) {
        throw new Error("Choose a valid Duelstock backup.");
    }
    return {batches: state.batches, orders: state.orders, adjustments};
}

export function filterBatches(batches, query) {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return batches.filter(batch => {
        const description = [
            batch.name, batch.setCode, batch.edition, batch.variant,
            batch.language, batch.condition, batch.bin,
        ].join(" ").toLowerCase();
        return terms.every(term => description.includes(term));
    });
}
