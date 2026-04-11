-- Ordini fornitore (righe merce da ordinare)
CREATE TABLE IF NOT EXISTS supplier_orders (
    id SERIAL PRIMARY KEY,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    order_date DATE NOT NULL,
    vat_percent NUMERIC(5, 2) NOT NULL DEFAULT 23,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_supplier_orders_supplier_id ON supplier_orders(supplier_id);
CREATE INDEX IF NOT EXISTS ix_supplier_orders_order_date ON supplier_orders(order_date);

CREATE TABLE IF NOT EXISTS supplier_order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
    product_description VARCHAR(255) NOT NULL,
    pieces INTEGER,
    note TEXT
);

CREATE INDEX IF NOT EXISTS ix_supplier_order_items_order_id ON supplier_order_items(order_id);
