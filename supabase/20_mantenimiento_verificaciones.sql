-- Ejecutar de manera programada (diario) desde un contexto administrativo;
-- NO ejecutar como anon/authenticated. Se eliminan OTP de más de 48 horas.
SELECT public.ats_purgar_verificaciones_correo() AS registros_purgados;
