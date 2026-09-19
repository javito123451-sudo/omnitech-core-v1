-- Precios OFICIALES de OpenAI GPT-5.6 (Luna, Terra, Sol): tarifa STANDARD de contexto corto.
-- Fuente: https://developers.openai.com/api/docs/pricing y la página oficial de cada modelo.
-- NO incluye precios Batch, Flex, Fast/Priority ni de contexto largo.
-- Unidades: USD por 1.000.000 de tokens. provisional = false (precio validado, con su fuente).
--
-- Los tres modelos entran en UNA sola sentencia (una transacción: o entran los tres o ninguno) y es
-- idempotente: si ya hay una fila oficial vigente para el modelo, no se duplica ni se pisa. Cambiar un
-- precio después se hace con setModelPricing() (cierra la fila vigente y crea otra), no editando esta.
-- gpt-4o y gpt-4o-mini NO se tocan: siguen como legacy/provisional (pricing.ts) hasta su revisión.
INSERT INTO "ai_model_pricing"
  ("provider", "model", "input_cost", "cached_input_cost", "output_cost", "currency", "effective_from", "active", "source", "provisional", "notes", "created_by")
SELECT v."provider", v."model", v."input_cost", v."cached_input_cost", v."output_cost", 'USD', now(), true, v."source", false,
       'Precio oficial OpenAI: STANDARD, contexto corto (sin Batch/Flex/Priority ni contexto largo)', 'migration:0009'
FROM (VALUES
  ('openai', 'gpt-5.6-luna',  0.200000, 0.020000,  1.200000, 'https://developers.openai.com/api/docs/models/gpt-5.6-luna'),
  ('openai', 'gpt-5.6-terra', 2.000000, 0.200000, 12.000000, 'https://developers.openai.com/api/docs/models/gpt-5.6-terra'),
  ('openai', 'gpt-5.6-sol',   4.000000, 0.400000, 20.000000, 'https://developers.openai.com/api/docs/models/gpt-5.6-sol')
) AS v("provider", "model", "input_cost", "cached_input_cost", "output_cost", "source")
WHERE NOT EXISTS (
  SELECT 1 FROM "ai_model_pricing" p
  WHERE p."provider" = v."provider" AND p."model" = v."model" AND p."active" = true AND p."effective_to" IS NULL AND p."provisional" = false
);
