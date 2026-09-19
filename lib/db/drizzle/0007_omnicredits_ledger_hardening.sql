ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_manual_reference_check" CHECK ("credit_ledger"."entry_type" not in ('grant', 'adjustment', 'refund', 'expiration') or ("credit_ledger"."reference" is not null and btrim("credit_ledger"."reference") <> ''));--> statement-breakpoint
CREATE FUNCTION credit_ledger_block_delete() RETURNS trigger AS $$
BEGIN
  -- El ledger es append-only: un movimiento no se borra, se corrige con otro
  -- (adjustment/refund). Un DELETE directo corre a profundidad 1 y se rechaza.
  -- El borrado en cascada (ON DELETE CASCADE al eliminar una organización o una
  -- cuenta) lo ejecuta el trigger de integridad referencial, es decir, a
  -- profundidad > 1, y se permite: es el único borrado legítimo.
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'credit_ledger es inmutable: un movimiento no se borra; registra un movimiento de ajuste';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER credit_ledger_no_delete BEFORE DELETE ON credit_ledger FOR EACH ROW EXECUTE FUNCTION credit_ledger_block_delete();
--> statement-breakpoint
CREATE FUNCTION credit_ledger_block_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'credit_ledger es inmutable: no se puede vaciar';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER credit_ledger_no_truncate BEFORE TRUNCATE ON credit_ledger FOR EACH STATEMENT EXECUTE FUNCTION credit_ledger_block_truncate();
