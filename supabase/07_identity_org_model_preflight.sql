/*
=========================================================
FASE 4A - PREFLIGHT DEL MODELO DE IDENTIDAD Y ORGANIZACIÓN
Proyecto: TalentAI / Plataforma Web con IA para RR.HH.

Audita usuarios, empleados, departamentos y roles, además
 de las relaciones que otras tablas mantienen con ellos.

REGENERADO: 2026-10-30 (Fase 4A).
SOLO LECTURA: no crea objetos ni modifica datos, permisos,
RLS o Storage.
=========================================================
*/

WITH
 target_tables AS (
   SELECT unnest(ARRAY['usuarios','empleados','departamentos','roles']) AS table_name
 ),
 row_counts AS (
   SELECT jsonb_build_object(
     'usuarios',      (SELECT count(*) FROM public.usuarios),
     'empleados',     (SELECT count(*) FROM public.empleados),
     'departamentos', (SELECT count(*) FROM public.departamentos),
     'roles',         (SELECT count(*) FROM public.roles)
   ) AS data
 ),
 columns_info AS (
   SELECT COALESCE(jsonb_agg(jsonb_build_object(
     'table', c.table_name,
     'position', c.ordinal_position,
     'column', c.column_name,
     'data_type', c.data_type,
     'udt_name', c.udt_name,
     'nullable', c.is_nullable,
     'default', c.column_default,
     'max_length', c.character_maximum_length,
     'identity', c.is_identity,
     'identity_generation', c.identity_generation
   ) ORDER BY c.table_name, c.ordinal_position), '[]'::jsonb) AS data
   FROM information_schema.columns c
   JOIN target_tables t ON t.table_name = c.table_name
   WHERE c.table_schema = 'public'
 ),
 constraints_info AS (
   SELECT COALESCE(jsonb_agg(jsonb_build_object(
     'table', tbl.relname,
     'constraint', con.conname,
     'type', CASE con.contype
       WHEN 'p' THEN 'PRIMARY KEY'
       WHEN 'f' THEN 'FOREIGN KEY'
       WHEN 'u' THEN 'UNIQUE'
       WHEN 'c' THEN 'CHECK'
       WHEN 'x' THEN 'EXCLUSION'
       ELSE con.contype::text
     END,
     'definition', pg_get_constraintdef(con.oid, true)
   ) ORDER BY tbl.relname, con.conname), '[]'::jsonb) AS data
   FROM pg_constraint con
   JOIN pg_class tbl ON tbl.oid = con.conrelid
   JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
   JOIN target_tables t ON t.table_name = tbl.relname
   WHERE ns.nspname = 'public'
 ),
 indexes_info AS (
   SELECT COALESCE(jsonb_agg(jsonb_build_object(
     'table', i.tablename,
     'index', i.indexname,
     'definition', i.indexdef
   ) ORDER BY i.tablename, i.indexname), '[]'::jsonb) AS data
   FROM pg_indexes i
   JOIN target_tables t ON t.table_name = i.tablename
   WHERE i.schemaname = 'public'
 ),
 all_fk_relationships AS (
   SELECT COALESCE(jsonb_agg(jsonb_build_object(
     'source_table', src.relname,
     'constraint', con.conname,
     'target_table', tgt.relname,
     'definition', pg_get_constraintdef(con.oid, true),
     'on_update', CASE con.confupdtype
       WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
       WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
       WHEN 'd' THEN 'SET DEFAULT' ELSE con.confupdtype::text END,
     'on_delete', CASE con.confdeltype
       WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
       WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
       WHEN 'd' THEN 'SET DEFAULT' ELSE con.confdeltype::text END
   ) ORDER BY src.relname, con.conname), '[]'::jsonb) AS data
   FROM pg_constraint con
   JOIN pg_class src ON src.oid = con.conrelid
   JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
   JOIN pg_class tgt ON tgt.oid = con.confrelid
   JOIN pg_namespace tgt_ns ON tgt_ns.oid = tgt.relnamespace
   WHERE con.contype = 'f'
     AND src_ns.nspname = 'public'
     AND tgt_ns.nspname = 'public'
     AND (
       src.relname IN ('usuarios','empleados','departamentos','roles')
       OR tgt.relname IN ('usuarios','empleados','departamentos','roles')
     )
 ),
 domain_values AS (
   SELECT jsonb_build_object(
     'usuarios.rol', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('value', rol, 'count', n) ORDER BY rol)
       FROM (SELECT rol, count(*) n FROM public.usuarios GROUP BY rol) s
     ), '[]'::jsonb),
     'empleados.estado', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('value', estado, 'count', n) ORDER BY estado)
       FROM (SELECT estado, count(*) n FROM public.empleados GROUP BY estado) s
     ), '[]'::jsonb),
     'roles.nivel_permiso', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('value', nivel_permiso, 'count', n) ORDER BY nivel_permiso)
       FROM (SELECT nivel_permiso, count(*) n FROM public.roles GROUP BY nivel_permiso) s
     ), '[]'::jsonb)
   ) AS data
 ),
 catalogs AS (
   SELECT jsonb_build_object(
     'departamentos', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
         'id_departamento', id_departamento,
         'nombre', nombre
       ) ORDER BY id_departamento)
       FROM public.departamentos
     ), '[]'::jsonb),
     'roles', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
         'id_rol', id_rol,
         'nombre_rol', nombre_rol,
         'nivel_permiso', nivel_permiso
       ) ORDER BY id_rol)
       FROM public.roles
     ), '[]'::jsonb)
   ) AS data
 ),
 email_health AS (
   SELECT jsonb_build_object(
     'usuarios_blank_email', (SELECT count(*) FROM public.usuarios WHERE email IS NULL OR trim(email) = ''),
     'empleados_blank_email', (SELECT count(*) FROM public.empleados WHERE correo IS NULL OR trim(correo) = ''),
     'usuarios_not_normalized', (SELECT count(*) FROM public.usuarios WHERE email IS NOT NULL AND email <> lower(trim(email))),
     'empleados_not_normalized', (SELECT count(*) FROM public.empleados WHERE correo IS NOT NULL AND correo <> lower(trim(correo))),
     'usuarios_duplicate_normalized_email', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('email', email_norm, 'count', n) ORDER BY email_norm)
       FROM (
         SELECT lower(trim(email)) email_norm, count(*) n
         FROM public.usuarios
         WHERE email IS NOT NULL AND trim(email) <> ''
         GROUP BY lower(trim(email)) HAVING count(*) > 1
       ) d
     ), '[]'::jsonb),
     'empleados_duplicate_normalized_email', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('email', email_norm, 'count', n) ORDER BY email_norm)
       FROM (
         SELECT lower(trim(correo)) email_norm, count(*) n
         FROM public.empleados
         WHERE correo IS NOT NULL AND trim(correo) <> ''
         GROUP BY lower(trim(correo)) HAVING count(*) > 1
       ) d
     ), '[]'::jsonb)
   ) AS data
 ),
 user_employee_mapping AS (
   SELECT jsonb_build_object(
     'exact_email_matches', (
       SELECT count(*) FROM public.usuarios u
       JOIN public.empleados e ON lower(trim(u.email)) = lower(trim(e.correo))
     ),
     'usuarios_without_employee', (
       SELECT count(*) FROM public.usuarios u
       WHERE NOT EXISTS (
         SELECT 1 FROM public.empleados e
         WHERE lower(trim(e.correo)) = lower(trim(u.email))
       )
     ),
     'empleados_without_usuario', (
       SELECT count(*) FROM public.empleados e
       WHERE NOT EXISTS (
         SELECT 1 FROM public.usuarios u
         WHERE lower(trim(u.email)) = lower(trim(e.correo))
       )
     ),
     'matches', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
         'usuario_id', u.id,
         'usuario_nombre', u.nombre,
         'usuario_email', u.email,
         'usuario_rol_sistema', u.rol,
         'empleado_id', e.id_empleado,
         'empleado_nombre', e.nombre,
         'empleado_correo', e.correo,
         'empleado_estado', e.estado,
         'id_departamento', e.id_departamento,
         'id_rol', e.id_rol
       ) ORDER BY u.id)
       FROM public.usuarios u
       JOIN public.empleados e ON lower(trim(u.email)) = lower(trim(e.correo))
     ), '[]'::jsonb)
   ) AS data
 ),
 employee_fk_health AS (
   SELECT jsonb_build_object(
     'employees_total', (SELECT count(*) FROM public.empleados),
     'without_department', (SELECT count(*) FROM public.empleados WHERE id_departamento IS NULL),
     'orphan_department', (
       SELECT count(*) FROM public.empleados e
       LEFT JOIN public.departamentos d ON d.id_departamento = e.id_departamento
       WHERE e.id_departamento IS NOT NULL AND d.id_departamento IS NULL
     ),
     'without_role', (SELECT count(*) FROM public.empleados WHERE id_rol IS NULL),
     'orphan_role', (
       SELECT count(*) FROM public.empleados e
       LEFT JOIN public.roles r ON r.id_rol = e.id_rol
       WHERE e.id_rol IS NOT NULL AND r.id_rol IS NULL
     )
   ) AS data
 ),
 catalog_duplicate_health AS (
   SELECT jsonb_build_object(
     'departamentos_duplicate_names', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('nombre', nombre_norm, 'count', n) ORDER BY nombre_norm)
       FROM (
         SELECT lower(trim(nombre)) nombre_norm, count(*) n
         FROM public.departamentos
         GROUP BY lower(trim(nombre)) HAVING count(*) > 1
       ) d
     ), '[]'::jsonb),
     'roles_duplicate_names', COALESCE((
       SELECT jsonb_agg(jsonb_build_object('nombre_rol', nombre_norm, 'count', n) ORDER BY nombre_norm)
       FROM (
         SELECT lower(trim(nombre_rol)) nombre_norm, count(*) n
         FROM public.roles
         GROUP BY lower(trim(nombre_rol)) HAVING count(*) > 1
       ) d
     ), '[]'::jsonb)
   ) AS data
 ),
 rls_status AS (
   SELECT COALESCE(jsonb_agg(jsonb_build_object(
     'table', c.relname,
     'rls_enabled', c.relrowsecurity,
     'rls_forced', c.relforcerowsecurity
   ) ORDER BY c.relname), '[]'::jsonb) AS data
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   JOIN target_tables t ON t.table_name = c.relname
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
 ),
 sequence_identity_info AS (
   SELECT COALESCE(jsonb_agg(jsonb_build_object(
     'table', c.table_name,
     'column', c.column_name,
     'default', c.column_default,
     'identity', c.is_identity,
     'identity_generation', c.identity_generation
   ) ORDER BY c.table_name, c.ordinal_position), '[]'::jsonb) AS data
   FROM information_schema.columns c
   JOIN target_tables t ON t.table_name = c.table_name
   WHERE c.table_schema = 'public'
     AND (c.column_default LIKE 'nextval(%' OR c.is_identity = 'YES')
 )
SELECT '01_ROW_COUNTS' AS section, data FROM row_counts
UNION ALL SELECT '02_COLUMNS', data FROM columns_info
UNION ALL SELECT '03_CONSTRAINTS', data FROM constraints_info
UNION ALL SELECT '04_INDEXES', data FROM indexes_info
UNION ALL SELECT '05_ALL_FK_RELATIONSHIPS', data FROM all_fk_relationships
UNION ALL SELECT '06_DOMAIN_VALUES', data FROM domain_values
UNION ALL SELECT '07_CATALOGS', data FROM catalogs
UNION ALL SELECT '08_EMAIL_HEALTH', data FROM email_health
UNION ALL SELECT '09_USER_EMPLOYEE_MAPPING', data FROM user_employee_mapping
UNION ALL SELECT '10_EMPLOYEE_FK_HEALTH', data FROM employee_fk_health
UNION ALL SELECT '11_CATALOG_DUPLICATES', data FROM catalog_duplicate_health
UNION ALL SELECT '12_RLS_STATUS', data FROM rls_status
UNION ALL SELECT '13_SEQUENCE_IDENTITY', data FROM sequence_identity_info
ORDER BY section;
