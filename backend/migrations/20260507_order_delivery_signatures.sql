ALTER TABLE supplier_orders
  ADD COLUMN IF NOT EXISTS order_signed_by VARCHAR(128),
  ADD COLUMN IF NOT EXISTS unloading_signed_by VARCHAR(128);

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS order_signed_by VARCHAR(128),
  ADD COLUMN IF NOT EXISTS unloading_signed_by VARCHAR(128);
