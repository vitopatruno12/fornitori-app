CREATE TABLE IF NOT EXISTS warehouse_movements (
    id SERIAL PRIMARY KEY,
    movement_type VARCHAR(8) NOT NULL,
    movement_at TIMESTAMPTZ NOT NULL,
    operator_name VARCHAR(128) NOT NULL,
    signature VARCHAR(128) NOT NULL,
    product_description VARCHAR(255) NOT NULL,
    pieces INTEGER,
    weight_kg NUMERIC(10, 3),
    volume_liters NUMERIC(10, 3),
    merchandise_condition VARCHAR(128),
    location VARCHAR(128) NOT NULL DEFAULT 'Magazzino',
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_warehouse_movements_movement_at ON warehouse_movements (movement_at);
CREATE INDEX IF NOT EXISTS ix_warehouse_movements_movement_type ON warehouse_movements (movement_type);
CREATE INDEX IF NOT EXISTS ix_warehouse_movements_location ON warehouse_movements (location);
