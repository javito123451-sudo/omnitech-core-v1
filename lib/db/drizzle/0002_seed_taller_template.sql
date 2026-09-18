-- Plantilla de onboarding para la vertical Omni Taller (taller mecánico /
-- automoción). Las 10 plantillas existentes se sembraron por SQL crudo en
-- startupMigrations.ts, guardadas detrás de un "solo si la tabla está
-- vacía" — como ya no está vacía en producción, esa vía nunca volverá a
-- correr para añadir una fila nueva. Esta migración añade la fila
-- directamente, idempotente vía ON CONFLICT (slug).
INSERT INTO onboard_templates (slug, name, description, icon, default_modules, default_fiscal, recommended_plan, default_roles, is_active, order_index)
VALUES (
  'taller',
  'Taller Mecánico',
  'Taller de automoción: citas, presupuestos y seguimiento de reparación por vehículo',
  'Wrench',
  '["crm","quotes","whatsapp","ai_agents","omni_taller","automations"]'::jsonb,
  '{"companyType":"autonomo","regime":"estimacion_directa","vat":true,"irpf":true,"country":"ES"}'::jsonb,
  'business',
  '[{"role":"admin","count":1},{"role":"member","count":3}]'::jsonb,
  true,
  10
)
ON CONFLICT (slug) DO NOTHING;