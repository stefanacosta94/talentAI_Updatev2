# Security Hardening - Phase 1

Cambios aplicados sobre el snapshot auditado:

- Registro público fuerza rol `empleado`; el cliente no puede elevar privilegios.
- Validación de roles permitidos en gestión administrativa.
- Login con rate limiting dedicado (10 intentos / 15 minutos).
- JWT restringido a HS256 y validación estricta del header Bearer.
- Rutas `/api/admin/*` revalidan en base de datos que la cuenta exista y conserve rol admin.
- Prevención de auto-eliminación y auto-degradación de un administrador activo.
- La creación administrativa de usuarios ya no devuelve `password_hash`.
- Passwords nuevos usan bcrypt con 12 rondas y política de 8-128 caracteres.
- Validación de correo y normalización a minúsculas.
- Uploads PDF limitados a un archivo, máximo 5 MB, MIME `application/pdf` y magic bytes `%PDF-`.
- Sanitización de componentes de nombre de archivo.
- Mitigación de Stored XSS en vistas críticas mediante escape de valores dinámicos.
- URLs dinámicas del frontend limitadas a HTTP/HTTPS.
- Manejo de errores de Multer y ocultamiento de errores internos en `NODE_ENV=production`.
- Se agregaron pruebas unitarias de utilidades de seguridad con `node:test`.

Pendiente para la fase de Supabase:

- Migrar buckets `curriculums` y `documentos_empresa` a privados.
- Sustituir URLs públicas por rutas de objeto + URLs firmadas temporales.
- Revisar RLS, Storage Policies, constraints, índices y permisos de la anon key.
- Definir si el backend debe usar una Service Role key exclusivamente en servidor.
