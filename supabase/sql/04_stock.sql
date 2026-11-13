-- =====================================================================
-- ONTICKET - 04 de 09: LIBRO DE STOCK
-- Requiere: 01, 02, 03
-- Contenido: inventory_movements, inventory_balances, stock_alerts
--
-- PRINCIPIO: NADIE ESCRIBE EL NUMERO DE STOCK.
--   * Cada entrada o salida es una linea en inventory_movements
--     (cantidad con signo). El libro es de solo agregar.
--   * inventory_balances es una cache: saldo = suma de movimientos.
--     La mantiene SOLO un trigger (archivo 06).
--   * El saldo PUEDE quedar negativo: dos cajas sin conexion pueden
--     vender la ultima unidad. La venta ya ocurrio, asi que no se
--     rechaza: se abre una alerta en stock_alerts, que se cierra sola
--     cuando el saldo vuelve a ser >= 0 (sustitucion o ajuste).
--   * El posnet muestra: saldo sincronizado - ventas locales pendientes.
-- =====================================================================
BEGIN;

-- =====================================================================
-- A) INVENTORY_MOVEMENTS  (el libro)
--   Tipos manuales (panel web): initial, purchase, adjustment,
--                               transfer_in, transfer_out
--   Tipos automaticos (triggers): sale, substitution_reversal,
--                                 substitution_delivery
-- =====================================================================
CREATE TABLE public.inventory_movements (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id          uuid        NOT NULL REFERENCES public.clubs (id),
    location_id      uuid        NOT NULL,
    product_id       uuid        NOT NULL,
    movement_type    text        NOT NULL,
    quantity         integer     NOT NULL,          -- con signo: + entra / - sale
    sale_item_id     uuid,                          -- solo en 'sale'
    substitution_id  uuid,                          -- solo en sustituciones
    note             text,
    actor_type       text,                          -- quien lo cargo (movimientos manuales)
    actor_id         uuid,
    occurred_at      timestamptz NOT NULL DEFAULT now(),
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT inventory_movements_type_check CHECK (movement_type IN (
        'initial', 'purchase', 'adjustment', 'transfer_in', 'transfer_out',
        'sale', 'substitution_reversal', 'substitution_delivery')),
    CONSTRAINT inventory_movements_quantity_check CHECK (quantity <> 0),
    -- Cada tipo automatico lleva su referencia, y solo la suya.
    CONSTRAINT inventory_movements_refs_check CHECK (
        (movement_type = 'sale') = (sale_item_id IS NOT NULL)
        AND (movement_type IN ('substitution_reversal', 'substitution_delivery'))
            = (substitution_id IS NOT NULL)
    ),
    CONSTRAINT inventory_movements_actor_check CHECK (
        (actor_type IS NULL AND actor_id IS NULL)
        OR
        (actor_type IN ('platform_admin', 'user') AND actor_id IS NOT NULL)
    ),
    CONSTRAINT inventory_movements_location_fk
        FOREIGN KEY (location_id, club_id) REFERENCES public.inventory_locations (id, club_id),
    CONSTRAINT inventory_movements_product_fk
        FOREIGN KEY (product_id, club_id) REFERENCES public.products (id, club_id),
    CONSTRAINT inventory_movements_sale_item_fk
        FOREIGN KEY (sale_item_id, club_id) REFERENCES public.sale_items (id, club_id),
    CONSTRAINT inventory_movements_substitution_fk
        FOREIGN KEY (substitution_id, club_id) REFERENCES public.sale_item_substitutions (id, club_id)
);
COMMENT ON TABLE public.inventory_movements IS 'Libro de stock. Solo agregar. El saldo es la suma de estas lineas.';

-- "Una venta descuenta stock UNA sola vez": un movimiento por item y
-- un par (reversa, entrega) por sustitucion.
CREATE UNIQUE INDEX uq_inventory_movements_sale_item
    ON public.inventory_movements (sale_item_id) WHERE movement_type = 'sale';
CREATE UNIQUE INDEX uq_inventory_movements_substitution
    ON public.inventory_movements (substitution_id, movement_type) WHERE substitution_id IS NOT NULL;

CREATE INDEX idx_inventory_movements_club_occurred ON public.inventory_movements (club_id, occurred_at DESC);
CREATE INDEX idx_inventory_movements_location      ON public.inventory_movements (location_id, club_id);
CREATE INDEX idx_inventory_movements_product       ON public.inventory_movements (product_id, club_id);
CREATE INDEX idx_inventory_movements_sale_item     ON public.inventory_movements (sale_item_id, club_id);
CREATE INDEX idx_inventory_movements_substitution  ON public.inventory_movements (substitution_id, club_id);
-- Historial de un producto en una ubicacion (pantalla de stock).
CREATE INDEX idx_inventory_movements_stock
    ON public.inventory_movements (location_id, product_id, occurred_at DESC);


-- =====================================================================
-- B) INVENTORY_BALANCES  (cache del saldo; solo la escribe el trigger)
-- =====================================================================
CREATE TABLE public.inventory_balances (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id      uuid        NOT NULL REFERENCES public.clubs (id),
    location_id  uuid        NOT NULL,
    product_id   uuid        NOT NULL,
    quantity     integer     NOT NULL DEFAULT 0,    -- puede ser negativo (sobreventa)
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT inventory_balances_unique UNIQUE (location_id, product_id),
    CONSTRAINT inventory_balances_location_fk
        FOREIGN KEY (location_id, club_id) REFERENCES public.inventory_locations (id, club_id),
    CONSTRAINT inventory_balances_product_fk
        FOREIGN KEY (product_id, club_id) REFERENCES public.products (id, club_id)
);
COMMENT ON TABLE public.inventory_balances IS 'Saldo de stock por ubicacion y producto. Cache mantenida por trigger: no escribir a mano.';

CREATE INDEX idx_inventory_balances_club     ON public.inventory_balances (club_id);
CREATE INDEX idx_inventory_balances_location ON public.inventory_balances (location_id, club_id);
CREATE INDEX idx_inventory_balances_product  ON public.inventory_balances (product_id, club_id);


-- =====================================================================
-- C) STOCK_ALERTS  (saldo negativo = sobreventa a revisar)
-- =====================================================================
CREATE TABLE public.stock_alerts (
    id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id                uuid        NOT NULL REFERENCES public.clubs (id),
    location_id            uuid        NOT NULL,
    product_id             uuid        NOT NULL,
    kind                   text        NOT NULL DEFAULT 'negative_stock',
    status                 text        NOT NULL DEFAULT 'open',
    quantity_at_detection  integer     NOT NULL,    -- el saldo mas bajo visto
    created_at             timestamptz NOT NULL DEFAULT now(),
    resolved_at            timestamptz,
    resolved_note          text,
    CONSTRAINT stock_alerts_kind_check   CHECK (kind IN ('negative_stock')),
    CONSTRAINT stock_alerts_status_check CHECK (status IN ('open', 'resolved')),
    CONSTRAINT stock_alerts_resolution_consistency
        CHECK ((status = 'resolved') = (resolved_at IS NOT NULL)),
    CONSTRAINT stock_alerts_location_fk
        FOREIGN KEY (location_id, club_id) REFERENCES public.inventory_locations (id, club_id),
    CONSTRAINT stock_alerts_product_fk
        FOREIGN KEY (product_id, club_id) REFERENCES public.products (id, club_id)
);
COMMENT ON TABLE public.stock_alerts IS 'Alertas de stock negativo. Se abren y se cierran solas (trigger).';

-- Una sola alerta abierta por ubicacion y producto.
CREATE UNIQUE INDEX uq_stock_alerts_open
    ON public.stock_alerts (location_id, product_id) WHERE status = 'open';
CREATE INDEX idx_stock_alerts_club_created ON public.stock_alerts (club_id, created_at DESC);
CREATE INDEX idx_stock_alerts_location     ON public.stock_alerts (location_id, club_id);
CREATE INDEX idx_stock_alerts_product      ON public.stock_alerts (product_id, club_id);

COMMIT;
