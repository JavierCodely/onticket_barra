-- =====================================================================
-- ONTICKET - 03 de 09: VENTAS, RETIRO POR QR, SUSTITUCIONES E IMPUESTOS
-- Requiere: 01, 02
-- Contenido: sales, sale_items, sale_payments, sale_status_events,
--            sale_item_substitutions, sale_item_taxes
--
-- TODAS estas filas las crea el posnet y su id (UUID) se genera EN EL
-- DISPOSITIVO: es la clave de idempotencia. Reintentar un envio es
--     INSERT ... ON CONFLICT (id) DO NOTHING
-- y no duplica nada. El posnet solo INSERTA: nunca modifica ni borra.
-- (Las reglas automaticas estan en el archivo 06.)
-- =====================================================================
BEGIN;

-- =====================================================================
-- A) SALES  (el ticket)
-- status / delivered_* los mantiene un trigger a partir de
-- sale_status_events; el resto de la fila es inmutable.
-- =====================================================================
CREATE TABLE public.sales (
    id                    uuid          PRIMARY KEY,
    club_id               uuid          NOT NULL REFERENCES public.clubs (id),
    cash_register_id      uuid          NOT NULL,
    cash_shift_id         uuid          NOT NULL,
    cashier_user_id       uuid          NOT NULL,
    -- Etiqueta para personas ('C2-000123'). La identidad de la venta es id.
    -- NO es UNIQUE: dos posnets sin conexion podrian repetir un numero y
    -- una venta ya cobrada no se rechaza (v_ticket_number_conflicts los lista).
    ticket_number         text          NOT NULL,
    total                 numeric(12,2) NOT NULL,
    status                text          NOT NULL DEFAULT 'pending',
    delivered_at          timestamptz,
    delivered_by_user_id  uuid,
    created_at_device     timestamptz   NOT NULL,          -- hora del posnet
    received_at           timestamptz   NOT NULL DEFAULT now(),  -- hora del servidor
    updated_at            timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT sales_ticket_number_not_blank CHECK (btrim(ticket_number) <> ''),
    CONSTRAINT sales_total_check  CHECK (total >= 0),
    CONSTRAINT sales_status_check CHECK (status IN ('pending', 'delivered')),
    CONSTRAINT sales_delivery_consistency CHECK (
        (status = 'pending'   AND delivered_at IS NULL     AND delivered_by_user_id IS NULL)
        OR
        (status = 'delivered' AND delivered_at IS NOT NULL AND delivered_by_user_id IS NOT NULL)
    ),
    CONSTRAINT sales_id_club_unique UNIQUE (id, club_id),
    CONSTRAINT sales_register_fk
        FOREIGN KEY (cash_register_id, club_id) REFERENCES public.cash_registers (id, club_id),
    CONSTRAINT sales_shift_fk
        FOREIGN KEY (cash_shift_id, club_id) REFERENCES public.cash_shifts (id, club_id),
    CONSTRAINT sales_cashier_fk
        FOREIGN KEY (cashier_user_id, club_id) REFERENCES public.users (id, club_id),
    CONSTRAINT sales_delivered_by_fk
        FOREIGN KEY (delivered_by_user_id, club_id) REFERENCES public.users (id, club_id)
);
COMMENT ON TABLE public.sales IS 'Ventas (tickets). El posnet las inserta; el retiro lo marca un trigger.';
COMMENT ON COLUMN public.sales.created_at_device IS 'Hora del posnet (puede estar mal). received_at es la hora confiable del servidor.';

CREATE INDEX idx_sales_club_created   ON public.sales (club_id, created_at_device DESC);
CREATE INDEX idx_sales_club_ticket    ON public.sales (club_id, ticket_number);
CREATE INDEX idx_sales_register       ON public.sales (cash_register_id, club_id);
CREATE INDEX idx_sales_shift          ON public.sales (cash_shift_id, club_id);
CREATE INDEX idx_sales_cashier        ON public.sales (cashier_user_id, club_id);
CREATE INDEX idx_sales_delivered_by   ON public.sales (delivered_by_user_id, club_id);


-- =====================================================================
-- B) SALE_ITEMS  (lo VENDIDO, con su foto de nombre, precio y costo)
-- =====================================================================
CREATE TABLE public.sale_items (
    id            uuid          PRIMARY KEY,
    club_id       uuid          NOT NULL REFERENCES public.clubs (id),
    sale_id       uuid          NOT NULL,
    product_id    uuid          NOT NULL,
    product_name  text          NOT NULL,
    quantity      integer       NOT NULL,
    unit_price    numeric(12,2) NOT NULL,
    unit_cost     numeric(12,2) NOT NULL,
    line_total    numeric(12,2) NOT NULL,
    received_at   timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT sale_items_quantity_check   CHECK (quantity > 0),
    CONSTRAINT sale_items_amounts_check    CHECK (unit_price >= 0 AND unit_cost >= 0),
    CONSTRAINT sale_items_line_total_check CHECK (line_total = quantity * unit_price),
    CONSTRAINT sale_items_id_club_unique   UNIQUE (id, club_id),
    CONSTRAINT sale_items_sale_fk
        FOREIGN KEY (sale_id, club_id) REFERENCES public.sales (id, club_id),
    CONSTRAINT sale_items_product_fk
        FOREIGN KEY (product_id, club_id) REFERENCES public.products (id, club_id)
);
COMMENT ON TABLE public.sale_items IS 'Items vendidos. Solo agregar. Guarda la foto del producto al momento de la venta.';

CREATE INDEX idx_sale_items_club    ON public.sale_items (club_id);
CREATE INDEX idx_sale_items_sale    ON public.sale_items (sale_id, club_id);
CREATE INDEX idx_sale_items_product ON public.sale_items (product_id, club_id);


-- =====================================================================
-- C) SALE_PAYMENTS  (una venta puede tener varios pagos)
-- Que la suma de pagos = total NO se bloquea (la venta ya se cobro):
-- la vista v_sales_integrity_issues lista las que no coinciden.
-- =====================================================================
CREATE TABLE public.sale_payments (
    id           uuid          PRIMARY KEY,
    club_id      uuid          NOT NULL REFERENCES public.clubs (id),
    sale_id      uuid          NOT NULL,
    method       text          NOT NULL REFERENCES public.payment_methods (code),
    amount       numeric(12,2) NOT NULL,
    received_at  timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT sale_payments_amount_check CHECK (amount > 0),
    CONSTRAINT sale_payments_sale_fk
        FOREIGN KEY (sale_id, club_id) REFERENCES public.sales (id, club_id)
);
COMMENT ON TABLE public.sale_payments IS 'Pagos de cada venta (pago mixto = varias filas). Solo agregar.';

CREATE INDEX idx_sale_payments_club   ON public.sale_payments (club_id);
CREATE INDEX idx_sale_payments_sale   ON public.sale_payments (sale_id, club_id);
CREATE INDEX idx_sale_payments_method ON public.sale_payments (method);


-- =====================================================================
-- D) SALE_STATUS_EVENTS  (la barra escanea el QR = retiro)
-- Dos barras pueden escanear el mismo ticket sin conexion: gana el
-- primer evento en llegar; el resto queda is_duplicate = true.
-- =====================================================================
CREATE TABLE public.sale_status_events (
    id                  uuid        PRIMARY KEY,
    club_id             uuid        NOT NULL REFERENCES public.clubs (id),
    sale_id             uuid        NOT NULL,
    event_type          text        NOT NULL DEFAULT 'delivered',
    scanned_by_user_id  uuid        NOT NULL,
    occurred_at         timestamptz NOT NULL,              -- hora del posnet
    received_at         timestamptz NOT NULL DEFAULT now(),
    is_duplicate        boolean     NOT NULL DEFAULT false, -- lo decide un trigger
    CONSTRAINT sale_status_events_type_check CHECK (event_type IN ('delivered')),
    CONSTRAINT sale_status_events_sale_fk
        FOREIGN KEY (sale_id, club_id) REFERENCES public.sales (id, club_id),
    CONSTRAINT sale_status_events_scanned_by_fk
        FOREIGN KEY (scanned_by_user_id, club_id) REFERENCES public.users (id, club_id)
);
COMMENT ON TABLE public.sale_status_events IS 'Eventos de retiro de tickets. Solo agregar.';

-- Un solo retiro valido por ticket.
CREATE UNIQUE INDEX uq_sale_status_events_one_delivery
    ON public.sale_status_events (sale_id) WHERE NOT is_duplicate;
CREATE INDEX idx_sale_status_events_club       ON public.sale_status_events (club_id);
CREATE INDEX idx_sale_status_events_sale       ON public.sale_status_events (sale_id, club_id);
CREATE INDEX idx_sale_status_events_scanned_by ON public.sale_status_events (scanned_by_user_id, club_id);


-- =====================================================================
-- E) SALE_ITEM_SUBSTITUTIONS  (lo ENTREGADO distinto de lo vendido)
--
-- Ejemplo: se vendio Corona (precio 5000, costo 1000) y no habia; la
-- barra entrega Heineken (precio 6000, costo 2000) sin cobrar diferencia.
--   * sale_items conserva lo vendido (Corona, 5000).
--   * esta tabla registra lo entregado (Heineken), quien y por que.
--   * ingreso = 5000 (lo cobrado)       costo real = 2000 (Heineken)
--     descuento por sustitucion = 6000 - 5000 = 1000 (lo absorbe el club)
--   * stock: Corona +1 (no se entrego) y Heineken -1.
-- Las columnas original_* y *_difference las completa un trigger.
-- =====================================================================
CREATE TABLE public.sale_item_substitutions (
    id                       uuid          PRIMARY KEY,
    club_id                  uuid          NOT NULL REFERENCES public.clubs (id),
    sale_id                  uuid          NOT NULL,
    sale_item_id             uuid          NOT NULL,
    quantity                 integer       NOT NULL,       -- unidades sustituidas
    reason                   text          NOT NULL DEFAULT 'out_of_stock',
    -- Hoy solo 'absorbed_by_club'. Ampliar cuando exista el modulo de reembolsos.
    settlement               text          NOT NULL DEFAULT 'absorbed_by_club',
    -- Lo vendido (lo copia el trigger desde sale_items)
    original_product_id      uuid          NOT NULL,
    original_product_name    text          NOT NULL,
    original_unit_price      numeric(12,2) NOT NULL,
    original_unit_cost       numeric(12,2) NOT NULL,
    -- Lo entregado (foto que envia el posnet)
    substitute_product_id    uuid          NOT NULL,
    substitute_product_name  text          NOT NULL,
    substitute_unit_price    numeric(12,2) NOT NULL,
    substitute_unit_cost     numeric(12,2) NOT NULL,
    -- Calculados por el trigger
    price_difference         numeric(12,2) NOT NULL DEFAULT 0,  -- (entregado - vendido) x cantidad
    cost_difference          numeric(12,2) NOT NULL DEFAULT 0,  -- costo extra para el club
    location_id              uuid          NOT NULL,       -- barra que entrega
    authorized_by_user_id    uuid          NOT NULL,
    occurred_at              timestamptz   NOT NULL,       -- hora del posnet
    received_at              timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT sale_item_substitutions_quantity_check CHECK (quantity > 0),
    CONSTRAINT sale_item_substitutions_reason_check
        CHECK (reason IN ('out_of_stock', 'customer_request', 'damaged', 'other')),
    CONSTRAINT sale_item_substitutions_settlement_check CHECK (settlement IN ('absorbed_by_club')),
    CONSTRAINT sale_item_substitutions_different_product
        CHECK (original_product_id <> substitute_product_id),
    CONSTRAINT sale_item_substitutions_amounts_check
        CHECK (substitute_unit_price >= 0 AND substitute_unit_cost >= 0),
    CONSTRAINT sale_item_substitutions_id_club_unique UNIQUE (id, club_id),
    CONSTRAINT sale_item_substitutions_sale_fk
        FOREIGN KEY (sale_id, club_id) REFERENCES public.sales (id, club_id),
    CONSTRAINT sale_item_substitutions_item_fk
        FOREIGN KEY (sale_item_id, club_id) REFERENCES public.sale_items (id, club_id),
    CONSTRAINT sale_item_substitutions_original_product_fk
        FOREIGN KEY (original_product_id, club_id) REFERENCES public.products (id, club_id),
    CONSTRAINT sale_item_substitutions_substitute_product_fk
        FOREIGN KEY (substitute_product_id, club_id) REFERENCES public.products (id, club_id),
    CONSTRAINT sale_item_substitutions_location_fk
        FOREIGN KEY (location_id, club_id) REFERENCES public.inventory_locations (id, club_id),
    CONSTRAINT sale_item_substitutions_authorized_by_fk
        FOREIGN KEY (authorized_by_user_id, club_id) REFERENCES public.users (id, club_id)
);
COMMENT ON TABLE public.sale_item_substitutions IS 'Producto entregado en lugar del vendido. Solo agregar.';

CREATE INDEX idx_sale_item_substitutions_club_occurred ON public.sale_item_substitutions (club_id, occurred_at DESC);
CREATE INDEX idx_sale_item_substitutions_sale       ON public.sale_item_substitutions (sale_id, club_id);
CREATE INDEX idx_sale_item_substitutions_item       ON public.sale_item_substitutions (sale_item_id, club_id);
CREATE INDEX idx_sale_item_substitutions_original   ON public.sale_item_substitutions (original_product_id, club_id);
CREATE INDEX idx_sale_item_substitutions_substitute ON public.sale_item_substitutions (substitute_product_id, club_id);
CREATE INDEX idx_sale_item_substitutions_location   ON public.sale_item_substitutions (location_id, club_id);
CREATE INDEX idx_sale_item_substitutions_user       ON public.sale_item_substitutions (authorized_by_user_id, club_id);


-- =====================================================================
-- F) SALE_ITEM_TAXES  (foto del impuesto aplicado a cada item)
-- La calcula y la guarda el posnet al vender, igual que la foto de
-- precio y costo. Por eso desactivar o cambiar un impuesto no altera el
-- pasado. El servidor no bloquea montos raros: v_sale_tax_issues los lista.
-- =====================================================================
CREATE TABLE public.sale_item_taxes (
    id                  uuid          PRIMARY KEY,
    club_id             uuid          NOT NULL REFERENCES public.clubs (id),
    sale_id             uuid          NOT NULL,
    sale_item_id        uuid          NOT NULL,
    tax_id              uuid          NOT NULL,
    tax_name            text          NOT NULL,            -- foto
    kind                text          NOT NULL,            -- foto
    percentage          numeric(7,4),                      -- foto
    fixed_amount        numeric(12,2),                     -- foto
    -- Foto de los metodos del impuesto, separados por coma: 'card,transfer'.
    -- Texto (no arreglo) para que llegue igual a SQLite.
    applies_to_methods  text          NOT NULL,
    taxable_ratio       numeric(7,6)  NOT NULL,            -- parte del ticket alcanzada (0 < r <= 1)
    amount              numeric(12,2) NOT NULL,            -- impuesto de este item
    received_at         timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT sale_item_taxes_kind_check CHECK (kind IN ('percentage', 'fixed')),
    CONSTRAINT sale_item_taxes_value_check CHECK (
        (kind = 'percentage' AND percentage IS NOT NULL AND fixed_amount IS NULL)
        OR
        (kind = 'fixed' AND fixed_amount IS NOT NULL AND percentage IS NULL)
    ),
    CONSTRAINT sale_item_taxes_methods_format CHECK (applies_to_methods ~ '^[a-z_]+(,[a-z_]+)*$'),
    CONSTRAINT sale_item_taxes_ratio_check    CHECK (taxable_ratio > 0 AND taxable_ratio <= 1),
    CONSTRAINT sale_item_taxes_amount_check   CHECK (amount >= 0),
    CONSTRAINT sale_item_taxes_one_per_item   UNIQUE (sale_item_id, tax_id),
    CONSTRAINT sale_item_taxes_sale_fk
        FOREIGN KEY (sale_id, club_id) REFERENCES public.sales (id, club_id),
    CONSTRAINT sale_item_taxes_item_fk
        FOREIGN KEY (sale_item_id, club_id) REFERENCES public.sale_items (id, club_id),
    CONSTRAINT sale_item_taxes_tax_fk
        FOREIGN KEY (tax_id, club_id) REFERENCES public.taxes (id, club_id)
);
COMMENT ON TABLE public.sale_item_taxes IS 'Impuestos aplicados a cada item, con su foto historica. Solo agregar.';

CREATE INDEX idx_sale_item_taxes_club ON public.sale_item_taxes (club_id);
CREATE INDEX idx_sale_item_taxes_sale ON public.sale_item_taxes (sale_id, club_id);
CREATE INDEX idx_sale_item_taxes_item ON public.sale_item_taxes (sale_item_id, club_id);
CREATE INDEX idx_sale_item_taxes_tax  ON public.sale_item_taxes (tax_id, club_id);

COMMIT;
