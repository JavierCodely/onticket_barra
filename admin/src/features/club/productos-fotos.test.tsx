import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { crearClienteFalso, SESION_DE_PRUEBA, URL_STORAGE } from "@/test/supabaseFalso"
import { rutaDeFoto } from "@/lib/datos"
import { validarFoto } from "@/lib/validaciones"
import { ProductosPage } from "./ProductosPage"

const CLUB = "club-1"
const URL_VIEJA = `${URL_STORAGE}/product-images/club-1/p1-100.webp`
const FERNET = { id: "p1", name: "Fernet", sku: null, category_id: null, cost: 1500, price: 6500, image_url: null, active: true }
const CORONA = { ...FERNET, id: "p2", name: "Corona", image_url: URL_VIEJA }

type Respuesta = { data: unknown; error: unknown }

function cliente(products: Respuesta[] = [], extra: Record<string, Respuesta[]> = {}) {
  return crearClienteFalso(SESION_DE_PRUEBA, {
    products: [{ data: [CORONA, FERNET], error: null }, ...products],
    product_categories: [{ data: [], error: null }],
    inventory_locations: [{ data: [{ id: "d", name: "Depósito", kind: "storage", active: true }], error: null }],
    inventory_balances: [{ data: [], error: null }],
    ...extra,
  })
}

const foto = (tipo = "image/webp", bytes = 1000, nombre = "fernet.webp") =>
  new File([new Uint8Array(bytes)], nombre, { type: tipo })

// applyAccept: false para poder probar que el panel rechaza otros tipos.
const usuario = () => userEvent.setup({ applyAccept: false })

describe("validaciones de la foto", () => {
  it("JPG, PNG o WebP de hasta 2 MB", () => {
    expect(validarFoto({ type: "image/webp", size: 1000 })).toBeNull()
    expect(validarFoto({ type: "image/jpeg", size: 2 * 1024 * 1024 })).toBeNull()
    expect(validarFoto({ type: "image/gif", size: 1000 })).toMatch(/JPG, PNG o WebP/)
    expect(validarFoto({ type: "image/png", size: 2 * 1024 * 1024 + 1 })).toMatch(/más de 2 MB/)
    expect(validarFoto({ type: "image/png", size: 0 })).toMatch(/vacío/)
  })

  it("ruta dentro del bucket a partir de la URL publica", () => {
    expect(rutaDeFoto(URL_VIEJA)).toBe("club-1/p1-100.webp")
    expect(rutaDeFoto(null)).toBeNull()
    expect(rutaDeFoto("https://otro-sitio.com/x.png")).toBeNull()
  })
})

describe("Productos: fotos", () => {
  it("la lista muestra la miniatura de cada producto, o un icono si no tiene foto", async () => {
    const { client } = cliente()
    render(<ProductosPage client={client} clubId={CLUB} />)
    expect(await screen.findByRole("img", { name: "Foto de Corona" })).toHaveAttribute("src", URL_VIEJA)
    expect(screen.queryByRole("img", { name: "Foto de Fernet" })).not.toBeInTheDocument()
  })

  it("EDITAR > Subir foto: la sube a la carpeta del club y guarda la URL publica en el producto", async () => {
    const falso = cliente([{ data: { ...FERNET, image_url: "X" }, error: null }])
    const u = usuario()
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    await u.click(await screen.findByRole("button", { name: "Editar Fernet" }))
    const dialogo = await screen.findByRole("dialog")
    await u.upload(within(dialogo).getByLabelText("Subir foto"), foto())

    expect(falso.subidas).toHaveLength(1)
    const { bucket, ruta, opciones } = falso.subidas[0]
    expect(bucket).toBe("product-images")
    expect(ruta).toMatch(/^club-1\/p1-\d+\.webp$/)
    expect(opciones).toMatchObject({ contentType: "image/webp", upsert: false })

    const escritura = falso.escrituras.find((e) => e.tabla === "products" && e.operacion === "update")!
    expect(escritura.fila).toEqual({ image_url: `${URL_STORAGE}/product-images/${ruta}` })
    expect(escritura.filtros).toContainEqual({ metodo: "eq", args: ["id", "p1"] })
    // no tenia foto: no hay nada que borrar
    expect(falso.borrados).toEqual([])
  })

  it("EDITAR > Cambiar foto: guarda la nueva y borra la vieja del bucket", async () => {
    const nueva = `${URL_STORAGE}/product-images/club-1/p2-200.png`
    const falso = cliente([{ data: { ...CORONA, image_url: nueva }, error: null }])
    const u = usuario()
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    await u.click(await screen.findByRole("button", { name: "Editar Corona" }))
    const dialogo = await screen.findByRole("dialog")
    expect(within(dialogo).getByRole("img", { name: "Foto de Corona" })).toHaveAttribute("src", URL_VIEJA)
    await u.upload(within(dialogo).getByLabelText("Cambiar foto"), foto("image/png", 500, "corona.png"))

    expect(falso.subidas[0].ruta).toMatch(/^club-1\/p2-\d+\.png$/)
    expect(falso.borrados).toEqual([{ bucket: "product-images", rutas: ["club-1/p1-100.webp"] }])
    expect(await within(dialogo).findByRole("img", { name: "Foto de Corona" })).toHaveAttribute("src", nueva)
  })

  it("EDITAR > Quitar foto: deja image_url en null y borra el archivo", async () => {
    const falso = cliente([{ data: { ...CORONA, image_url: null }, error: null }])
    const u = usuario()
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    await u.click(await screen.findByRole("button", { name: "Editar Corona" }))
    await u.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Quitar foto" }))

    expect(falso.escrituras[0].fila).toEqual({ image_url: null })
    expect(falso.borrados).toEqual([{ bucket: "product-images", rutas: ["club-1/p1-100.webp"] }])
    expect(await within(screen.getByRole("dialog")).findByLabelText("Subir foto")).toBeInTheDocument()
  })

  it("rechaza un tipo de archivo que no es foto, o una de mas de 2 MB, sin subir nada", async () => {
    const falso = cliente()
    const u = usuario()
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    await u.click(await screen.findByRole("button", { name: "Editar Fernet" }))
    const dialogo = await screen.findByRole("dialog")

    await u.upload(within(dialogo).getByLabelText("Subir foto"), foto("image/gif", 100, "x.gif"))
    expect(within(dialogo).getByRole("alert")).toHaveTextContent("JPG, PNG o WebP")
    await u.upload(within(dialogo).getByLabelText("Subir foto"), foto("image/jpeg", 3 * 1024 * 1024, "grande.jpg"))
    expect(within(dialogo).getByRole("alert")).toHaveTextContent("más de 2 MB")
    expect(falso.subidas).toEqual([])
    expect(falso.escrituras).toEqual([])
  })

  it("si Storage rechaza la subida, avisa y no cambia el producto", async () => {
    const falso = cliente([], {
      "storage:upload:product-images": [{ data: null, error: { message: "new row violates row-level security policy" } }],
    })
    const u = usuario()
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    await u.click(await screen.findByRole("button", { name: "Editar Fernet" }))
    const dialogo = await screen.findByRole("dialog")
    await u.upload(within(dialogo).getByLabelText("Subir foto"), foto())
    expect(await within(dialogo).findByText("No se pudo subir la foto. Intentá de nuevo.")).toBeInTheDocument()
    expect(falso.escrituras).toEqual([])
  })

  it("NUEVO PRODUCTO con foto: crea el producto y despues le sube la foto", async () => {
    const creado = { ...FERNET, id: "p9", name: "Gin tonic" }
    const falso = crearClienteFalso(SESION_DE_PRUEBA, {
      products: [
        { data: [], error: null },
        { data: creado, error: null },
        { data: { ...creado, image_url: "X" }, error: null },
      ],
      inventory_locations: [{ data: [{ id: "d", name: "Depósito", kind: "storage", active: true }], error: null }],
    })
    const u = usuario()
    render(<ProductosPage client={falso.client} clubId={CLUB} />)
    await u.click(await screen.findByRole("button", { name: "Nuevo producto" }))
    await u.upload(screen.getByLabelText("Elegir foto (opcional)"), foto("image/jpeg", 800, "gin.jpg"))
    expect(screen.getByText("gin.jpg")).toBeInTheDocument()
    await u.type(screen.getByLabelText("Nombre"), "Gin tonic")
    await u.type(screen.getByLabelText("Precio"), "7000")
    await u.click(screen.getByRole("button", { name: "Crear producto" }))

    expect(falso.escrituras[0]).toMatchObject({ tabla: "products", operacion: "insert" })
    expect(falso.subidas[0].ruta).toMatch(/^club-1\/p9-\d+\.jpg$/)
    expect(falso.escrituras[1].fila).toEqual({ image_url: `${URL_STORAGE}/product-images/${falso.subidas[0].ruta}` })
  })
})
