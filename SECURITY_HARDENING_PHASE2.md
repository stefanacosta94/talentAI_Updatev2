# Security Hardening — Fase 2 (Supabase)

## Hallazgos confirmados de la auditoría

- Los buckets `curriculums` y `documentos_empresa` estaban `public = true`.
- Ambos buckets tenían policies `FOR ALL` asignadas al rol PostgreSQL `public`.
- Ocho tablas de negocio tenían RLS deshabilitado.
- `anon` y `authenticated` tenían privilegios DML amplios sobre las tablas de `public`.
- El proyecto ya tiene `vector` 0.8.0 y una columna `base_conocimiento.vector_embedding`, útil para el futuro RAG.

## Arquitectura de seguridad seleccionada

El navegador **no** se comunica directamente con Supabase.

```text
Browser
   |
   | JWT de la aplicación
   v
Express API
   |
   | SUPABASE_SERVICE_ROLE_KEY (solo servidor)
   v
Supabase
```

Esto permite que Express sea la frontera de autenticación/autorización mientras Supabase queda cerrado a clientes directos.

## Orden obligatorio

1. Copiar `.env.example` a la configuración local y agregar `SUPABASE_SERVICE_ROLE_KEY`.
2. Nunca poner esa llave en `rrhh-frontend`, GitHub, screenshots o documentación pública.
3. Ejecutar `npm install` y `npm test`.
4. Arrancar el backend y validar login + endpoints básicos.
5. Ejecutar `supabase/00_preflight_security_check.sql`.
6. Ejecutar `supabase/01_server_only_rls_and_private_storage.sql`.
7. Volver a validar:
   - vacantes públicas a través de Express,
   - postulación con PDF,
   - login admin,
   - candidatos y apertura temporal de CV,
   - carga/listado/apertura/eliminación de documentos.
8. Cuando todo esté estable, ejecutar opcionalmente `02_optional_revoke_direct_client_access.sql`.

## Cambio de Storage

Los registros nuevos ya no guardan una URL pública permanente. Las columnas existentes
`url_archivo_cv` y `url_archivo` se conservan por compatibilidad, pero guardan la ruta interna
del objeto. Cuando el frontend necesita abrir un PDF, Express genera una URL firmada temporal
con duración de 5 minutos.

El código también entiende URLs públicas antiguas para facilitar la transición.

## Nota arquitectónica

En una fase posterior conviene renombrar:

- `aplicaciones_ats.url_archivo_cv` -> `storage_path_cv`
- `base_conocimiento.url_archivo` -> `storage_path`

No se hace ahora para evitar una migración destructiva mientras estabilizamos la aplicación.
