"use strict";

const supabase = require("../config/supabase");
const {
  withSupabaseRetry,
  createSupabaseError,
} = require("../utils/supabaseRetry");
const { decidirAccesoChat } = require("../services/chatAccessPolicy");

// El JWT identifica la sesión; los privilegios y la vinculación se consultan en BD.
async function chatOnly(req, res, next) {
  try {
    const idUsuario = req.usuario?.id;
    if (!idUsuario)
      return res.status(401).json({ exito: false, error: "Sesión inválida." });

    const { data: usuarioActual, error: usuarioError } =
      await withSupabaseRetry(
        () =>
          supabase
            .from("usuarios")
            .select("id, rol")
            .eq("id", idUsuario)
            .maybeSingle(),
        { label: "Autorización de acceso al asistente IA" },
      );
    if (usuarioError)
      return next(
        createSupabaseError(
          usuarioError,
          "No fue posible verificar el acceso al asistente",
        ),
      );

    // Los administradores vigentes pueden utilizar también el asistente.
    if (!usuarioActual || usuarioActual.rol !== "empleado") {
      const decision = decidirAccesoChat(usuarioActual, null);
      if (!decision.permitido)
        return res
          .status(decision.status)
          .json({ exito: false, error: decision.error });
      req.usuario.rol = usuarioActual.rol;
      return next();
    }

    const { data: empleado, error: empleadoError } = await withSupabaseRetry(
      () =>
        supabase
          .from("empleados")
          .select("id_empleado, estado")
          .eq("id_usuario", idUsuario)
          .maybeSingle(),
      { label: "Verificación de cuenta laboral vinculada" },
    );
    if (empleadoError)
      return next(
        createSupabaseError(
          empleadoError,
          "No fue posible verificar el vínculo laboral",
        ),
      );

    const decision = decidirAccesoChat(usuarioActual, empleado);
    if (!decision.permitido)
      return res
        .status(decision.status)
        .json({ exito: false, error: decision.error });
    req.usuario.rol = usuarioActual.rol;
    req.usuario.id_empleado = empleado.id_empleado;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = chatOnly;
