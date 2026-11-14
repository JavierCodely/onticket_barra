import { assert, assertEquals } from "jsr:@std/assert@1.0.13"
import { esPinTrivial, validarPedido } from "./validar.ts"

const CLUB = "c0000000-0000-0000-0000-00000000000a"

Deno.test("acepta un cajero valido y normaliza el usuario", () => {
  const r = validarPedido({ club_id: CLUB, full_name: " Juan ", role: "cashier", username: " Juan.P ", pin: "482913" })
  assert(r.ok)
  assertEquals(r.pedido, { club_id: CLUB, full_name: "Juan", role: "cashier", username: "juan.p", pin: "482913" })
})

Deno.test("acepta un encargado (club_admin) con email y contrasena", () => {
  const r = validarPedido({
    club_id: CLUB, full_name: "Encargada", role: "club_admin", email: " Ana@Club.COM ", password: "una-clave-larga",
  })
  assert(r.ok)
  assert(r.pedido.role === "club_admin" && r.pedido.email === "ana@club.com")
})

Deno.test("rechaza roles desconocidos (no se puede crear un administrador de plataforma)", () => {
  for (const role of ["platform_admin", "admin", "", undefined]) {
    const r = validarPedido({ club_id: CLUB, full_name: "X", role, username: "xxx", pin: "482913" })
    assert(!r.ok && r.errores.role, `rol ${role} debia rechazarse`)
  }
})

Deno.test("rechaza club_id que no es UUID", () => {
  const r = validarPedido({ club_id: "1; drop table", full_name: "X", role: "cashier", username: "xxx", pin: "482913" })
  assert(!r.ok && r.errores.club_id)
})

Deno.test("PIN: 6 a 8 digitos y no trivial", () => {
  for (const pin of ["12345", "123456789", "12a456", "", "111111", "123456", "987654"]) {
    const r = validarPedido({ club_id: CLUB, full_name: "X", role: "bartender", username: "barra1", pin })
    assert(!r.ok && r.errores.pin, `PIN ${pin} debia rechazarse`)
  }
  for (const pin of ["482913", "70315528"]) {
    assert(validarPedido({ club_id: CLUB, full_name: "X", role: "bartender", username: "barra1", pin }).ok)
  }
})

Deno.test("PIN numerico enviado como numero no se acepta (pierde ceros)", () => {
  const r = validarPedido({ club_id: CLUB, full_name: "X", role: "cashier", username: "xxx", pin: 48291 })
  assert(!r.ok && r.errores.pin)
})

Deno.test("usuario con el mismo formato que el CHECK de la base", () => {
  for (const username of ["ab", "-abc", "a b", "x".repeat(33)]) {
    const r = validarPedido({ club_id: CLUB, full_name: "X", role: "cashier", username, pin: "482913" })
    assert(!r.ok && r.errores.username, `usuario ${username} debia rechazarse`)
  }
})

Deno.test("club_admin: email valido y contrasena de 8 o mas", () => {
  const r = validarPedido({ club_id: CLUB, full_name: "X", role: "club_admin", email: "no-es-email", password: "corta" })
  assert(!r.ok && r.errores.email && r.errores.password)
})

Deno.test("cuerpo que no es objeto", () => {
  for (const cuerpo of [null, "texto", [1, 2], 5]) assert(!validarPedido(cuerpo).ok)
})

Deno.test("esPinTrivial", () => {
  assert(esPinTrivial("000000") && esPinTrivial("234567") && esPinTrivial("876543"))
  assert(!esPinTrivial("482913") && !esPinTrivial("135790"))
})
