import {correctBatch, filterBatches, record, reverseSale, summarize, validateBackup} from "./stock.js";

const key = "duelstock.v1";
const pricingKey = "duelstock.pricing-defaults.v1";
const view = document.querySelector("#view");
const notice = document.querySelector("#notice");
const conditions = ["Near Mint", "Lightly Played", "Moderately Played", "Heavily Played", "Damaged"];
const currency = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"});
const money = cents => currency.format(cents / 100);
const cents = value => Math.round(Number(value) * 100);
const escape = value => String(value).replace(/[&<>"']/g, char => (
    {"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[char]
));
const read = () => JSON.parse(localStorage.getItem(key) ?? '{"batches":[],"orders":[]}');
const save = state => localStorage.setItem(key, JSON.stringify(state));
const alert = message => { notice.textContent = message; };
const card = batch => [batch.name, batch.setCode, batch.edition, batch.variant, batch.language, batch.condition].join(" · ");
const heading = (title, subtitle, action = "") =>
    `<div class="pagehead"><div><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ""}</div>${action}</div>`;
const button = (label, page) => `<a class="button" href="#${page}">${label}</a>`;
const table = (headers, body) => `<div class="tablewrap"><table><thead><tr>${headers.map(label => `<th scope="col">${label}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
const field = (label, name, attrs = "", type = "text") =>
    `<div><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" ${attrs} required></div>`;
const amount = (label, name, value = "") => field(label, name, `min="0" max="999999.99" step="0.01" value="${value}"`, "number");

function inventory(state) {
    const batches = state.batches;
    view.innerHTML = heading("Inventory", "Track exact printings, purchase batches, and bin locations.", button("Add stock", "add")) +
        `<div class="fields kpis">
        <div class="panel">Copies on hand<strong>${batches.reduce((total, batch) => total + batch.quantity, 0)}</strong></div>
        <div class="panel">Active batches<strong>${batches.filter(batch => batch.quantity > 0).length}</strong></div>
        <div class="panel">Stock cost<strong>${money(batches.reduce((total, batch) => total + batch.quantity * batch.cost, 0))}</strong></div>
        </div>
        <form class="search" role="search"><input type="search" aria-label="Search inventory" placeholder="Card name, set code, or bin"></form>
        <div id="results"></div>`;
    const input = view.querySelector("input");
    const results = view.querySelector("#results");
    const render = () => {
        const query = input.value.trim().toLowerCase();
        const matching = filterBatches(batches, query);
        results.innerHTML = table(["Card", "Bin", "On hand", "Cost per copy", ""], matching.map(batch =>
            `<tr><td><strong>${escape(batch.name)}</strong><small>${escape([batch.setCode, batch.edition, batch.variant, batch.language, batch.condition].join(" · "))}</small></td><td>${escape(batch.bin)}</td><td>${batch.quantity}</td><td>${money(batch.cost)}</td><td><div class="row-actions"><a href="#edit/${batch.id}">Edit</a><a href="#duplicate/${batch.id}" aria-label="Duplicate batch for ${escape(batch.name)}">Duplicate</a></div></td></tr>`
        ).join("") || `<tr><td colspan="5">${query ? "No matching cards." : "Add your first purchase batch to get started."}</td></tr>`);
    };
    input.addEventListener("input", render);
    input.form.addEventListener("submit", event => event.preventDefault());
    render();
}

function intake(existing, adjustments = [], source = existing) {
    view.innerHTML = heading(existing ? "Edit batch" : source ? "Duplicate batch" : "Add stock", existing ? "Corrections are recorded in the batch history." : "Use a separate batch for each printing, condition, bin, or purchase price.") +
        `<form class="panel"><div class="fields">
        ${field("Card name", "name", 'maxlength="150"')}
        ${field("Set code", "setCode", 'maxlength="40" placeholder="SDK-001"')}
        ${field("Edition", "edition", 'maxlength="40" placeholder="First Edition"')}
        ${field("Rarity or variant", "variant", 'maxlength="80"')}
        ${field("Language", "language", 'maxlength="40" value="English"')}
        <div><label for="condition">Condition</label><select id="condition" name="condition">${conditions.map(condition => `<option>${condition}</option>`).join("")}</select></div>
        ${field("Bin location", "bin", 'maxlength="50" placeholder="A1"')}
        ${field("Quantity", "quantity", 'min="0" max="100000" step="1" value="1"', "number")}
        ${amount("Cost per copy (USD)", "cost")}
        ${existing ? field("Reason for correction", "reason", 'maxlength="250"') : ""}
        </div><div class="actions"><button value="save">Save stock</button>${existing ? "" : '<button class="secondary" value="next">Save and add next</button>'}<a href="#inventory">Cancel</a></div></form>` + (adjustments.length ? `<section class="panel"><h2>Correction history</h2>
        ${table(["Date", "Reason", "Copies"], adjustments.map(item => `<tr><td>${escape(new Date(item.created).toLocaleString())}</td><td>${escape(item.reason)}</td><td>${item.before.quantity} to ${item.after.quantity}</td></tr>`).join(""))}</section>` : "");
    const intakeForm = view.querySelector("form");
    if (source) {
        for (const input of intakeForm.elements) {
            if (Object.hasOwn(source, input.name)) {
                input.value = input.name === "cost" ? (source.cost / 100).toFixed(2) : source[input.name];
            }
        }
    }
    if (!existing) {
        intakeForm.elements.quantity.min = "1";
        intakeForm.elements.quantity.value = "1";
        if (source) intakeForm.elements.cost.value = "";
    }
    intakeForm.addEventListener("submit", async event => {
        event.preventDefault();
        const addNext = event.submitter?.value === "next";
        const controls = [...intakeForm.querySelectorAll("button")];
        for (const control of controls) control.disabled = true;
        try {
            const values = Object.fromEntries([...new FormData(event.currentTarget)].map(([name, value]) => [name, value.trim()]));
            if (Object.values(values).some(value => !value)) throw new Error("Fill in every stock field.");
            const {reason, ...details} = values;
            const batch = {...details, id: existing?.id ?? crypto.randomUUID(), setCode: values.setCode.toUpperCase(), quantity: Number(values.quantity), cost: cents(values.cost)};
            await navigator.locks.request(key, () => {
                const state = read();
                if (existing) {
                    const current = state.batches.find(item => item.id === existing.id);
                    if (JSON.stringify(current) !== JSON.stringify(existing)) throw new Error("This batch changed in another tab. Reopen it before editing.");
                    save(correctBatch(state, batch, reason, new Date().toISOString()));
                } else {
                    save({...state, batches: [...state.batches, batch]});
                }
            });
            if (addNext) {
                intakeForm.reset();
                for (const name of ["language", "bin"]) intakeForm.elements[name].value = batch[name];
                intakeForm.elements.name.focus();
                alert(`Added ${batch.quantity} × ${batch.name}.`);
            } else {
                location.hash = "inventory";
            }
        } catch (error) {
            alert(error.message);
        } finally {
            for (const control of controls) control.disabled = false;
        }
    });
}

function pickList(lines) {
    return table(["Bin", "Card", "Copies"], [...lines].sort((a, b) =>
        a.bin.localeCompare(b.bin, undefined, {numeric: true}) || a.card.localeCompare(b.card)
    ).map(line => `<tr><td><strong>${escape(line.bin)}</strong></td><td>${escape(line.card)}</td><td>${line.quantity}</td></tr>`).join(""));
}

function totals(lines, costs) {
    const result = summarize(lines, costs);
    const entries = [
        ["Card sales", result.sales], ["Shipping income", result.shipping],
        ["Acquisition cost", result.cost], ["Marketplace fees", result.fees],
        ["Postage and packaging", result.overhead],
    ];
    if (result.breakEven !== null) entries.push(["Break-even card subtotal", result.breakEven]);
    return `<dl class="totals">${entries.map(([label, value]) => `<dt>${label}</dt><dd>${money(value)}</dd>`).join("")}
        <dt class="net">Profit before tax</dt><dd class="net">${money(result.profit)}</dd></dl>`;
}

function pricingDefaults() {
    const saved = JSON.parse(localStorage.getItem(pricingKey) ?? "{}") ?? {};
    return Object.fromEntries(["rate", "flat", "postage", "packaging"].map(name => {
        const value = saved[name];
        const maximum = name === "rate" ? 99 : 999999.99;
        const fallback = name === "rate" || name === "flat" ? "" : "0.00";
        return [name, Number.isFinite(value) && value >= 0 && value <= maximum ? value.toFixed(2) : fallback];
    }));
}

function percentage(label, name, value) {
    return field(label, name, `min="0" max="99" step="0.01" value="${value}"`, "number");
}

function editPricingDefaults() {
    const defaults = pricingDefaults();
    view.innerHTML = heading("Pricing defaults", "Set the costs you typically use. You can override them for any order.") +
        `<form class="panel"><div class="fields">
        ${percentage("Estimated percentage fee", "rate", defaults.rate)}
        ${amount("Estimated fixed fee", "flat", defaults.flat)}
        ${amount("Postage", "postage", defaults.postage)}
        ${amount("Packaging", "packaging", defaults.packaging)}
        </div><p><small>Estimated fees apply to price checks. Recorded sales still use your actual marketplace fees.</small></p>
        <div class="actions"><button>Save defaults</button><a href="#estimate">Back to price check</a></div></form>`;
    view.querySelector("form").addEventListener("submit", event => {
        event.preventDefault();
        try {
            const entries = [...new FormData(event.currentTarget)].map(([name, value]) => [name, Number(value)]);
            localStorage.setItem(pricingKey, JSON.stringify(Object.fromEntries(entries)));
            alert("Pricing defaults saved.");
        } catch (error) {
            alert(error.message);
        }
    });
}

function orderPage(state, estimate) {
    const defaults = pricingDefaults();
    const title = estimate ? "Price check" : "Record an order";
    const batches = state.batches.filter(batch => batch.quantity > 0);
    view.innerHTML = heading(title, estimate ?
        "Estimate profit and break-even for a single card or a combined shipment." :
        "Build a pick list by bin, then confirm the sale to deduct stock.",
        estimate ? '<a href="#pricing-defaults">Pricing defaults</a>' : "") +
        (batches.length ? `<form class="stack">
        <section class="panel"><h2>Cards</h2><div id="lines"></div><div class="actions"><button type="button" id="add-line" class="secondary">Add line</button></div></section>
        <section class="panel"><h2>Order costs <span class="muted">(USD)</span></h2><div class="fields">
        ${estimate ? percentage("Estimated percentage fee", "rate", defaults.rate) +
            amount("Estimated fixed fee", "flat", defaults.flat) : field("TCGplayer order number", "number", 'maxlength="80"') + amount("Actual total marketplace fees", "fees")}
        ${amount("Shipping income", "shipping", "0.00")}${amount("Postage", "postage", defaults.postage)}${amount("Packaging", "packaging", defaults.packaging)}
        </div>${estimate ? '<p><small>The estimate applies one percentage to card sales plus shipping income. Enter actual fees when recording a sale.</small></p>' : ""}
        <div class="actions"><button>${estimate ? "Calculate estimate" : "Review pick list"}</button></div></section></form>
        <div id="review" aria-live="polite"></div>` :
        `<section class="panel"><p>Add stock before starting.</p><div class="actions">${button("Add stock", "add")}</div></section>`);
    if (!batches.length) return;
    const rows = view.querySelector("#lines");
    const form = view.querySelector("form");
    const review = view.querySelector("#review");
    let rowId = 0;
    const clearReview = () => { review.innerHTML = ""; alert(""); };
    function addLine() {
        rowId++;
        const row = document.createElement("fieldset");
        row.className = "line";
        row.innerHTML = `<div class="batch-picker">
            <label for="filter-${rowId}">Find a batch</label>
            <input type="search" id="filter-${rowId}" placeholder="Card name, set code, or bin">
            <label for="batch-${rowId}">Inventory batch</label>
            <select id="batch-${rowId}" class="batch" required></select>
            <small class="match-count" role="status"></small></div>
            ${field("Copies", `quantity-${rowId}`, 'class="quantity" min="1" max="100000" step="1" value="1"', "number")}
            ${field("Price per copy", `price-${rowId}`, 'class="price" min="0" max="999999.99" step="0.01"', "number")}
            <div class="actions"><button type="button" class="secondary">Remove</button></div>`;
        const search = row.querySelector('input[type="search"]');
        const select = row.querySelector("select");
        const count = row.querySelector(".match-count");
        function showMatches() {
            const selectedId = select.value;
            const matching = filterBatches(batches, search.value);
            select.replaceChildren(new Option("Select a batch", ""));
            for (const batch of matching) {
                select.add(new Option(`${card(batch)} · ${batch.bin} · ${batch.quantity} left · ${money(batch.cost)} cost`, batch.id));
            }
            if (matching.some(batch => batch.id === selectedId)) select.value = selectedId;
            count.textContent = matching.length ? `${matching.length} matching ${matching.length === 1 ? "batch" : "batches"}` : "No matching batches.";
        }
        search.addEventListener("input", showMatches);
        showMatches();
        row.querySelector("button").addEventListener("click", () => {
            if (rows.children.length === 1) return;
            row.remove();
            updateRemove();
            clearReview();
        });
        rows.append(row);
        updateRemove();
        return row;
    }
    function updateRemove() {
        for (const control of rows.querySelectorAll("button")) control.hidden = rows.children.length === 1;
    }
    addLine();
    form.querySelector("#add-line").addEventListener("click", () => {
        clearReview();
        addLine().querySelector('input[type="search"]').focus();
    });
    form.addEventListener("input", clearReview);
    form.addEventListener("submit", event => {
        event.preventDefault();
        clearReview();
        try {
            const selected = new Set();
            const lines = [...rows.children].map(row => {
                const id = row.querySelector(".batch").value;
                const batch = batches.find(item => item.id === id);
                const quantity = Number(row.querySelector(".quantity").value);
                if (selected.has(id)) throw new Error("Combine quantities for the same batch on one line.");
                selected.add(id);
                if (quantity > batch.quantity) throw new Error(`Only ${batch.quantity} copies of ${batch.name} are available in that batch.`);
                return {id, quantity, card: card(batch), bin: batch.bin, cost: batch.cost, price: cents(row.querySelector(".price").value)};
            });
            const data = new FormData(form);
            const costs = {shipping: cents(data.get("shipping")), postage: cents(data.get("postage")), packaging: cents(data.get("packaging"))};
            const number = String(data.get("number") ?? "").trim().toUpperCase();
            if (estimate) {
                costs.rate = cents(data.get("rate"));
                costs.flat = cents(data.get("flat"));
            } else {
                if (!number) throw new Error("Enter the TCGplayer order number.");
                if (read().orders.some(order => order.number === number)) throw new Error("This order has already been recorded.");
                costs.fees = cents(data.get("fees"));
            }
            review.innerHTML = `<section class="panel" tabindex="-1"><h2>${estimate ? "Estimated totals" : "Pick list by bin"}</h2>
                ${estimate ? "" : pickList(lines)}${totals(lines, costs)}
                ${estimate ? "" : '<div class="actions"><button id="confirm">Record sale and deduct stock</button></div>'}</section>`;
            review.querySelector("section").focus();
            review.querySelector("#confirm")?.addEventListener("click", async event => {
                const control = event.currentTarget;
                control.disabled = true;
                const order = {id: crypto.randomUUID(), number, costs, lines, created: new Date().toISOString()};
                try {
                    await navigator.locks.request(key, () => save(record(read(), order)));
                    location.hash = `orders/${order.id}`;
                } catch (error) {
                    alert(error.message);
                    control.disabled = false;
                }
            });
        } catch (error) {
            alert(error.message);
        }
    });
}

function orders(state, id) {
    if (id) {
        const order = state.orders.find(item => item.id === id);
        view.innerHTML = order ? heading(`Order ${escape(order.number)}`, order.reversal ? "Sale reversed. Original totals are shown for reference." : "Sale recorded and stock deducted.", '<a href="#orders">Back to orders</a>') +
            `<section class="panel"><h2>Picked stock</h2>${pickList(order.lines)}${totals(order.lines, order.costs)}</section>` +
            (order.reversal ? `<p>Reason: ${escape(order.reversal.reason)}. ${order.reversal.restock ? "Cards returned to stock." : "No cards returned to stock."}</p>` :
                `<details class="panel"><summary>Reverse sale</summary><form id="reverse-form">
                ${field("Reason for reversal", "reason", 'maxlength="250"')}
                <label class="checkbox"><input name="restock" type="checkbox"> Return cards to their original batches</label>
                <div class="actions"><button>Confirm reversal</button></div></form></details>`) :
            heading("Order unavailable", "", '<a href="#orders">Back to orders</a>');
        view.querySelector("#reverse-form")?.addEventListener("submit", async event => {
            event.preventDefault();
            const form = event.currentTarget;
            const reason = form.elements.reason.value.trim();
            const restock = form.elements.restock.checked;
            form.querySelector("button").disabled = true;
            try {
                await navigator.locks.request(key, () => save(reverseSale(read(), id, reason, restock, new Date().toISOString())));
                render();
            } catch (error) {
                alert(error.message);
                form.querySelector("button").disabled = false;
            }
        });
        return;
    }
    view.innerHTML = heading("Orders", "Review recorded sales and actual profit.", button("Record an order", "new-order")) +
        table(["Order number", "Recorded", "Profit"], state.orders.map(order =>
            `<tr><td><a href="#orders/${order.id}">${escape(order.number)}</a></td><td>${escape(new Date(order.created).toLocaleString())}</td><td>${order.reversal ? "Reversed" : money(summarize(order.lines, order.costs).profit)}</td></tr>`
        ).join("") || '<tr><td colspan="3">Recorded sales will appear here.</td></tr>');
}

function render() {
    alert("");
    const [page, id] = (location.hash.slice(1) || "inventory").split("/");
    const section = ["add", "edit", "duplicate"].includes(page) ? "inventory" : page === "new-order" ? "orders" : page === "pricing-defaults" ? "estimate" : page;
    for (const control of document.querySelectorAll("[data-page]")) {
        if (control.dataset.page === section) control.setAttribute("aria-current", "page");
        else control.removeAttribute("aria-current");
    }
    try {
        const state = read();
        if (page === "add") intake();
        else if (page === "edit" || page === "duplicate") {
            const batch = state.batches.find(item => item.id === id);
            if (batch && page === "edit") intake(batch, (state.adjustments ?? []).filter(item => item.batchId === id));
            else if (batch) intake(null, [], batch);
            else view.innerHTML = heading("Batch unavailable");
        }
        else if (page === "pricing-defaults") editPricingDefaults();
        else if (page === "estimate" || page === "new-order") orderPage(state, page === "estimate");
        else if (page === "orders") orders(state, id);
        else inventory(state);
    } catch (error) {
        view.replaceChildren();
        alert(`Could not load Duelstock. ${error.message}`);
    }
}

for (const control of document.querySelectorAll("[data-page]")) {
    control.addEventListener("click", () => { location.hash = control.dataset.page; });
}
document.querySelector("#backup").addEventListener("click", () => {
    try {
        const url = URL.createObjectURL(new Blob([JSON.stringify(read(), null, 2)], {type: "application/json"}));
        const link = document.createElement("a");
        link.href = url;
        link.download = "duelstock-backup.json";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
        alert(error.message);
    }
});
const backupFile = document.querySelector("#backup-file");
document.querySelector("#restore").addEventListener("click", () => backupFile.click());
backupFile.addEventListener("change", async () => {
    const file = backupFile.files[0];
    backupFile.value = "";
    if (!file) return;
    try {
        const backup = validateBackup(JSON.parse(await file.text()));
        await navigator.locks.request(key, () => {
            const existing = read();
            if (existing.batches.length || existing.orders.length) {
                throw new Error("Import is available only in an empty browser workspace. Your current records were preserved.");
            }
            save(backup);
        });
        render();
        alert("Backup imported.");
    } catch (error) {
        alert(error instanceof SyntaxError ? "Choose a valid Duelstock JSON backup." : error.message);
    }
});
window.addEventListener("hashchange", render);
render();
