// Perfil del administrador de plataforma (archivo 19). Repite como ayuda
// las reglas de la base: nombre de 1 a 60 caracteres, apellido opcional de
// hasta 60, telefono opcional con digitos, espacios, guiones o parentesis.
import type { DatosPerfil } from "./datos"

export type FormPerfil = { nombre: string; apellido: string; telefono: string }
export type ErroresPerfil = Partial<Record<keyof FormPerfil, string>>

export const TELEFONO = /^\+?[0-9][0-9 ()-]{5,24}$/

export function validarPerfil(f: FormPerfil): { ok: true; valor: DatosPerfil } | { ok: false; errores: ErroresPerfil } {
  const nombre = f.nombre.trim()
  const apellido = f.apellido.trim()
  const telefono = f.telefono.trim()
  const errores: ErroresPerfil = {}
  if (!nombre) errores.nombre = "Escribí tu nombre."
  else if (nombre.length > 60) errores.nombre = "Máximo 60 caracteres."
  if (apellido.length > 60) errores.apellido = "Máximo 60 caracteres."
  if (telefono && !TELEFONO.test(telefono)) errores.telefono = "Solo números, espacios, guiones o paréntesis (ej. +54 9 11 5555-0000)."
  if (Object.keys(errores).length > 0) return { ok: false, errores }
  return { ok: true, valor: { first_name: nombre, last_name: apellido || null, phone: telefono || null } }
}
