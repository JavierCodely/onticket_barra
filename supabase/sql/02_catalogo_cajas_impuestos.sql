-- =====================================================================
-- ONTICKET - 02 de 09: CATALOGO, UBICACIONES, CAJAS E IMPUESTOS
-- Requiere: 01
-- Contenido: products, inventory_locations, cash_registers, cash_shifts,
--            taxes, tax_payment_methods
-- Reglas y convenciones: CLAUDE.md y encabezado del archivo 01.
-- =====================================================================
BEGIN;

-- =====================================================================
-- A) PRODUCTS  (catalogo por club)
-- Cambiar precio o costo NO altera ventas pasadas: cada sale_item guarda
-- su propia foto (nombre, precio, costo).
-- =====================================================================
CREATE TABLE public.products (
    id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id     uuid          NOT NULL REFERENCES public.clubs (id),
    name        text          NOT NULL,
    sku         text,
    category    text,
    cost        numeric(12,2) NOT NULL DEFAULT 0,
    price       numeric(12,2) NOT NULL,
    image_url   text,
    active      boolean       NOT NULL DEFAULT true,
    created_at  timestamptz   NOT NULL DEFAULT now(),
    updated_at  timestamptz   NOT NULL DEFAULT now(),
    deleted_at  timestamptz,
    CONSTRAINT products_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT products_sku_not_blank  CHECK (sku IS NULL OR btrim(sku) <> ''),
    CONSTRAINT products_cost_check     CHECK (cost >= 0),
    CONSTRAINT products_price_check    CHECK (price >= 0),
    CONSTRAINT products_id_club_unique UNIQUE (id, club_id)
);
COMMENT ON TABLE public.products IS 'Catalogo de productos de cada club.';

-- Nombre y sku unicos DENTRO del club (otros clubs pueden repetirlos).
CREATE UNIQUE INDEX uq_products_club_name
    ON public.products (club_id, lower(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_products_club_sku
    ON public.products (club_id, sku) WHERE sku IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_products_club ON public.products (club_id);


-- =====================================================================
-- B) INVENTORY_LOCATIONS  (ej: "Barra principal", "Deposito")
-- =====================================================================
CREATE TABLE public.inventory_locations (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id     uuid        NOT NULL REFERENCES public.clubs (id),
    name        text        NOT NULL,
    kind        text        NOT NULL DEFAULT 'bar',
    active      boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz,
    CONSTRAINT inventory_locations_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT inventory_locations_kind_check     CHECK (kind IN ('bar', 'storage')),
    CONSTRAINT inventory_locations_id_club_unique UNIQUE (id, club_id)
);
COMMENT ON TABLE public.inventory_locations IS 'Lugares fisicos donde hay stock (una heladera por barra reduce conflictos).';

CREATE UNIQUE INDEX uq_inventory_locations_club_name
    ON public.inventory_locations (club_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX idx_inventory_locations_club ON public.inventory_locations (club_id);


-- =====================================================================
-- C) CASH_REGISTERS  (cada caja vende desde UNA ubicacion de stock)
-- =====================================================================
CREATE TABLE public.cash_registers (
    id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id                uuid        NOT NULL REFERENCES public.clubs (id),
    name                   text        NOT NULL,
    inventory_location_id  uuid        NOT NULL,
    active                 boolean     NOT NULL DEFAULT true,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    deleted_at             timestamptz,
    CONSTRAINT cash_registers_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT cash_registers_id_club_unique UNIQUE (id, club_id),
    CONSTRAINT cash_registers_location_fk
        FOREIGN KEY (inventory_location_id, club_id)
        REFERENCES public.inventory_locations (id, club_id)
);
COMMENT ON TABLE public.cash_registers IS 'Cajas del club. inventory_location_id indica de donde sale el stock que vende.';

CREATE UNIQUE INDEX uq_cash_registers_club_name
    ON public.cash_registers (club_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX idx_cash_registers_club     ON public.cash_registers (club_id);
CREATE INDEX idx_cash_registers_location ON public.cash_registers (inventory_location_id, club_id);


-- =====================================================================
-- D) CASH_SHIFTS  (turnos de caja; version minima)
-- El id lo genera el posnet. Arqueos y turnos compartidos: modulo futuro.
-- No hay "un solo turno abierto por caja": dos posnets sin conexion
-- podrian abrir a la vez y la base no debe rechazar lo que ya ocurrio.
-- =====================================================================
CREATE TABLE public.cash_shifts (
    id                 uuid        PRIMARY KEY,
    club_id            uuid        NOT NULL REFERENCES public.clubs (id),
    cash_register_id   uuid        NOT NULL,
    opened_by_user_id  uuid        NOT NULL,
    opened_at          timestamptz NOT NULL,               -- hora del posnet
    closed_at          timestamptz,
    received_at        timestamptz NOT NULL DEFAULT now(), -- hora del servidor
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cash_shifts_closed_after_opened CHECK (closed_at IS NULL OR closed_at >= opened_at),
    CONSTRAINT cash_shifts_id_club_unique UNIQUE (id, club_id),
    CONSTRAINT cash_shifts_register_fk
        FOREIGN KEY (cash_register_id, club_id) REFERENCES public.cash_registers (id, club_id),
    CONSTRAINT cash_shifts_opened_by_fk
        FOREIGN KEY (opened_by_user_id, club_id) REFERENCES public.users (id, club_id)
);
COMMENT ON TABLE public.cash_shifts IS 'Turnos de caja abiertos desde el posnet.';

CREATE INDEX idx_cash_shifts_club_opened ON public.cash_shifts (club_id, opened_at DESC);
CREATE INDEX idx_cash_shifts_register    ON public.cash_shifts (cash_register_id, club_id);
CREATE INDEX idx_cash_shifts_opened_by   ON public.cash_shifts (opened_by_user_id, club_id);


-- =====================================================================
-- E) TAXES  (impuestos y comisiones de cada club)
--
-- REGLAS
-- 1) Cada club define los suyos: nombre + porcentaje O monto fijo, y los
--    metodos de pago a los que aplica (tax_payment_methods).
-- 2) Estan INCLUIDOS en el precio: no se suman a lo que paga el cliente,
--    se descuentan de lo que el club se queda.
--        margen neto = precio - impuestos - costo
-- 3) Porcentaje: % del importe de la linea.
--    Monto fijo : monto POR UNIDAD vendida.
--    Pago mixto : proporcional a la parte del ticket pagada con los
--                 metodos del impuesto (ratio).
--        porcentaje: ROUND(line_total * percentage / 100 * ratio, 2)
--        fijo      : ROUND(fixed_amount * quantity * ratio, 2)
--        ratio     = pagos con metodos del impuesto / total del ticket
-- 4) Activar / desactivar = columna active. No se borran (sin DELETE).
--    Desactivar no toca el pasado: cada venta guarda su foto en
--    sale_item_taxes. Las ventas nuevas ya no lo aplican (el posnet
--    solo descarga impuestos activos).
-- =====================================================================
CREATE TABLE public.taxes (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id       uuid          NOT NULL REFERENCES public.clubs (id),
    name          text          NOT NULL,              -- ej: 'Comision tarjeta'
    kind          text          NOT NULL,              -- 'percentage' | 'fixed'
    percentage    numeric(7,4),                        -- 3.0000 = 3 %
    fixed_amount  numeric(12,2),                       -- monto fijo POR UNIDAD
    -- Hoy solo 'included'. Agregar 'added' si algun impuesto debe sumarse
    -- al precio que paga el cliente.
    charge_mode   text          NOT NULL DEFAULT 'included',
    active        boolean       NOT NULL DEFAULT true,
    created_at    timestamptz   NOT NULL DEFAULT now(),
    updated_at    timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT taxes_name_not_blank   CHECK (btrim(name) <> ''),
    CONSTRAINT taxes_kind_check       CHECK (kind IN ('percentage', 'fixed')),
    CONSTRAINT taxes_charge_mode_check CHECK (charge_mode IN ('included')),
    CONSTRAINT taxes_value_check CHECK (
        (kind = 'percentage' AND percentage IS NOT NULL AND percentage > 0
                             AND percentage <= 100 AND fixed_amount IS NULL)
        OR
        (kind = 'fixed' AND fixed_amount IS NOT NULL AND fixed_amount > 0
                        AND percentage IS NULL)
    ),
    CONSTRAINT taxes_id_club_unique UNIQUE (id, club_id)
);
COMMENT ON TABLE public.taxes IS 'Impuestos y comisiones del club, incluidos en el precio. Se activan o desactivan; no se borran.';
COMMENT ON COLUMN public.taxes.fixed_amount IS 'Monto fijo por unidad vendida.';

CREATE UNIQUE INDEX uq_taxes_club_name ON public.taxes (club_id, lower(name));

-- Metodos de pago a los que aplica cada impuesto (una fila por metodo).
-- Un impuesto sin metodos no se aplica nunca: el panel debe exigir uno.
CREATE TABLE public.tax_payment_methods (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id  uuid NOT NULL REFERENCES public.clubs (id),
    tax_id   uuid NOT NULL,
    method   text NOT NULL REFERENCES public.payment_methods (code),
    CONSTRAINT tax_payment_methods_unique UNIQUE (tax_id, method),
    CONSTRAINT tax_payment_methods_tax_fk
        FOREIGN KEY (tax_id, club_id) REFERENCES public.taxes (id, club_id)
);
COMMENT ON TABLE public.tax_payment_methods IS 'Que metodos de pago disparan cada impuesto.';

CREATE INDEX idx_tax_payment_methods_club   ON public.tax_payment_methods (club_id);
CREATE INDEX idx_tax_payment_methods_tax    ON public.tax_payment_methods (tax_id, club_id);
CREATE INDEX idx_tax_payment_methods_method ON public.tax_payment_methods (method);

COMMIT;
